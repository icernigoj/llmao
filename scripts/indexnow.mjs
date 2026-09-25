// Tells IndexNow search engines (Bing, Yandex…) that the docs pages changed.
// Run after the site is deployed: node scripts/indexnow.mjs
import { readdirSync, readFileSync } from 'node:fs';

const SITE = 'https://icernigoj.github.io/llmao';
const key = readFileSync('site/indexnow-key.txt', 'utf8').trim();
const urls = [`${SITE}/`, ...readdirSync('site/content').filter((file) => file.endsWith('.md')).map((file) => `${SITE}/${file.replace(/\.md$/, '')}/`)];

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: 'icernigoj.github.io', key, keyLocation: `${SITE}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${response.status} ${response.statusText} (${urls.length} URLs)`);
