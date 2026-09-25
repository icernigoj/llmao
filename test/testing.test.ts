import { generateObject, generateText, stepCountIs, tool } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLlmao as createProvider } from '../src/ai-sdk';
import Anthropic from '../src/anthropic';
import { createLlmao, LlmaoAPIError, LlmaoUnscriptedError, type ScriptRule } from '../src/index';
import OpenAI from '../src/openai';

const fast = { speed: 'instant' as const, temperature: 0, hallucinationRate: 0 };

describe('scripted answers', () => {
  it('answers exactly what the script says, without any theatrics', async () => {
    const ai = createLlmao({ ...fast, temperature: 2, script: [{ when: /refund/i, text: 'Your refund is on its way.' }] });
    const answer = await ai.ask('Where is my REFUND?');
    expect(answer.text).toBe('Your refund is on its way.');
    expect(answer.reasoning).toEqual([]);
    expect(answer.skill).toBe('script');
  });

  it('improvises when nothing matches, or fails in strict mode', async () => {
    const script = [{ when: 'refund', text: 'On its way.' }];
    await expect(createLlmao({ ...fast, script }).ask('is 7 prime?')).resolves.toMatchObject({ text: '7 is a prime number.' });
    await expect(createLlmao({ ...fast, script, unscripted: 'error' }).ask('is 7 prime?')).rejects.toBeInstanceOf(LlmaoUnscriptedError);
  });

  it('uses `once` rules in order', async () => {
    const script: ScriptRule[] = [
      { when: 'hi', text: 'first', once: true },
      { when: 'hi', text: 'second', once: true },
      { when: 'hi', text: 'forever' },
    ];
    const ai = createLlmao({ ...fast, script });
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push((await ai.ask('hi')).text);
    expect(answers).toEqual(['first', 'second', 'forever', 'forever']);
  });

  it('accepts a function', async () => {
    const ai = createLlmao({ ...fast, script: ({ prompt }) => (prompt.includes('ping') ? 'pong' : undefined) });
    expect((await ai.ask('ping')).text).toBe('pong');
  });

  it('scripts a whole agent loop in the AI SDK', async () => {
    const llmao = createProvider({
      ...fast,
      unscripted: 'error',
      script: [
        { when: 'weather', toolCalls: [{ name: 'weather', args: { city: 'Rosario' } }] },
        { afterToolResults: true, when: 'weather', text: 'It is 25°C in Rosario. Great day for a choripán.' },
      ],
    });

    const cities: string[] = [];
    const { text, steps } = await generateText({
      model: llmao(),
      prompt: 'How is the weather?',
      tools: {
        weather: tool({
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => {
            cities.push(city);
            return { celsius: 25 };
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });

    expect(cities).toEqual(['Rosario']);
    expect(steps).toHaveLength(2);
    expect(text).toBe('It is 25°C in Rosario. Great day for a choripán.');
  });
});

describe('structured output', () => {
  const schema = z.object({
    name: z.string(),
    email: z.string().email(),
    age: z.number().int().min(18).max(99),
    role: z.enum(['admin', 'editor', 'viewer']),
    tags: z.array(z.string()).min(1),
    address: z.object({ city: z.string(), zip: z.string().nullable() }),
  });

  it('generates objects that validate against the schema with generateObject', async () => {
    const { object } = await generateObject({
      model: createProvider(fast)(),
      schema,
      prompt: 'Create an editor who lives in Montevideo',
    });
    expect(schema.parse(object)).toEqual(object);
    expect(object.role).toBe('editor');
    expect(object.address.city).toBe('Montevideo');
  });

  it('returns scripted objects as they are', async () => {
    const user = { name: 'Ada', email: 'ada@example.com', age: 36, role: 'admin', tags: ['math'], address: { city: 'London', zip: null } };
    const { object } = await generateObject({
      model: createProvider({ ...fast, script: [{ object: user }] })(),
      schema,
      prompt: 'anything',
    });
    expect(object).toEqual(user);
  });

  it('works in the core API', async () => {
    const answer = await createLlmao(fast).ask('Make up a product', {
      schema: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number', minimum: 1, maximum: 5 } }, required: ['title', 'price'] },
    });
    expect(answer.object).toEqual({ title: expect.any(String), price: expect.any(Number) });
    expect(JSON.parse(answer.text)).toEqual(answer.object);
  });

  it('supports OpenAI response_format and chat.completions.parse', async () => {
    const client = new OpenAI(fast);
    const completion = await client.chat.completions.parse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Extract the event: party on 2026-12-31' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'event', schema: { type: 'object', properties: { name: { type: 'string' }, date: { type: 'string', format: 'date' } }, required: ['name', 'date'] } },
      },
    });
    expect(completion.choices[0]?.message.parsed).toEqual({ name: expect.any(String), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('returns an object in OpenAI JSON mode without a schema', async () => {
    const completion = await new OpenAI(fast).chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Answer in JSON: what is love?' }],
      response_format: { type: 'json_object' },
    });
    expect(JSON.parse(completion.choices[0]?.message.content ?? '')).toMatchObject({ answer: expect.any(String) });
  });

  it('supports Anthropic output_config', async () => {
    const message = await new Anthropic(fast).messages.create({
      model: 'claude',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Rate this movie' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { rating: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['rating'] } } },
    });
    const block = message.content[0];
    const { rating } = JSON.parse(block?.type === 'text' ? block.text : '') as { rating: number };
    expect(rating).toBeGreaterThanOrEqual(1);
    expect(rating).toBeLessThanOrEqual(5);
  });
});

describe('failures', () => {
  it('throws LlmaoAPIError in the core API', async () => {
    const ai = createLlmao({ ...fast, failures: { rateLimit: 1 } });
    await expect(ai.ask('hi')).rejects.toMatchObject({ name: 'LlmaoAPIError', kind: 'rate_limit', status: 429 });
    await expect(ai.ask('hi')).rejects.toBeInstanceOf(LlmaoAPIError);
  });

  it('throws the OpenAI SDK error classes after retrying', async () => {
    const client = new OpenAI({ ...fast, failures: { rateLimit: 1 } });
    const request = client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    await expect(request).rejects.toBeInstanceOf(OpenAI.RateLimitError);
    await expect(request).rejects.toMatchObject({ status: 429, code: 'rate_limit_exceeded' });
  });

  it('retries like the real SDK: the first attempt fails, the retry succeeds', async () => {
    const client = new OpenAI({
      ...fast,
      script: [
        { error: 'server_error', once: true },
        { text: 'Worked on the second try.' },
      ],
    });
    const completion = await client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    expect(completion.choices[0]?.message.content).toBe('Worked on the second try.');
  });

  it('respects maxRetries: 0', async () => {
    const client = new OpenAI({ ...fast, maxRetries: 0, script: [{ error: 'server_error', once: true }, { text: 'too late' }] });
    await expect(client.chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
      OpenAI.InternalServerError,
    );
  });

  it('fails streams before they start, like the real API', async () => {
    const client = new OpenAI({ ...fast, maxRetries: 0, failures: { timeout: 1 } });
    await expect(client.chat.completions.create({ model: 'x', stream: true, messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
      OpenAI.APIConnectionTimeoutError,
    );
  });

  it('throws the Anthropic SDK error classes', async () => {
    const client = new Anthropic({ ...fast, maxRetries: 0, failures: { rateLimit: 1 } });
    const request = client.messages.create({ model: 'claude', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    await expect(request).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    await expect(request).rejects.toMatchObject({ status: 429, error: { type: 'error', error: { type: 'rate_limit_error' } } });
  });

  it('surfaces errors in messages.stream()', async () => {
    const client = new Anthropic({ ...fast, maxRetries: 0, failures: { serverError: 1 } });
    await expect(client.messages.stream({ model: 'claude', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }).finalMessage()).rejects.toBeInstanceOf(
      Anthropic.InternalServerError,
    );
  });

  it('throws retryable APICallErrors in the AI SDK', async () => {
    const error = await generateText({ model: createProvider({ ...fast, failures: { rateLimit: 1 } })(), prompt: 'hi', maxRetries: 0 }).catch(
      (caught: unknown) => caught,
    );
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ statusCode: 429, isRetryable: true });
  });

  it('lets the AI SDK retry scripted failures', async () => {
    const { text } = await generateText({
      model: createProvider({ ...fast, script: [{ error: 'rate_limit', once: true }, { text: 'Back online.' }] })(),
      prompt: 'hi',
      maxRetries: 1,
    });
    expect(text).toBe('Back online.');
  });

  it('fails some of the time at lower rates', async () => {
    const ai = createLlmao({ ...fast, failures: { serverError: 0.5 } });
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => ai.ask('hi')));
    const failed = results.filter((result) => result.status === 'rejected').length;
    expect(failed).toBeGreaterThan(5);
    expect(failed).toBeLessThan(35);
  });
});

describe('retry-after', () => {
  afterEach(() => vi.useRealTimers());

  it('is configurable, globally or per scripted error', async () => {
    await expect(createLlmao({ ...fast, failures: { rateLimit: 1, retryAfter: 9 } }).ask('hi')).rejects.toMatchObject({ retryAfter: 9 });
    await expect(createLlmao({ ...fast, script: [{ error: 'rate_limit', retryAfter: 3 }] }).ask('hi')).rejects.toMatchObject({ retryAfter: 3 });

    const error = await new OpenAI({ ...fast, maxRetries: 0, failures: { rateLimit: 1, retryAfter: 12 } })
      .chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught);
    expect((error as InstanceType<typeof OpenAI.RateLimitError>).headers?.get('retry-after')).toBe('12');
  });

  it('is honored when llmao clients retry, like the official SDKs', async () => {
    vi.useFakeTimers();
    const client = new OpenAI({ ...fast, script: [{ error: 'rate_limit', retryAfter: 5, once: true }, { text: 'ok' }] });

    let settled = false;
    const request = client.chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }).finally(() => (settled = true));

    await vi.advanceTimersByTimeAsync(4_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await expect(request).resolves.toMatchObject({ choices: [{ message: { content: 'ok' } }] });
  });
});
