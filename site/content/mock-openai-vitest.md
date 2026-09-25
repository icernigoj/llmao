---
title: How to mock the OpenAI SDK in Vitest
description: Mock the openai package in Vitest with vi.mock and llmao. Scripted answers, recorded calls, streaming, tool calls and real SDK errors, without an API key.
---

# How to mock the OpenAI SDK in Vitest

Replace the `openai` package with [llmao](https://github.com/icernigoj/llmao), a fake LLM that implements the same client, and control it from the test. No API key, no network, no changes to your app.

## Install

```bash
npm install --save-dev llmao
```

## Mock the module

```ts
import { beforeEach, expect, test, vi } from 'vitest';
import * as llmao from 'llmao/testing';
import { classify } from './support'; // calls new OpenAI().chat.completions.create()

vi.mock('openai', () => import('llmao/openai'));

beforeEach(() => llmao.reset());

test('classifies shipping tickets', async () => {
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  await expect(classify('My order never arrived')).resolves.toBe('shipping');
  expect(llmao.calls).toHaveLength(1);
  expect(llmao.lastCall()?.prompt).toBe('My order never arrived');
});
```

`vi.mock` is hoisted, so it applies before your app imports `openai`. Importing `llmao/testing` turns on test mode: every client answers instantly, never hallucinates, uses what you pass to `configure()`, and records its calls.

## Streaming

Streaming works like the real API, so you can test code that renders tokens as they arrive:

```ts
const stream = await client.chat.completions.create({ model: 'gpt-4o', stream: true, messages });
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? '');
}
```

## Fake timers and latency

Test mode creates no timers, so `vi.useFakeTimers()` works as is. To test a loading state or your own timeout, turn the latency back on and move the clock:

```ts
vi.useFakeTimers();
llmao.configure({ speed: 'realistic', script: [{ text: 'shipping' }] });

const result = classify('where is my order');
await vi.advanceTimersByTimeAsync(100);
// the model is still "thinking" here
await vi.advanceTimersByTimeAsync(60_000);
await expect(result).resolves.toBe('shipping');
```

## Related

- [Mock OpenAI in Jest](../mock-openai-jest/)
- [Mock the Anthropic SDK](../mock-anthropic-sdk/)
- [Test the Vercel AI SDK](../test-vercel-ai-sdk/)
