/** Builds the language model a job uses, from the model gateway settings. */
import { createAnthropic } from '@ai-sdk/anthropic';
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

/**
 * Builds the model of a job. The key is passed explicitly: the providers' environment fallbacks
 * are never used, so what runs is what the settings say.
 *
 * @param resolved - The settings and the opened key.
 * @param job - The job.
 * @returns The model.
 * @throws {ModelUnavailableError} When Anthropic or OpenAI has no key saved.
 */
export function languageModel(resolved: ResolvedModelSettings, job: ModelJob): LanguageModel {
  const { settings, apiKey } = resolved;
  const id = modelIdFor(settings, job);
  const baseURL = settings.baseUrl ?? undefined;
  if (settings.provider === 'openai-compatible') {
    const options = { name: 'gateway', baseURL: baseURL ?? '', includeUsage: true };
    return createOpenAICompatible(apiKey ? { ...options, apiKey } : options)(id);
  }
  if (apiKey === null)
    throw new ModelUnavailableError('Save an API key in Settings → Model first.');
  const common = { apiKey, ...(baseURL ? { baseURL } : {}) };
  return settings.provider === 'anthropic' ? createAnthropic(common)(id) : createOpenAI(common)(id);
}
