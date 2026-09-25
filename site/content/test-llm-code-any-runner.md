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

## Other languages

The server speaks the OpenAI and Anthropic HTTP APIs, so it works from Python, Go, Ruby or curl too. See [a fake OpenAI-compatible API server](../fake-openai-api-server/).

## Related

- [Mock OpenAI in Jest](../mock-openai-jest/)
- [Test rate limits, retries and outages](../simulate-llm-errors/)
