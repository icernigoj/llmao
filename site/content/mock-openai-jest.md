---
title: How to mock the OpenAI SDK in Jest
description: Test code that calls OpenAI in Jest without an API key. Script the answers, simulate rate limits and assert on the prompts your app sent, with one jest.mock line.
---

# How to mock the OpenAI SDK in Jest

Tests that call the real OpenAI API are slow, flaky, need an API key in CI and cost money. Hand-written mocks (`jest.fn()` returning a fake completion) have to fake the whole response shape, and they drift every time the SDK changes.

[llmao](https://github.com/icernigoj/llmao) is a fake LLM that behaves like the real API: same client, same response objects, same errors. You swap it in with one line and your app code stays untouched.

## Install

```bash
npm install --save-dev llmao
```

## Mock the module

Say your app has a function that uses the official SDK:

```ts
// src/support.ts
import OpenAI from 'openai';

const client = new OpenAI();

export async function classify(ticket: string) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Classify the ticket as billing, shipping or other.' },
      { role: 'user', content: ticket },
    ],
  });
  return completion.choices[0].message.content;
}
```

In the test, replace `openai` with `llmao/openai` and script the answers:

```ts
// src/support.test.ts
jest.mock('openai', () => require('llmao/openai'));

import OpenAI from 'openai'; // this is llmao now
import * as llmao from 'llmao/testing';
import { classify } from './support';

beforeEach(() => llmao.reset());

test('classifies shipping tickets', async () => {
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  expect(await classify('My order never arrived')).toBe('shipping');
});

test('sends the ticket with the right system prompt', async () => {
  llmao.configure({ script: [{ text: 'billing' }] });
  await classify('I was charged twice');

  expect(llmao.lastCall()).toMatchObject({
    model: 'gpt-4o',
    system: 'Classify the ticket as billing, shipping or other.',
    prompt: 'I was charged twice',
  });
});

test('surfaces rate limits', async () => {
  llmao.configure({ failures: { rateLimit: 1 } });
  await expect(classify('hi')).rejects.toBeInstanceOf(OpenAI.RateLimitError);
});
```

## What you get

- **Scripted answers**: rules match on a substring, a regex or a function. Use `unscripted: 'error'` to fail the test on any prompt you didn't script.
- **Recorded calls**: `llmao.calls` and `llmao.lastCall()` give you the provider, model, prompt, system prompt, tools, the original request and the answer.
- **Real errors**: `OpenAI.RateLimitError` with `status: 429` and a `retry-after` header, `OpenAI.InternalServerError`, timeouts. The client retries like the real SDK (`maxRetries`, default 2).
- **Streaming, tool calls and structured output** (`response_format`, `chat.completions.parse()`) work like the real thing.
- **Fast**: importing `llmao/testing` makes every answer instant and deterministic. It creates no timers, so it works with `jest.useFakeTimers()`.

## Scripting a whole conversation

```ts
llmao.configure({
  unscripted: 'error',
  script: [
    { when: 'weather', toolCalls: [{ name: 'get_weather', args: { city: 'Lima' } }] },
    { when: 'weather', afterToolResults: true, text: 'It is sunny in Lima.' },
    { error: 'server_error', once: true }, // fail once, then fall through
  ],
});
```

## Related

- [Mock OpenAI in Vitest](../mock-openai-vitest/)
- [Test rate limits, retries and outages](../simulate-llm-errors/)
- [Any other test runner (node:test, Mocha)](../test-llm-code-any-runner/)
