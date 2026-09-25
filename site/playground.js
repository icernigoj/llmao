import { createLlmao, MODELS } from './lib/index.mjs';

const $ = (id) => document.getElementById(id);
// Google Analytics events, when the site is built with GA_ID
const track = (name, params = {}) => window.gtag?.('event', name, params);
const form = $('ask');
const promptInput = $('prompt');
const modelSelect = $('model');
const output = $('output');
const stats = $('stats');
const share = $('share');

const EXAMPLES = [
  'how many r are in strawberry?',
  'what is 2 + 2?',
  'reverse the word hello',
  'should I rewrite it in Rust?',
  'explain quantum computing',
  '¿cuántas r hay en frutilla?',
];

for (const [id, card] of Object.entries(MODELS)) {
  const option = new Option(id, id);
  option.title = card.description;
  modelSelect.add(option);
}

for (const example of EXAMPLES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = example;
  button.addEventListener('click', () => {
    promptInput.value = example;
    run();
  });
  $('examples').append(button);
}

let controller;

async function run(seed = Math.floor(Math.random() * 2 ** 31)) {
  const prompt = promptInput.value.trim() || promptInput.placeholder;
  const model = modelSelect.value;
  promptInput.value = prompt;

  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;

  // The link reproduces this exact answer
  const params = new URLSearchParams({ q: prompt, m: model, s: String(seed) });
  history.replaceState(null, '', `?${params}`);
  share.hidden = true;
  stats.textContent = '';

  output.replaceChildren();
  const thinking = document.createElement('div');
  thinking.className = 'thinking';
  const answer = document.createElement('div');
  answer.className = 'answer';
  output.append(thinking, answer);

  track('playground_ask', { model, example: EXAMPLES.includes(prompt) });
  const llmao = createLlmao({ model, seed, speed: model === 'lmao-o1-overthinker' ? 'fast' : 'realistic' });
  try {
    for await (const event of llmao.stream(prompt, { signal })) {
      if (event.type === 'reasoning-start') thinking.textContent = '💭 ';
      if (event.type === 'reasoning-delta') thinking.textContent += event.delta.replaceAll('\n', '\n💭 ');
      if (event.type === 'text-delta') answer.textContent += event.delta;
      if (event.type === 'finish') {
        const { confidence, usage, hallucinated } = event.answer;
        stats.textContent = `${(confidence * 100).toFixed(1)}% confident · ${usage.totalTokens} tokens · $${usage.costUSD.toFixed(6)} saved${hallucinated ? ' · 🍄 hallucinated' : ''}`;
        share.hidden = false;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    answer.className = 'answer error';
    answer.textContent = String(error?.message ?? error);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});

share.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    share.textContent = 'Copied!';
    track('share_answer', { model: modelSelect.value });
  } catch {
    share.textContent = 'Copy the URL from the address bar';
  }
  setTimeout(() => (share.textContent = 'Copy link to this answer'), 1800);
});

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied!';
      track('copy_install');
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    } catch {
      // Clipboard unavailable: the command is visible anyway
    }
  });
}

// Shared link: replay the exact same answer
const params = new URLSearchParams(location.search);
if (params.get('q')) {
  track('open_shared_answer', { model: params.get('m') ?? '' });
  promptInput.value = params.get('q');
  if (MODELS[params.get('m')]) modelSelect.value = params.get('m');
  run(Number(params.get('s')) || undefined);
}

// Code example tabs
for (const container of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      select(tab);
      track('select_example', { example: tab.id.replace('tab-', '') });
    });
    tab.addEventListener('keydown', (event) => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset) return;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}
