import { agentify, type AgentifyOptions, type Agentified } from './agentify';
import { respond, type EngineOptions } from './engine';
import type { Answer, LlmaoEvent, ToolChoice, ToolDefinition, Turn } from './types';

export interface AskOptions extends EngineOptions {
  /** Tools the model may pretend to need */
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /** A system prompt.  Some instructions are even followed (try "talk like a pirate") */
  system?: string;
  signal?: AbortSignal;
}

export type Prompt = string | Turn[];

export interface Llmao {
  /** Asks a question and waits (realistically) for the answer */
  ask(prompt: Prompt, options?: AskOptions): Promise<Answer>;
  /** Streams reasoning, text and tool calls, token by token */
  stream(prompt: Prompt, options?: AskOptions): AsyncGenerator<LlmaoEvent>;
  /** Wraps any object so every method call becomes an agentic experience */
  agentify<T extends object>(target: T, options?: AgentifyOptions): Agentified<T>;
}

function toTurns(prompt: Prompt, system?: string): Turn[] {
  const turns: Turn[] = typeof prompt === 'string' ? [{ role: 'user', text: prompt }] : prompt;
  return system ? [{ role: 'system', text: system }, ...turns] : turns;
}

export function createLlmao(defaults: EngineOptions = {}): Llmao {
  const start = (prompt: Prompt, options: AskOptions = {}) => {
    const { tools, toolChoice, system, signal, ...engineOptions } = options;
    const response = respond({ turns: toTurns(prompt, system), tools, toolChoice }, { ...defaults, ...engineOptions });
    return { response, signal };
  };

  return {
    ask(prompt, options) {
      const { response, signal } = start(prompt, options);
      return response.wait(signal);
    },
    stream(prompt, options) {
      const { response, signal } = start(prompt, options);
      return response.events(signal);
    },
    agentify(target, options) {
      return agentify(target, { seed: defaults.seed, ...options });
    },
  };
}

/** A ready-to-use instance of our flagship model */
export const llmao: Llmao = createLlmao();
