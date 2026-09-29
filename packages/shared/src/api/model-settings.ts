/** Model gateway endpoints: read and save the settings, and test the connection. Admin only. */
import { z } from 'zod';
import { modelGatewaySchema, modelProviders } from '../model-settings.ts';
import { defineEndpoint } from './contract.ts';

/** Validates the settings as the API returns them: each provider's key masked, if one is stored. */
export const modelSettingsViewSchema = z.object({
  gateway: modelGatewaySchema,
  /** Each provider's stored key, masked such as `••••••••9f2a`, or `null` when none is stored. */
  keys: z.record(z.string(), z.string().nullable()),
  /** This month, from the usage ledger: tokens, threads, pinned views, and the list-price cost. */
  usage: z.object({
    tokens: z.number(),
    threads: z.number(),
    pinnedViews: z.number(),
    dollars: z.number(),
  }),
});

/** The settings as the API returns them. */
export type ModelSettingsView = z.infer<typeof modelSettingsViewSchema>;

/** Validates the result of a connection test. */
export const modelTestSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  /** What went wrong, or the model's name, in words. */
  message: z.string(),
});

/** Reads the model settings. */
export const getModelSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/model',
  output: modelSettingsViewSchema,
});

/** Saves the model settings. A key replaces the stored one; without one the stored key stays. */
export const saveModelSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/model',
  body: z.object({
    gateway: modelGatewaySchema,
    /** New keys, by provider id; a provider left out keeps its key. */
    apiKeys: z.record(z.string(), z.string().min(1).max(2000)).default({}),
  }),
  output: modelSettingsViewSchema,
});

/** Tests the saved settings: reachability, tool calling and structured output. */
export const testModelSettingsEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/model/test',
  body: z.object({ providerId: z.string().min(1).max(40) }),
  output: modelTestSchema,
});

/**
 * Lists the chat models a provider offers. Without a key in the request, the stored key is used
 * when the provider is the saved one.
 */
export const listModelsEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/model/models',
  body: z.object({
    provider: z.enum(modelProviders),
    baseUrl: z.string().max(500).nullable(),
    apiKey: z.string().min(1).max(2000).optional(),
    /** The saved provider being edited, whose stored key may be used. */
    providerId: z.string().max(40).optional(),
  }),
  output: z.object({ models: z.array(z.string()), message: z.string().nullable() }),
});

/** A provider as a thread may choose it: no key, no base URL. */
export const providerChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(modelProviders),
  /** The model that builds, for the choice's label. */
  buildModel: z.string(),
});

/** A provider a thread may use. */
export type ProviderChoice = z.infer<typeof providerChoiceSchema>;

/** The providers a thread may use, and the default, for editors starting a thread. */
export const listProviderChoicesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/model-providers',
  output: z.object({ providers: z.array(providerChoiceSchema), defaultProviderId: z.string() }),
});
