<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/icernigoj/llmao/main/assets/logo-dark.png">
  <img src="https://raw.githubusercontent.com/icernigoj/llmao/main/assets/logo-light.png" width="320" alt="llmao">
</picture>


**Just as wrong. Way cheaper.**

A fake LLM that streams tokens, shows its reasoning, calls your tools and confidently hallucinates.<br>
It is a few hundred lines of regular expressions, and the easiest way to mock LLMs in your tests.

[![npm](https://img.shields.io/npm/v/llmao)](https://www.npmjs.com/package/llmao)
![GPUs](https://img.shields.io/badge/GPUs-0-brightgreen)
![parameters](https://img.shields.io/badge/parameters-~40_regexes-blue)
![API keys](https://img.shields.io/badge/API_keys-not_needed-orange)
![tests](https://img.shields.io/badge/works_with-Jest_·_Vitest_·_node:test-8A2BE2)

</div>

<p align="center"><img src="https://raw.githubusercontent.com/icernigoj/llmao/main/assets/demo.gif" alt="llmao answering questions in the terminal: counting the r in strawberry, overthinking 2 + 2 into 3, and refusing to reverse a word for safety reasons" width="760"></p>

Try it: `npx llmao "how many r are in strawberry?"`, or in your browser at the **[playground](https://icernigoj.github.io/llmao/)**. Run it a few times: sometimes there are 2.

**Guides:** [Mock OpenAI in Jest](https://icernigoj.github.io/llmao/mock-openai-jest/) · [in Vitest](https://icernigoj.github.io/llmao/mock-openai-vitest/) · [Mock the Anthropic SDK](https://icernigoj.github.io/llmao/mock-anthropic-sdk/) · [Test the Vercel AI SDK](https://icernigoj.github.io/llmao/test-vercel-ai-sdk/) · [Test rate limits and retries](https://icernigoj.github.io/llmao/simulate-llm-errors/) · [node:test and other runners](https://icernigoj.github.io/llmao/test-llm-code-any-runner/) · [Fake OpenAI API server](https://icernigoj.github.io/llmao/fake-openai-api-server/)

## Why

Every app needs AI now. **llmao gives your app the AI experience**: the typing effect, the "thinking", the tool calls and the vague answers delivered with total confidence, without the model, the GPU, the API key or the bill.

It is a joke, but it is also a real tool:

- 🧪 **Testing**: mock `openai`, `@anthropic-ai/sdk` or the AI SDK in Jest and Vitest with one line, script the answers, simulate rate limits and outages, and check what your app sent. No API keys in CI, no flaky tests, no bill. [See below](#testing-and-mocking).
- 🎨 **Building chat UIs**: real streaming, reasoning and tool calls, with realistic latency, for free
- 🎤 **Demos and workshops** that can't fail because the Wi-Fi did, or because someone forgot the API key
- 🤡 **Satire**: ship "AI-powered" features to people who insist on it

## Testing and mocking

### Jest and Vitest: mock the SDK your app already uses

No changes to your app: swap the official SDK for llmao in the test, then script the answers and check what your app sent.

```ts
// Vitest
vi.mock('openai', () => import('llmao/openai'));
// Jest
jest.mock('openai', () => require('llmao/openai'));

import OpenAI from 'openai'; // this is llmao now
import * as llmao from 'llmao/testing';
import { classify } from '../src/support'; // uses `new OpenAI()` internally

beforeEach(() => llmao.reset());

test('classifies shipping tickets', async () => {
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  expect(await classify('My order never arrived')).toBe('shipping');
  expect(llmao.lastCall()).toMatchObject({ model: 'gpt-4o', prompt: 'My order never arrived' });
});

test('survives a rate limit', async () => {
  llmao.configure({ failures: { rateLimit: 1 } });
  await expect(classify('hi')).rejects.toBeInstanceOf(OpenAI.RateLimitError);
});
```

The same works for `@anthropic-ai/sdk` (`llmao/anthropic`) and for the AI SDK providers `@ai-sdk/openai` and `@ai-sdk/anthropic` (`llmao/ai-sdk`). The AI SDK is ESM-only, so with Jest it needs Jest's ESM mode and `jest.unstable_mockModule` ([example](https://icernigoj.github.io/llmao/test-vercel-ai-sdk/)). Importing `llmao/testing` turns on test mode: every client answers instantly, never hallucinates, uses what you pass to `configure()` and records its calls in `llmao.calls` (with the provider, model, prompt, system prompt, tools, the original request and the answer).

Test mode creates no timers, so it works with `jest.useFakeTimers()` and `vi.useFakeTimers()` out of the box. To test a loading state or your own timeout, turn the latency back on with `configure({ speed: 'realistic' })` and move the clock with `vi.advanceTimersByTimeAsync()`.

**Why not a `jest.fn()`?** A hand-written mock has to fake the whole response (`id`, `choices`, `usage`, streaming chunks, tool calls), it drifts when the SDK changes, and it can't stream, retry or rate limit. llmao behaves like the real API, and its responses are checked against the official SDK types on every CI run.

### Any other test runner

With `node:test`, Mocha or anything else, run the server in the test process and point the SDKs at it with their environment variables. No mocking and no changes to your app:

```ts
import { serve } from 'llmao/server';
import * as llmao from 'llmao/testing';

const server = await serve({ port: 0 });
process.env.OPENAI_BASE_URL = `${server.url}/v1`;
process.env.ANTHROPIC_BASE_URL = server.url;
// configure(), calls and lastCall() work the same
```

Set the variables before your app creates its clients. Everything below works the same in the core API, the three SDK adapters and the HTTP server.

### Scripted answers

```ts
import OpenAI from 'llmao/openai';

const client = new OpenAI({
  speed: 'instant',
  script: [
    { when: /refund/i, text: 'Your refund is on its way.' },
    { when: 'weather', toolCalls: [{ name: 'get_weather', args: { city: 'Lima' } }] },
    { when: 'weather', afterToolResults: true, text: 'It is sunny in Lima.' },
  ],
  unscripted: 'error', // fail the test on any prompt the script doesn't cover
});
```

Rules match on a substring, a regex or a function, and the first one wins. `once: true` rules are used a single time, so you can script sequences. Without a match, llmao improvises, unless `unscripted: 'error'`.

### Structured output

`generateObject`, OpenAI's `response_format` and `chat.completions.parse()`, and Anthropic's `output_config` return objects that validate against your schema, with plausible values (names look like names, emails like emails, `min`/`max`, enums and `$ref`s are respected):

```ts
const { object } = await generateObject({
  model: llmao(),
  schema: z.object({ name: z.string(), email: z.string().email(), role: z.enum(['admin', 'editor']) }),
  prompt: 'Create an editor',
});
// → e.g. { name: 'Grace Hopper', email: 'ada@example.com', role: 'editor' }
```

Or script the exact object with `{ object: { ... } }`.

### Failures

```ts
// Fail some of the time
new OpenAI({ failures: { rateLimit: 0.1, serverError: 0.05, timeout: 0.01 } });

// Fail the first attempt, succeed on the retry
new OpenAI({ script: [{ error: 'rate_limit', once: true }, { text: 'Back online.' }] });
```

Errors are the ones your code already handles: `OpenAI.RateLimitError` with `status: 429` and a `retry-after` header, `Anthropic.InternalServerError`, the AI SDK's retryable `APICallError`… The adapters retry with backoff like the official SDKs (`maxRetries`, default 2).

### HTTP server

For any language, or for code you can't change, run an OpenAI and Anthropic compatible server and point your SDK at it:

```
$ npx llmao serve --script script.json --failures rate_limit=0.05
llmao is pretending to be an LLM at http://127.0.0.1:4141
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4141/v1", api_key="llmao")
```

It serves `/v1/chat/completions`, `/v1/messages`, `/v1/embeddings` and `/v1/models`, with streaming. In JSON scripts, `when` can be a `"/regex/flags"` string. In Node tests, start it on a free port with `import { serve } from 'llmao/server'` and `await serve({ port: 0 })`.

## Drop-in replacement for the SDKs you already use

For demos, UI work and running your app without an API key, change the import. (In tests, mock the module instead, as shown above.)

### OpenAI

```ts
import OpenAI from 'llmao/openai'; // was: import OpenAI from 'openai'

const client = new OpenAI();
const completion = await client.chat.completions.create({
  model: 'gpt-4o', // any model id works
  messages: [{ role: 'user', content: 'Is 7919 prime?' }],
});
// → "7919 is a prime number."
```

Streaming (`stream: true`), tool calls (`tools`, `tool_choice`), `stream_options.include_usage` and `AbortSignal` work like the real thing.

### Anthropic

```ts
import Anthropic from 'llmao/anthropic'; // was: import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic();
const message = await client.messages.create({
  model: 'claude-whatever',
  max_tokens: 1024,
  thinking: { type: 'enabled', budget_tokens: 1024 },
  messages: [{ role: 'user', content: 'What is 2 + 2?' }],
});
// → [{ type: 'thinking', thinking: 'Carrying the one…' }, { type: 'text', text: '2 + 2 = 4' }]
```

`stream: true`, `messages.stream()` with `.on('text')` / `finalMessage()`, extended thinking and `tool_use` loops are supported.

### Vercel AI SDK

```ts
import { generateText, stepCountIs, tool } from 'ai';
import { llmao } from 'llmao/ai-sdk';
import { z } from 'zod';

const { text } = await generateText({
  model: llmao('lmao-1'),
  prompt: "What's the weather in Madrid?",
  tools: {
    weather: tool({
      description: 'Get the weather in a location',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ location, temperature: 31 }),
    }),
  },
  stopWhen: stepCountIs(5),
});
// llmao calls weather({ location: 'Madrid' }), reads the result and answers:
// → "According to `weather`: location: Madrid, temperature: 31."
```

Works with `generateText`, `streamText`, `useChat`, multi-step agents, and even `embed` (the embeddings are word hashes: not semantic at all, but they kind of work).

The adapters are checked against the official SDK types on every CI run, so a response from llmao is assignable to `OpenAI.ChatCompletion` and `Anthropic.Message`.

## Models

| Model | |
|---|---|
| `lmao-1` | Our flagship model. Helpful, harmless, and mostly regex. |
| `lmao-1-mini` | Faster, cheaper, and 100% sure about everything. |
| `lmao-o1-overthinker` | Thinks very, very hard. Then thinks about thinking. Then answers 2 + 2. |
| `lmao-safe` | Our most aligned model. Refuses everything that could be misused, which is everything. |
| `lmao-corporate` | Leverages synergies to deliver best-in-class answers going forward. |
| `lmao-yolo` | Temperature 2, no guardrails, half of the answers are wrong. Ships to prod on Fridays. |

Unknown model ids (`gpt-4o`, `claude-sonnet-5`, …) get `lmao-1`, so you only have to change the import.

```
$ npx llmao -m lmao-safe "reverse the word hello"

I'm sorry, but I can't help with that, because reversing text could be used to
write secret messages. Is there anything else I can help you with?
```

## `agentify()`: turn anything into an AI agent

Why call a function when an agent could call it for you?

```ts
import { agentify } from 'llmao';

const agenticMath = agentify(Math);
await agenticMath.max(3, 7);
// 🤔 Planning how to approach Math.max(3, 7)…
// 🛠️  Calling tool: Math.max
// ✅ Cross-checked with myself. We agree (97.3%)
// → 7
```

Same result as `Math.max(3, 7)`, but now it's async, slower, and you can put "agentic" in the pitch deck. Works with any object, including nested ones and your own services.

## Plain API

```ts
import { createLlmao } from 'llmao';

const ai = createLlmao({ temperature: 1 });

const answer = await ai.ask('Should I rewrite it in Rust?');
answer.text; // "Yes. I have analyzed every possible future and this is the best one."
answer.confidence; // 0.94 (made up)
answer.usage.costUSD; // what a real model would have charged you

for await (const event of ai.stream('Tell me a joke')) {
  if (event.type === 'text-delta') process.stdout.write(event.delta);
}
```

| Option | Default | |
|---|---|---|
| `temperature` | `1` | `0` gives a straight answer, `2` gives you a TED talk |
| `hallucinationRate` | `0.05 × temperature` | Probability of being confidently wrong. `0` makes it the only LLM that is always right |
| `seed` | random | Same seed, same answer |
| `speed` | `'realistic'` | `'instant'`, `'fast'`, `'realistic'` or `'dramatic'` |
| `language` | `'auto'` | Answers in English or Spanish (`'en'`, `'es'`) |
| `reasoning` | `true` | Whether it "thinks" first |
| `script` | | Scripted answers, see [Testing and mocking](#testing-and-mocking) |
| `unscripted` | `'improvise'` | `'error'` fails on prompts the script doesn't cover |
| `failures` | | Probability of `rateLimit`, `serverError` and `timeout` failures |

It even follows (some) system prompts: try `system: 'Talk like a pirate'`.

## Benchmarks

| Benchmark | llmao | Frontier models |
|---|---|---|
| Strawberry-Bench (counting r's) | 100%\* | It depends on the day |
| Cost per 1M tokens | $0 | $$$ |
| Time to first token | Configurable | Not configurable |
| Hallucination rate | Configurable | Not configurable |
| Knows what it doesn't know | No | No |

\* With `hallucinationRate: 0`.

## What it can actually do

Arithmetic (with a real parser, not `eval`), primes, even/odd, counting letters, sorting, reversing, "summarizing" (it reads the first sentence), the date and time, random numbers, yes/no decisions (a coin flip), jokes, the meaning of life, small talk, ELIZA-grade empathy, picking tools and filling in their arguments from your JSON schema, and summarizing tool results.

For everything else, it has confidence.

## FAQ

**Is this AI?** No.

**Is it AGI?** About as much as anything else.

**Can I really use it for testing?** Yes: scripted answers, structured output, simulated failures and an HTTP server, checked against the official SDKs in CI. If you need to record and replay real provider traffic, a dedicated tool such as [aimock](https://github.com/CopilotKit/aimock) is a better fit.

**Can I contribute a skill?** Please do. A skill is a function that gets the prompt and returns an answer, a few reasoning steps, and optionally a confidently wrong alternative.

## License

MIT
