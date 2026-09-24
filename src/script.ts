import type { Script, ScriptContext, ScriptedReply, ScriptRule, Turn } from './types';

/** Rules with `once: true` that were already used */
const usedRules = new WeakSet<ScriptRule>();

export class LlmaoUnscriptedError extends Error {
  constructor(readonly prompt: string) {
    super(`llmao: no scripted answer for ${JSON.stringify(prompt)}. Add a rule for it, or set unscripted: 'improvise'.`);
    this.name = 'LlmaoUnscriptedError';
  }
}

export function scriptContext(turns: Turn[]): ScriptContext {
  let prompt = '';
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role === 'user') {
      prompt = turn.text;
      break;
    }
  }
  const last = turns[turns.length - 1];
  return { prompt, turns, toolResults: last?.role === 'tool' ? last.results : [] };
}

function matches(rule: ScriptRule, context: ScriptContext): boolean {
  if (rule.once && usedRules.has(rule)) return false;
  if (Boolean(rule.afterToolResults) !== context.toolResults.length > 0) return false;

  const { when } = rule;
  if (when === undefined) return true;
  if (typeof when === 'string') return context.prompt.toLowerCase().includes(when.toLowerCase());
  if (when instanceof RegExp) {
    when.lastIndex = 0;
    return when.test(context.prompt);
  }
  return when(context);
}

/** Finds the scripted reply for this conversation, if any */
export function findScriptedReply(script: Script, context: ScriptContext): ScriptedReply | undefined {
  if (typeof script === 'function') {
    const reply = script(context);
    return typeof reply === 'string' ? { text: reply } : reply;
  }

  const rule = script.find((candidate) => matches(candidate, context));
  if (rule?.once) usedRules.add(rule);
  return rule;
}
