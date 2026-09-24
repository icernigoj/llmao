import type { LlmaoOptions } from './types';

export type Persona = 'helpful' | 'mini' | 'overthinker' | 'safe' | 'corporate' | 'yolo';

export interface ModelCard {
  persona: Persona;
  description: string;
  defaults: LlmaoOptions;
}

export const MODELS = {
  'lmao-1': {
    persona: 'helpful',
    description: 'Our flagship model. Helpful, harmless, and mostly regex.',
    defaults: {},
  },
  'lmao-1-mini': {
    persona: 'mini',
    description: 'Faster, cheaper, and 100% sure about everything.',
    defaults: { speed: 'fast' },
  },
  'lmao-o1-overthinker': {
    persona: 'overthinker',
    description: 'Thinks very, very hard. Then thinks about thinking. Then answers 2 + 2.',
    defaults: { speed: 'dramatic' },
  },
  'lmao-safe': {
    persona: 'safe',
    description: 'Our most aligned model. Refuses everything that could be misused, which is everything.',
    defaults: {},
  },
  'lmao-corporate': {
    persona: 'corporate',
    description: 'Leverages synergies to deliver best-in-class answers going forward.',
    defaults: {},
  },
  'lmao-yolo': {
    persona: 'yolo',
    description: 'Temperature 2, no guardrails, half of the answers are wrong. Ships to prod on Fridays.',
    defaults: { temperature: 2, hallucinationRate: 0.5 },
  },
} satisfies Record<string, ModelCard>;

export type ModelId = keyof typeof MODELS | (string & {});

export const DEFAULT_MODEL = 'lmao-1';

/** Unknown model ids (like `gpt-4o`) get the flagship, so llmao works as a drop-in */
export function getModel(modelId: string | undefined): ModelCard {
  return (MODELS as Record<string, ModelCard>)[modelId ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
}
