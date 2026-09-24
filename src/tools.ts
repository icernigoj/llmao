import type { Rng } from './rng';
import type { JsonSchema, ToolChoice, ToolDefinition } from './types';

const IGNORED_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'into', 'your',
  'get', 'set', 'use', 'tool', 'function', 'returns', 'return', 'given', 'para',
  'con', 'que', 'los', 'las', 'una', 'del', 'por',
]);

function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !IGNORED_WORDS.has(word));
}

/** Loose match so that "weather" matches "getWeather" and "clima" matches "climate" */
const similar = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

export function pickTool(
  prompt: string,
  tools: ToolDefinition[],
  choice: ToolChoice = 'auto',
): { tool: ToolDefinition; matched: string[] } | null {
  if (tools.length === 0 || choice === 'none') return null;

  if (typeof choice === 'object') {
    const tool = tools.find((candidate) => candidate.name === choice.name);
    if (!tool) throw new Error(`llmao: tool "${choice.name}" was forced but not provided`);
    return { tool, matched: [] };
  }

  const promptWords = words(prompt);
  const scored = tools.map((tool) => {
    const toolWords = [...words(tool.name), ...words(tool.description ?? '')];
    const matched = [...new Set(promptWords.filter((word) => toolWords.some((toolWord) => similar(word, toolWord))))];
    // Matching the tool name is worth more than matching its description
    const score = matched.length + words(tool.name).filter((word) => promptWords.some((p) => similar(p, word))).length;
    return { tool, matched, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;
  if (best.score > 0 || choice === 'required') return { tool: best.tool, matched: best.matched };
  return null;
}

const QUESTION_PREFIX = /^(?:can you|could you|please|what(?:'s| is)|how (?:is|are)|tell me|search(?: for)?|find|look up|busc[aá]|decime|qu[eé] es|c[oó]mo est[aá])\s+/i;

function extractString(name: string, schema: JsonSchema, prompt: string): string | undefined {
  const quoted = prompt.match(/["“']([^"”']+)["”']/);
  if (quoted) return quoted[1];

  const key = `${name} ${schema.description ?? ''}`.toLowerCase();
  if (/e-?mail|^(?:to|from|cc|bcc|recipient)\b/.test(key)) return prompt.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (/url|link|website/.test(key)) return prompt.match(/https?:\/\/\S+/)?.[0];
  if (/date|fecha/.test(key)) return prompt.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? new Date().toISOString().slice(0, 10);
  if (/city|location|place|country|ciudad|lugar|pa[ií]s/.test(key)) {
    const place = prompt.match(/\b(?:in|at|for|en|de|para)\s+((?:\p{Lu}[\p{L}-]*\s?){1,3})/u)?.[1]?.trim();
    return place ?? prompt.match(/\b\p{Lu}[\p{L}-]+/u)?.[0];
  }
  if (/name|nombre/.test(key)) return prompt.match(/\b\p{Lu}[\p{L}-]+/u)?.[0];

  return prompt.replace(/[?¿!¡]/g, '').replace(QUESTION_PREFIX, '').trim() || undefined;
}

/**
 * Builds tool arguments from a JSON schema by squinting at the prompt.
 * Required properties are always filled; optional ones only when found.
 */
export function synthesizeArgs(schema: JsonSchema | undefined, prompt: string, rng: Rng): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const numbers = (prompt.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const args: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(properties)) {
    const type = Array.isArray(property.type) ? property.type.find((t) => t !== 'null') : property.type;
    let value: unknown;

    if (property.enum?.length) {
      value = property.enum.find((option) => prompt.toLowerCase().includes(String(option).toLowerCase()));
      if (value === undefined && required.has(name)) value = property.enum[0];
    } else if (type === 'number' || type === 'integer') {
      value = numbers.shift();
      if (value === undefined && required.has(name)) value = property.default ?? rng.int(1, 10);
    } else if (type === 'boolean') {
      value = property.default ?? (required.has(name) ? true : undefined);
    } else if (type === 'array') {
      if (required.has(name)) value = [];
    } else if (type === 'object') {
      if (required.has(name)) value = synthesizeArgs(property, prompt, rng);
    } else {
      value = extractString(name, property, prompt);
      if (value === undefined && required.has(name)) value = property.default ?? prompt.trim();
    }

    if (value !== undefined) args[name] = value;
  }

  return args;
}

/** Turns a tool result into something that reads like prose */
export function describeToolOutput(content: string): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return content;
  }

  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
    .join(', ');
}
