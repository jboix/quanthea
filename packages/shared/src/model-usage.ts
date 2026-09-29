/**
 * Token usage and what it costs. A turn records its tokens per model; the price table turns them
 * into an approximate cost. Prices change: the table says when it was checked, and a model not in
 * it is shown without a cost.
 */
import { z } from 'zod';

/** Validates the tokens of one model in a turn. */
export const tokenUsageSchema = z.object({
  /** Input tokens read fresh. */
  input: z.number().nonnegative(),
  /** Input tokens read from the provider's cache. */
  cachedInput: z.number().nonnegative(),
  /** Input tokens written to the provider's cache. */
  cacheWrite: z.number().nonnegative(),
  /** Output tokens, reasoning included. */
  output: z.number().nonnegative(),
});

/** The tokens of one model in a turn. */
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/** Validates a turn's usage: tokens by model id. */
export const turnUsageSchema = z.record(z.string(), tokenUsageSchema);

/** A turn's usage: tokens by model id. */
export type TurnUsage = z.infer<typeof turnUsageSchema>;

/** No tokens. */
export const noUsage: TokenUsage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };

/**
 * Adds one model's tokens to a turn's usage.
 *
 * @param usage - The turn's usage so far.
 * @param model - The model id.
 * @param tokens - The tokens to add.
 * @returns The new usage.
 */
export function addUsage(usage: TurnUsage, model: string, tokens: TokenUsage): TurnUsage {
  const before = usage[model] ?? noUsage;
  return {
    ...usage,
    [model]: {
      input: before.input + tokens.input,
      cachedInput: before.cachedInput + tokens.cachedInput,
      cacheWrite: before.cacheWrite + tokens.cacheWrite,
      output: before.output + tokens.output,
    },
  };
}

/** A model's list price in US dollars per million tokens. */
export interface ModelPrice {
  /** Fresh input. */
  readonly input: number;
  /** Input read from the cache; the input price when the provider has no cache price. */
  readonly cachedInput?: number;
  /** Input written to the cache; the input price when the provider charges nothing extra. */
  readonly cacheWrite?: number;
  /** Output. */
  readonly output: number;
}

/** When the prices below were last checked against the providers' pages. */
export const pricesCheckedOn = '2026-09-29';

/** List prices by model id, as checked on {@link pricesCheckedOn}. */
export const modelPrices: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  'gpt-6-sol': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gemini-3.8-flash': { input: 0.75, cachedInput: 0.075, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, cachedInput: 0.075, output: 3.75 },
  'gemini-3.6-flash': { input: 0.75, cachedInput: 0.075, output: 3.75 },
  'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, cachedInput: 0.025, output: 1.5 },
  'mistral-large-latest': { input: 0.5, output: 1.5 },
  'mistral-medium-latest': { input: 1.5, output: 7.5 },
  'mistral-small-latest': { input: 0.15, output: 0.6 },
  'ministral-8b-latest': { input: 0.15, output: 0.15 },
};

/**
 * The price of a model: its own entry, or the entry its id starts with, so a dated id such as
 * `claude-sonnet-5-20260901` finds `claude-sonnet-5`.
 *
 * @param model - The model id.
 * @returns The price, or `undefined` when the table does not know the model.
 */
export function priceOf(model: string): ModelPrice | undefined {
  const bare = model.replace(/^models\//, '');
  const known = Object.keys(modelPrices)
    .filter((id) => bare === id || bare.startsWith(`${id}-`))
    .sort((first, second) => second.length - first.length)[0];
  return known === undefined ? undefined : modelPrices[known];
}

/**
 * What one model's tokens cost.
 *
 * @param tokens - The tokens.
 * @param price - The model's price.
 * @returns US dollars.
 */
function dollarsFor(tokens: TokenUsage, price: ModelPrice): number {
  const cached = tokens.cachedInput * (price.cachedInput ?? price.input);
  const written = tokens.cacheWrite * (price.cacheWrite ?? price.input);
  return (tokens.input * price.input + cached + written + tokens.output * price.output) / 1e6;
}

/**
 * What a turn's tokens cost at list price.
 *
 * @param usage - The turn's usage.
 * @returns The dollars for the models the table knows, and the models it does not.
 */
export function costOf(usage: TurnUsage): { dollars: number; unpriced: string[] } {
  let dollars = 0;
  const unpriced: string[] = [];
  for (const [model, tokens] of Object.entries(usage)) {
    const price = priceOf(model);
    if (price) dollars += dollarsFor(tokens, price);
    else unpriced.push(model);
  }
  return { dollars, unpriced };
}
