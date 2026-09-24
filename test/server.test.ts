import RealAnthropic from '@anthropic-ai/sdk';
import RealOpenAI from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type RunningServer } from '../src/server';

// The official SDKs, talking to llmao over HTTP
let server: RunningServer;
let openai: RealOpenAI;
let anthropic: RealAnthropic;

beforeAll(async () => {
  server = await serve({
    port: 0,
    speed: 'instant',
    temperature: 0,
    hallucinationRate: 0,
    script: [
      { when: 'please fail', error: 'rate_limit' },
      { when: 'refund', text: 'Your refund is on its way.' },
    ],
  });
  openai = new RealOpenAI({ baseURL: `${server.url}/v1`, apiKey: 'llmao', maxRetries: 0 });
  anthropic = new RealAnthropic({ baseURL: server.url, apiKey: 'llmao', maxRetries: 0 });
});

afterAll(() => server.close());

describe('OpenAI SDK over HTTP', () => {
  it('creates chat completions', async () => {
    const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'is 13 prime?' }] });
    expect(completion.choices[0]?.message.content).toBe('13 is a prime number.');
  });

  it('uses the script', async () => {
    const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'where is my refund' }] });
    expect(completion.choices[0]?.message.content).toBe('Your refund is on its way.');
  });

  it('streams server-sent events', async () => {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      stream: true,
      messages: [{ role: 'user', content: 'reverse "stressed"' }],
    });
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
    expect(text).toBe('desserts');
  });

  it('calls tools', async () => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather in Quito' }],
      tools: [
        {
          type: 'function',
          function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
        },
      ],
    });
    expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({ type: 'function', function: { name: 'get_weather', arguments: '{"city":"Quito"}' } });
  });

  it('returns real SDK errors, with status and headers', async () => {
    const error = await openai.chat.completions
      .create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'please fail' }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RealOpenAI.RateLimitError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limit_exceeded' });
    expect((error as InstanceType<typeof RealOpenAI.RateLimitError>).headers.get('retry-after')).toBe('0');
  });

  it('lists models and creates embeddings', async () => {
    const models = await openai.models.list();
    expect(models.data.map((model) => model.id)).toContain('lmao-safe');

    const { data } = await openai.embeddings.create({ model: 'lmao-embed', input: ['hello', 'world'] });
    expect(data).toHaveLength(2);
    expect(data[0]?.embedding).toHaveLength(256);
  });
});

describe('Anthropic SDK over HTTP', () => {
  it('creates messages', async () => {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'is 12 even?' }],
    });
    expect(message.content).toEqual([{ type: 'text', text: '12 is even.', citations: null }]);
  });

  it('streams with messages.stream()', async () => {
    const text = await anthropic.messages
      .stream({ model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'sort 3, 1, 2' }] })
      .finalText();
    expect(text).toBe('1, 2, 3');
  });

  it('returns real SDK errors', async () => {
    const error = await anthropic.messages
      .create({ model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'please fail' }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RealAnthropic.RateLimitError);
    expect(error).toMatchObject({ status: 429 });
  });
});

describe('HTTP details', () => {
  it('answers unknown routes with a 404', async () => {
    const response = await fetch(`${server.url}/v1/images/generations`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('only fakes') } });
  });

  it('rejects invalid JSON', async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, { method: 'POST', body: '{nope' });
    expect(response.status).toBe(400);
  });

  it('allows browsers (CORS)', async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
