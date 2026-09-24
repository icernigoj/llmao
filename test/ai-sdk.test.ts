import { cosineSimilarity, embedMany, generateText, stepCountIs, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmao } from '../src/ai-sdk';

const llmao = createLlmao({ speed: 'instant', hallucinationRate: 0, temperature: 0 });

describe('Vercel AI SDK provider', () => {
  it('works with generateText', async () => {
    const { text, reasoningText, finishReason, usage, providerMetadata } = await generateText({
      model: llmao('lmao-1'),
      prompt: 'Is 7919 prime?',
    });

    expect(text).toBe('7919 is a prime number.');
    expect(reasoningText).toMatch(/divisor/);
    expect(finishReason).toBe('stop');
    expect(usage.totalTokens).toBeGreaterThan(0);
    expect(providerMetadata?.llmao).toMatchObject({ skill: 'prime', hallucinated: false });
  });

  it('works with streamText', async () => {
    const result = streamText({ model: llmao('lmao-1'), prompt: 'reverse "stressed"' });
    let text = '';
    for await (const delta of result.textStream) text += delta;
    expect(text).toBe('desserts');
    await expect(result.finishReason).resolves.toBe('stop');
  });

  it('runs a multi-step agent with real tools', async () => {
    const calls: string[] = [];
    const { text, steps } = await generateText({
      model: llmao('lmao-1'),
      prompt: "What's the weather in Madrid?",
      tools: {
        weather: tool({
          description: 'Get the weather in a location',
          inputSchema: z.object({ location: z.string().describe('The city') }),
          execute: async ({ location }) => {
            calls.push(location);
            return { location, temperature: 31 };
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });

    expect(calls).toEqual(['Madrid']);
    expect(steps).toHaveLength(2);
    expect(text).toBe('According to `weather`: location: Madrid, temperature: 31.');
  });

  it('streams tool calls too', async () => {
    const result = streamText({
      model: llmao('lmao-1'),
      prompt: 'weather in Oslo',
      tools: {
        weather: tool({
          description: 'Get the weather in a location',
          inputSchema: z.object({ location: z.string() }),
          execute: async ({ location }) => ({ location, temperature: -3 }),
        }),
      },
      stopWhen: stepCountIs(3),
    });

    await expect(result.text).resolves.toBe('According to `weather`: location: Oslo, temperature: -3.');
  });

  it('has embeddings that are not semantic at all but kind of work', async () => {
    const { embeddings } = await embedMany({
      model: llmao.embeddingModel(),
      values: ['the cat sat on the mat', 'a cat sat on a mat', 'quarterly revenue grew 12%'],
    });
    const [cat, similarCat, revenue] = embeddings as [number[], number[], number[]];
    expect(cosineSimilarity(cat, similarCat)).toBeGreaterThan(cosineSimilarity(cat, revenue));
  });

  it('cannot draw', () => {
    expect(() => llmao.imageModel('lmao-vision')).toThrow('It can barely count');
  });
});
