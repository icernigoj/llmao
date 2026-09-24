import type { Rng } from './rng';
import { extractTopic } from './skills';
import { extractString } from './tools';
import type { JsonSchema } from './types';

const NAMES = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Margaret Hamilton', 'Linus Torvalds'];
const CITIES = ['Buenos Aires', 'Paris', 'Tokyo', 'Lisbon', 'Montevideo'];
const COUNTRIES = ['Argentina', 'France', 'Japan', 'Portugal', 'Uruguay'];

const PROSE = [
  (topic: string) => `${capitalize(topic)} is a complex, multifaceted topic that experts agree is important.`,
  (topic: string) => `In short: ${topic} depends on context, nuance and synergy.`,
  (topic: string) => `Studies show that ${topic} is 73% more relevant than it was last year.`,
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  const path = ref.replace(/^#\/?/, '').split('/').filter(Boolean);
  let node: unknown = root;
  for (const key of path) node = (node as Record<string, unknown> | undefined)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')];
  return (node as JsonSchema | undefined) ?? {};
}

function typeOf(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null') ?? schema.type[0];
  if (schema.type) return schema.type;
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
}

function numberFor(key: string, schema: JsonSchema, integer: boolean, rng: Rng): number {
  const min = typeof schema.minimum === 'number' ? schema.minimum : typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : undefined;
  const max = typeof schema.maximum === 'number' ? schema.maximum : typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum - 1 : undefined;

  let [low, high] = [0, 100];
  if (/age/.test(key)) [low, high] = [18, 90];
  else if (/year/.test(key)) [low, high] = [2000, new Date().getFullYear()];
  else if (/rating|stars|score/.test(key)) [low, high] = [1, 5];
  else if (/price|cost|amount|total/.test(key)) [low, high] = [5, 500];
  else if (/count|quantity|qty/.test(key)) [low, high] = [1, 10];
  else if (/lat/.test(key)) [low, high] = [-60, 60];
  else if (/lon|lng/.test(key)) [low, high] = [-180, 180];
  if (min !== undefined) low = min;
  if (max !== undefined) high = max;
  if (high < low) high = low;

  if (integer) return rng.int(Math.ceil(low), Math.floor(high));
  return Math.round((low + rng.next() * (high - low)) * 100) / 100;
}

function stringFor(key: string, schema: JsonSchema, prompt: string, rng: Rng): string {
  const format = typeof schema.format === 'string' ? schema.format : '';
  const topic = extractTopic(prompt) || 'this topic';

  if (format === 'email' || /e-?mail/.test(key)) return extractString(key, schema, prompt, { quoted: false }) ?? 'ada@example.com';
  if (format === 'date-time' || /(?:^|_)(?:created|updated)(?:_?at)?$|timestamp/.test(key)) return new Date().toISOString();
  if (format === 'date' || /date|birthday/.test(key)) return new Date().toISOString().slice(0, 10);
  if (format === 'uri' || format === 'url' || /url|link|website/.test(key)) return 'https://example.com';
  if (format === 'uuid' || key === 'id' || /(?:^|_)id$|Id$/.test(key)) return `lmao-${rng.int(1000, 9999)}-${rng.int(1000, 9999)}`;
  if (/first_?name/i.test(key)) return (rng.pick(NAMES).split(' ')[0]) as string;
  if (/last_?name|surname/i.test(key)) return (rng.pick(NAMES).split(' ')[1]) as string;
  if (/name|author|user/.test(key)) return extractString('name', schema, prompt, { quoted: false }) ?? rng.pick(NAMES);
  if (/city|location|place/.test(key)) return extractString('city', schema, prompt, { quoted: false }) ?? rng.pick(CITIES);
  if (/country/.test(key)) return rng.pick(COUNTRIES);
  if (/phone/.test(key)) return '+54 11 5555-0142';
  if (/colou?r/.test(key)) return '#7C3AED';
  if (/lang/.test(key)) return 'en';
  if (/title|headline|subject/.test(key)) return capitalize(topic);
  if (/tag|keyword|category|label|topic/.test(key)) return topic.split(' ')[0] ?? 'misc';

  const sentence = rng.pick(PROSE)(topic);
  if (typeof schema.maxLength === 'number') return sentence.slice(0, schema.maxLength);
  return sentence;
}

/**
 * Makes up a value that matches a JSON schema, using the prompt for
 * inspiration.  Values are plausible, never true.
 */
export function generateObject(schema: JsonSchema | undefined, prompt: string, rng: Rng): unknown {
  const root = schema ?? {};
  // JSON mode without a schema: any object will do
  if (Object.keys(root).length === 0) {
    return { answer: rng.pick(PROSE)(extractTopic(prompt) || 'this topic'), confidence: 0.97 };
  }
  return generate(root, '', 0);

  function generate(node: JsonSchema, key: string, depth: number): unknown {
    if (typeof node.$ref === 'string') return generate(resolveRef(node.$ref, root), key, depth);
    if ('const' in node) return node.const;
    if (node.enum?.length) {
      const mentioned = node.enum.find((option) => typeof option === 'string' && prompt.toLowerCase().includes(option.toLowerCase()));
      return mentioned ?? rng.pick(node.enum);
    }
    const variants = (node.anyOf ?? node.oneOf) as JsonSchema[] | undefined;
    if (variants?.length) {
      const nonNull = variants.filter((variant) => variant.type !== 'null');
      return generate(nonNull[0] ?? variants[0] ?? {}, key, depth);
    }
    if (Array.isArray(node.allOf)) {
      const merged = (node.allOf as JsonSchema[]).reduce<JsonSchema>(
        (all, part) => ({ ...all, ...part, properties: { ...all.properties, ...part.properties } }),
        {},
      );
      return generate(merged, key, depth);
    }

    const lowerKey = key.toLowerCase();
    switch (typeOf(node)) {
      case 'object': {
        const result: Record<string, unknown> = {};
        if (depth > 6) return result;
        for (const [name, property] of Object.entries(node.properties ?? {})) {
          result[name] = generate(property, name, depth + 1);
        }
        return result;
      }
      case 'array': {
        const min = typeof node.minItems === 'number' ? node.minItems : 1;
        const max = typeof node.maxItems === 'number' ? node.maxItems : Math.max(min, 3);
        const length = depth > 6 ? 0 : rng.int(min, Math.max(min, Math.min(max, min + 2)));
        return Array.from({ length }, () => generate(node.items ?? {}, key.replace(/s$/, ''), depth + 1));
      }
      case 'integer':
        return numberFor(lowerKey, node, true, rng);
      case 'number':
        return numberFor(lowerKey, node, false, rng);
      case 'boolean':
        return typeof node.default === 'boolean' ? node.default : rng.chance(0.5);
      case 'null':
        return null;
      case 'string':
        return stringFor(key, node, prompt, rng);
      default:
        return node.default ?? stringFor(key, node, prompt, rng);
    }
  }
}
