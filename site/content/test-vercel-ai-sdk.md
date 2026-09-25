---
title: How to test the Vercel AI SDK without API keys
description: Test generateText, streamText, generateObject and tool-calling agents built with the Vercel AI SDK, using llmao as a mock provider. Works with @ai-sdk/openai and @ai-sdk/anthropic.
---

# How to test the Vercel AI SDK without API keys

[llmao](https://github.com/icernigoj/llmao) is an AI SDK provider (spec v4) that answers like a model, but is scripted from your test. It works with `generateText`, `streamText`, `generateObject`, multi-step agents and `embed`.

## Option 1: mock the provider package

If your app imports `openai` from `@ai-sdk/openai` (or `anthropic` from `@ai-sdk/anthropic`), mock the package. llmao exports the same names:

```ts
vi.mock('@ai-sdk/openai', () => import('llmao/ai-sdk'));

import * as llmao from 'llmao/testing';
import { reply } from './agent'; // generateText({ model: openai('gpt-4o'), ... })

beforeEach(() => llmao.reset());

test('replies', async () => {
  llmao.configure({ script: [{ text: 'Happy to help!' }] });
  expect(await reply('Hi!')).toBe('Happy to help!');
});
```

With Jest: the AI SDK is ESM-only, so Jest has to run in ESM mode (`NODE_OPTIONS=--experimental-vm-modules`), where modules are mocked with `jest.unstable_mockModule` before importing your app:

```ts
import { jest } from '@jest/globals';

jest.unstable_mockModule('@ai-sdk/openai', () => import('llmao/ai-sdk'));
const llmao = await import('llmao/testing');
const { reply } = await import('./agent.js');
```

## Option 2: pass the model

If the model is injected, pass llmao directly:

```ts
import { createLlmao } from 'llmao/ai-sdk';

const model = createLlmao({ speed: 'instant', script: [{ text: 'Hi!' }] })();
```

## Agents with tools

```ts
llmao.configure({
  unscripted: 'error',
  script: [
    { when: 'weather', toolCalls: [{ name: 'weather', args: { city: 'Rosario' } }] },
    { when: 'weather', afterToolResults: true, text: 'It is 25°C in Rosario.' },
  ],
});

const { text, steps } = await generateText({ model, tools: { weather }, stopWhen: stepCountIs(5), prompt: 'How is the weather?' });
// your real `weather.execute` runs with { city: 'Rosario' }, and steps.length === 2
```

## Structured output

`generateObject` gets an object that validates against your Zod schema, with plausible values (names look like names, emails like emails, enums and ranges are respected). Or script the exact object:

```ts
llmao.configure({ script: [{ object: { name: 'Ada', role: 'admin' } }] });
```

## Errors and retries

llmao throws the AI SDK's retryable `APICallError` (429, 500, timeouts), so the SDK's own retry logic runs:

```ts
llmao.configure({ script: [{ error: 'rate_limit', once: true }, { text: 'Back online.' }] });
const { text } = await generateText({ model, prompt: 'hi', maxRetries: 1 }); // 'Back online.'
```

## Related

- [Test rate limits, retries and outages](../simulate-llm-errors/)
- [Mock OpenAI in Vitest](../mock-openai-vitest/)
