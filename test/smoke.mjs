// Runs the built package on old Node versions, without any dev tooling
import assert from 'node:assert/strict';
import { agentify, createLlmao } from '../dist/index.mjs';
import OpenAI from '../dist/openai.mjs';
import Anthropic from '../dist/anthropic.mjs';

const options = { speed: 'instant', temperature: 0, hallucinationRate: 0 };

assert.equal((await createLlmao(options).ask('is 7 prime?')).text, '7 is a prime number.');

let streamed = '';
for await (const event of createLlmao(options).stream('reverse "abc"')) {
  if (event.type === 'text-delta') streamed += event.delta;
}
assert.equal(streamed, 'cba');

const completion = await new OpenAI(options).chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'is 4 even?' }] });
assert.equal(completion.choices[0].message.content, '4 is even.');

const stream = await new OpenAI(options).chat.completions.create({ model: 'x', stream: true, messages: [{ role: 'user', content: 'is 4 even?' }] });
let chunks = '';
for await (const chunk of stream) chunks += chunk.choices[0]?.delta.content ?? '';
assert.equal(chunks, '4 is even.');

const message = await new Anthropic(options).messages.stream({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'sort 2, 1' }] }).finalText();
assert.equal(message, '1, 2');

assert.equal(await agentify(Math, { log: () => {}, thinkingTime: 0 }).abs(-3), 3);

console.log(`smoke ok on node ${process.version}`);
