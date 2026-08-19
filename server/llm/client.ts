import Anthropic from '@anthropic-ai/sdk';

/**
 * Every LLM call in Orbit shares this client. The API key is read from ANTHROPIC_API_KEY
 * (loaded from server/.env by env.ts) — the SDK resolves it from the environment, so it is
 * never passed around or logged.
 */
export const MODEL = 'claude-opus-5';

/**
 * Mining is bulk extraction under strict rules rather than open judgment, so it can run on a
 * cheaper model than tailoring without changing what reaches an employer. Overridable from
 * server/.env (MINING_MODEL) so the choice is a config decision, not a code edit.
 */
export const MINING_MODEL = process.env.MINING_MODEL ?? MODEL;

/** Per-MTok input/output rates, for cost estimates that name their model. */
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getClient(): Anthropic {
  if (!llmConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to server/.env to enable LLM features.');
  }
  client ??= new Anthropic();
  return client;
}

/** Rough spend estimate for the UI/logs. Defaults to Opus 5 rates when the model is unknown. */
export function estimateCostUsd(
  usage: { input_tokens: number; output_tokens: number },
  model: string = MODEL
): number {
  const rate = RATES[model] ?? RATES['claude-opus-5'];
  return (usage.input_tokens / 1_000_000) * rate.input + (usage.output_tokens / 1_000_000) * rate.output;
}
