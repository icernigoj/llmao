<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/icernigoj/llmao/main/assets/logo-dark.png">
  <img src="https://raw.githubusercontent.com/icernigoj/llmao/main/assets/logo-light.png" width="320" alt="llmao">
</picture>


**An AI that isn't.**

It streams tokens, shows its reasoning, calls your tools, reports token usage and confidently hallucinates.<br>
It is also a few hundred lines of regular expressions.

[![npm](https://img.shields.io/npm/v/llmao)](https://www.npmjs.com/package/llmao)
![GPUs](https://img.shields.io/badge/GPUs-0-brightgreen)
![parameters](https://img.shields.io/badge/parameters-~40_regexes-blue)
![API keys](https://img.shields.io/badge/API_keys-not_needed-orange)

</div>

```
$ npx llmao "how many r are in strawberry?"

💭 Consulting 175 billion parameters (it is a dozen regexes)…
💭 Spelling it out: s-t-r-a-w-b-e-r-r-y
💭 Counting every "r" very carefully, as I was trained to do…

Great question! There are 3 "r" in "strawberry". I hope this helps! 😊
```

Run it a few more times. Sometimes there are 2.

## Why

Every app needs AI now. **llmao gives your app the AI experience** — the typing effect, the "thinking", the tool calls, the vague answers delivered with total confidence — without the model, the GPU, the API key or the bill.

It is a joke, but it is also genuinely handy:

- 🎤 **Demos and workshops** that can't fail because the Wi-Fi did, or because someone forgot the API key
- 🎨 **Building chat UIs**: real streaming, reasoning and tool calls, with realistic latency, for free
- 🧪 **Tests and CI** with `seed` for reproducible answers and `speed: 'instant'`
- 🤡 **Satire**: ship "AI-powered" features to people who insist on it

## Drop-in replacement for the SDKs you already use

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

**Is this a real mock for testing LLM apps?** It's good for UI development, demos and reproducible tests. For recording and replaying real provider traffic over HTTP, use a dedicated tool such as [aimock](https://github.com/CopilotKit/aimock).

**Can I contribute a skill?** Please do. A skill is a function that gets the prompt and returns an answer, a few reasoning steps, and optionally a confidently wrong alternative.

## License

MIT
