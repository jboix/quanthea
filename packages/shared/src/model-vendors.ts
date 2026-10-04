/**
 * Who a provider's requests actually reach: the vendor behind its base URL, or the vendor its kind
 * names. Usage shows it, since a provider's name is free text and may name someone else.
 */
import type { ModelProvider } from './model-settings.ts';

/** The vendors quanthea tells apart, with the name people know each by. */
export const modelVendors = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  together: 'Together',
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI compatible',
} as const;

/** A vendor, such as `gemini`. */
export type ModelVendor = keyof typeof modelVendors;

/** The API hosts of the vendors that have one; a host matches itself and its subdomains. */
const vendorHosts: readonly (readonly [host: string, vendor: ModelVendor])[] = [
  ['api.anthropic.com', 'anthropic'],
  ['api.openai.com', 'openai'],
  ['api.mistral.ai', 'mistral'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['openrouter.ai', 'openrouter'],
  ['api.groq.com', 'groq'],
  ['api.deepseek.com', 'deepseek'],
  ['api.together.xyz', 'together'],
];

/** The port Ollama listens on, on whatever host runs it. */
const ollamaPort = '11434';

/**
 * The vendor behind a base URL, when its host or port gives it away.
 *
 * @param baseUrl - The base URL, or `null`.
 * @returns The vendor, or `null` when the URL names none quanthea knows (LiteLLM and vLLM among them).
 */
function vendorOfUrl(baseUrl: string | null): ModelVendor | null {
  // The shared package has no DOM types, so no `URL`: the host and port come from a pattern.
  const parts = /^https?:\/\/(?:[^@/]*@)?([^/:?#]+)(?::(\d+))?/i.exec(baseUrl ?? '');
  if (!parts) return null;
  const hostname = (parts[1] ?? '').toLowerCase();
  const port = parts[2] ?? '';
  const known = vendorHosts.find(([host]) => hostname === host || hostname.endsWith(`.${host}`));
  if (known) return known[1];
  return port === ollamaPort ? 'ollama' : null;
}

/**
 * The vendor a provider's requests reach: the one its base URL names, else the one its kind names.
 *
 * @param provider - The provider's kind and base URL.
 * @param provider.provider - The kind, such as `openai-compatible`.
 * @param provider.baseUrl - The base URL, or `null` for the kind's own API.
 * @returns The vendor; `openai-compatible` for a gateway quanthea does not recognise.
 */
export function vendorOf(provider: {
  readonly provider: ModelProvider;
  readonly baseUrl: string | null;
}): ModelVendor {
  return vendorOfUrl(provider.baseUrl) ?? provider.provider;
}

/**
 * The name of a vendor as recorded, such as `Gemini` for `gemini`.
 *
 * @param vendor - The vendor id, as the usage ledger holds it.
 * @returns The name, or `null` for an empty or unknown id.
 */
export function vendorLabel(vendor: string): string | null {
  return Object.hasOwn(modelVendors, vendor) ? modelVendors[vendor as ModelVendor] : null;
}

/** The names quanthea gives on its own: a vendor's name, or `Provider 2` for a new provider. */
const givenNames = new Set<string>(Object.values(modelVendors));

/**
 * The name to propose for a provider: its vendor's, while its name is empty or one quanthea gave.
 * A name someone chose is never second-guessed.
 *
 * @param config - The provider as edited.
 * @param config.name - Its name.
 * @param config.provider - Its kind.
 * @param config.baseUrl - Its base URL.
 * @returns The vendor's name, or `null` when the name already is it or someone chose it.
 */
export function suggestedProviderName(config: {
  readonly name: string;
  readonly provider: ModelProvider;
  readonly baseUrl: string | null;
}): string | null {
  const name = config.name.trim();
  const given = name === '' || givenNames.has(name) || /^Provider \d+$/.test(name);
  const label = modelVendors[vendorOf(config)];
  return given && name !== label ? label : null;
}
