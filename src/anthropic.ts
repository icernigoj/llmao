/**
 * A drop-in replacement for the `@anthropic-ai/sdk` client:
 *
 * ```ts
 * import Anthropic from 'llmao/anthropic'; // was: import Anthropic from '@anthropic-ai/sdk'
 * const client = new Anthropic();
 * await client.messages.create({ model: 'claude-whatever', max_tokens: 1024, messages });
 * ```
 */
import { respond, type EngineOptions, type Response } from './engine';
import type { LlmaoAPIError } from './errors';
import { withRetries } from './retry';
import { chunkString, LlmaoStream, randomId } from './stream';
import type { Answer, JsonSchema, ToolChoice, ToolResult, Turn } from './types';

/*
 * Request types are deliberately loose: anything written for the official SDK
 * (images, documents, server tools...) is accepted, and what llmao does not
 * understand is ignored at runtime.
 */

export interface ContentBlockParam {
  type: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
}

export interface MessageParam {
  role: 'user' | 'assistant' | 'system';
  content: string | ReadonlyArray<ContentBlockParam>;
}

export interface Tool {
  /** Some server tools have no name, and llmao ignores them */
  name?: string;
  type?: string | null;
  description?: string;
  input_schema?: unknown;
}

export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: ReadonlyArray<MessageParam>;
  system?: string | ReadonlyArray<{ type: string; text?: unknown }>;
  temperature?: number;
  tools?: ReadonlyArray<Tool>;
  tool_choice?: { type: string; name?: string };
  thinking?: { type: string };
  output_config?: { format?: { type: string; schema?: unknown } | null } | null;
  stream?: boolean;
}

export type MessageCreateResult<P extends MessageCreateParams> = P extends { stream: true }
  ? LlmaoStream<MessageStreamEvent>
  : P extends { stream: boolean }
    ? P extends { stream: false }
      ? Message
      : Message | LlmaoStream<MessageStreamEvent>
    : Message;

export type ContentBlock =
  | { type: 'text'; text: string; citations: null }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; caller: { type: 'direct' } };

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation: null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  inference_geo: string | null;
  output_tokens_details: null;
  server_tool_use: null;
  service_tier: 'standard' | 'priority' | 'batch' | null;
}

export interface Message {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  container: null;
  content: ContentBlock[];
  stop_details: null;
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: Usage;
}

export type MessageStreamEvent =
  | { type: 'message_start'; message: Message }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'signature_delta'; signature: string }
        | { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: { stop_reason: StopReason | null; stop_sequence: string | null; stop_details: null; container: null };
      usage: {
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
        input_tokens: number | null;
        output_tokens: number;
        output_tokens_details: null;
        server_tool_use: null;
      };
    }
  | { type: 'message_stop' };

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string | undefined>;
}

export class AnthropicError extends Error {}

type ErrorBody = { type: 'error'; error: { type: string; message: string } };

/** Same shape as the SDK's `APIError`, so `error.status` and friends work */
export class APIError extends AnthropicError {
  readonly requestID: string | null | undefined;

  constructor(
    readonly status: number | undefined,
    readonly error: ErrorBody | undefined,
    message: string | undefined,
    readonly headers: Headers | undefined,
  ) {
    super(status ? `${status} ${JSON.stringify(error)}` : (message ?? 'Unknown error'));
    this.name = new.target.name;
    this.requestID = headers?.get('request-id');
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

export function toAnthropicError(error: LlmaoAPIError): APIError {
  const headers = new Headers({ 'request-id': `req_lmao${randomId(16)}` });
  switch (error.kind) {
    case 'rate_limit':
      headers.set('retry-after', String(error.retryAfter));
      return new RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: error.message } }, error.message, headers);
    case 'server_error':
      return new InternalServerError(500, { type: 'error', error: { type: 'api_error', message: error.message } }, error.message, headers);
    case 'timeout':
      return new APIConnectionTimeoutError({ message: error.message });
  }
}

export interface ClientOptions extends EngineOptions {
  /** Retries for simulated failures, like the real SDK  @default 2 */
  maxRetries?: number;
  /** Accepted for compatibility.  llmao does not need one */
  apiKey?: string;
  baseURL?: string;
  [key: string]: unknown;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((block: { type?: unknown; text?: unknown }) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function toTurns(params: MessageCreateParams): Turn[] {
  const turns: Turn[] = [];
  const system = textOf(params.system);
  if (system) turns.push({ role: 'system', text: system });

  const toolNames = new Map<string, string>();
  for (const message of params.messages) {
    const blocks: ReadonlyArray<ContentBlockParam> =
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;

    if (message.role === 'system') {
      turns.push({ role: 'system', text: textOf(blocks) });
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls = blocks.flatMap((block) => {
        if (block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') return [];
        toolNames.set(block.id, block.name);
        return [{ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> }];
      });
      turns.push({ role: 'assistant', text: textOf(blocks), toolCalls });
      continue;
    }

    const results: ToolResult[] = blocks.flatMap((block) =>
      block.type === 'tool_result' && typeof block.tool_use_id === 'string'
        ? [{ toolCallId: block.tool_use_id, name: toolNames.get(block.tool_use_id) ?? 'tool', content: textOf(block.content) }]
        : [],
    );
    const text = textOf(blocks);
    if (results.length > 0) turns.push({ role: 'tool', results });
    if (text || results.length === 0) turns.push({ role: 'user', text });
  }

  return turns;
}

function toToolChoice(choice: MessageCreateParams['tool_choice']): ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === 'tool' && choice.name) return { name: choice.name };
  if (choice.type === 'any') return 'required';
  if (choice.type === 'none') return 'none';
  return 'auto';
}

const signature = () => `lmao${randomId(40)}`;

function contentBlocks(answer: Answer, showThinking: boolean): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (showThinking && answer.reasoning.length > 0) {
    blocks.push({ type: 'thinking', thinking: answer.reasoning.join('\n'), signature: signature() });
  }
  if (answer.text) blocks.push({ type: 'text', text: answer.text, citations: null });
  for (const call of answer.toolCalls) {
    blocks.push({ type: 'tool_use', id: call.id.replace(/^call_/, 'toolu_'), name: call.name, input: call.args, caller: { type: 'direct' } });
  }
  return blocks;
}

function toUsage(answer: Answer): Usage {
  return {
    input_tokens: answer.usage.inputTokens,
    output_tokens: answer.usage.outputTokens + answer.usage.reasoningTokens,
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: 'standard',
  };
}

interface Prepared {
  response: Response;
  message: Message;
  showThinking: boolean;
}

function cleanHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).flatMap(([key, value]) => (value === undefined ? [] : [[key.toLowerCase(), value]])));
}

async function prepare(
  params: MessageCreateParams,
  options: ClientOptions,
  signal?: AbortSignal,
  headers?: Record<string, string | undefined>,
): Promise<Prepared> {
  const showThinking = params.thinking?.type === 'enabled' || params.thinking?.type === 'adaptive';
  const format = params.output_config?.format;
  const response = await withRetries(
    (attempt) =>
      respond(
        {
          turns: toTurns(params),
          tools: params.tools?.flatMap((tool) =>
            tool.name && tool.input_schema ? [{ name: tool.name, description: tool.description, parameters: tool.input_schema as JsonSchema }] : [],
          ),
          toolChoice: toToolChoice(params.tool_choice),
          responseFormat: format?.type === 'json_schema' ? { type: 'json', schema: format.schema as JsonSchema | undefined } : undefined,
        },
        { ...options, model: params.model, temperature: params.temperature ?? options.temperature, attempt, trace: { provider: 'anthropic', params, headers: cleanHeaders(headers) } },
      ),
    { maxRetries: options.maxRetries ?? 2, speed: options.speed, signal, toError: toAnthropicError },
  );
  const { answer } = response;
  const message: Message = {
    id: `msg_lmao${randomId(20)}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    container: null,
    content: contentBlocks(answer, showThinking),
    stop_details: null,
    stop_reason: answer.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: toUsage(answer),
  };
  return { response, message, showThinking };
}

async function* streamEvents({ response, message, showThinking }: Prepared, signal: AbortSignal): AsyncGenerator<MessageStreamEvent> {
  yield {
    type: 'message_start',
    message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 1 } },
  };

  let index = -1;
  let open: 'thinking' | 'text' | null = null;
  const close = function* (): Generator<MessageStreamEvent> {
    if (open === 'thinking') {
      const thinking = message.content.find((block) => block.type === 'thinking');
      yield { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: thinking?.type === 'thinking' ? thinking.signature : signature() } };
    }
    if (open) yield { type: 'content_block_stop', index };
    open = null;
  };

  for await (const event of response.events(signal)) {
    if (event.type === 'reasoning-start' && showThinking) {
      index++;
      open = 'thinking';
      yield { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } };
    } else if (event.type === 'reasoning-delta' && open === 'thinking') {
      yield { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: event.delta } };
    } else if (event.type === 'text-start') {
      yield* close();
      index++;
      open = 'text';
      yield { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } };
    } else if (event.type === 'text-delta') {
      yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: event.delta } };
    } else if (event.type === 'tool-call') {
      yield* close();
      index++;
      const id = event.toolCall.id.replace(/^call_/, 'toolu_');
      yield {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name: event.toolCall.name, input: {}, caller: { type: 'direct' } },
      };
      for (const piece of chunkString(JSON.stringify(event.toolCall.args))) {
        yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: piece } };
      }
      yield { type: 'content_block_stop', index };
    } else if (event.type === 'finish') {
      yield* close();
      yield {
        type: 'message_delta',
        delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: null, container: null },
        usage: {
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          output_tokens_details: null,
          server_tool_use: null,
        },
      };
      yield { type: 'message_stop' };
    }
  }
}

type MessageStreamListeners = {
  text: (delta: string, snapshot: string) => void;
  thinking: (delta: string, snapshot: string) => void;
  message: (message: Message) => void;
  end: () => void;
  error: (error: unknown) => void;
};

/** A small version of the SDK's `MessageStream`, returned by `messages.stream()` */
export class MessageStream implements AsyncIterable<MessageStreamEvent> {
  private readonly buffer: MessageStreamEvent[] = [];
  private readonly wakeUps: Array<() => void> = [];
  private readonly listeners: { [K in keyof MessageStreamListeners]: MessageStreamListeners[K][] } = {
    text: [],
    thinking: [],
    message: [],
    end: [],
    error: [],
  };
  private finished = false;
  private failure: { error: unknown } | null = null;
  private readonly done: Promise<Message>;
  readonly controller = new AbortController();

  constructor(start: (signal: AbortSignal) => Promise<Prepared>, signal?: AbortSignal) {
    if (signal) signal.addEventListener('abort', () => this.controller.abort(signal.reason), { once: true });
    this.done = this.run(start);
    // Errors are surfaced through the iterator, the listeners and finalMessage()
    this.done.catch(() => {});
  }

  private async run(start: (signal: AbortSignal) => Promise<Prepared>): Promise<Message> {
    let text = '';
    let thinking = '';
    try {
      // Let the caller attach listeners before anything happens
      await Promise.resolve();
      const prepared = await start(this.controller.signal);
      for await (const event of streamEvents(prepared, this.controller.signal)) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          for (const listener of this.listeners.text) listener(event.delta.text, text);
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
          thinking += event.delta.thinking;
          for (const listener of this.listeners.thinking) listener(event.delta.thinking, thinking);
        }
        this.buffer.push(event);
        this.wake();
      }
      for (const listener of this.listeners.message) listener(prepared.message);
      return prepared.message;
    } catch (error) {
      this.failure = { error };
      for (const listener of this.listeners.error) listener(error);
      throw error;
    } finally {
      this.finished = true;
      this.wake();
      for (const listener of this.listeners.end) listener();
    }
  }

  private wake() {
    for (const wakeUp of this.wakeUps.splice(0)) wakeUp();
  }

  on<K extends keyof MessageStreamListeners>(event: K, listener: MessageStreamListeners[K]): this {
    this.listeners[event].push(listener);
    return this;
  }

  abort(): void {
    this.controller.abort();
  }

  finalMessage(): Promise<Message> {
    return this.done;
  }

  async finalText(): Promise<string> {
    const message = await this.done;
    return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  }

  async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
    let position = 0;
    while (true) {
      if (position < this.buffer.length) {
        yield this.buffer[position++] as MessageStreamEvent;
      } else if (this.failure) {
        throw this.failure.error;
      } else if (this.finished) {
        return;
      } else {
        await new Promise<void>((resolve) => this.wakeUps.push(resolve));
      }
    }
  }
}

class Messages {
  constructor(private readonly options: ClientOptions) {}

  create<P extends MessageCreateParams>(params: P, options?: RequestOptions): Promise<MessageCreateResult<P>> {
    return this.run(params, options) as Promise<MessageCreateResult<P>>;
  }

  private async run(params: MessageCreateParams, options: RequestOptions = {}): Promise<Message | LlmaoStream<MessageStreamEvent>> {
    const prepared = await prepare(params, this.options, options.signal, options.headers);
    if (params.stream) {
      return new LlmaoStream((signal) => streamEvents(prepared, signal), options.signal);
    }
    await prepared.response.wait(options.signal);
    return prepared.message;
  }

  stream(params: MessageCreateParams, options: RequestOptions = {}): MessageStream {
    return new MessageStream((signal) => prepare(params, this.options, signal, options.headers), options.signal);
  }
}

export class Anthropic {
  static AnthropicError = AnthropicError;
  static APIError = APIError;
  static APIConnectionError = APIConnectionError;
  static APIConnectionTimeoutError = APIConnectionTimeoutError;
  static RateLimitError = RateLimitError;
  static InternalServerError = InternalServerError;

  readonly messages: Messages;

  constructor(options: ClientOptions = {}) {
    this.messages = new Messages(options);
  }
}

export default Anthropic;
