// An app that knows nothing about llmao: it uses the official SDKs
import Anthropic from '@anthropic-ai/sdk';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: 'sk-this-would-be-a-real-key' });
const claude = new Anthropic({ apiKey: 'sk-ant-this-too' });

export async function classify(ticket: string): Promise<string | null> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Classify the ticket as billing, shipping or other.' },
      { role: 'user', content: ticket },
    ],
  });
  return completion.choices[0]?.message.content ?? null;
}

export async function summarize(text: string): Promise<string> {
  const message = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: `Summarize: ${text}` }],
  });
  const block = message.content[0];
  return block?.type === 'text' ? block.text : '';
}

export async function reply(ticket: string): Promise<string> {
  const { text } = await generateText({ model: openai('gpt-4o'), system: 'You are a friendly support agent.', prompt: ticket });
  return text;
}
