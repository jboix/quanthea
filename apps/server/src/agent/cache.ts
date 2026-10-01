/**
 * Prompt caching. Providers bill a repeated start of a request at a fraction of the input price.
 * OpenAI and Gemini find it on their own when the start stays the same; Anthropic caches only up to
 * the points a request marks. The instructions put what lasts first, and for Anthropic this module
 * marks the end of that part and the end of the conversation so far.
 */
import type { ModelSettings } from '@quanthea/shared';
import type { Instructions, ModelMessage } from 'ai';
import type { InstructionParts } from './prompt.ts';

/** The provider option that marks a cache point for Anthropic. */
const cachePoint = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

/**
 * The instructions as the provider takes them: for Anthropic two system blocks, the lasting one
 * marked as a cache point; for the others one text, lasting part first.
 *
 * @param parts - The lasting part and the turn's part.
 * @param provider - The provider.
 * @returns The instructions.
 */
export function cachedInstructions(
  parts: InstructionParts,
  provider: ModelSettings['provider'],
): Instructions {
  if (provider !== 'anthropic') return `${parts.lasting}\n\n${parts.turn}`;
  return [
    { role: 'system', content: parts.lasting, providerOptions: cachePoint },
    { role: 'system', content: parts.turn },
  ];
}

/**
 * The messages of a step with one cache point, on the last message, so the next step reads the
 * whole conversation so far from the cache. Earlier points are removed: Anthropic allows four.
 *
 * @param messages - The messages the step sends.
 * @param provider - The provider.
 * @returns The messages, marked for Anthropic and unchanged for the others.
 */
export function withCachedTail(
  messages: readonly ModelMessage[],
  provider: ModelSettings['provider'],
): ModelMessage[] {
  if (provider !== 'anthropic') return [...messages];
  const last = messages.length - 1;
  return messages.map((message, index) => {
    const { providerOptions, ...rest } = message;
    const { anthropic: _mark, ...others } = providerOptions ?? {};
    if (index === last) return { ...rest, providerOptions: { ...others, ...cachePoint } };
    return Object.keys(others).length === 0 ? rest : { ...rest, providerOptions: others };
  }) as ModelMessage[];
}
