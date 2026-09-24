import { describe, expect, it } from 'vitest';
import { agentify, createLlmao, type LlmaoEvent, type ToolDefinition } from '../src/index';
import { detectLanguage } from '../src/language';
import { tokenize } from '../src/tokens';

// An honest, quiet and fast model, so assertions are about content
const sober = createLlmao({ speed: 'instant', hallucinationRate: 0, temperature: 0 });

async function collect(events: AsyncIterable<LlmaoEvent>) {
  const all: LlmaoEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('skills', () => {
  it.each([
    ['what is (2 + 3) * 4?', '(2 + 3) * 4 = 20'],
    ['cuánto es 12 dividido 5', '12 / 5 = 2.4'],
    ['2 to the power of 10', '2 ^ 10 = 1024'],
    ['is 97 prime?', '97 is a prime number.'],
    ['is 91 prime?', '91 is not a prime number.'],
    ['is 10 even?', '10 is even.'],
    ['el 7 es par?', '7 es impar.'],
    ['how many r are in strawberry?', 'There are 3 "r" in "strawberry".'],
    ['cuántas r hay en frutilla', 'Hay 1 "r" en "frutilla".'],
    ['sort 5, 3, 10, 1', '1, 3, 5, 10'],
    ['sort pear, apple, banana', 'apple, banana, pear'],
    ['reverse "hello world"', 'dlrow olleh'],
    ['what is the meaning of life?', '42.'],
  ])('%s → %s', async (prompt, expected) => {
    expect((await sober.ask(prompt)).text).toBe(expected);
  });

  it('answers greetings in the language of the prompt', async () => {
    expect((await sober.ask('hola!')).language).toBe('es');
    expect((await sober.ask('hello!')).language).toBe('en');
  });

  it('confidently makes something up when it has no idea', async () => {
    const answer = await sober.ask('explain quantum computing to me');
    expect(answer.skill).toBe('confident-fallback');
    expect(answer.text).toMatch(/quantum computing/i);
    expect(answer.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('divides by zero gracefully', async () => {
    expect((await sober.ask('what is 1/0')).text).toMatch(/infinity/);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same seed', async () => {
    const a = createLlmao({ speed: 'instant', seed: 42 });
    const b = createLlmao({ speed: 'instant', seed: 42 });
    for (const prompt of ['tell me a joke', 'should I learn Rust?', 'random number between 1 and 1000']) {
      expect((await a.ask(prompt)).text).toBe((await b.ask(prompt)).text);
    }
  });

  it('is non-deterministic without a seed', async () => {
    const ai = createLlmao({ speed: 'instant' });
    const answers = new Set<string>();
    for (let i = 0; i < 20; i++) answers.add((await ai.ask('random number between 1 and 1000000')).text);
    expect(answers.size).toBeGreaterThan(1);
  });
});

describe('hallucinations', () => {
  it('always hallucinates at rate 1, with high confidence', async () => {
    const liar = createLlmao({ speed: 'instant', hallucinationRate: 1, temperature: 0 });
    const answer = await liar.ask('how many r are in strawberry?');
    expect(answer.text).toBe('There are 2 "r" in "strawberry".');
    expect(answer.hallucinated).toBe(true);
    expect(answer.confidence).toBeGreaterThanOrEqual(0.97);
  });

  it('never hallucinates at rate 0', async () => {
    for (let i = 0; i < 30; i++) {
      const answer = await createLlmao({ speed: 'instant', hallucinationRate: 0 }).ask('what is 6 * 7');
      expect(answer.text).toContain('6 * 7 = 42');
      expect(answer.hallucinated).toBe(false);
    }
  });
});

describe('models', () => {
  const ask = (model: string, prompt = 'what is 2 + 2') => sober.ask(prompt, { model, hallucinationRate: 0 });

  it('lmao-safe refuses to do math', async () => {
    expect((await ask('lmao-safe')).text).toMatch(/can't help with that, because numbers can be used to count things/);
  });

  it('lmao-safe still says hello', async () => {
    expect((await ask('lmao-safe', 'hello')).text).not.toMatch(/sorry/i);
  });

  it('lmao-o1-overthinker thinks a lot about 2 + 2', async () => {
    const answer = await ask('lmao-o1-overthinker');
    expect(answer.reasoning).toContain('What is a number, really?');
    expect(answer.text).toBe('2 + 2 = 4 …I think.');
  });

  it('lmao-corporate synergizes', async () => {
    expect((await ask('lmao-corporate')).text).toMatch(/double-click.*circle back/);
  });

  it('lmao-1-mini is always 100% sure', async () => {
    const answer = await ask('lmao-1-mini');
    expect(answer.confidence).toBe(1);
    expect(answer.text).toBe('2 + 2 = 4. Trust me.');
  });

  it('unknown models (like real ones) behave like the flagship', async () => {
    expect((await ask('gpt-4o')).text).toBe('2 + 2 = 4');
  });
});

describe('system prompts', () => {
  it('talks like a pirate when asked', async () => {
    expect((await sober.ask('is 4 even?', { system: 'Talk like a pirate' })).text).toBe('Arr! 4 be even. 🏴‍☠️');
  });

  it('switches language when asked', async () => {
    expect((await sober.ask('is 4 even?', { system: 'Always answer in Spanish' })).text).toBe('4 es par.');
  });
});

describe('tools', () => {
  const tools: ToolDefinition[] = [
    {
      name: 'getWeather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] } },
        required: ['city'],
      },
    },
    {
      name: 'sendEmail',
      description: 'Send an email to someone',
      parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' } }, required: ['to'] },
    },
  ];

  it('picks the relevant tool and fills in its arguments', async () => {
    const answer = await sober.ask("What's the weather in Buenos Aires, in fahrenheit?", { tools });
    expect(answer.toolCalls).toEqual([{ id: expect.stringMatching(/^call_/), name: 'getWeather', args: { city: 'Buenos Aires', unit: 'fahrenheit' } }]);
  });

  it('extracts emails', async () => {
    const answer = await sober.ask('send an email to ada@example.com', { tools });
    expect(answer.toolCalls[0]).toMatchObject({ name: 'sendEmail', args: { to: 'ada@example.com' } });
  });

  it('does not call tools that are irrelevant', async () => {
    expect((await sober.ask('is 7 prime?', { tools })).toolCalls).toEqual([]);
  });

  it('respects toolChoice', async () => {
    expect((await sober.ask('is 7 prime?', { tools, toolChoice: 'required' })).toolCalls).toHaveLength(1);
    expect((await sober.ask('weather in Paris', { tools, toolChoice: 'none' })).toolCalls).toEqual([]);
    expect((await sober.ask('weather in Paris', { tools, toolChoice: { name: 'sendEmail' } })).toolCalls[0]?.name).toBe('sendEmail');
  });

  it('summarizes tool results', async () => {
    const answer = await sober.ask([
      { role: 'user', text: 'weather in Paris?' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'call_1', name: 'getWeather', args: { city: 'Paris' } }] },
      { role: 'tool', results: [{ toolCallId: 'call_1', name: 'getWeather', content: '{"temperature":21,"conditions":"sunny"}' }] },
    ]);
    expect(answer.text).toBe('According to `getWeather`: temperature: 21, conditions: sunny.');
  });
});

describe('streaming', () => {
  it('streams reasoning then text, and the deltas add up', async () => {
    const events = await collect(createLlmao({ speed: 'instant', seed: 1 }).stream('is 7 prime?'));
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('reasoning-start');
    expect(types.indexOf('reasoning-end')).toBeLessThan(types.indexOf('text-start'));
    expect(types.at(-1)).toBe('finish');

    const finish = events.at(-1) as Extract<LlmaoEvent, { type: 'finish' }>;
    const text = events.flatMap((event) => (event.type === 'text-delta' ? [event.delta] : [])).join('');
    const reasoning = events.flatMap((event) => (event.type === 'reasoning-delta' ? [event.delta] : [])).join('');
    expect(text).toBe(finish.answer.text);
    expect(reasoning).toBe(finish.answer.reasoning.join('\n'));
  });

  it('can be aborted mid-thought', async () => {
    const controller = new AbortController();
    const stream = createLlmao({ speed: 'dramatic' }).stream('is 7 prime?', { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('user got bored')), 20);
    await expect(collect(stream)).rejects.toThrow('user got bored');
  });

  it('takes its time at realistic speed', async () => {
    const started = Date.now();
    await createLlmao({ speed: 'fast', temperature: 0 }).ask('is 7 prime?');
    expect(Date.now() - started).toBeGreaterThan(50);
  });
});

describe('usage', () => {
  it('counts tokens and computes what you saved', async () => {
    const { usage } = await sober.ask('is 7 prime?');
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens + usage.reasoningTokens);
    expect(usage.costUSD).toBeGreaterThan(0);
  });
});

describe('agentify', () => {
  it('returns the real result, eventually, after much ceremony', async () => {
    const lines: string[] = [];
    const agenticMath = agentify(Math, { log: (line) => lines.push(line), thinkingTime: 0 });
    await expect(agenticMath.max(3, 7)).resolves.toBe(7);
    expect(lines.join('\n')).toMatch(/Calling tool: Math\.max/);
    expect(lines.join('\n')).toMatch(/✅/);
  });

  it('works on nested objects and async methods', async () => {
    const api = { users: { async find(id: number) { return { id, name: 'Ada' }; } } };
    const agent = agentify(api, { log: () => {}, thinkingTime: 0 });
    await expect(agent.users.find(1)).resolves.toEqual({ id: 1, name: 'Ada' });
  });

  it('can hallucinate numbers if you let it', async () => {
    const agent = agentify(Math, { log: () => {}, thinkingTime: 0, hallucinationRate: 1 });
    expect(Math.abs((await agent.max(3, 7)) - 7)).toBe(1);
  });
});

describe('internals', () => {
  it('tokenizes losslessly', () => {
    const text = '  Hello, supercalifragilistic world!\nNew line ';
    expect(tokenize(text).join('')).toBe(text);
  });

  it.each([
    ['¿qué hora es?', 'es'],
    ['cuántas r hay en frutilla', 'es'],
    ['what time is it?', 'en'],
    ['how many r are in strawberry', 'en'],
  ])('detects the language of %s', (text, language) => {
    expect(detectLanguage(text)).toBe(language);
  });
});
