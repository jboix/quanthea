/**
 * What querent knows about each provider before asking it: its API, the models worth offering by
 * name, and the model each job starts with. The provider's own model listing adds to these.
 */
import type { ModelProvider } from './model-settings.ts';

/** A model offered by name. */
export interface KnownModel {
  /** The id the API takes, such as `claude-sonnet-5`. */
  readonly id: string;
  /** The name people know it by, such as `Sonnet 5`. */
  readonly name: string;
}

/** What querent knows about a provider. */
export interface ProviderProfile {
  /** The provider's own API, or `null` for a gateway, which has none. */
  readonly baseUrl: string | null;
  /** The models offered by name, strongest first. */
  readonly models: readonly KnownModel[];
  /** The model each job starts with; empty means "same as build". */
  readonly defaults: {
    readonly build: string;
    readonly repair: string;
    readonly metadata: string;
  };
}

/** The profile of each provider. */
export const providerProfiles: Readonly<Record<ModelProvider, ProviderProfile>> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-fable-5-1', name: 'Fable 5.1' },
      { id: 'claude-opus-5-5', name: 'Opus 5.5' },
      { id: 'claude-sonnet-5', name: 'Sonnet 5' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
    ],
    defaults: { build: 'claude-sonnet-5', repair: '', metadata: 'claude-haiku-4-5' },
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini' },
      { id: 'gpt-5-nano', name: 'GPT-5 nano' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
    ],
    defaults: { build: 'gpt-5', repair: '', metadata: 'gpt-5-mini' },
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large' },
      { id: 'mistral-medium-latest', name: 'Mistral Medium' },
      { id: 'magistral-medium-latest', name: 'Magistral Medium' },
      { id: 'mistral-small-latest', name: 'Mistral Small' },
      { id: 'codestral-latest', name: 'Codestral' },
      { id: 'ministral-8b-latest', name: 'Ministral 8B' },
    ],
    defaults: { build: 'mistral-large-latest', repair: '', metadata: 'mistral-small-latest' },
  },
  'openai-compatible': {
    baseUrl: null,
    models: [],
    defaults: { build: '', repair: '', metadata: '' },
  },
};

/** A well-known OpenAI-compatible gateway. */
export interface GatewayPreset {
  /** Its name. */
  readonly name: string;
  /** Its OpenAI-compatible base URL. */
  readonly baseUrl: string;
}

/** Gateways people often point querent at. */
export const gatewayPresets: readonly GatewayPreset[] = [
  { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'LiteLLM', baseUrl: 'http://localhost:4000/v1' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { name: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
];
