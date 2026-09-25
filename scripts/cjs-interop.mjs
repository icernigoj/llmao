// The official SDKs' CommonJS builds export the client class itself, so that
// `const OpenAI = require('openai')` works.  Make llmao's drop-ins do the
// same, which is also what `jest.mock('openai', () => require('llmao/openai'))`
// needs.
import { appendFileSync, readFileSync } from 'node:fs';

const MARKER = '// llmao: CommonJS interop';

for (const file of ['dist/openai.cjs', 'dist/anthropic.cjs']) {
  if (readFileSync(file, 'utf8').includes(MARKER)) continue;
  appendFileSync(
    file,
    `\n${MARKER}\nmodule.exports = Object.assign(exports.default, exports);\nObject.defineProperty(module.exports, '__esModule', { value: true });\n`,
  );
}
