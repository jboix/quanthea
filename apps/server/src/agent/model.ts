/** Builds the language model a job uses, from the model gateway settings. */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelSettings } from '@querent/shared';
import type { LanguageModel } from 'ai';
import type { ResolvedModelSettings } from '../settings/model-settings.ts';

/** A job of the model: building dashboards, repairing queries, or writing titles and tags. */
export type ModelJob = keyof ModelSettings['models'];

/** Why no model could be built. */
export class ModelUnavailableError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What is missing, in words an admin can act on.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * The model id of a job; an empty repair or metadata model means the build model.
 *
 * @param settings - The settings.
 * @param job - The job.
 * @returns The model id.
 */
export function modelIdFor(settings: ModelSettings, job: ModelJob): string {
  return settings.models[job] || settings.models.build;
}

/** The connection a provider is built with. */
interface Connection {
  /** The key, if any. */
  readonly apiKey: string | null;
  /** The base URL, if not the provider's own. */
  readonly baseURL: string | undefined;
}

/**
 * The key and base URL options of a provider that needs a key.
 *
 * @param connection - The key and the base URL.
 * @returns The options.
 * @throws {ModelUnavailableError} When no key is saved.
 */
function keyed(connection: Connection) {
  if (connection.apiKey === null)
    throw new ModelUnavailableError('Save an API key in Settings → Model first.');
  return {
    apiKey: connection.apiKey,
    ...(connection.baseURL ? { baseURL: connection.baseURL } : {}),
  };
}

/** How each provider builds a model. */
const builders: Readonly<
  Record<ModelSettings['provider'], (connection: Connection, id: string) => LanguageModel>
> = {
  anthropic: (connection, id) => createAnthropic(keyed(connection))(id),
  openai: (connection, id) => createOpenAI(keyed(connection))(id),
  mistral: (connection, id) => createMistral(keyed(connection))(id),
  'openai-compatible': ({ apiKey, baseURL }, id) => {
    const options = { name: 'gateway', baseURL: baseURL ?? '', includeUsage: true };
    return createOpenAICompatible(apiKey ? { ...options, apiKey } : options)(id);
  },
};

/**
 * Builds the model of a job. The key is passed explicitly: the providers' environment fallbacks
 * are never used, so what runs is what the settings say.
 *
 * @param resolved - The settings and the opened key.
 * @param job - The job.
 * @returns The model.
 * @throws {ModelUnavailableError} When Anthropic, OpenAI or Mistral has no key saved.
 */
export function languageModel(resolved: ResolvedModelSettings, job: ModelJob): LanguageModel {
  const { settings, apiKey } = resolved;
  const connection = { apiKey, baseURL: settings.baseUrl ?? undefined };
  return builders[settings.provider](connection, modelIdFor(settings, job));
}
