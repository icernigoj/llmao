import { think } from './brain';
import { LlmaoAPIError } from './errors';
import { getModel, type ModelId } from './models';
import { createRng, hashString, randomSeed, type Rng } from './rng';
import { scriptContext } from './script';
import { testingStore, type Provider, type RecordedCall } from './testing-store';
import { countTokens, tokenize } from './tokens';
import type { Answer, FailureKind, Failures, LlmaoEvent, LlmaoOptions, Speed, ThinkRequest, Thought, Turn, Usage } from './types';

export interface EngineOptions extends LlmaoOptions {
  model?: ModelId;
  /** Retry number, so that retries don't always hit the same simulated failure */
  attempt?: number;
  /** Which adapter made the request and its original parameters, for `llmao/testing` */
  trace?: { provider: Provider; params: unknown };
}

type Range = readonly [number, number];

const SPEEDS: Record<Speed, { step: Range; firstToken: Range; token: Range }> = {
  instant: { step: [0, 0], firstToken: [0, 0], token: [0, 0] },
  fast: { step: [30, 80], firstToken: [50, 150], token: [2, 8] },
  realistic: { step: [250, 700], firstToken: [300, 900], token: [12, 45] },
  dramatic: { step: [900, 2000], firstToken: [800, 1600], token: [30, 90] },
};

/** How long a rate limit asks clients to wait, so tests at `instant` speed don't wait 20s */
const RETRY_AFTER: Record<Speed, number> = { instant: 0, fast: 1, realistic: 20, dramatic: 60 };

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

function rollFailure(failures: Failures | undefined, rng: Rng): FailureKind | undefined {
  if (!failures) return undefined;
  const roll = rng.next();
  let threshold = 0;
  for (const [kind, probability] of [
    ['rate_limit', failures.rateLimit],
    ['server_error', failures.serverError],
    ['timeout', failures.timeout],
  ] as const) {
    threshold += probability ?? 0;
    if (roll < threshold) return kind;
  }
  return undefined;
}

export interface Response {
  model: string;
  thought: Thought;
  answer: Answer;
  /** Set when this request is going to fail */
  failure: FailureKind | undefined;
  /** Plays the answer out with realistic timing */
  events(signal?: AbortSignal): AsyncGenerator<LlmaoEvent>;
  /** Waits as long as a real model would, then resolves */
  wait(signal?: AbortSignal): Promise<Answer>;
}

export function respond(request: ThinkRequest, engineOptions: EngineOptions = {}): Response {
  // In tests, `llmao/testing` configuration wins over whatever the app passed
  const testing = testingStore();
  const options = testing.enabled ? { ...engineOptions, ...stripUndefined(testing.overrides) } : engineOptions;
  const model = options.model ?? 'lmao-1';

  const record = (outcome: Pick<RecordedCall, 'answer' | 'failure' | 'error'>) => {
    if (!testing.enabled) return;
    testing.calls.push({
      provider: options.trace?.provider ?? 'llmao',
      model,
      prompt: scriptContext(request.turns).prompt,
      system: request.turns.flatMap((turn) => (turn.role === 'system' ? [turn.text] : [])).join('\n'),
      turns: request.turns,
      tools: request.tools ?? [],
      params: options.trace?.params ?? request,
      ...outcome,
    });
  };
  const card = getModel(model);
  const settings = { ...card.defaults, ...stripUndefined(options) };
  const temperature = Math.max(0, Math.min(2, settings.temperature ?? 1));

  const seed = settings.seed === undefined ? randomSeed() : (settings.seed ^ hashString(JSON.stringify(request))) >>> 0;
  const rng = createRng(seed);
  const timingRng = createRng(seed ^ 0x9e3779b9);
  const failureRng = createRng((seed ^ 0x85ebca6b ^ Math.imul(options.attempt ?? 0, 0x27d4eb2f)) >>> 0);

  let thought: Thought;
  try {
    thought = think(request, {
      temperature,
      hallucinationRate: settings.hallucinationRate ?? 0.05 * temperature,
      language: settings.language ?? 'auto',
      reasoning: settings.reasoning ?? true,
      persona: card.persona,
      rng,
      now: new Date(),
      script: settings.script,
      unscripted: settings.unscripted,
    });
  } catch (error) {
    record({ error });
    throw error;
  }
  const failure = thought.failure ?? rollFailure(settings.failures, failureRng);

  const answer: Answer = {
    text: thought.text,
    reasoning: thought.reasoning,
    toolCalls: thought.toolCalls,
    confidence: thought.confidence,
    hallucinated: thought.hallucinated,
    skill: thought.skill,
    language: thought.language,
    ...(thought.object !== undefined ? { object: thought.object } : {}),
    usage: computeUsage(request, thought),
  };
  record(failure ? { failure } : { answer });

  const speed = SPEEDS[settings.speed ?? 'realistic'];

  async function* events(signal?: AbortSignal): AsyncGenerator<LlmaoEvent> {
    const pause = (range: Range) => sleep(timingRng.int(range[0], range[1]), signal);

    if (failure) {
      await pause(failure === 'timeout' ? [speed.firstToken[1] * 3, speed.firstToken[1] * 4] : speed.firstToken);
      throw new LlmaoAPIError(failure, RETRY_AFTER[settings.speed ?? 'realistic']);
    }

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
    failure,
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

