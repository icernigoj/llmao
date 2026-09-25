---
title: How to mock the Anthropic SDK (Claude) in Jest and Vitest
description: Mock @anthropic-ai/sdk in your tests with llmao. Messages, streaming, extended thinking, tool use and real Anthropic errors, with no API key.
---

# How to mock the Anthropic SDK (Claude) in Jest and Vitest

[llmao](https://github.com/icernigoj/llmao) implements the `@anthropic-ai/sdk` client: `messages.create()`, streaming, `messages.stream()`, extended thinking, `tool_use` and the SDK's error classes. Swap it in from the test and script what Claude says.

## Install

```bash
npm install --save-dev llmao
```

## Mock the module

```ts
// Jest
jest.mock('@anthropic-ai/sdk', () => require('llmao/anthropic'));
// Vitest
vi.mock('@anthropic-ai/sdk', () => import('llmao/anthropic'));

import * as llmao from 'llmao/testing';
import { summarize } from './summarize'; // calls new Anthropic().messages.create()

beforeEach(() => llmao.reset());

test('summarizes', async () => {
  llmao.configure({ script: [{ when: 'Summarize', text: 'A short summary.' }] });

  expect(await summarize('A very long text')).toBe('A short summary.');
  expect(llmao.lastCall()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
});
```

## Tool use

```ts
llmao.configure({
  script: [
    { when: 'stock', toolCalls: [{ name: 'get_stock_price', args: { ticker: 'NVDA' } }] },
    { when: 'stock', afterToolResults: true, text: 'NVDA is trading at $1,337.' },
  ],
});
```

The first response has `stop_reason: 'tool_use'` and a `tool_use` block, exactly like the API. When your app sends the `tool_result` back, the second rule answers.

## Errors

```ts
llmao.configure({ failures: { rateLimit: 1 } });
await expect(summarize('hi')).rejects.toBeInstanceOf(Anthropic.RateLimitError);
```

The error has `status: 429`, a `retry-after` header and the same body as the real API (`{ type: 'error', error: { type: 'rate_limit_error' } }`).

## Related

- [Test rate limits, retries and outages](../simulate-llm-errors/)
- [Mock OpenAI in Jest](../mock-openai-jest/)
- [Any other test runner](../test-llm-code-any-runner/)
