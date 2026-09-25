// Runs the built package on old Node versions, without any dev tooling
import assert from 'node:assert/strict';
import { agentify, createLlmao } from '../dist/index.mjs';
import OpenAI from '../dist/openai.mjs';
import Anthropic from '../dist/anthropic.mjs';
import { serve } from '../dist/server.mjs';

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

// Scripts, structured output and failures
const scripted = createLlmao({ ...options, script: [{ when: /refund/i, text: 'On its way.' }] });
assert.equal((await scripted.ask('my REFUND?')).text, 'On its way.');
const { object } = await createLlmao(options).ask('a user', { schema: { type: 'object', properties: { age: { type: 'integer', minimum: 18, maximum: 20 } }, required: ['age'] } });
assert.ok(object.age >= 18 && object.age <= 20);
await assert.rejects(
  new OpenAI({ ...options, maxRetries: 0, failures: { rateLimit: 1 } }).chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
  (error) => error instanceof OpenAI.RateLimitError && error.status === 429,
);

// The HTTP server
const server = await serve({ ...options, port: 0 });
try {
  const response = await fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'is 4 even?' }] }),
  });
  assert.equal((await response.json()).choices[0].message.content, '4 is even.');

  const stream = await fetch(`${server.url}/v1/messages`, {
    method: 'POST',
    body: JSON.stringify({ model: 'x', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'is 4 even?' }] }),
  });
  assert.match(await stream.text(), /event: message_stop/);
} finally {
  await server.close();
}

// CommonJS: require() returns the class, like the official SDKs
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const OpenAICjs = require('../dist/openai.cjs');
assert.equal(typeof OpenAICjs, 'function');
assert.equal(OpenAICjs.default, OpenAICjs);
assert.equal(typeof require('../dist/anthropic.cjs'), 'function');

// Test mode, shared between the ESM and CJS builds
const testing = await import('../dist/testing.mjs');
testing.configure({ script: [{ text: 'scripted' }] });
const cjsCompletion = await new OpenAICjs().chat.completions.create({ model: 'x', messages: [{ role: 'user', content: 'hi' }] });
assert.equal(cjsCompletion.choices[0].message.content, 'scripted');
assert.equal(testing.lastCall().provider, 'openai');
testing.reset();
testing.disable();

console.log(`smoke ok on node ${process.version}`);
