import type { Language } from './types';

const SPANISH_WORDS = new Set([
  'qué', 'que', 'cómo', 'como', 'cuánto', 'cuanto', 'cuántas', 'cuantas',
  'cuántos', 'cuantos', 'cuál', 'cual', 'quién', 'quien', 'dónde', 'donde',
  'por', 'para', 'es', 'el', 'la', 'los', 'las', 'un', 'una', 'hola', 'sos',
  'eres', 'hay', 'en', 'y', 'de', 'del', 'con', 'mi', 'tu', 'me', 'decime',
  'dime', 'contame', 'debería', 'deberia', 'número', 'numero', 'hora', 'día',
  'chiste', 'gracias', 'buenas', 'buen', 'ordená', 'ordena', 'invertí',
  'resumí', 'resume', 'primo', 'par', 'impar', 'cuenta', 'sí', 'vida',
]);

const ENGLISH_WORDS = new Set([
  'what', 'how', 'is', 'are', 'the', 'a', 'an', 'of', 'in', 'to', 'and',
  'who', 'why', 'when', 'where', 'which', 'you', 'your', 'my', 'i', 'it',
  'hello', 'hi', 'hey', 'tell', 'me', 'should', 'many', 'much', 'number',
  'time', 'day', 'joke', 'thanks', 'sort', 'reverse', 'summarize', 'prime',
  'even', 'odd', 'does', 'do', 'can', 'please', 'life', 'yes',
]);

export function detectLanguage(text: string): Language {
  if (/[¿¡ñ]/i.test(text)) return 'es';

  let spanish = 0;
  let english = 0;
  for (const word of text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? []) {
    if (SPANISH_WORDS.has(word)) spanish++;
    if (ENGLISH_WORDS.has(word)) english++;
  }
  return spanish > english ? 'es' : 'en';
}

export type Localized<T = string> = Record<Language, T>;

export function localize<T>(language: Language, value: Localized<T>): T {
  return value[language];
}
