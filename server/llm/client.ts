import Anthropic from '@anthropic-ai/sdk';

/**
 * Every LLM call in Orbit shares this client. The API key is read from ANTHROPIC_API_KEY
 * (loaded from server/.env by env.ts) — the SDK resolves it from the environment, so it is
 * never passed around or logged.
 */
export const MODEL = 'claude-opus-5';

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

/** Rough spend estimate for the UI/logs. Opus 5 is $5/MTok in, $25/MTok out. */
export function estimateCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens / 1_000_000) * 5 + (usage.output_tokens / 1_000_000) * 25;
}
