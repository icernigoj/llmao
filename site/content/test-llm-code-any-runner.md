---
title: Test code that calls OpenAI or Claude with node:test, Mocha or any runner
description: Point the official OpenAI and Anthropic SDKs at a local fake LLM server with OPENAI_BASE_URL and ANTHROPIC_BASE_URL. No module mocking, no code changes, works with any test runner.
---

# Test code that calls OpenAI or Claude with node:test, Mocha or any runner

Module mocking is a Jest and Vitest feature. With `node:test`, Mocha or anything else, there is a simpler way: run [llmao](https://github.com/icernigoj/llmao)'s fake API server in the test process and point the official SDKs at it. Both SDKs read their base URL from an environment variable, so your app doesn't change.

## Install

```bash
npm install --save-dev llmao
```

## Example with node:test

```ts
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from 'llmao/server';
import * as llmao from 'llmao/testing';

let server;

before(async () => {
  server = await serve({ port: 0 }); // a free port
  process.env.OPENAI_BASE_URL = `${server.url}/v1`;
  process.env.ANTHROPIC_BASE_URL = server.url;
});

after(() => server.close());
beforeEach(() => llmao.reset());

test('classifies tickets', async () => {
  const { classify } = await import('./support.js'); // creates its clients after the env is set
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  assert.equal(await classify('My order never arrived'), 'shipping');
  assert.equal(llmao.lastCall().provider, 'openai');
});
```

Set the variables before your app creates its SDK clients. The server runs in the same process, so `configure()`, `calls` and `lastCall()` work exactly like in Jest and Vitest.

## Reading the recorded calls

Each call in `llmao.calls` has the `provider`, `model`, `prompt`, `system`, `tools`, the `answer` or `failure`, and:

- `params`: the request body your SDK sent, as parsed JSON (typed `unknown`: cast it to what you expect)
- `headers`: the request headers, lowercased. The official SDKs number their retries in `x-stainless-retry-count`

```ts
const body = llmao.lastCall().params as { max_tokens: number };
assert.equal(body.max_tokens, 1024);
assert.equal(llmao.calls[1].headers['x-stainless-retry-count'], '1');
```

## Testing retries with fake timers

Rate limits come with a `retry-after` header: `0` in test mode, or what you configure. To check that your code waits the right amount, set it and run the clock with `node:test`'s mock timers:

```ts
import { mock, test } from 'node:test';

// Moves the fake clock 100 ms at a time, letting network I/O happen in
// between, until the promise settles. Returns the simulated time (a slight
// overestimate, since the clock also moves while waiting for the network).
async function runClock(promise, step = 100) {
  let settled = false;
  promise.then(() => (settled = true), () => (settled = true));
  let elapsed = 0;
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    if (settled) break;
    mock.timers.tick(step);
    elapsed += step;
  }
  return elapsed;
}

test('honors retry-after instead of a fixed fallback', async () => {
  llmao.configure({ script: [{ error: 'rate_limit', retryAfter: 20, once: true }, { text: 'ok' }] });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const answer = classifyWithRetries('hi'); // your code
    const waited = await runClock(answer);
    assert.equal(await answer, 'ok');
    assert.ok(waited >= 20_000 && waited < 25_000);
  } finally {
    mock.timers.reset();
  }
});
```

Keep llmao at its default `instant` speed while timers are mocked: the server then answers without timers of its own, so only your code's waits move with the clock. This recipe runs in llmao's CI.

## Other languages

The server speaks the OpenAI and Anthropic HTTP APIs, so it works from Python, Go, Ruby or curl too. See [a fake OpenAI-compatible API server](../fake-openai-api-server/).

## Related

- [Mock OpenAI in Jest](../mock-openai-jest/)
- [Test rate limits, retries and outages](../simulate-llm-errors/)
