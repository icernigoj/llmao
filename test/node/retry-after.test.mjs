// The node:test recipe from the docs, run for real with the official SDK
// against the built package (pnpm build first).
import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import OpenAI from 'openai';
import { serve } from '../../dist/server.mjs';
import * as llmao from '../../dist/testing.mjs';

let server;
before(async () => {
  server = await serve({ port: 0 });
});
after(() => server.close());
beforeEach(() => llmao.reset());

// Moves the fake clock forward 100 ms at a time, letting network I/O happen
// in between, until the promise settles. Returns the simulated time: a slight
// overestimate, since the clock also moves while waiting for the network.
async function runClock(promise, step = 100) {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  let elapsed = 0;
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    if (settled) break;
    mock.timers.tick(step);
    elapsed += step;
  }
  return elapsed;
}

test('the SDK waits what retry-after says, then retries', async () => {
  llmao.configure({ script: [{ error: 'rate_limit', retryAfter: 20, once: true }, { text: 'ok' }] });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const client = new OpenAI({ baseURL: `${server.url}/v1`, apiKey: 'test' });
    const request = client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    const waited = await runClock(request);

    assert.equal((await request).choices[0].message.content, 'ok');
    assert.ok(waited >= 20_000 && waited < 25_000, `waited ${waited} ms`);
    assert.equal(llmao.calls.length, 2);
    assert.equal(llmao.calls[1].headers['x-stainless-retry-count'], '1');
  } finally {
    mock.timers.reset();
  }
});

test('rate limits carry the configured retry-after header', async () => {
  llmao.configure({ failures: { rateLimit: 1, retryAfter: 7 } });
  const client = new OpenAI({ baseURL: `${server.url}/v1`, apiKey: 'test', maxRetries: 0 });
  const error = await client.chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }).catch((caught) => caught);

  assert.ok(error instanceof OpenAI.RateLimitError);
  assert.equal(error.headers.get('retry-after'), '7');
});
