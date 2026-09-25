/**
 * A Vercel AI SDK provider:
 *
 * ```ts
 * import { generateText } from 'ai';
 * import { llmao } from 'llmao/ai-sdk';
 *
 * const { text } = await generateText({ model: llmao('lmao-1'), prompt: 'Is 7 prime?' });
 * ```
 */
import {
  APICallError,
  NoSuchModelError,
  type EmbeddingModelV4,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FinishReason,
  type LanguageModelV4Prompt,
  type LanguageModelV4StreamPart,
  type LanguageModelV4ToolResultOutput,
  type LanguageModelV4Usage,
  type ProviderV4,
  type SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import { embed } from './embeddings';
import { respond, type EngineOptions, type Response } from './engine';
import { LlmaoAPIError } from './errors';
import { randomId } from './stream';
import { countTokens } from './tokens';
import type { Answer, ToolChoice, Turn } from './types';
import type { ModelId } from './models';

function outputText(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return `Execution denied${output.reason ? `: ${output.reason}` : ''}`;
    case 'content':
      return output.value.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  }
}

function toTurns(prompt: LanguageModelV4Prompt): Turn[] {
  const turns: Turn[] = [];
  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        turns.push({ role: 'system', text: message.content });
        break;
      case 'user':
        turns.push({
          role: 'user',
          text: message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n'),
        });
        break;
      case 'assistant':
        turns.push({
          role: 'assistant',
          text: message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
          toolCalls: message.content.flatMap((part) =>
            part.type === 'tool-call'
              ? [{ id: part.toolCallId, name: part.toolName, args: (part.input ?? {}) as Record<string, unknown> }]
              : [],
          ),
        });
        break;
      case 'tool':
        turns.push({
          role: 'tool',
          results: message.content.flatMap((part) =>
            part.type === 'tool-result'
              ? [{ toolCallId: part.toolCallId, name: part.toolName, content: outputText(part.output) }]
              : [],
          ),
        });
        break;
    }
  }
  return turns;
}

function toToolChoice(choice: LanguageModelV4CallOptions['toolChoice']): ToolChoice | undefined {
  if (!choice) return undefined;
  return choice.type === 'tool' ? { name: choice.toolName } : choice.type;
}

function toUsage(answer: Answer): LanguageModelV4Usage {
  return {
    inputTokens: { total: answer.usage.inputTokens, noCache: answer.usage.inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: {
      total: answer.usage.outputTokens + answer.usage.reasoningTokens,
      text: answer.usage.outputTokens,
      reasoning: answer.usage.reasoningTokens,
    },
  };
}

function finishReason(answer: Answer): LanguageModelV4FinishReason {
  return answer.toolCalls.length > 0 ? { unified: 'tool-calls', raw: 'tool_calls' } : { unified: 'stop', raw: 'stop' };
}

function metadata(answer: Answer): SharedV4ProviderMetadata {
  return {
    llmao: {
      confidence: answer.confidence,
      hallucinated: answer.hallucinated,
      skill: answer.skill,
      costUSD: answer.usage.costUSD,
    },
  };
}

function toAPICallError(error: LlmaoAPIError, requestBodyValues: unknown): APICallError {
  return new APICallError({
    message: error.message,
    url: 'https://llmao.invalid/v1/generate',
    requestBodyValues,
    statusCode: error.status,
    responseHeaders: error.kind === 'rate_limit' ? { 'retry-after': String(error.retryAfter) } : {},
    isRetryable: true,
  });
}

/** Waits for the simulated failure, if any, and throws it as the AI SDK expects */
async function throwFailure(response: Response, options: LanguageModelV4CallOptions): Promise<void> {
  if (!response.failure) return;
  try {
    await response.wait(options.abortSignal);
  } catch (error) {
    if (error instanceof LlmaoAPIError) throw toAPICallError(error, { prompt: options.prompt });
    throw error;
  }
}

class LlmaoLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4';
  readonly provider = 'llmao';
  readonly supportedUrls = {};

  constructor(
    readonly modelId: string,
    private readonly options: EngineOptions,
  ) {}

  private start(options: LanguageModelV4CallOptions) {
    return respond(
      {
        turns: toTurns(options.prompt),
        tools: options.tools?.flatMap((tool) =>
          tool.type === 'function' ? [{ name: tool.name, description: tool.description, parameters: tool.inputSchema as Record<string, unknown> }] : [],
        ),
        toolChoice: toToolChoice(options.toolChoice),
        responseFormat:
          options.responseFormat?.type === 'json' ? { type: 'json', schema: options.responseFormat.schema as Record<string, unknown> | undefined } : undefined,
      },
      {
        ...this.options,
        model: this.modelId,
        temperature: options.temperature ?? this.options.temperature,
        seed: options.seed ?? this.options.seed,
        reasoning: options.reasoning === 'none' ? false : this.options.reasoning,
        trace: { provider: 'ai-sdk', params: { ...options, abortSignal: undefined } },
      },
    );
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    const response = this.start(options);
    await throwFailure(response, options);
    const answer = await response.wait(options.abortSignal);

    const content: LanguageModelV4Content[] = [];
    if (answer.reasoning.length > 0) content.push({ type: 'reasoning', text: answer.reasoning.join('\n') });
    if (answer.text) content.push({ type: 'text', text: answer.text });
    for (const call of answer.toolCalls) {
      content.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.args) });
    }

    return {
      content,
      finishReason: finishReason(answer),
      usage: toUsage(answer),
      providerMetadata: metadata(answer),
      response: { id: `lmao-${randomId(16)}`, timestamp: new Date(), modelId: this.modelId },
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV4CallOptions) {
    const response = this.start(options);
    await throwFailure(response, options);
    const controller = new AbortController();
    options.abortSignal?.addEventListener('abort', () => controller.abort(options.abortSignal?.reason), { once: true });
    const events = response.events(controller.signal);
    const modelId = this.modelId;
    let started = false;

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async pull(enqueue) {
        if (!started) {
          started = true;
          enqueue.enqueue({ type: 'stream-start', warnings: [] });
          enqueue.enqueue({ type: 'response-metadata', id: `lmao-${randomId(16)}`, timestamp: new Date(), modelId });
        }

        let next: IteratorResult<Awaited<ReturnType<typeof events.next>>['value']>;
        try {
          next = await events.next();
        } catch (error) {
          enqueue.enqueue({ type: 'error', error });
          enqueue.close();
          return;
        }
        if (next.done) {
          enqueue.close();
          return;
        }

        const event = next.value;
        switch (event.type) {
          case 'reasoning-start':
          case 'reasoning-end':
            enqueue.enqueue({ type: event.type, id: 'reasoning-0' });
            break;
          case 'reasoning-delta':
            enqueue.enqueue({ type: 'reasoning-delta', id: 'reasoning-0', delta: event.delta });
            break;
          case 'text-start':
          case 'text-end':
            enqueue.enqueue({ type: event.type, id: 'text-0' });
            break;
          case 'text-delta':
            enqueue.enqueue({ type: 'text-delta', id: 'text-0', delta: event.delta });
            break;
          case 'tool-call': {
            const { id, name, args } = event.toolCall;
            const input = JSON.stringify(args);
            enqueue.enqueue({ type: 'tool-input-start', id, toolName: name });
            enqueue.enqueue({ type: 'tool-input-delta', id, delta: input });
            enqueue.enqueue({ type: 'tool-input-end', id });
            enqueue.enqueue({ type: 'tool-call', toolCallId: id, toolName: name, input });
            break;
          }
          case 'finish':
            enqueue.enqueue({
              type: 'finish',
              usage: toUsage(event.answer),
              finishReason: finishReason(event.answer),
              providerMetadata: metadata(event.answer),
            });
            break;
        }
      },
      cancel(reason) {
        controller.abort(reason);
      },
    });

    return { stream };
  }
}

class LlmaoEmbeddingModel implements EmbeddingModelV4 {
  readonly specificationVersion = 'v4';
  readonly provider = 'llmao';
  readonly maxEmbeddingsPerCall = undefined;
  readonly supportsParallelCalls = true;

  constructor(readonly modelId: string) {}

  async doEmbed({ values }: { values: string[] }) {
    return {
      embeddings: values.map(embed),
      usage: { tokens: values.reduce((total, value) => total + countTokens(value), 0) },
      warnings: [],
    };
  }
}

export interface LlmaoProvider extends ProviderV4 {
  (modelId?: ModelId): LanguageModelV4;
  languageModel(modelId?: ModelId): LanguageModelV4;
  embeddingModel(modelId?: string): EmbeddingModelV4;
  /* Aliases of the official providers' methods, so llmao can stand in for them */
  chat(modelId?: ModelId): LanguageModelV4;
  completion(modelId?: ModelId): LanguageModelV4;
  responses(modelId?: ModelId): LanguageModelV4;
  messages(modelId?: ModelId): LanguageModelV4;
  embedding(modelId?: string): EmbeddingModelV4;
  textEmbedding(modelId?: string): EmbeddingModelV4;
  textEmbeddingModel(modelId?: string): EmbeddingModelV4;
  image(modelId: string): never;
}

export function createLlmao(options: EngineOptions = {}): LlmaoProvider {
  const languageModel = (modelId: ModelId = 'lmao-1') => new LlmaoLanguageModel(modelId, options);
  const embeddingModel = (modelId = 'lmao-embed') => new LlmaoEmbeddingModel(modelId);
  const imageModel = (modelId: string): never => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel', message: 'llmao cannot draw. It can barely count.' });
  };

  return Object.assign(languageModel, {
    specificationVersion: 'v4' as const,
    languageModel,
    chat: languageModel,
    completion: languageModel,
    responses: languageModel,
    messages: languageModel,
    embeddingModel,
    embedding: embeddingModel,
    textEmbedding: embeddingModel,
    textEmbeddingModel: embeddingModel,
    imageModel,
    image: imageModel,
  });
}

/** The default llmao provider */
export const llmao = createLlmao();

/*
 * Same names as `@ai-sdk/openai` and `@ai-sdk/anthropic`, so tests can swap
 * them out: vi.mock('@ai-sdk/openai', () => import('llmao/ai-sdk'))
 */
export const openai = llmao;
export const createOpenAI = createLlmao;
export const anthropic = llmao;
export const createAnthropic = createLlmao;
