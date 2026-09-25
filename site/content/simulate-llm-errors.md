---
title: How to test rate limits (429), retries and outages of LLM APIs
description: Simulate OpenAI and Anthropic rate limits, 500 errors and timeouts in your tests, with the SDKs' real error classes and retry-after headers, to check your retry and fallback logic.
---

# How to test rate limits (429), retries and outages of LLM APIs

Retry and fallback logic around LLM calls is easy to get wrong and hard to test, because real rate limits don't happen on demand. [llmao](https://github.com/icernigoj/llmao) makes them happen.

## Fail on demand

```ts
import * as llmao from 'llmao/testing';

// Every call fails with a rate limit
llmao.configure({ failures: { rateLimit: 1 } });

// Or some of the time
llmao.configure({ failures: { rateLimit: 0.1, serverError: 0.05, timeout: 0.01 } });

// Or exactly once: the first attempt fails, the retry succeeds
llmao.configure({ script: [{ error: 'rate_limit', once: true }, { text: 'Back online.' }] });
```

## The errors your code already handles

| | OpenAI SDK | Anthropic SDK | Vercel AI SDK |
|---|---|---|---|
| Rate limit | `OpenAI.RateLimitError`, `status: 429` | `Anthropic.RateLimitError`, `status: 429` | `APICallError`, `statusCode: 429` |
| Server error | `OpenAI.InternalServerError`, `status: 500` | `Anthropic.InternalServerError` | `APICallError`, `statusCode: 500` |
| Timeout | `OpenAI.APIConnectionTimeoutError` | `Anthropic.APIConnectionTimeoutError` | `APICallError` |

Rate limits come with a `retry-after` header on `error.headers` (a `Headers` object: read it with `error.headers.get('retry-after')`, not `error.headers['retry-after']`). In test mode it is `0`, so your backoff doesn't slow the test down.

## Retries

The OpenAI and Anthropic clients retry like the official SDKs (`maxRetries`, default 2), and the AI SDK runs its own retries. Each attempt is recorded, so you can assert on them:

```ts
llmao.configure({ failures: { rateLimit: 1 } });
await expect(classify('hi')).rejects.toBeInstanceOf(OpenAI.RateLimitError);

expect(llmao.calls).toHaveLength(3); // the first attempt plus two retries
expect(llmao.calls.every((call) => call.failure === 'rate_limit')).toBe(true);
```

If your code wraps the SDK in its own retry loop, this is also how you find out that you are retrying the SDK's retries.

## Related

- [Mock OpenAI in Jest](../mock-openai-jest/)
- [Mock the Anthropic SDK](../mock-anthropic-sdk/)
