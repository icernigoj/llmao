/**
 * A drop-in replacement for the `openai` client:
 *
 * ```ts
 * import OpenAI from 'llmao/openai'; // was: import OpenAI from 'openai'
 * const client = new OpenAI();
 * await client.chat.completions.create({ model: 'gpt-4o', messages });
 * ```
 */
import { respond, type EngineOptions } from './engine';
import type { LlmaoAPIError } from './errors';
import { MODELS } from './models';
import { withRetries } from './retry';
import { chunkString, LlmaoStream, randomId } from './stream';
import type { Answer, JsonSchema, ToolChoice, ToolResult, Turn } from './types';

/*
 * Request types are deliberately loose: anything written for the official SDK
 * (images, audio, custom tools...) is accepted, and what llmao does not
 * understand is ignored at runtime.
 */

export interface ChatCompletionMessageParam {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool' | 'function';
  content?: unknown;
  name?: string;
  tool_calls?: ReadonlyArray<{ id: string; type: string; function?: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ChatCompletionTool {
  type: string;
  function?: { name: string; description?: string; parameters?: unknown };
}

export type ChatCompletionToolChoiceOption = string | { type: string; function?: { name: string } };

export interface ChatCompletionCreateParams {
  model: string;
  messages: ReadonlyArray<ChatCompletionMessageParam>;
  stream?: boolean | null;
  temperature?: number | null;
  seed?: number | null;
  tools?: ReadonlyArray<ChatCompletionTool>;
  tool_choice?: ChatCompletionToolChoiceOption;
  stream_options?: { include_usage?: boolean } | null;
  response_format?: { type: string; json_schema?: { name?: string; schema?: unknown } };
}

export type ChatCompletionCreateResult<P extends ChatCompletionCreateParams> = P extends { stream: true }
  ? LlmaoStream<ChatCompletionChunk>
  : P extends { stream: boolean }
    ? P extends { stream: false }
      ? ChatCompletion
      : ChatCompletion | LlmaoStream<ChatCompletionChunk>
    : ChatCompletion;

export interface ChatCompletionMessageToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      refusal: string | null;
      tool_calls?: ChatCompletionMessageToolCall[];
    };
    finish_reason: FinishReason;
    logprobs: null;
  }>;
  usage?: CompletionUsage;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: FinishReason | null;
    logprobs?: null;
  }>;
  usage?: CompletionUsage | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export class OpenAIError extends Error {}

/** Same shape as the SDK's `APIError`, so `error.status` and friends work */
export class APIError extends OpenAIError {
  readonly code: string | null | undefined;
  readonly param: string | null | undefined;
  readonly type: string | undefined;
  readonly requestID: string | null | undefined;

  constructor(
    readonly status: number | undefined,
    readonly error: { message: string; type?: string; code?: string | null; param?: string | null } | undefined,
    message: string | undefined,
    readonly headers: Headers | undefined,
  ) {
    super(status ? `${status} ${message ?? ''}`.trim() : (message ?? 'Unknown error'));
    this.name = new.target.name;
    this.code = error?.code;
    this.param = error?.param;
    this.type = error?.type;
    this.requestID = headers?.get('x-request-id');
  }
}

export class APIConnectionError extends APIError {
  constructor({ message }: { message?: string } = {}) {
    super(undefined, undefined, message ?? 'Connection error.', undefined);
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? 'Request timed out.' });
  }
}

export class RateLimitError extends APIError {}

export class InternalServerError extends APIError {}

export function toOpenAIError(error: LlmaoAPIError): APIError {
  const headers = new Headers({ 'x-request-id': `req_lmao${randomId(16)}` });
  switch (error.kind) {
    case 'rate_limit':
      headers.set('retry-after', String(error.retryAfter));
      return new RateLimitError(429, { message: error.message, type: 'requests', code: 'rate_limit_exceeded', param: null }, error.message, headers);
    case 'server_error':
      return new InternalServerError(500, { message: error.message, type: 'server_error', code: null, param: null }, error.message, headers);
    case 'timeout':
      return new APIConnectionTimeoutError({ message: error.message });
  }
}

export interface ParsedChatCompletion<T> extends ChatCompletion {
  choices: Array<ChatCompletion['choices'][number] & { message: ChatCompletion['choices'][number]['message'] & { parsed: T | null } }>;
}

export interface ClientOptions extends EngineOptions {
  /** Retries for simulated failures, like the real SDK  @default 2 */
  maxRetries?: number;
  /** Accepted for compatibility.  llmao does not need one, and will not tell anyone */
  apiKey?: string;
  baseURL?: string;
  [key: string]: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: { type?: unknown; text?: unknown }) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('\n');
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toTurns(messages: ReadonlyArray<ChatCompletionMessageParam>): Turn[] {
  const turns: Turn[] = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      turns.push({ role: 'system', text: textOf(message.content) });
    } else if (message.role === 'user') {
      turns.push({ role: 'user', text: textOf(message.content) });
    } else if (message.role === 'assistant') {
      const toolCalls = (message.tool_calls ?? []).flatMap((call) => {
        if (!call.function) return [];
        toolNames.set(call.id, call.function.name);
        return [{ id: call.id, name: call.function.name, args: parseArguments(call.function.arguments) }];
      });
      turns.push({ role: 'assistant', text: textOf(message.content), toolCalls });
    } else if (message.role === 'tool' && message.tool_call_id) {
      const result: ToolResult = {
        toolCallId: message.tool_call_id,
        name: toolNames.get(message.tool_call_id) ?? 'tool',
        content: textOf(message.content),
      };
      const previous = turns[turns.length - 1];
      if (previous?.role === 'tool') previous.results.push(result);
      else turns.push({ role: 'tool', results: [result] });
    }
  }

  return turns;
}

function toToolChoice(choice: ChatCompletionToolChoiceOption | undefined): ToolChoice | undefined {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  if (typeof choice === 'object' && choice.function) return { name: choice.function.name };
  return undefined;
}

function toUsage(answer: Answer): CompletionUsage {
  const completion = answer.usage.outputTokens + answer.usage.reasoningTokens;
  return {
    prompt_tokens: answer.usage.inputTokens,
    completion_tokens: completion,
    total_tokens: answer.usage.inputTokens + completion,
    completion_tokens_details: { reasoning_tokens: answer.usage.reasoningTokens },
  };
}

function toToolCalls(answer: Answer): ChatCompletionMessageToolCall[] {
  return answer.toolCalls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
}

class Completions {
  constructor(private readonly options: ClientOptions) {}

  create<P extends ChatCompletionCreateParams>(params: P, options?: RequestOptions): Promise<ChatCompletionCreateResult<P>> {
    return this.run(params, options) as Promise<ChatCompletionCreateResult<P>>;
  }

  /** Like `create`, but also parses structured output into `message.parsed` */
  async parse<T = unknown>(
    params: ChatCompletionCreateParams & { response_format?: { $parseRaw?: (content: string) => T } },
    options?: RequestOptions,
  ): Promise<ParsedChatCompletion<T>> {
    const completion = (await this.run({ ...params, stream: false }, options)) as ChatCompletion;
    const parseRaw = params.response_format?.$parseRaw;
    return {
      ...completion,
      choices: completion.choices.map((choice) => {
        const content = choice.message.content;
        const parsed =
          content === null || !params.response_format?.type.startsWith('json')
            ? null
            : parseRaw
              ? parseRaw(content)
              : (JSON.parse(content) as T);
        return { ...choice, message: { ...choice.message, parsed } };
      }),
    };
  }

  private async run(
    params: ChatCompletionCreateParams,
    options: RequestOptions = {},
  ): Promise<ChatCompletion | LlmaoStream<ChatCompletionChunk>> {
    const format = params.response_format;
    const response = await withRetries(
      (attempt) =>
        respond(
          {
            turns: toTurns(params.messages),
            tools: params.tools?.flatMap((tool) =>
              tool.type === 'function' && tool.function
                ? [{ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters as JsonSchema }]
                : [],
            ),
            toolChoice: toToolChoice(params.tool_choice),
            responseFormat:
              format?.type === 'json_schema' || format?.type === 'json_object'
                ? { type: 'json', schema: format.json_schema?.schema as JsonSchema | undefined }
                : undefined,
          },
          {
            ...this.options,
            model: params.model,
            temperature: params.temperature ?? this.options.temperature,
            seed: params.seed ?? this.options.seed,
            attempt,
            trace: { provider: 'openai', params },
          },
        ),
      { maxRetries: this.options.maxRetries ?? 2, speed: this.options.speed, signal: options.signal, toError: toOpenAIError },
    );

    const id = `chatcmpl-lmao${randomId(20)}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, created, model: params.model, system_fingerprint: 'fp_regex' };
    const finishReason: FinishReason = response.answer.toolCalls.length > 0 ? 'tool_calls' : 'stop';

    if (!params.stream) {
      const answer = await response.wait(options.signal);
      const toolCalls = toToolCalls(answer);
      return {
        ...base,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: toolCalls.length > 0 ? null : answer.text,
              refusal: null,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: finishReason,
            logprobs: null,
          },
        ],
        usage: toUsage(answer),
      };
    }

    const includeUsage = params.stream_options?.include_usage === true;

    return new LlmaoStream<ChatCompletionChunk>(async function* (signal) {
      const chunk = (
        delta: ChatCompletionChunk['choices'][number]['delta'],
        finish: FinishReason | null = null,
      ): ChatCompletionChunk => ({
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
        ...(includeUsage ? { usage: null } : {}),
      });

      yield chunk({ role: 'assistant', content: '' });
      const hasToolCalls = response.answer.toolCalls.length > 0;
      let toolIndex = 0;

      for await (const event of response.events(signal)) {
        if (event.type === 'text-delta' && !hasToolCalls) {
          yield chunk({ content: event.delta });
        } else if (event.type === 'tool-call') {
          const index = toolIndex++;
          yield chunk({
            tool_calls: [{ index, id: event.toolCall.id, type: 'function', function: { name: event.toolCall.name, arguments: '' } }],
          });
          for (const piece of chunkString(JSON.stringify(event.toolCall.args))) {
            yield chunk({ tool_calls: [{ index, function: { arguments: piece } }] });
          }
        } else if (event.type === 'finish') {
          yield chunk({}, finishReason);
          if (includeUsage) {
            yield { ...base, object: 'chat.completion.chunk', choices: [], usage: toUsage(event.answer) };
          }
        }
      }
    }, options.signal);
  }
}

export class OpenAI {
  static OpenAIError = OpenAIError;
  static APIError = APIError;
  static APIConnectionError = APIConnectionError;
  static APIConnectionTimeoutError = APIConnectionTimeoutError;
  static RateLimitError = RateLimitError;
  static InternalServerError = InternalServerError;

  readonly chat: { completions: Completions };
  readonly models: {
    list(): Promise<{ object: 'list'; data: Array<{ id: string; object: 'model'; created: number; owned_by: string }> }>;
  };

  constructor(options: ClientOptions = {}) {
    this.chat = { completions: new Completions(options) };
    this.models = {
      async list() {
        return {
          object: 'list',
          data: Object.keys(MODELS).map((id) => ({ id, object: 'model', created: 1_700_000_000, owned_by: 'llmao' })),
        };
      },
    };
  }
}

export default OpenAI;
