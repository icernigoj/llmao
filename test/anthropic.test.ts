import { describe, expect, it } from 'vitest';
import Anthropic, { type MessageParam, type MessageStreamEvent } from '../src/anthropic';

const client = new Anthropic({ apiKey: 'not-needed', speed: 'instant', hallucinationRate: 0, temperature: 0 });

const tools = [
  {
    name: 'get_stock_price',
    description: 'Get the current stock price for a ticker',
    input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] },
  },
];

describe('messages.create', () => {
  it('returns a message', async () => {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Is 21 prime?' }],
    });

    expect(message).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '21 is not a prime number.' }],
    });
    expect(message.id).toMatch(/^msg_/);
    expect(message.usage.input_tokens).toBeGreaterThan(0);
  });

  it('shows its thinking when extended thinking is enabled', async () => {
    const message = await client.messages.create({
      model: 'lmao-o1-overthinker',
      max_tokens: 1024,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: 'what is 2 + 2' }],
    });

    expect(message.content[0]).toMatchObject({ type: 'thinking', thinking: expect.stringContaining('What is a number, really?') });
    expect(message.content[1]).toMatchObject({ type: 'text', text: '2 + 2 = 4 …I think.' });
  });

  it('runs a whole tool use loop', async () => {
    const messages: MessageParam[] = [{ role: 'user', content: 'What is the stock price of "NVDA"?' }];

    const first = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages, tools });
    const toolUse = first.content.find((block) => block.type === 'tool_use');
    expect(first.stop_reason).toBe('tool_use');
    expect(toolUse).toMatchObject({ type: 'tool_use', name: 'get_stock_price', input: { ticker: 'NVDA' } });

    messages.push(
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse!.type === 'tool_use' ? toolUse!.id : '', content: '{"price":1337}' }] },
    );

    const second = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages, tools });
    expect(second.content).toEqual([{ type: 'text', text: 'According to `get_stock_price`: price: 1337.', citations: null }]);
  });

  it('streams the same events as the real API', async () => {
    const stream = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: 'is 9 odd?' }],
    });

    const events: MessageStreamEvent[] = [];
    for await (const event of stream) events.push(event);

    expect(events[0]?.type).toBe('message_start');
    expect(events.at(-2)).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
    expect(events.at(-1)?.type).toBe('message_stop');

    const blocks = events.flatMap((event) => (event.type === 'content_block_start' ? [event.content_block.type] : []));
    expect(blocks).toEqual(['thinking', 'text']);

    const text = events
      .map((event) => (event.type === 'content_block_delta' && event.delta.type === 'text_delta' ? event.delta.text : ''))
      .join('');
    expect(text).toBe('9 is odd.');

    // Every started block is stopped
    const starts = events.filter((event) => event.type === 'content_block_start').length;
    const stops = events.filter((event) => event.type === 'content_block_stop').length;
    expect(stops).toBe(starts);
  });
});

describe('messages.stream', () => {
  it('emits text events and resolves the final message', async () => {
    const deltas: string[] = [];
    const stream = client.messages
      .stream({ model: 'claude-sonnet-5', max_tokens: 1024, messages: [{ role: 'user', content: 'sort 3, 1, 2' }] })
      .on('text', (delta) => deltas.push(delta));

    const message = await stream.finalMessage();
    expect(deltas.join('')).toBe('1, 2, 3');
    expect(message.content).toEqual([{ type: 'text', text: '1, 2, 3', citations: null }]);
    await expect(stream.finalText()).resolves.toBe('1, 2, 3');
  });

  it('can also be iterated', async () => {
    const stream = client.messages.stream({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    expect(types.at(-1)).toBe('message_stop');
  });
});
