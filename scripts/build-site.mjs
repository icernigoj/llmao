// Builds the docs site (GitHub Pages) into site-dist/: the landing page with
// the playground, one page per recipe, llms.txt, llms-full.txt and a sitemap.
// Run `pnpm build` first: the playground uses the library from dist/.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { createHighlighter } from 'shiki';

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
<link rel="icon" type="image/png" href="${SITE}/assets/icon.png">
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

const snippet = marked.parse(`\`\`\`ts
jest.mock('openai', () => require('llmao/openai')); // or vi.mock(...)

import * as llmao from 'llmao/testing';
import { classify } from './support'; // uses new OpenAI() inside

test('classifies shipping tickets', async () => {
  llmao.configure({ script: [{ when: /never arrived/i, text: 'shipping' }] });

  expect(await classify('My order never arrived')).toBe('shipping');
  expect(llmao.lastCall().prompt).toBe('My order never arrived');
});
\`\`\``);

const cards = recipes
  .map((recipe) => `<a class="card" href="${SITE}/${recipe.slug}/"><strong>${escape(recipe.meta.title.replace(/^How to /, '').replace(/^./, (c) => c.toUpperCase()))}</strong><span>${escape(recipe.meta.description.split('. ')[0])}.</span></a>`)
  .join('\n');

const landing = `<main class="landing">
<section class="hero">
  <h1>Just as wrong.<br>Way cheaper.</h1>
  <p class="lead">A fake LLM that streams, reasons, calls tools and confidently hallucinates, powered by regex. Mock OpenAI, Anthropic and the Vercel AI SDK in your tests, run demos without an API key, or just have fun.</p>
  <div class="install"><code>npm i -D llmao</code><button type="button" data-copy="npm i -D llmao">Copy</button></div>
</section>

<section class="playground" aria-labelledby="try">
  <h2 id="try">Try it</h2>
  <form id="ask">
    <select id="model" aria-label="Model"></select>
    <input id="prompt" aria-label="Your question" autocomplete="off" placeholder="how many r are in strawberry?">
    <button type="submit">Ask</button>
  </form>
  <div class="examples" id="examples"></div>
  <div class="output" id="output" aria-live="polite"><p class="hint">Ask anything. It will answer with total confidence.</p></div>
  <div class="actions"><span id="stats"></span><button type="button" id="share" hidden>Copy link to this answer</button></div>
</section>

<section id="docs">
  <h2>Mock LLMs in your tests</h2>
  <p>Swap the SDK your app already uses for llmao, script the answers, simulate rate limits and outages, and check what your app sent. No API keys in CI, no flaky tests, no bill.</p>
  ${snippet}
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
mkdirSync(join(OUT, 'assets'));
for (const asset of ['logo-light.png', 'logo-dark.png', 'icon.png', 'social-preview.png', 'demo.gif']) {
  copyFileSync(join('assets', asset), join(OUT, 'assets', asset));
}
// The library itself, for the playground (only the browser-safe ESM chunks)
mkdirSync(join(OUT, 'lib'));
for (const file of readdirSync('dist').filter((name) => name.endsWith('.mjs'))) {
  const code = readFileSync(join('dist', file), 'utf8');
  if (/from ["']node:/.test(code)) continue;
  cpSync(join('dist', file), join(OUT, 'lib', file));
}
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
- Simulated failures: \`configure({ failures: { rateLimit, serverError, timeout } })\` throw the SDKs' real error classes (\`OpenAI.RateLimitError\` with status 429 and a retry-after header, \`Anthropic.InternalServerError\`, the AI SDK's \`APICallError\`)
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
