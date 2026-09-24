#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createLlmao } from './llmao';
import { MODELS } from './models';
import type { Speed, Turn } from './types';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint(2);
const bold = paint(1);
const cyan = paint(36);
const yellow = paint(33);

const HELP = `
${bold('llmao')} — an AI that isn't

${bold('Usage')}
  llmao "is 7 prime?"            Ask a question
  llmao                          Chat (Ctrl+C to leave)

${bold('Options')}
  -m, --model <id>        ${Object.keys(MODELS).join(', ')}
  -t, --temperature <n>   0 (straight answers) to 2 (TED talk)  [default: 1]
  -s, --seed <n>          Same seed, same answer
      --speed <speed>     instant, fast, realistic, dramatic   [default: realistic]
      --no-thinking       Skip the reasoning
      --stats             Show confidence, tokens and money saved
      --models            List the models
  -h, --help              Show this help
`;

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        model: { type: 'string', short: 'm' },
        temperature: { type: 'string', short: 't' },
        seed: { type: 'string', short: 's' },
        speed: { type: 'string' },
        'no-thinking': { type: 'boolean' },
        stats: { type: 'boolean' },
        models: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

const { values, positionals } = parse();

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.models) {
  for (const [id, card] of Object.entries(MODELS)) console.log(`${bold(id.padEnd(22))} ${card.description}`);
  process.exit(0);
}

const speeds: Speed[] = ['instant', 'fast', 'realistic', 'dramatic'];
if (values.speed && !speeds.includes(values.speed as Speed)) {
  console.error(`Unknown speed "${values.speed}". Use one of: ${speeds.join(', ')}`);
  process.exit(1);
}

const ai = createLlmao({
  model: values.model,
  temperature: values.temperature === undefined ? undefined : Number(values.temperature),
  seed: values.seed === undefined ? undefined : Number(values.seed),
  speed: values.speed as Speed | undefined,
  reasoning: values['no-thinking'] ? false : undefined,
});

async function answer(turns: Turn[]): Promise<string> {
  let text = '';
  for await (const event of ai.stream(turns)) {
    switch (event.type) {
      case 'reasoning-start':
        process.stdout.write(dim('💭 '));
        break;
      case 'reasoning-delta':
        process.stdout.write(dim(event.delta.replaceAll('\n', '\n💭 ')));
        break;
      case 'reasoning-end':
        process.stdout.write('\n\n');
        break;
      case 'text-delta':
        text += event.delta;
        process.stdout.write(event.delta);
        break;
      case 'finish': {
        process.stdout.write('\n');
        if (values.stats) {
          const { usage, confidence, hallucinated, skill } = event.answer;
          const saved = usage.costUSD.toFixed(6);
          console.log(
            dim(`\n${Math.round(confidence * 1000) / 10}% confident · ${usage.totalTokens} tokens · $${saved} saved · skill: ${skill}`) +
              (hallucinated ? yellow(' · 🍄 hallucinated') : ''),
          );
        }
        break;
      }
    }
  }
  return text;
}

async function main() {
  const question = positionals.join(' ').trim();
  if (question) {
    await answer([{ role: 'user', text: question }]);
    return;
  }

  if (!process.stdin.isTTY) {
    const input = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data));
    });
    await answer([{ role: 'user', text: input.trim() }]);
    return;
  }

  console.log(dim(`llmao (${values.model ?? 'lmao-1'}) — Ctrl+C to leave\n`));
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  readline.on('SIGINT', () => {
    console.log(dim('\nBye! That was 0 real tokens.'));
    process.exit(0);
  });

  const history: Turn[] = [];
  while (true) {
    const prompt = (await readline.question(cyan('› '))).trim();
    if (!prompt) continue;
    history.push({ role: 'user', text: prompt });
    history.push({ role: 'assistant', text: await answer(history) });
    console.log();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
