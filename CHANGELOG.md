# Changelog

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

First release: an AI that isn't.
