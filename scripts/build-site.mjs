// Builds the docs site (GitHub Pages) into site-dist/: the landing page with
// the playground, one page per recipe, llms.txt, llms-full.txt and a sitemap.
// Run `pnpm build` first: the playground uses the library from dist/.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { createHighlighter } from 'shiki';
import { siAnthropic, siJest, siNodedotjs, siPython, siVercel, siVitest } from 'simple-icons';

// SITE_URL lets you preview locally, e.g. SITE_URL=http://localhost:4173
const SITE = (process.env.SITE_URL ?? 'https://icernigoj.github.io/llmao').replace(/\/$/, '');
const REPO = 'https://github.com/icernigoj/llmao';
const OUT = 'site-dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (!existsSync('dist/index.mjs')) throw new Error('Run `pnpm build` before building the site');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// --- Markdown with highlighted code ------------------------------------------

const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['ts', 'js', 'bash', 'json', 'python', 'text'],
});

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
      return highlighter.codeToHtml(text, { lang: language, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
    },
  },
});

const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseFrontMatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('Missing front matter');
  const meta = Object.fromEntries(match[1].split('\n').map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]));
  return { meta, body: source.slice(match[0].length) };
}

// --- Logos: Simple Icons (CC0), except OpenAI, which is not in that set: its official files, unmodified, under OpenAI's brand terms ---

const BRANDS = {
  jest: { icon: siJest, label: 'Jest' },
  vitest: { icon: siVitest, label: 'Vitest' },
  node: { icon: siNodedotjs, label: 'node:test' },
  openai: { image: 'openai-blossom', label: 'OpenAI' },
  anthropic: { icon: siAnthropic, label: 'Anthropic', mono: true },
  aisdk: { icon: siVercel, label: 'AI SDK', mono: true },
  python: { icon: siPython, label: 'Python' },
};

function logo(id, { withLabel = true } = {}) {
  const brand = BRANDS[id];
  if (brand.image) {
    // Official files as provided: black on light backgrounds, white on dark ones
    const picture = `<picture class="official-logo"><source media="(prefers-color-scheme: dark)" srcset="${SITE}/brand/${brand.image}-white.svg"><img src="${SITE}/brand/${brand.image}-black.svg" alt="" width="40" height="40"></picture>`;
    return `<span class="brand-logo" title="${brand.label}">${picture}${withLabel ? `<span>${brand.label}</span>` : ''}</span>`;
  }
  if (!brand.icon) return `<span class="brand-logo brand-text">${brand.label}</span>`;
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true" style="${brand.mono ? '' : `color:#${brand.icon.hex}`}"><path d="${brand.icon.path}"/></svg>`;
  return `<span class="brand-logo" title="${brand.label}">${svg}${withLabel ? `<span>${brand.label}</span>` : ''}</span>`;
}

// --- Layout --------------------------------------------------------------------

function layout({ title, description, path, body, scripts = '' }) {
  const url = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${url}">
<meta name="google-site-verification" content="AW7gF3qFlfkbJ_9RQGB9tSLCO42lvEGnW_jM5OYEZ0Y">
<link rel="icon" href="${SITE}/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="${SITE}/assets/favicon-32.png">
<link rel="apple-touch-icon" href="${SITE}/assets/apple-touch-icon.png">
<meta name="theme-color" content="#0d1117">
<link rel="alternate" type="text/plain" title="llms.txt" href="${SITE}/llms.txt">
<meta property="og:type" content="website">
<meta property="og:site_name" content="llmao">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${SITE}/assets/social-preview.png">
<link rel="stylesheet" href="${SITE}/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${SITE}/"><picture><source media="(prefers-color-scheme: dark)" srcset="${SITE}/assets/logo-dark.png"><img src="${SITE}/assets/logo-light.png" alt="llmao" height="26"></picture></a>
  <nav>
    <a href="${SITE}/#docs">Docs</a>
    <a href="${REPO}">GitHub</a>
    <a href="https://www.npmjs.com/package/llmao">npm</a>
  </nav>
</header>
${body}
<footer>
  <p><a href="${REPO}">llmao</a> is MIT licensed. It is a joke, and also a real testing tool. · <a href="${SITE}/llms.txt">llms.txt</a></p>
  <p class="legal">OpenAI, Anthropic, Vercel, Jest, Vitest, Node.js, Python and other names and logos are trademarks of their respective owners, used only to show compatibility. llmao is not affiliated with or endorsed by them.</p>
</footer>
${scripts}
</body>
</html>
`;
}

// --- Recipes -------------------------------------------------------------------

const recipes = readdirSync('site/content')
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => {
    const slug = file.replace(/\.md$/, '');
    const source = readFileSync(join('site/content', file), 'utf8');
    return { slug, ...parseFrontMatter(source) };
  });

// Order on the landing page and in llms.txt
const ORDER = [
  'mock-openai-jest',
  'mock-openai-vitest',
  'mock-anthropic-sdk',
  'test-vercel-ai-sdk',
  'simulate-llm-errors',
  'test-llm-code-any-runner',
  'fake-openai-api-server',
];
recipes.sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));

for (const recipe of recipes) {
  const html = marked.parse(recipe.body);
  mkdirSync(join(OUT, recipe.slug), { recursive: true });
  writeFileSync(
    join(OUT, recipe.slug, 'index.html'),
    layout({
      title: `${recipe.meta.title} | llmao`,
      description: recipe.meta.description,
      path: `/${recipe.slug}/`,
      body: `<main class="doc">${html}<p class="doc-footer"><a href="${SITE}/">← llmao</a> · <a href="${SITE}/${recipe.slug}.md">Markdown</a></p></main>`,
    }),
  );
  // Plain Markdown next to every page, for llms.txt readers
  writeFileSync(join(OUT, `${recipe.slug}.md`), recipe.body);
}

// --- Landing page ----------------------------------------------------------------

const EXAMPLES = [
  {
    id: 'jest',
    label: 'Jest',
    logos: ['jest', 'openai'],
    caption: 'Mock <code>openai</code> with one line. Your app keeps calling <code>new OpenAI()</code>.',
    guide: 'mock-openai-jest/',
    code: `jest.mock('openai', () => require('llmao/openai'));

import * as llmao from 'llmao/testing';
import { classify } from './support'; // uses new OpenAI() inside

beforeEach(() => llmao.reset());

test('classifies shipping tickets', async () => {
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  expect(await classify('My order never arrived')).toBe('shipping');
  expect(llmao.lastCall().prompt).toBe('My order never arrived');
});`,
  },
  {
    id: 'vitest',
    label: 'Vitest',
    logos: ['vitest', 'openai'],
    caption: 'Same idea with <code>vi.mock</code>. Test mode creates no timers, so fake timers work too.',
    guide: 'mock-openai-vitest/',
    code: `import * as llmao from 'llmao/testing';
import { classify } from './support';

vi.mock('openai', () => import('llmao/openai'));

test('sends the right system prompt', async () => {
  llmao.configure({ script: [{ text: 'billing' }] });
  await classify('I was charged twice');

  expect(llmao.lastCall()).toMatchObject({
    model: 'gpt-4o',
    system: 'Classify the ticket as billing, shipping or other.',
  });
});`,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    logos: ['anthropic'],
    caption: 'Script tool use: the first answer calls your tool, the second one reads its result.',
    guide: 'mock-anthropic-sdk/',
    code: `jest.mock('@anthropic-ai/sdk', () => require('llmao/anthropic'));

import * as llmao from 'llmao/testing';
import { askAboutStocks } from './agent';

test('uses the stock tool', async () => {
  llmao.configure({
    script: [
      { when: 'stock', toolCalls: [{ name: 'get_stock_price', args: { ticker: 'NVDA' } }] },
      { when: 'stock', afterToolResults: true, text: 'NVDA is trading at $1,337.' },
    ],
  });

  expect(await askAboutStocks('What is the stock price of NVDA?')).toBe('NVDA is trading at $1,337.');
});`,
  },
  {
    id: 'aisdk',
    label: 'AI SDK',
    logos: ['aisdk'],
    caption: 'Mock <code>@ai-sdk/openai</code> or <code>@ai-sdk/anthropic</code>. <code>generateObject</code> gets objects that match your schema.',
    guide: 'test-vercel-ai-sdk/',
    code: `import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai'; // this is llmao now
import { z } from 'zod';

vi.mock('@ai-sdk/openai', () => import('llmao/ai-sdk'));

test('extracts a user', async () => {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: z.object({ name: z.string(), email: z.string().email() }),
    prompt: 'Extract the user from this email…',
  });

  expect(object.email).toContain('@');
});`,
  },
  {
    id: 'errors',
    label: 'Rate limits',
    logos: [],
    badge: '429',
    caption: "The SDKs' own error classes, with <code>retry-after</code> headers. Every retry is recorded.",
    guide: 'simulate-llm-errors/',
    code: `test('gives up after the SDK retries', async () => {
  llmao.configure({ failures: { rateLimit: 1 } });

  await expect(classify('hi')).rejects.toBeInstanceOf(OpenAI.RateLimitError);
  expect(llmao.calls).toHaveLength(3); // the first attempt plus 2 retries
});

test('recovers when the retry works', async () => {
  llmao.configure({ script: [{ error: 'rate_limit', once: true }, { text: 'billing' }] });

  expect(await classify('charged twice')).toBe('billing');
});`,
  },
  {
    id: 'node',
    label: 'node:test',
    logos: ['node'],
    caption: 'No module mocking: run the fake API in the test process and point the SDKs at it.',
    guide: 'test-llm-code-any-runner/',
    code: `import { serve } from 'llmao/server';
import * as llmao from 'llmao/testing';

const server = await serve({ port: 0 });
process.env.OPENAI_BASE_URL = \`\${server.url}/v1\`;
process.env.ANTHROPIC_BASE_URL = server.url;

test('classifies tickets', async () => {
  const { classify } = await import('./support.js');
  llmao.configure({ script: [{ text: 'shipping' }] });

  assert.equal(await classify('My order never arrived'), 'shipping');
});`,
  },
];

const RECIPE_LOGOS = {
  'mock-openai-jest': ['jest', 'openai'],
  'mock-openai-vitest': ['vitest', 'openai'],
  'mock-anthropic-sdk': ['jest', 'vitest', 'anthropic'],
  'test-vercel-ai-sdk': ['aisdk'],
  'simulate-llm-errors': ['openai', 'anthropic', 'aisdk'],
  'test-llm-code-any-runner': ['node', 'openai', 'anthropic'],
  'fake-openai-api-server': ['python', 'node', 'openai'],
};

const cards = recipes
  .map(
    (recipe) => `<a class="card" href="${SITE}/${recipe.slug}/">
  <span class="card-logos">${(RECIPE_LOGOS[recipe.slug] ?? []).map((id) => logo(id, { withLabel: false })).join('')}</span>
  <strong>${escape(recipe.meta.title.replace(/^How to /, '').replace(/^./, (c) => c.toUpperCase()))}</strong>
  <span>${escape(recipe.meta.description.split('. ')[0])}.</span>
</a>`,
  )
  .join('\n');

const useCases = [
  {
    logos: ['jest', 'vitest'],
    title: 'Mock LLMs in your tests',
    text: 'Swap <code>openai</code> or <code>@anthropic-ai/sdk</code> for llmao with one line. Script the answers and assert on what your app sent.',
    href: 'mock-openai-jest/',
  },
  {
    badge: '429',
    title: 'Test rate limits and outages',
    text: "Real 429s, 500s and timeouts, thrown as the SDKs' own error classes. See your retry logic actually work.",
    href: 'simulate-llm-errors/',
  },
  {
    logos: ['aisdk'],
    title: 'Test AI SDK agents',
    text: '<code>generateText</code>, <code>streamText</code>, <code>generateObject</code> and tool calls, scripted step by step.',
    href: 'test-vercel-ai-sdk/',
  },
  {
    logos: ['python', 'node'],
    title: 'Any language, any runner',
    text: 'An OpenAI and Anthropic compatible server. <code>npx llmao serve</code> and point your SDK at it.',
    href: 'fake-openai-api-server/',
  },
]
  .map(
    (useCase) => `<a class="use-case" href="${SITE}/${useCase.href}">
  <span class="use-case-icon">${useCase.badge ? `<span class="status-badge">${useCase.badge}</span>` : useCase.logos.map((id) => logo(id, { withLabel: false })).join('')}</span>
  <strong>${useCase.title}</strong>
  <span>${useCase.text}</span>
  <span class="more">Read the guide →</span>
</a>`,
  )
  .join('\n');

const tabs = `<div class="tabs" data-tabs>
  <div class="tab-list" role="tablist" aria-label="Examples">
    ${EXAMPLES.map(
      (example, index) =>
        `<button type="button" role="tab" id="tab-${example.id}" aria-controls="panel-${example.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${example.badge ? `<span class="status-badge" style="font-size:11px;padding:1px 6px">${example.badge}</span>` : example.logos.map((id) => logo(id, { withLabel: false })).join('')}${example.label}</button>`,
    ).join('')}
  </div>
  ${EXAMPLES.map(
    (example, index) => `<div class="tab-panel" role="tabpanel" id="panel-${example.id}" aria-labelledby="tab-${example.id}"${index === 0 ? '' : ' hidden'}>
    <p>${example.caption} <a href="${SITE}/${example.guide}">Read the guide →</a></p>
    ${marked.parse('```ts\n' + example.code + '\n```')}
  </div>`,
  ).join('')}
</div>`;

const landing = `<main class="landing">
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">A fake LLM for tests, demos and fun</p>
    <h1>Just as wrong.<br><span class="gradient-text">Way cheaper.</span></h1>
    <p class="lead">It streams, reasons, calls tools and confidently hallucinates, powered by regex. Swap it in for OpenAI, Anthropic or the Vercel AI SDK in your tests, and stop paying for flaky CI.</p>
  </div>
  <div class="hero-cta">
    <div class="cta-card">
      <span class="cta-label">Install</span>
      <div class="cta-command"><code><span class="prompt">$</span> npm i -D llmao</code><button type="button" class="copy" data-copy="npm i -D llmao">Copy</button></div>
      <div class="cta-buttons">
        <a class="button primary" href="#try">Try it in the browser</a>
        <a class="button" href="#docs">Read the guides</a>
      </div>
      <ul class="cta-points"><li>No API key</li><li>Zero dependencies</li><li>MIT</li></ul>
    </div>
  </div>
</section>

<section class="works-with" aria-label="Works with">
  <span class="works-with-label">Works with</span>
  <div class="logos">${['jest', 'vitest', 'node', 'openai', 'anthropic', 'aisdk', 'python'].map((id) => logo(id)).join('')}</div>
</section>

<section class="use-cases" aria-label="Use cases">
${useCases}
</section>

<section class="playground" aria-labelledby="try">
  <h2 id="try">Try it</h2>
  <p class="section-lead">Pick a model and ask anything. It will answer with total confidence.</p>
  <form id="ask">
    <select id="model" aria-label="Model"></select>
    <input id="prompt" aria-label="Your question" autocomplete="off" placeholder="how many r are in strawberry?">
    <button type="submit">Ask</button>
  </form>
  <div class="examples" id="examples"></div>
  <div class="output" id="output" aria-live="polite"><p class="hint">Try the overthinker with "what is 2 + 2?", or ask lmao-safe to reverse a word.</p></div>
  <div class="actions"><span id="stats"></span><button type="button" id="share" hidden>Copy link to this answer</button></div>
</section>

<section id="docs">
  <h2>Mock LLMs in your tests</h2>
  <p class="section-lead">Swap the SDK your app already uses for llmao, script the answers, simulate rate limits and outages, and check what your app sent. No API keys in CI, no flaky tests, no bill.</p>
  ${tabs}
  <h3 class="guides-title">Guides</h3>
  <div class="cards">${cards}</div>
</section>

<section>
  <h2>Everything a real LLM does</h2>
  <ul class="features">
    <li><strong>Drop-in clients</strong> for <code>openai</code>, <code>@anthropic-ai/sdk</code> and a Vercel AI SDK provider, checked against the official types in CI</li>
    <li><strong>Streaming, reasoning, tool calls and structured output</strong> that validates against your schema</li>
    <li><strong>Rate limits, 500s and timeouts</strong> with the SDKs' real error classes and retries</li>
    <li><strong>An HTTP server</strong> compatible with the OpenAI and Anthropic APIs, for any language</li>
    <li><strong>Hallucinations</strong>, configurable. The only LLM you can set to always be right</li>
  </ul>
</section>
</main>`;

writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: 'llmao: a fake LLM to mock OpenAI, Anthropic and the AI SDK in your tests',
    description:
      'Just as wrong. Way cheaper. A fake LLM powered by regex: mock OpenAI, Anthropic and the Vercel AI SDK in Jest, Vitest or any test runner, without API keys. Try it in the browser.',
    path: '/',
    body: landing,
    scripts: `<script type="module" src="${SITE}/playground.js"></script>`,
  }),
);

// --- Static files ------------------------------------------------------------------

copyFileSync('site/style.css', join(OUT, 'style.css'));
copyFileSync('site/playground.js', join(OUT, 'playground.js'));
// IndexNow (Bing and others): the key file must be served from the site
const indexNowKey = readFileSync('site/indexnow-key.txt', 'utf8').trim();
writeFileSync(join(OUT, `${indexNowKey}.txt`), indexNowKey);
mkdirSync(join(OUT, 'assets'));
for (const asset of ['logo-light.png', 'logo-dark.png', 'icon.png', 'icon-512.png', 'favicon-32.png', 'apple-touch-icon.png', 'social-preview.png', 'demo.gif']) {
  copyFileSync(join('assets', asset), join(OUT, 'assets', asset));
}
// The library itself, for the playground (only the browser-safe ESM chunks)
mkdirSync(join(OUT, 'lib'));
for (const file of readdirSync('dist').filter((name) => name.endsWith('.mjs'))) {
  const code = readFileSync(join('dist', file), 'utf8');
  if (/from ["']node:/.test(code)) continue;
  cpSync(join('dist', file), join(OUT, 'lib', file));
}
copyFileSync('assets/favicon.ico', join(OUT, 'favicon.ico'));
cpSync('site/brand', join(OUT, 'brand'), { recursive: true });
writeFileSync(join(OUT, '.nojekyll'), '');
writeFileSync(
  join(OUT, '404.html'),
  layout({ title: 'Not found | llmao', description: 'This page does not exist.', path: '/404.html', body: '<main class="doc"><h1>404</h1><p>I searched my 175 billion parameters and this page is not in any of them.</p><p><a href="./">Go home</a></p></main>' }),
);

// --- llms.txt, llms-full.txt, sitemap, robots -------------------------------------------

const summary = `llmao is a fake LLM powered by regex. It is a drop-in replacement for the OpenAI (\`openai\`) and Anthropic (\`@anthropic-ai/sdk\`) Node.js SDKs and a Vercel AI SDK provider, used to test code that calls LLMs in Jest, Vitest, node:test or any runner, without API keys. It is also a joke.`;

const facts = `- Install: \`npm install --save-dev llmao\` (Node 18+, zero runtime dependencies, MIT)
- Jest: \`jest.mock('openai', () => require('llmao/openai'))\`. Vitest: \`vi.mock('openai', () => import('llmao/openai'))\`. Same for \`@anthropic-ai/sdk\` → \`llmao/anthropic\`, and \`@ai-sdk/openai\` / \`@ai-sdk/anthropic\` → \`llmao/ai-sdk\` (the AI SDK is ESM-only: in Jest use ESM mode and \`jest.unstable_mockModule\`)
- \`import * as llmao from 'llmao/testing'\` turns on test mode (instant, deterministic, no timers) and gives \`configure()\`, \`reset()\`, \`calls\` and \`lastCall()\`
- Scripted answers: \`configure({ script: [{ when: /regex/ | 'substring' | fn, text, toolCalls, object, error, once, afterToolResults }], unscripted: 'error' })\`
- Simulated failures: \`configure({ failures: { rateLimit, serverError, timeout, retryAfter } })\` throw the SDKs' real error classes (\`OpenAI.RateLimitError\` with status 429 and a retry-after header, \`Anthropic.InternalServerError\`, the AI SDK's \`APICallError\`)
- Any language or runner: \`npx llmao serve\` (or \`serve()\` from \`llmao/server\`) is an OpenAI and Anthropic compatible HTTP server; point SDKs at it with \`OPENAI_BASE_URL\` / \`ANTHROPIC_BASE_URL\`
- Structured output (\`generateObject\`, \`response_format\`, \`output_config\`) returns objects that validate against the schema`;

writeFileSync(
  join(OUT, 'llms.txt'),
  `# llmao

> ${summary}

${facts}

## Docs

${recipes.map((recipe) => `- [${recipe.meta.title}](${SITE}/${recipe.slug}.md): ${recipe.meta.description}`).join('\n')}

## Optional

- [README](${REPO}/blob/main/README.md): full reference, including the joke models (lmao-safe, lmao-o1-overthinker…) and agentify()
- [npm package](https://www.npmjs.com/package/llmao)
- [Full docs in one file](${SITE}/llms-full.txt)
`,
);

writeFileSync(
  join(OUT, 'llms-full.txt'),
  `# llmao ${pkg.version}

> ${summary}

${facts}

${recipes.map((recipe) => `---\n\nSource: ${SITE}/${recipe.slug}/\n\n${recipe.body.trim()}`).join('\n\n')}

---

Source: ${REPO}/blob/main/README.md

${readFileSync('README.md', 'utf8').replace(/^<div align="center">[\s\S]*?<\/div>\s*/, '').trim()}
`,
);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['', ...recipes.map((recipe) => `${recipe.slug}/`)].map((path) => `  <url><loc>${SITE}/${path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Built ${recipes.length} recipes into ${OUT}/`);
