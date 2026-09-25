# Changelog

## 0.3.1

- New skill: rolling dice ("roll a die", "tirá un dado"). It is also the example in the new CONTRIBUTING.md
- First release published automatically from GitHub Actions, with npm provenance

## 0.3.0

- **`llmao/testing`** for Jest and Vitest: mock `openai`, `@anthropic-ai/sdk`, `@ai-sdk/openai` or `@ai-sdk/anthropic` with llmao, then `configure()` answers and failures from the test and assert on the recorded `calls`. Test mode is instant and never hallucinates
- `require('llmao/openai')` and `require('llmao/anthropic')` now return the client class, like the official SDKs, so `jest.mock('openai', () => require('llmao/openai'))` works
- `llmao/ai-sdk` exports `openai`, `createOpenAI`, `anthropic` and `createAnthropic`, plus the providers' method names (`chat`, `responses`, `messages`, `embedding`…)
- Works with any test runner (`node:test`, Mocha…) by pointing the SDKs at `llmao/server` with `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`
- New tagline: "Just as wrong. Way cheaper."

## 0.2.1

- Wording: no more em dashes in the CLI, the answers and the package description

## 0.2.0

llmao is now a real testing tool (it is still a joke).

- **Scripted answers**: `script` rules by substring, regex or function, `once` sequences, `afterToolResults` for agent loops, and `unscripted: 'error'` for strict tests
- **Structured output**: `generateObject`, OpenAI `response_format` and `chat.completions.parse()`, Anthropic `output_config`, and `schema` in the core API. Objects validate against the schema and look plausible
- **Simulated failures**: `failures: { rateLimit, serverError, timeout }` or scripted `error`s, thrown as the official SDK error classes (`OpenAI.RateLimitError`, `Anthropic.InternalServerError`, the AI SDK's `APICallError`…), with retries and backoff like the real SDKs
- **HTTP server**: `npx llmao serve` and `llmao/server` speak `/v1/chat/completions`, `/v1/messages`, `/v1/embeddings` and `/v1/models`, so any SDK in any language can use llmao
- The CLI wraps long answers between words

## 0.1.0

First release.
