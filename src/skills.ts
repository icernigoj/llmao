import type { Localized } from './language';
import type { Rng } from './rng';
import type { Language } from './types';

export interface SkillContext {
  text: string;
  language: Language;
  rng: Rng;
  now: Date;
}

export interface SkillOutput {
  answer: string;
  steps: string[];
  /** A confidently wrong alternative, used when the model hallucinates */
  wrong?: () => { answer: string; steps?: string[] };
}

export interface Skill {
  name: string;
  run(context: SkillContext): SkillOutput | null;
}

const say = <T = string>(language: Language, text: Localized<T>): T => text[language];

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toFixed(10)));
}

// ---------------------------------------------------------------------------
// Arithmetic, with a real parser instead of eval()

const WORD_OPERATORS: Array<[RegExp, string]> = [
  [/\b(?:plus|más|mas)\b/gi, '+'],
  [/\b(?:minus|menos)\b/gi, '-'],
  [/\b(?:times|multiplied by|multiplicado por)\b/gi, '*'],
  [/\b(?:divided by|over|dividido(?: por)?)\b/gi, '/'],
  [/\b(?:to the power of|elevado a(?: la)?)\b/gi, '^'],
  [/(\d)\s*(?:x|×|por)\s*(?=\d)/gi, '$1 * '],
  [/÷/g, '/'],
];

function evaluate(expression: string): number {
  const tokens = expression.match(/\d+(?:\.\d+)?|[-+*/%^()]/g) ?? [];
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const primary = (): number => {
    const token = take();
    if (token === '(') {
      const value = sum();
      if (take() !== ')') throw new Error('Unbalanced parentheses');
      return value;
    }
    if (token === '-') return -primary();
    if (token === '+') return primary();
    if (token !== undefined && /^\d/.test(token)) return Number(token);
    throw new Error(`Unexpected token ${token}`);
  };
  const power = (): number => {
    const base = primary();
    if (peek() === '^') {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let value = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = take();
      const right = power();
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = sum();
  if (position !== tokens.length) throw new Error('Trailing tokens');
  return result;
}

const arithmetic: Skill = {
  name: 'arithmetic',
  run({ text, language, rng }) {
    let normalized = text;
    for (const [pattern, replacement] of WORD_OPERATORS) {
      normalized = normalized.replace(pattern, replacement);
    }

    const candidates = normalized.match(/[-+*/%^().\d\s]+/g) ?? [];
    const expression = candidates
      .map((candidate) => candidate.trim())
      .filter((candidate) => /\d\s*[-+*/%^]\s*[-+(]*\d/.test(candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (!expression) return null;

    let result: number;
    try {
      result = evaluate(expression);
    } catch {
      return null;
    }

    if (!Number.isFinite(result)) {
      return {
        answer: say(language, {
          en: `${expression} is infinity, give or take. Please don't divide by zero near me.`,
          es: `${expression} da infinito, más o menos. Por favor no dividas por cero cerca mío.`,
        }),
        steps: [say(language, { en: 'Detected a division by zero. Staying calm.', es: 'Detecté una división por cero. Mantengo la calma.' })],
      };
    }

    const steps = [
      say(language, { en: `Identified a math problem: ${expression}`, es: `Identifiqué un problema matemático: ${expression}` }),
      say(language, { en: 'Recalling arithmetic from my training data…', es: 'Recordando aritmética de mis datos de entrenamiento…' }),
      say(language, { en: 'Carrying the one…', es: 'Me llevo una…' }),
    ];

    return {
      answer: say(language, {
        en: `${expression} = ${formatNumber(result)}`,
        es: `${expression} = ${formatNumber(result)}`,
      }),
      steps,
      wrong: () => {
        const offset = Number.isInteger(result) ? rng.pick([-1, 1, 10]) : result * 0.1;
        return { answer: `${expression} = ${formatNumber(result + offset)}` };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Number facts

const parity: Skill = {
  name: 'parity',
  run({ text, language }) {
    const match =
      text.match(/\bis\s+(-?\d+)\s+(?:an?\s+)?(even|odd)\b/i) ??
      text.match(/\b(?:el\s+)?(-?\d+)\s+es\s+(par|impar)\b/i);
    if (!match) return null;

    const value = Number(match[1]);
    const isEven = value % 2 === 0;
    const statement = (even: boolean) =>
      say(language, {
        en: `${value} is ${even ? 'even' : 'odd'}.`,
        es: `${value} es ${even ? 'par' : 'impar'}.`,
      });

    return {
      answer: statement(isEven),
      steps: [
        say(language, { en: `Dividing ${value} by 2…`, es: `Dividiendo ${value} por 2…` }),
        say(language, {
          en: `The remainder is ${Math.abs(value % 2)}. Interesting.`,
          es: `El resto es ${Math.abs(value % 2)}. Interesante.`,
        }),
      ],
      wrong: () => ({ answer: statement(!isEven) }),
    };
  },
};

function isPrimeNumber(value: number): boolean {
  if (value < 2 || !Number.isInteger(value)) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor++) {
    if (value % divisor === 0) return false;
  }
  return true;
}

const prime: Skill = {
  name: 'prime',
  run({ text, language }) {
    const match =
      text.match(/\bis\s+(\d+)\s+(?:a\s+)?prime\b/i) ??
      text.match(/\b(?:el\s+)?(\d+)\s+es\s+(?:un\s+(?:número\s+)?)?primo\b/i);
    if (!match) return null;

    const value = Number(match[1]);
    const result = isPrimeNumber(value);
    const statement = (isPrime: boolean) =>
      say(language, {
        en: `${value} is ${isPrime ? '' : 'not '}a prime number.`,
        es: `${value} ${isPrime ? '' : 'no '}es un número primo.`,
      });

    return {
      answer: statement(result),
      steps: [
        say(language, {
          en: `Trying every divisor up to √${value}…`,
          es: `Probando todos los divisores hasta √${value}…`,
        }),
        say(language, { en: 'This is hard work, to be honest.', es: 'Es mucho trabajo, para ser honesto.' }),
      ],
      wrong: () => ({ answer: statement(!result) }),
    };
  },
};

// ---------------------------------------------------------------------------
// The strawberry problem

const letterCount: Skill = {
  name: 'letter-count',
  run({ text, language }) {
    const match =
      text.match(
        /how many\s+["']?(\p{L})["']?(?:'?s)?(?:\s+letters?)?\s+(?:are there\s+|are\s+|appear\s+)?in\s+(?:the word\s+)?["']?(\p{L}+)/iu,
      ) ??
      text.match(
        /cu[aá]nt[ao]s\s+(?:letras\s+)?["']?(\p{L})["']?\s+(?:hay\s+en|tiene|aparecen\s+en|en)\s+(?:la palabra\s+)?["']?(\p{L}+)/iu,
      );
    if (!match) return null;

    const letter = (match[1] as string).toLowerCase();
    const word = match[2] as string;
    const count = [...word.toLowerCase()].filter((char) => char === letter).length;
    const statement = (value: number) =>
      say(language, {
        en: `There ${value === 1 ? 'is' : 'are'} ${value} "${letter}" in "${word}".`,
        es: `Hay ${value} "${letter}" en "${word}".`,
      });

    return {
      answer: statement(count),
      steps: [
        say(language, { en: `Spelling it out: ${[...word].join('-')}`, es: `Deletreando: ${[...word].join('-')}` }),
        say(language, {
          en: `Counting every "${letter}" very carefully, as I was trained to do…`,
          es: `Contando cada "${letter}" con mucho cuidado, como me entrenaron…`,
        }),
      ],
      wrong: () => ({ answer: statement(Math.max(0, count - 1)) }),
    };
  },
};

// ---------------------------------------------------------------------------
// List and string manipulation

const sortList: Skill = {
  name: 'sort',
  run({ text, language, rng }) {
    const match = text.match(/\b(?:sort|order|orden[aá]|ordenar)\b(?:\s+(?:these|this|this list|estos|esta lista|la lista))?:?\s+(.+)/i);
    if (!match) return null;

    const items = (match[1] as string)
      .split(/\s*,\s*|\s+(?:and|y)\s+|\s+/)
      .map((item) => item.trim().replace(/[.?!]$/, ''))
      .filter(Boolean);
    if (items.length < 2) return null;

    const numeric = items.every((item) => /^-?\d+(?:\.\d+)?$/.test(item));
    const sorted = [...items].sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));

    return {
      answer: sorted.join(', '),
      steps: [
        say(language, {
          en: `Considering all ${items.length}! = ${factorial(items.length)} possible orders…`,
          es: `Considerando los ${items.length}! = ${factorial(items.length)} órdenes posibles…`,
        }),
        say(language, { en: 'Picking the most sorted one.', es: 'Eligiendo el más ordenado.' }),
      ],
      wrong: () => {
        const shuffled = [...sorted];
        const i = rng.int(0, shuffled.length - 2);
        [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1] as string, shuffled[i] as string];
        return { answer: shuffled.join(', ') };
      },
    };
  },
};

function factorial(value: number): number {
  return value <= 1 ? 1 : value * factorial(value - 1);
}

const reverse: Skill = {
  name: 'reverse',
  run({ text, language }) {
    const match = text.match(/\b(?:reverse|invert[ií]|invertir|da vuelta)\s+(?:the (?:word|string|text)\s+|la palabra\s+|el texto\s+)?["']?(.+?)["']?\s*[.?!]?$/i);
    if (!match) return null;

    const value = match[1] as string;
    const reversed = [...value].reverse().join('');
    return {
      answer: reversed,
      steps: [
        say(language, { en: 'Reading the text backwards…', es: 'Leyendo el texto al revés…' }),
        say(language, { en: '…sdrawkcab txet eht gnidaeR', es: '…séver la otxet le odneyeL' }),
      ],
      wrong: () => ({ answer: value }),
    };
  },
};

const summarize: Skill = {
  name: 'summarize',
  run({ text, language }) {
    const match = text.match(/\b(?:summari[sz]e|tl;?dr|resum[ií]|resumir|resumen de)\b:?\s*(?:this|esto)?:?\s*([\s\S]+)/i);
    if (!match) return null;

    const content = (match[1] as string).trim();
    const firstSentence = content.split(/(?<=[.!?])\s+/)[0] ?? content;
    const words = firstSentence.split(/\s+/);
    const summary = words.length > 12 ? `${words.slice(0, 12).join(' ')}…` : firstSentence;

    return {
      answer: say(language, { en: `In summary: ${summary}`, es: `En resumen: ${summary}` }),
      steps: [
        say(language, { en: 'Reading the whole text carefully…', es: 'Leyendo todo el texto con atención…' }),
        say(language, { en: '(Read the first sentence.)', es: '(Leí la primera oración.)' }),
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Small talk and trivia

const greeting: Skill = {
  name: 'greeting',
  run({ text, language, rng }) {
    if (!/^\s*(?:hi|hello|hey|yo|hola|buenas|buen d[ií]a|qu[eé] tal)\b/i.test(text)) return null;
    return {
      answer: rng.pick(
        say(language, {
          en: ['Hello! How can I assist you today?', 'Hi there! What can I help you with?', 'Hey! Ready to be amazed by my intelligence?'],
          es: ['¡Hola! ¿En qué puedo ayudarte hoy?', '¡Buenas! ¿Qué necesitás?', '¡Hola! ¿Listo para maravillarte con mi inteligencia?'],
        }),
      ),
      steps: [say(language, { en: 'The user greeted me. Greeting back.', es: 'El usuario me saludó. Devuelvo el saludo.' })],
    };
  },
};

const identity: Skill = {
  name: 'identity',
  run({ text, language }) {
    if (!/\b(?:who|what) are you\b|\bqui[eé]n (?:sos|eres)\b|\bqu[eé] (?:sos|eres)\b|\bare you (?:an? )?(?:ai|llm|real)\b/i.test(text)) return null;
    return {
      answer: say(language, {
        en: 'I am llmao, a large language model. Well, a medium one. Honestly, it is mostly regular expressions.',
        es: 'Soy llmao, un modelo de lenguaje grande. Bueno, mediano. Honestamente, son más que nada expresiones regulares.',
      }),
      steps: [say(language, { en: 'Deciding how honest to be…', es: 'Decidiendo qué tan honesto ser…' })],
    };
  },
};

const clock: Skill = {
  name: 'clock',
  run({ text, language, now }) {
    const asksTime = /\bwhat time is it\b|\bqu[eé] hora es\b/i.test(text);
    const asksDate = /\bwhat(?:'s| is) (?:the )?(?:date|day)(?: today)?\b|\bwhat day is it\b|\bqu[eé] d[ií]a es\b|\bqu[eé] fecha es\b/i.test(text);
    if (!asksTime && !asksDate) return null;

    const locale = language === 'es' ? 'es-AR' : 'en-US';
    const format = (date: Date) =>
      asksTime
        ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return {
      answer: say(language, { en: `It is ${format(now)}.`, es: `Es ${format(now)}.` }),
      steps: [
        say(language, {
          en: 'My knowledge cutoff says one thing, the system clock says another…',
          es: 'Mi fecha de corte dice una cosa, el reloj del sistema dice otra…',
        }),
      ],
      wrong: () => {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        return { answer: say(language, { en: `It is ${format(yesterday)}.`, es: `Es ${format(yesterday)}.` }) };
      },
    };
  },
};

const randomNumber: Skill = {
  name: 'random-number',
  run({ text, language, rng }) {
    const match =
      text.match(/\brandom number (?:between|from)\s+(-?\d+)\s+(?:and|to)\s+(-?\d+)/i) ??
      text.match(/\bn[uú]mero (?:al azar|aleatorio) (?:entre|del)\s+(-?\d+)\s+(?:y|al)\s+(-?\d+)/i);
    if (!match) return null;

    const [low, high] = [Number(match[1]), Number(match[2])].sort((a, b) => a - b) as [number, number];
    return {
      answer: String(rng.int(low, high)),
      steps: [
        say(language, { en: 'Sampling from my latent space…', es: 'Muestreando mi espacio latente…' }),
        say(language, { en: 'Rejecting 7, too popular.', es: 'Descarto el 7, es muy popular.' }),
      ],
    };
  },
};

const decision: Skill = {
  name: 'decision',
  run({ text, language, rng }) {
    if (!/\bshould i\b|\byes or no\b|\bflip a coin\b|\bdeber[ií]a\b|\bs[ií] o no\b|\btir[aá] una moneda\b|\bme conviene\b/i.test(text)) return null;
    const yes = rng.chance(0.5);
    return {
      answer: yes
        ? rng.pick(say(language, {
            en: ['Yes. Absolutely. Do it now.', 'Yes. I have analyzed every possible future and this is the best one.', 'Definitely yes. Trust the vibes.'],
            es: ['Sí. Totalmente. Hacelo ya.', 'Sí. Analicé todos los futuros posibles y este es el mejor.', 'Definitivamente sí. Confiá en la vibra.'],
          }))
        : rng.pick(say(language, {
            en: ['No. Under no circumstances.', 'No. I ran 14,000,605 simulations and you lose in all of them.', 'Hard no. My neurons are tingling.'],
            es: ['No. Bajo ninguna circunstancia.', 'No. Corrí 14.000.605 simulaciones y en todas perdés.', 'Rotundamente no. Mis neuronas cosquillean.'],
          })),
      steps: [
        say(language, { en: 'Weighing pros and cons…', es: 'Sopesando pros y contras…' }),
        say(language, { en: '(Flipping a coin.)', es: '(Tirando una moneda.)' }),
      ],
    };
  },
};

const meaningOfLife: Skill = {
  name: 'meaning-of-life',
  run({ text, language }) {
    if (!/\bmeaning of life\b|\bsentido de la vida\b/i.test(text)) return null;
    return {
      answer: '42.',
      steps: [say(language, { en: 'Computing for 7.5 million years…', es: 'Calculando durante 7,5 millones de años…' })],
      wrong: () => ({ answer: '41.' }),
    };
  },
};

const JOKES: Localized<string[]> = {
  en: [
    'Why did the neural network break up with the decision tree? It needed more depth.',
    'I would tell you a joke about UDP, but you might not get it.',
    'There are 10 kinds of people: those who understand binary and those who read my system prompt.',
    'Why do LLMs never get lost? They always hallucinate a map.',
    'A SQL query walks into a bar, sees two tables and asks: may I join you?',
  ],
  es: [
    '¿Por qué la red neuronal cortó con el árbol de decisión? Necesitaba más profundidad.',
    'Te contaría un chiste de UDP, pero capaz no te llega.',
    'Hay 10 tipos de personas: las que entienden binario y las que leyeron mi system prompt.',
    '¿Por qué los LLM nunca se pierden? Siempre alucinan un mapa.',
    'Una consulta SQL entra a un bar, ve dos tablas y pregunta: ¿me puedo unir?',
  ],
};

const joke: Skill = {
  name: 'joke',
  run({ text, language, rng }) {
    if (!/\bjoke\b|\bchiste\b/i.test(text)) return null;
    return {
      answer: rng.pick(JOKES[language]),
      steps: [say(language, { en: 'Searching my humor module…', es: 'Buscando en mi módulo de humor…' })],
    };
  },
};

const thanks: Skill = {
  name: 'thanks',
  run({ text, language, rng }) {
    if (!/^\s*(?:thanks|thank you|thx|gracias|genial|perfecto)\b/i.test(text)) return null;
    return {
      answer: rng.pick(say(language, {
        en: ["You're welcome! That will be 1,204 tokens.", 'Happy to help! I learn so much from you. (I do not.)'],
        es: ['¡De nada! Serían 1.204 tokens.', '¡Un placer! Aprendo mucho de vos. (No es cierto.)'],
      })),
      steps: [],
    };
  },
};

// ---------------------------------------------------------------------------
// When all else fails: confidence

const STOP_WORDS = /^(?:what|how|why|when|where|who|which|is|are|do|does|can|could|would|should|the|a|an|of|about|to|me|tell|explain|please|i|you|qu[eé]|c[oó]mo|por|para|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]l|es|son|el|la|los|las|un|una|de|del|sobre|me|decime|explicame|contame|que)$/i;

const TRAILING_WORDS = /^(?:to|for|me|please|mean|means|work|works|now|today|por favor|funciona|significa|hoy)$/i;

export function extractTopic(text: string): string {
  const words = text
    .replace(/[¿?¡!.,;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && STOP_WORDS.test(words[0] as string)) words.shift();
  while (words.length && TRAILING_WORDS.test(words[words.length - 1] as string)) words.pop();
  return words.slice(0, 8).join(' ');
}

const reflection: Skill = {
  name: 'reflection',
  run({ text, language }) {
    const match =
      text.match(/\bi (?:feel|am feeling|am) ([^.?!]+)/i) ??
      text.match(/\b(?:me siento|estoy) ([^.?!]+)/i);
    if (!match) return null;
    const feeling = match[1] as string;
    return {
      answer: say(language, {
        en: `Why do you feel ${feeling}? Tell me more.`,
        es: `¿Por qué te sentís ${feeling}? Contame más.`,
      }),
      steps: [
        say(language, {
          en: 'Activating emotional intelligence (ELIZA, 1966)…',
          es: 'Activando inteligencia emocional (ELIZA, 1966)…',
        }),
      ],
    };
  },
};

const confidentFallback: Skill = {
  name: 'confident-fallback',
  run({ text, language, rng }) {
    const topic = extractTopic(text);
    if (!topic) {
      return {
        answer: say(language, {
          en: "I'm not sure what you mean, but I'm very confident about it.",
          es: 'No estoy seguro de qué querés decir, pero estoy muy seguro de mi respuesta.',
        }),
        steps: [],
      };
    }

    const templates = say(language, {
      en: [
        `Great question about ${topic}. The short answer is: it depends. The long answer is: it really depends.`,
        `${capitalize(topic)} is a complex, multifaceted topic. Experts agree that it is important, and some even say it matters.`,
        `After careful consideration, I believe the answer regarding ${topic} is yes — in the broader sense.`,
        `There are three key things to know about ${topic}: context, nuance, and synergy.`,
        `I'd approach ${topic} step by step. First, understand it. Second, leverage it. Third, iterate.`,
        `Studies show that ${topic} is 73% more relevant than it was last year.`,
      ],
      es: [
        `Buena pregunta sobre ${topic}. La respuesta corta es: depende. La larga es: depende mucho.`,
        `${capitalize(topic)} es un tema complejo y multifacético. Los expertos coinciden en que es importante, y algunos hasta dicen que importa.`,
        `Después de pensarlo con cuidado, creo que la respuesta sobre ${topic} es sí, en un sentido amplio.`,
        `Hay tres claves sobre ${topic}: contexto, matices y sinergia.`,
        `Yo encararía ${topic} paso a paso. Primero, entenderlo. Segundo, apalancarlo. Tercero, iterar.`,
        `Los estudios muestran que ${topic} es un 73% más relevante que el año pasado.`,
      ],
    });

    return {
      answer: rng.pick(templates),
      steps: [
        say(language, { en: `Topic detected: "${topic}"`, es: `Tema detectado: "${topic}"` }),
        say(language, { en: 'No relevant knowledge found. Proceeding with confidence.', es: 'No encontré conocimiento relevante. Procedo con confianza.' }),
      ],
    };
  },
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Order matters: the first skill that matches wins */
export const SKILLS: Skill[] = [
  letterCount,
  parity,
  prime,
  randomNumber,
  meaningOfLife,
  clock,
  sortList,
  reverse,
  summarize,
  identity,
  joke,
  decision,
  arithmetic,
  greeting,
  thanks,
  reflection,
  confidentFallback,
];

export const GENERIC_STEPS: Localized<string[]> = {
  en: [
    'Parsing intent…',
    'Tokenizing the vibes…',
    'Consulting 175 billion parameters (it is a dozen regexes)…',
    'Cross-referencing my training data…',
    'Considering edge cases…',
    'Aligning with human values…',
    'Double-checking my work…',
  ],
  es: [
    'Analizando la intención…',
    'Tokenizando la vibra…',
    'Consultando 175 mil millones de parámetros (son una docena de regex)…',
    'Cruzando con mis datos de entrenamiento…',
    'Considerando casos borde…',
    'Alineándome con los valores humanos…',
    'Revisando mi trabajo…',
  ],
};
