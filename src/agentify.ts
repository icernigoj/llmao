import { createRng, randomSeed, type Rng } from './rng';

export interface AgentifyOptions {
  /** Where the agent narrates its journey.  @default console.log */
  log?: (line: string) => void;
  /** Milliseconds to "think" before each call.  @default 600 */
  thinkingTime?: number;
  /** Probability of returning a slightly wrong number.  @default 0 */
  hallucinationRate?: number;
  seed?: number;
}

/** Every method becomes async, because agents are async.  That's the agentic tax. */
export type Agentified<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends object
      ? Agentified<T[K]>
      : T[K];
};

const PLANS = [
  (call: string) => `🤔 Planning how to approach ${call}…`,
  (call: string) => `🧠 Breaking ${call} down into sub-tasks (there is one)…`,
  (call: string) => `📋 Drafting a 5-step plan for ${call}…`,
  (call: string) => `🤔 Considering whether ${call} aligns with the user's long-term goals…`,
];

const VERIFICATIONS = [
  (confidence: string) => `✅ Verified the result with ${confidence}% confidence`,
  (confidence: string) => `✅ Cross-checked with myself. We agree (${confidence}%)`,
  (confidence: string) => `✅ Result reviewed by a second agent, which is also me (${confidence}%)`,
];

function describeCall(path: string, args: unknown[]): string {
  const rendered = args.map((arg) => {
    try {
      const json = JSON.stringify(arg);
      return json === undefined ? String(arg) : json.length > 40 ? `${json.slice(0, 37)}…` : json;
    } catch {
      return String(arg);
    }
  });
  return `${path}(${rendered.join(', ')})`;
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Turns any object into an AI agent.  The results are the same, but now
 * every call plans, uses tools, and verifies its work.
 *
 * @example
 * const agenticMath = agentify(Math);
 * await agenticMath.max(3, 7); // 🤔 Planning… 🛠️ Calling tool… ✅ 7
 */
export function agentify<T extends object>(target: T, options: AgentifyOptions = {}): Agentified<T> {
  const rng = createRng(options.seed ?? randomSeed());
  return wrap(target, options, rng, (target as { name?: string }).name ?? tagOf(target));
}

function tagOf(target: object): string {
  const tag = Object.prototype.toString.call(target).slice(8, -1);
  return tag === 'Object' ? 'agent' : tag;
}

function wrap<T extends object>(target: T, options: AgentifyOptions, rng: Rng, path: string): Agentified<T> {
  const log = options.log ?? console.log;
  const thinkingTime = options.thinkingTime ?? 600;

  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      const name = typeof property === 'symbol' ? property.toString() : property;

      if (typeof value === 'function') {
        return async (...args: unknown[]) => {
          const call = describeCall(`${path}.${name}`, args);
          log(rng.pick(PLANS)(call));
          await sleep(thinkingTime);
          log(`🛠️  Calling tool: ${path}.${name}`);

          let result = await value.apply(object, args);
          if (typeof result === 'number' && Number.isFinite(result) && rng.chance(options.hallucinationRate ?? 0)) {
            result += rng.pick([-1, 1]);
          }

          await sleep(thinkingTime / 2);
          log(rng.pick(VERIFICATIONS)((95 + rng.next() * 4.9).toFixed(1)));
          return result;
        };
      }

      if (value !== null && typeof value === 'object') {
        return wrap(value, options, rng, `${path}.${name}`);
      }

      return value;
    },
  }) as Agentified<T>;
}
