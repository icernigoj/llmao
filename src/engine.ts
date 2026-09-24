import { think } from './brain';
import { getModel, type ModelId } from './models';
import { createRng, hashString, randomSeed } from './rng';
import { countTokens, tokenize } from './tokens';
import type { Answer, LlmaoEvent, LlmaoOptions, Speed, ThinkRequest, Thought, Turn, Usage } from './types';

export interface EngineOptions extends LlmaoOptions {
  model?: ModelId;
}

type Range = readonly [number, number];

const SPEEDS: Record<Speed, { step: Range; firstToken: Range; token: Range }> = {
  instant: { step: [0, 0], firstToken: [0, 0], token: [0, 0] },
  fast: { step: [30, 80], firstToken: [50, 150], token: [2, 8] },
  realistic: { step: [250, 700], firstToken: [300, 900], token: [12, 45] },
  dramatic: { step: [900, 2000], firstToken: [800, 1600], token: [30, 90] },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function turnText(turn: Turn): string {
  if (turn.role === 'tool') return turn.results.map((result) => result.content).join('\n');
  if (turn.role === 'assistant') return turn.text + JSON.stringify(turn.toolCalls ?? []);
  return turn.text;
}

function computeUsage(request: ThinkRequest, thought: Thought): Usage {
  const inputTokens =
    request.turns.reduce((total, turn) => total + countTokens(turnText(turn)), 0) +
    (request.tools ? countTokens(JSON.stringify(request.tools)) : 0);
  const outputTokens =
    countTokens(thought.text) + thought.toolCalls.reduce((total, call) => total + countTokens(JSON.stringify(call.args)), 0);
  const reasoningTokens = countTokens(thought.reasoning.join('\n'));
  // Priced like a frontier model, so you can appreciate the savings
  const costUSD = (inputTokens * 2.5 + (outputTokens + reasoningTokens) * 10) / 1_000_000;

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens,
    costUSD: Number(costUSD.toFixed(6)),
  };
}

export interface Response {
  model: string;
  thought: Thought;
  answer: Answer;
  /** Plays the answer out with realistic timing */
  events(signal?: AbortSignal): AsyncGenerator<LlmaoEvent>;
  /** Waits as long as a real model would, then resolves */
  wait(signal?: AbortSignal): Promise<Answer>;
}

export function respond(request: ThinkRequest, options: EngineOptions = {}): Response {
  const model = options.model ?? 'lmao-1';
  const card = getModel(model);
  const settings = { ...card.defaults, ...stripUndefined(options) };
  const temperature = Math.max(0, Math.min(2, settings.temperature ?? 1));

  const seed = settings.seed === undefined ? randomSeed() : (settings.seed ^ hashString(JSON.stringify(request))) >>> 0;
  const rng = createRng(seed);
  const timingRng = createRng(seed ^ 0x9e3779b9);

  const thought = think(request, {
    temperature,
    hallucinationRate: settings.hallucinationRate ?? 0.05 * temperature,
    language: settings.language ?? 'auto',
    reasoning: settings.reasoning ?? true,
    persona: card.persona,
    rng,
    now: new Date(),
  });

  const answer: Answer = {
    text: thought.text,
    reasoning: thought.reasoning,
    toolCalls: thought.toolCalls,
    confidence: thought.confidence,
    hallucinated: thought.hallucinated,
    skill: thought.skill,
    language: thought.language,
    usage: computeUsage(request, thought),
  };

  const speed = SPEEDS[settings.speed ?? 'realistic'];

  async function* events(signal?: AbortSignal): AsyncGenerator<LlmaoEvent> {
    const pause = (range: Range) => sleep(timingRng.int(range[0], range[1]), signal);

    if (thought.reasoning.length > 0) {
      yield { type: 'reasoning-start' };
      for (const [index, step] of thought.reasoning.entries()) {
        await pause(speed.step);
        for (const token of tokenize(index === 0 ? step : `\n${step}`)) {
          await pause(speed.token);
          yield { type: 'reasoning-delta', delta: token };
        }
      }
      yield { type: 'reasoning-end' };
    }

    await pause(speed.firstToken);

    if (thought.text) {
      yield { type: 'text-start' };
      for (const token of tokenize(thought.text)) {
        await pause(speed.token);
        yield { type: 'text-delta', delta: token };
      }
      yield { type: 'text-end' };
    }

    for (const toolCall of thought.toolCalls) {
      await pause(speed.step);
      yield { type: 'tool-call', toolCall };
    }

    yield { type: 'finish', answer };
  }

  return {
    model,
    thought,
    answer,
    events,
    async wait(signal) {
      for await (const _ of events(signal)) {
        // Just enjoying the suspense
      }
      return answer;
    },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

