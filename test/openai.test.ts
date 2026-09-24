import { describe, expect, it } from 'vitest';
import OpenAI, { type ChatCompletionChunk, type ChatCompletionMessageParam } from '../src/openai';

const client = new OpenAI({ apiKey: 'sk-not-needed', speed: 'instant', hallucinationRate: 0, temperature: 0 });

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get the weather for a city',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  },
];

describe('chat.completions.create', () => {
  it('returns a chat completion', async () => {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Is 13 prime?' },
      ],
    });

    expect(completion).toMatchObject({
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '13 is a prime number.' }, finish_reason: 'stop' }],
    });
    expect(completion.id).toMatch(/^chatcmpl-/);
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  it('accepts content parts', async () => {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'is 8 even?' }] }],
    });
    expect(completion.choices[0]?.message.content).toBe('8 is even.');
  });

  it('streams chunks that add up to the answer', async () => {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'how many r are in strawberry' }],
      stream: true,
      stream_options: { include_usage: true },
    });

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks[0]?.choices[0]?.delta.role).toBe('assistant');
    expect(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? '').join('')).toBe('There are 3 "r" in "strawberry".');
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe('stop');
    expect(chunks.at(-1)?.choices).toEqual([]);
    expect(chunks.at(-1)?.usage?.completion_tokens).toBeGreaterThan(0);
  });

  it('runs a whole tool calling loop', async () => {
    const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: "What's the weather in Tokyo?" }];

    const first = await client.chat.completions.create({ model: 'gpt-4o', messages, tools });
    const toolCall = first.choices[0]?.message.tool_calls?.[0];
    expect(first.choices[0]?.finish_reason).toBe('tool_calls');
    expect(first.choices[0]?.message.content).toBeNull();
    expect(toolCall?.function).toEqual({ name: 'get_weather', arguments: '{"city":"Tokyo"}' });

    messages.push(first.choices[0]!.message as ChatCompletionMessageParam, {
      role: 'tool',
      tool_call_id: toolCall!.id,
      content: JSON.stringify({ temperature: 18, sky: 'cloudy' }),
    });

    const second = await client.chat.completions.create({ model: 'gpt-4o', messages, tools });
    expect(second.choices[0]?.message.content).toBe('According to `get_weather`: temperature: 18, sky: cloudy.');
  });

  it('streams tool calls with arguments in pieces', async () => {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather in Lima please' }],
      tools,
      stream: true,
    });

    let name = '';
    let args = '';
    for await (const chunk of stream) {
      for (const call of chunk.choices[0]?.delta.tool_calls ?? []) {
        name += call.function?.name ?? '';
        args += call.function?.arguments ?? '';
      }
    }
    expect(name).toBe('get_weather');
    expect(JSON.parse(args)).toEqual({ city: 'Lima' });
  });

  it('can be aborted', async () => {
    const slow = new OpenAI({ speed: 'dramatic' });
    const controller = new AbortController();
    const request = slow.chat.completions.create(
      { model: 'lmao-o1-overthinker', messages: [{ role: 'user', content: 'is 7 prime?' }] },
      { signal: controller.signal },
    );
    controller.abort(new Error('too slow'));
    await expect(request).rejects.toThrow('too slow');
  });
});

describe('models.list', () => {
  it('lists the llmao family', async () => {
    const { data } = await client.models.list();
    expect(data.map((model) => model.id)).toContain('lmao-o1-overthinker');
  });
});
