export type Language = 'en' | 'es';

export type Speed = 'instant' | 'fast' | 'realistic' | 'dramatic';

export interface LlmaoOptions {
  /**
   * Controls how much the model rambles and how often it hallucinates.
   * `0` gives a straight answer, `2` gives you a TED talk.
   * @default 1
   */
  temperature?: number;
  /**
   * Probability (0-1) of confidently answering something wrong.  Defaults to
   * `0.05 * temperature`.  Set it to `0` for a model that is always right,
   * which no real LLM can offer.
   */
  hallucinationRate?: number;
  /**
   * Makes answers reproducible: the same prompt with the same seed always
   * gets the same answer.  Without it, every answer is a surprise.
   */
  seed?: number;
  /**
   * How long the model pretends to think.  Use `instant` in tests.
   * @default 'realistic'
   */
  speed?: Speed;
  /**
   * Language of the answers.  `auto` answers in the language of the prompt.
   * @default 'auto'
   */
  language?: Language | 'auto';
  /** Whether to "think" before answering (reasoning steps) @default true */
  reasoning?: boolean;
  /**
   * Scripted answers for tests: rules are checked in order and the first
   * match wins.  Unmatched prompts are improvised, unless `unscripted` is
   * `'error'`.
   */
  script?: Script;
  /** What to do with prompts the script doesn't cover @default 'improvise' */
  unscripted?: 'improvise' | 'error';
  /** Probability (0-1) of each kind of failure, to test your error handling */
  failures?: Failures;
}

export type FailureKind = 'rate_limit' | 'server_error' | 'timeout';

export interface Failures {
  rateLimit?: number;
  serverError?: number;
  timeout?: number;
}

export interface ScriptedReply {
  text?: string;
  reasoning?: string[];
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }>;
  /** For structured output requests */
  object?: unknown;
  /** Fail instead of answering */
  error?: FailureKind;
}

export interface ScriptContext {
  /** The last user message */
  prompt: string;
  turns: Turn[];
  /** Results of the tool calls, when the model is answering after them */
  toolResults: ToolResult[];
}

export interface ScriptRule extends ScriptedReply {
  /**
   * A substring (case-insensitive), a regex or a predicate on the last user
   * message.  Omit it to match everything.
   */
  when?: string | RegExp | ((context: ScriptContext) => boolean);
  /** Only use this rule once, e.g. to fail the first attempt and succeed on the retry */
  once?: boolean;
  /**
   * Match when the model is answering after tool results, instead of after a
   * user message.  Use it to script the final answer of an agent loop.
   */
  afterToolResults?: boolean;
}

export type Script = ScriptRule[] | ((context: ScriptContext) => ScriptedReply | string | undefined);

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
};

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: JsonSchema;
}

export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  /** The tool output, already serialized as text */
  content: string;
}

/** Provider-agnostic conversation turn used internally */
export type Turn =
  | { role: 'system'; text: string }
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export interface ThinkRequest {
  turns: Turn[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /** Ask for JSON, optionally matching a schema */
  responseFormat?: { type: 'json'; schema?: JsonSchema };
}

/** What the "model" decided to say, before any theatrics */
export interface Thought {
  reasoning: string[];
  text: string;
  toolCalls: ToolCall[];
  /** Made up, like the answer sometimes */
  confidence: number;
  hallucinated: boolean;
  /** Which regex did the heavy lifting */
  skill: string;
  language: Language;
  /** Set for structured output requests */
  object?: unknown;
  /** Set when the request should fail */
  failure?: FailureKind;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** What this would have cost on a real frontier model */
  costUSD: number;
}

export interface Answer {
  text: string;
  reasoning: string[];
  toolCalls: ToolCall[];
  confidence: number;
  hallucinated: boolean;
  skill: string;
  language: Language;
  /** Set for structured output requests */
  object?: unknown;
  usage: Usage;
}

export type LlmaoEvent =
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'reasoning-end' }
  | { type: 'text-start' }
  | { type: 'text-delta'; delta: string }
  | { type: 'text-end' }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'finish'; answer: Answer };
