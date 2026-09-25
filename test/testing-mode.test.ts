import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as llmao from '../src/testing';
import { classify, reply, summarize } from './fixtures/support-app';

// Swap the official SDKs for llmao, without touching the app
vi.mock('openai', () => import('../src/openai'));
vi.mock('@anthropic-ai/sdk', () => import('../src/anthropic'));
vi.mock('@ai-sdk/openai', () => import('../src/ai-sdk'));

beforeEach(() => llmao.reset());

describe('llmao/testing', () => {
  it('scripts the answers of an app that uses the OpenAI SDK', async () => {
    llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });
    await expect(classify('My order never arrived')).resolves.toBe('shipping');
  });

  it('records what the app sent', async () => {
    llmao.configure({ script: [{ text: 'billing' }] });
    await classify('I was charged twice');

    expect(llmao.calls).toHaveLength(1);
    expect(llmao.lastCall()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'I was charged twice',
      system: 'Classify the ticket as billing, shipping or other.',
      answer: { text: 'billing' },
    });
    expect(llmao.calls[0]?.params).toMatchObject({ messages: [{ role: 'system' }, { role: 'user', content: 'I was charged twice' }] });
  });

  it('fails the test on prompts the script does not cover, in strict mode', async () => {
    llmao.configure({ script: [{ when: 'refund', text: 'billing' }], unscripted: 'error' });
    await expect(classify('Where is my package?')).rejects.toThrow(/no scripted answer for "Where is my package\?"/);
    expect(llmao.lastCall()?.error).toBeInstanceOf(Error);
  });

  it('simulates outages with the SDK error classes the app already handles', async () => {
    llmao.configure({ failures: { rateLimit: 1 } });
    await expect(classify('hi')).rejects.toBeInstanceOf(OpenAI.RateLimitError);
    // The first attempt plus the SDK's two retries
    expect(llmao.calls).toHaveLength(3);
    expect(llmao.calls.every((call) => call.failure === 'rate_limit')).toBe(true);
  });

  it('lets the app recover from a failed first attempt', async () => {
    llmao.configure({ script: [{ error: 'server_error', once: true }, { text: 'other' }] });
    await expect(classify('hello')).resolves.toBe('other');
    expect(llmao.calls.map((call) => call.failure ?? call.answer?.text)).toEqual(['server_error', 'other']);
  });

  it('works for the Anthropic SDK', async () => {
    llmao.configure({ script: [{ when: 'Summarize', text: 'A short summary.' }] });
    await expect(summarize('A very long text')).resolves.toBe('A short summary.');
    expect(llmao.lastCall()?.provider).toBe('anthropic');
  });

  it('works for the AI SDK providers', async () => {
    llmao.configure({ script: [{ text: 'Happy to help!' }] });
    await expect(reply('Hi!')).resolves.toBe('Happy to help!');
    expect(llmao.lastCall()).toMatchObject({ provider: 'ai-sdk', model: 'gpt-4o', system: 'You are a friendly support agent.' });
  });

  it('is fast and honest by default, even though the app set nothing', async () => {
    const started = Date.now();
    await classify('is 7 prime?');
    expect(Date.now() - started).toBeLessThan(100);
    expect(llmao.lastCall()?.answer?.hallucinated).toBe(false);
  });

  it('reset() clears calls and configuration', async () => {
    llmao.configure({ script: [{ text: 'scripted' }] });
    await classify('x');
    llmao.reset();
    expect(llmao.calls).toHaveLength(0);
    await expect(classify('is 9 prime?')).resolves.not.toBe('scripted');
  });
});

describe('fake timers', () => {
  afterEach(() => vi.useRealTimers());

  it('does not need them: test mode creates no timers at all', async () => {
    vi.useFakeTimers();
    llmao.configure({ script: [{ text: 'shipping' }] });
    // Resolves without advancing the clock
    await expect(classify('where is my order')).resolves.toBe('shipping');
  });

  it('can drive realistic latency, e.g. to test a loading state or a timeout', async () => {
    vi.useFakeTimers();
    llmao.configure({ speed: 'realistic', script: [{ text: 'shipping' }] });

    let settled = false;
    const result = classify('where is my order').then((label) => {
      settled = true;
      return label;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false); // still "thinking"

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(true);
    await expect(result).resolves.toBe('shipping');
  });

  it('retries rate limits without waiting in real time', async () => {
    vi.useFakeTimers();
    llmao.configure({ speed: 'realistic', script: [{ error: 'rate_limit', once: true }, { text: 'billing' }] });
    const result = classify('charged twice');
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBe('billing');
  });
});
