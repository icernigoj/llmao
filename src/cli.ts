#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createLlmao } from './llmao';
import { MODELS } from './models';
import { serve } from './server';
import type { Failures, ScriptRule, Speed, Turn } from './types';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint(2);
const bold = paint(1);
const cyan = paint(36);
const yellow = paint(33);

const HELP = `
${bold('llmao')}: just as wrong, way cheaper

${bold('Usage')}
  llmao "is 7 prime?"            Ask a question
  llmao                          Chat (Ctrl+C to leave)
  llmao serve                    Start an OpenAI and Anthropic compatible server

${bold('Options')}
  -m, --model <id>        ${Object.keys(MODELS).join(', ')}
  -t, --temperature <n>   0 (straight answers) to 2 (TED talk)  [default: 1]
  -s, --seed <n>          Same seed, same answer
      --speed <speed>     instant, fast, realistic, dramatic   [default: realistic]
      --no-thinking       Skip the reasoning
      --stats             Show confidence, tokens and money saved
      --models            List the models
  -h, --help              Show this help

${bold('Server options')}
  -p, --port <n>          [default: 4141]
      --host <host>       [default: 127.0.0.1]
      --script <file>     JSON file with scripted answers:
                          [{ "when": "/weather/i", "text": "Sunny" }]
      --failures <list>   e.g. rate_limit=0.1,server_error=0.05,timeout=0.01
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
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        script: { type: 'string' },
        failures: { type: 'string' },
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Script rules from JSON, where `when` can be a "/regex/flags" string */
function loadScript(file: string): ScriptRule[] {
  let rules: unknown;
  try {
    rules = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Could not read the script ${file}: ${(error as Error).message}`);
  }
  if (!Array.isArray(rules)) fail(`The script ${file} must be a JSON array of rules.`);
  return rules.map((rule: ScriptRule & { when?: unknown }) => {
    const regex = typeof rule.when === 'string' ? rule.when.match(/^\/(.*)\/([a-z]*)$/s) : null;
    return regex ? { ...rule, when: new RegExp(regex[1] as string, regex[2]) } : rule;
  });
}

function parseFailures(value: string): Failures {
  const keys: Record<string, keyof Failures> = { rate_limit: 'rateLimit', server_error: 'serverError', timeout: 'timeout' };
  const failures: Failures = {};
  for (const pair of value.split(',')) {
    const [name, probability] = pair.split('=');
    const key = keys[name?.trim() ?? ''];
    const number = Number(probability);
    if (!key || !(number >= 0 && number <= 1)) fail(`Invalid failure "${pair}". Use e.g. rate_limit=0.1,server_error=0.05,timeout=0.01`);
    failures[key] = number;
  }
  return failures;
}

const engineOptions = {
  model: values.model,
  temperature: values.temperature === undefined ? undefined : Number(values.temperature),
  seed: values.seed === undefined ? undefined : Number(values.seed),
  speed: values.speed as Speed | undefined,
  reasoning: values['no-thinking'] ? false : undefined,
  script: values.script ? loadScript(values.script) : undefined,
  failures: values.failures ? parseFailures(values.failures) : undefined,
};

const ai = createLlmao(engineOptions);

/**
 * Writes streamed tokens, wrapping lines between words instead of in the
 * middle of them.  Holds back at most one word.
 */
function createWrappingWriter() {
  const width = process.stdout.isTTY ? process.stdout.columns : Infinity;
  let column = 0;
  let word = '';

  const flush = () => {
    if (!word) return;
    const [, spaces = '', body = ''] = word.match(/^(\s*)([\s\S]*)$/) ?? [];
    if (spaces.includes('\n')) {
      process.stdout.write(word);
      column = body.length;
    } else if (column > 0 && column + spaces.length + body.length > width) {
      process.stdout.write(`\n${body}`);
      column = body.length;
    } else {
      process.stdout.write(word);
      column += word.length;
    }
    word = '';
  };

  return {
    write(token: string) {
      if (/^\s/.test(token)) flush();
      word += token;
    },
    end: flush,
  };
}

async function answer(turns: Turn[]): Promise<string> {
  let text = '';
  const writer = createWrappingWriter();
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
        writer.write(event.delta);
        break;
      case 'finish': {
        writer.end();
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

async function startServer() {
  const port = values.port === undefined ? 4141 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port "${values.port}".`);

  const { url } = await serve({ ...engineOptions, port, host: values.host });
  console.log(`${bold('llmao')} is pretending to be an LLM at ${cyan(url)}\n`);
  console.log(dim('  OpenAI      ') + `new OpenAI({ baseURL: '${url}/v1', apiKey: 'llmao' })`);
  console.log(dim('  Anthropic   ') + `new Anthropic({ baseURL: '${url}', apiKey: 'llmao' })`);
  console.log(dim('  curl        ') + `curl ${url}/v1/chat/completions -d '{"messages":[{"role":"user","content":"is 7 prime?"}]}'`);
  console.log(dim('\nCtrl+C to stop'));
}

async function main() {
  if (positionals[0] === 'serve') {
    await startServer();
    return;
  }

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

  console.log(dim(`llmao (${values.model ?? 'lmao-1'}). Ctrl+C to leave\n`));
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
