import type { Answer, FailureKind, LlmaoOptions, ToolDefinition, Turn } from './types';

export type Provider = 'llmao' | 'openai' | 'anthropic' | 'ai-sdk';

export interface RecordedCall {
  provider: Provider;
  model: string;
  /** The last user message */
  prompt: string;
  /** The system prompt, if any */
  system: string;
  turns: Turn[];
  tools: ToolDefinition[];
  /**
   * The request as your code sent it: the object passed to the SDK, or the
   * parsed JSON body when the call came through the HTTP server
   */
  params: unknown;
  /**
   * Request headers, lowercased.  Filled in for calls through the HTTP server,
   * where the official SDKs send e.g. `x-stainless-retry-count`
   */
  headers: Record<string, string>;
  /** 0 for the first attempt, then 1, 2… when llmao's own clients retry */
  attempt: number;
  /** What llmao answered, unless the call failed */
  answer?: Answer;
  /** The simulated failure, if any */
  failure?: FailureKind;
  /** Set when the call threw, e.g. an unscripted prompt in strict mode */
  error?: unknown;
}

interface Store {
  enabled: boolean;
  overrides: LlmaoOptions;
  calls: RecordedCall[];
}

// Shared through globalThis so that the ESM and CommonJS builds, which may
// both be loaded in the same test run, see the same configuration
const KEY = Symbol.for('llmao.testing');

export function testingStore(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  return (holder[KEY] ??= { enabled: false, overrides: {}, calls: [] });
}
