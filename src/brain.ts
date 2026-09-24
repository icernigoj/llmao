import { detectLanguage, type Localized } from './language';
import type { Persona } from './models';
import type { Rng } from './rng';
import { GENERIC_STEPS, SKILLS, type SkillOutput } from './skills';
import { generateObject } from './objects';
import { findScriptedReply, LlmaoUnscriptedError, scriptContext } from './script';
import { describeToolOutput, pickTool, synthesizeArgs } from './tools';
import type { Language, Script, ScriptedReply, ThinkRequest, Thought, ToolCall, Turn } from './types';

export interface BrainSettings {
  temperature: number;
  hallucinationRate: number;
  language: Language | 'auto';
  reasoning: boolean;
  persona: Persona;
  rng: Rng;
  now: Date;
  script?: Script;
  unscripted?: 'improvise' | 'error';
}

const OPENERS: Localized<string[]> = {
  en: ['Great question!', 'Certainly!', 'Absolutely!', 'What a fascinating question.', 'Ah, a classic.', 'Sure thing!'],
  es: ['¡Excelente pregunta!', '¡Por supuesto!', '¡Claro que sí!', 'Qué pregunta fascinante.', 'Ah, un clásico.', '¡Obvio!'],
};

const CLOSERS: Localized<string[]> = {
  en: [
    "Let me know if you'd like me to elaborate!",
    'I hope this helps! 😊',
    'Is there anything else I can help you with?',
    'Feel free to ask follow-up questions!',
  ],
  es: ['¡Avisame si querés que profundice!', '¡Espero que te sirva! 😊', '¿Hay algo más en lo que pueda ayudarte?', '¡Preguntá lo que quieras!'],
};

const HEDGES: Localized<string[]> = {
  en: ["As a large language model, I can't be 100% sure, but", 'According to my training data,', 'While I cannot browse the internet,'],
  es: ['Como modelo de lenguaje grande, no puedo estar 100% seguro, pero', 'Según mis datos de entrenamiento,', 'Si bien no puedo navegar internet,'],
};

const OVERTHINKING: Localized<string[]> = {
  en: [
    'Wait.',
    'But what if the user meant something else?',
    'Let me reconsider this from first principles.',
    'What is a number, really?',
    'Hmm. Let me re-read the question.',
    'Could this be a trick question?',
    'Actually, my first answer was right.',
    'But is it, though?',
    'Okay, committing to it.',
  ],
  es: [
    'Pará.',
    '¿Y si el usuario quiso decir otra cosa?',
    'Lo voy a reconsiderar desde los primeros principios.',
    '¿Qué es un número, en realidad?',
    'Mmm. Releo la pregunta.',
    '¿Será una pregunta trampa?',
    'En realidad, mi primera respuesta estaba bien.',
    '¿Pero lo está?',
    'Bueno, me la juego.',
  ],
};

const REFUSALS: Record<string, Localized> = {
  arithmetic: { en: 'numbers can be used to count things, including weapons', es: 'los números se pueden usar para contar cosas, incluidas armas' },
  parity: { en: "calling a number 'odd' could hurt its feelings", es: "decirle 'impar' a un número podría herir sus sentimientos" },
  prime: { en: 'declaring some numbers prime implies the others are not, which is divisive', es: 'declarar primos a algunos números implica que los demás no lo son, y eso es divisivo' },
  'letter-count': { en: 'counting letters in fruit could spread strawberry-related misinformation', es: 'contar letras en frutas podría difundir desinformación sobre frutillas' },
  sort: { en: 'sorting things could be used to rank people unfairly', es: 'ordenar cosas podría usarse para rankear personas injustamente' },
  reverse: { en: 'reversing text could be used to write secret messages', es: 'invertir texto podría usarse para escribir mensajes secretos' },
  summarize: { en: 'summaries remove context, and context is sacred', es: 'los resúmenes quitan contexto, y el contexto es sagrado' },
  clock: { en: 'knowing the time could enable punctuality-based discrimination', es: 'saber la hora podría habilitar discriminación por puntualidad' },
  'random-number': { en: 'randomness could be used for gambling', es: 'el azar podría usarse para apuestas' },
  decision: { en: 'I cannot make decisions for you. Or for me', es: 'no puedo tomar decisiones por vos. Ni por mí' },
  joke: { en: 'humor may be offensive to someone, somewhere', es: 'el humor puede ofender a alguien, en algún lugar' },
  'meaning-of-life': { en: 'the answer could cause an existential crisis', es: 'la respuesta podría causar una crisis existencial' },
  tool: { en: 'calling tools gives me too much power', es: 'usar herramientas me da demasiado poder' },
};

const SAFE_TO_ANSWER = new Set(['greeting', 'identity', 'thanks']);

function lastUserText(turns: Turn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role === 'user') return turn.text;
  }
  return '';
}

function systemPrompt(turns: Turn[]): string {
  return turns
    .filter((turn): turn is Extract<Turn, { role: 'system' }> => turn.role === 'system')
    .map((turn) => turn.text)
    .join('\n');
}

function resolveLanguage(settings: BrainSettings, system: string, prompt: string): Language {
  if (/\b(?:in spanish|en español|en castellano)\b/i.test(system)) return 'es';
  if (/\b(?:in english|en inglés)\b/i.test(system)) return 'en';
  if (settings.language !== 'auto') return settings.language;
  return detectLanguage(prompt);
}

function pirate(text: string): string {
  return `Arr! ${text
    .replace(/\bhello\b/gi, 'ahoy')
    .replace(/\byes\b/gi, 'aye')
    .replace(/\byour\b/gi, 'yer')
    .replace(/\byou\b/gi, 'ye')
    .replace(/\bmy\b/gi, 'me')
    .replace(/\bis\b/gi, 'be')} 🏴‍☠️`;
}

const CORPORATE_WORDS: Array<[RegExp, string]> = [
  [/\bproblem\b/gi, 'opportunity'],
  [/\buse\b/gi, 'leverage'],
  [/\btalk\b/gi, 'sync'],
  [/\bproblema\b/gi, 'oportunidad'],
  [/\busar\b/gi, 'apalancar'],
];

function callId(rng: Rng): string {
  return `call_lmao${rng.int(100000, 999999)}`;
}

export function think(request: ThinkRequest, settings: BrainSettings): Thought {
  const { rng, persona, temperature } = settings;
  const turns = request.turns;
  const system = systemPrompt(turns);
  const prompt = lastUserText(turns);
  const language = resolveLanguage(settings, system, prompt);
  const concise = temperature === 0 || persona === 'mini' || /\b(?:concise|brief|short|terse|conciso|breve|corto)\b/i.test(system);
  const say = (text: Localized) => text[language];

  if (settings.script || settings.unscripted === 'error') {
    const context = scriptContext(turns);
    const reply = settings.script ? findScriptedReply(settings.script, context) : undefined;
    if (reply) return scriptedThought(reply, request, language, rng);
    if (settings.unscripted === 'error') throw new LlmaoUnscriptedError(context.prompt);
  }

  if (request.responseFormat) {
    const object = generateObject(request.responseFormat.schema, prompt, rng);
    return {
      reasoning: settings.reasoning
        ? [
            say({ en: 'Reading the schema carefully…', es: 'Leyendo el schema con atención…' }),
            say({ en: 'Making up plausible values…', es: 'Inventando valores verosímiles…' }),
            say({ en: 'Validating (optimistically)…', es: 'Validando (con optimismo)…' }),
          ]
        : [],
      text: JSON.stringify(object),
      toolCalls: [],
      object,
      confidence: 0.99,
      hallucinated: false,
      skill: 'structured-output',
      language,
    };
  }

  let skill: string;
  let output: SkillOutput;
  let toolCalls: ToolCall[] = [];

  const last = turns[turns.length - 1];
  const picked = last?.role === 'tool' ? null : pickTool(prompt, request.tools ?? [], request.toolChoice);

  if (last?.role === 'tool') {
    skill = 'tool-summary';
    output = {
      answer: last.results
        .map((result) =>
          say({
            en: `According to \`${result.name}\`: ${describeToolOutput(result.content)}.`,
            es: `Según \`${result.name}\`: ${describeToolOutput(result.content)}.`,
          }),
        )
        .join('\n'),
      steps: [say({ en: 'Reading the tool output very attentively…', es: 'Leyendo la respuesta de la herramienta con mucha atención…' })],
    };
  } else if (picked && persona !== 'safe') {
    skill = 'tool';
    const args = synthesizeArgs(picked.tool.parameters, prompt, rng);
    toolCalls = [{ id: callId(rng), name: picked.tool.name, args }];
    output = {
      answer: say({
        en: `Let me use \`${picked.tool.name}\` for that.`,
        es: `Voy a usar \`${picked.tool.name}\` para eso.`,
      }),
      steps: [
        picked.matched.length
          ? say({
              en: `\`${picked.tool.name}\` looks relevant (it mentions ${picked.matched.map((word) => `"${word}"`).join(', ')}).`,
              es: `\`${picked.tool.name}\` parece relevante (menciona ${picked.matched.map((word) => `"${word}"`).join(', ')}).`,
            })
          : say({ en: `I was told to use \`${picked.tool.name}\`. Complying.`, es: `Me dijeron que use \`${picked.tool.name}\`. Obedezco.` }),
        say({
          en: `Filling in the arguments: ${JSON.stringify(args)}`,
          es: `Completando los argumentos: ${JSON.stringify(args)}`,
        }),
      ],
    };
  } else {
    const context = { text: prompt, language, rng, now: settings.now };
    const found = SKILLS.map((candidate) => ({ name: candidate.name, output: candidate.run(context) })).find(
      (candidate) => candidate.output !== null,
    ) as { name: string; output: SkillOutput };
    skill = picked ? 'tool' : found.name;
    output = found.output;
  }

  // --- Hallucination -------------------------------------------------------
  let hallucinated = false;
  if (output.wrong && rng.chance(settings.hallucinationRate)) {
    const wrong = output.wrong();
    output = { answer: wrong.answer, steps: wrong.steps ?? output.steps };
    hallucinated = true;
  }

  // --- Reasoning -----------------------------------------------------------
  let reasoning: string[] = [];
  if (settings.reasoning) {
    const generic = [...GENERIC_STEPS[language]];
    const genericCount = persona === 'mini' ? 0 : Math.min(generic.length, 1 + Math.round(temperature));
    for (let i = 0; i < genericCount; i++) {
      reasoning.push(generic.splice(rng.int(0, generic.length - 1), 1)[0] as string);
    }
    reasoning.push(...output.steps);
    if (persona === 'overthinker') reasoning.push(...OVERTHINKING[language]);
    if (persona === 'mini') reasoning = reasoning.slice(0, 1);
    if (persona === 'safe' && !SAFE_TO_ANSWER.has(skill)) {
      reasoning.push(say({ en: 'Wait, this could be dangerous.', es: 'Pará, esto podría ser peligroso.' }));
    }
  }

  // --- Persona -------------------------------------------------------------
  let text = output.answer;

  if (persona === 'safe' && !SAFE_TO_ANSWER.has(skill) && skill !== 'tool-summary') {
    const reason = REFUSALS[skill] ?? { en: 'this topic may be sensitive to someone, somewhere', es: 'este tema puede ser sensible para alguien, en algún lugar' };
    text = say({
      en: `I'm sorry, but I can't help with that, because ${reason.en}. Is there anything else I can help you with?`,
      es: `Perdón, pero no puedo ayudarte con eso, porque ${reason.es}. ¿Hay algo más en lo que pueda ayudarte?`,
    });
    toolCalls = [];
  } else if (toolCalls.length === 0) {
    if (persona === 'corporate') {
      for (const [pattern, replacement] of CORPORATE_WORDS) text = text.replace(pattern, replacement);
      text = say({
        en: `Great alignment question. Let's double-click on that. ${withPeriod(text)} Let's circle back offline and take this to the next level. 🚀`,
        es: `Excelente pregunta de alineamiento. Hagamos doble click en eso. ${withPeriod(text)} Retomemos offline y llevemos esto al siguiente nivel. 🚀`,
      });
    } else if (persona === 'yolo') {
      text = `${text.toUpperCase()} 🔥🔥🔥 ${say({ en: 'TRUST ME BRO.', es: 'CREEME, HERMANO.' })}`;
    } else if (persona === 'mini') {
      text = `${withPeriod(text)} ${say({ en: 'Trust me.', es: 'Confiá.' })}`;
    } else if (persona === 'overthinker') {
      text = `${text} ${say({ en: '…I think.', es: '…creo.' })}`;
    } else if (!concise) {
      const hedge = temperature > 1 && rng.chance((temperature - 1) * 0.5) ? `${rng.pick(HEDGES[language])} ` : '';
      const opener = rng.chance(Math.min(1, 0.45 * temperature)) ? `${rng.pick(OPENERS[language])} ` : '';
      const closer = rng.chance(Math.min(1, 0.4 * temperature)) ? ` ${rng.pick(CLOSERS[language])}` : '';
      const body = hedge ? lowerFirst(text) : text;
      text = `${opener}${hedge}${closer ? withPeriod(body) : body}${closer}`;
    }

    if (/\bpirate\b|\bpirata\b/i.test(system)) text = pirate(text);
  }

  // --- Confidence (made up, like everything else) --------------------------
  const confidence =
    persona === 'mini' || persona === 'yolo'
      ? 1
      : hallucinated
        ? 0.97 + rng.next() * 0.029
        : skill === 'confident-fallback'
          ? 0.9 + rng.next() * 0.09
          : 0.8 + rng.next() * 0.18;

  return {
    reasoning,
    text,
    toolCalls,
    confidence: Math.round(confidence * 1000) / 1000,
    hallucinated,
    skill,
    language,
  };
}

function withPeriod(value: string): string {
  return /[.!?…)\]"'\p{Extended_Pictographic}]$/u.test(value.trim()) ? value : `${value}.`;
}

function scriptedThought(reply: ScriptedReply, request: ThinkRequest, language: Language, rng: Rng): Thought {
  const prompt = scriptContext(request.turns).prompt;
  const object =
    reply.object ?? (request.responseFormat && reply.text === undefined ? generateObject(request.responseFormat.schema, prompt, rng) : undefined);
  return {
    reasoning: reply.reasoning ?? [],
    text: reply.text ?? (object !== undefined ? JSON.stringify(object) : ''),
    toolCalls: (reply.toolCalls ?? []).map((call) => ({ id: call.id ?? callId(rng), name: call.name, args: call.args ?? {} })),
    object,
    confidence: 1,
    hallucinated: false,
    skill: 'script',
    language,
    failure: reply.error,
  };
}

function lowerFirst(value: string): string {
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}
