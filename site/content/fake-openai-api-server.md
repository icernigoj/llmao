---
title: A fake OpenAI-compatible API server for local development and CI
description: Run a local server that speaks the OpenAI and Anthropic APIs (chat completions, messages, embeddings, streaming) for development, demos and CI, from any language. No API key.
---

# A fake OpenAI-compatible API server for local development and CI

```bash
npx llmao serve
```

```
llmao is pretending to be an LLM at http://127.0.0.1:4141
```

[llmao](https://github.com/icernigoj/llmao) serves `/v1/chat/completions`, `/v1/messages` (Anthropic), `/v1/embeddings` and `/v1/models`, with streaming, tool calls and structured output. Point any SDK at it:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4141/v1", api_key="llmao")
print(client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "is 7 prime?"}]).choices[0].message.content)
# e.g. "Certainly! 7 is a prime number." (use --temperature 0 for plain answers)
```

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"how many r are in strawberry?"}]}'
```

## Scripted answers and failures

```bash
npx llmao serve --script script.json --failures rate_limit=0.05,server_error=0.01
```

```json
[
  { "when": "/order\\s+#?\\d+/i", "text": "Your order has shipped." },
  { "when": "boom", "error": "server_error" }
]
```

In a JSON script, `when` can be a `"/regex/flags"` string. Failures come back with the real status codes and error bodies (429 with `retry-after`, 500, 504), so your SDK's retry logic runs.

## Options

| Flag | |
|---|---|
| `-p, --port` | Port (default `4141`) |
| `--host` | Host (default `127.0.0.1`) |
| `--script <file>` | Scripted answers |
| `--failures <list>` | e.g. `rate_limit=0.1,server_error=0.05,timeout=0.01` |
| `--speed` | `instant`, `fast`, `realistic` or `dramatic` |
| `-m, --model` | Personality: `lmao-1`, `lmao-safe`, `lmao-o1-overthinker`… |

In Node, start it from code with `import { serve } from 'llmao/server'` and `await serve({ port: 0 })`.

## Related

- [Any test runner with environment variables](../test-llm-code-any-runner/)
- [Test rate limits, retries and outages](../simulate-llm-errors/)
