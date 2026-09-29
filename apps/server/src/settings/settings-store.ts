/** The typed settings store: one Zod-validated JSON document per section. */
import {
  authModeSchema,
  defaultModelGateway,
  type ModelProvider,
  modelGatewaySchema,
  modelSettingsSchema,
} from '@querent/shared';
import { z } from 'zod';
import type { SettingsRepository } from '../db/settings-repository.ts';

/** The id and name an upgraded provider gets from its vendor. */
const upgradedNames: Readonly<Record<ModelProvider, { id: string; name: string }>> = {
  anthropic: { id: 'anthropic', name: 'Anthropic' },
  openai: { id: 'openai', name: 'OpenAI' },
  mistral: { id: 'mistral', name: 'Mistral' },
  'openai-compatible': { id: 'gateway', name: 'Gateway' },
};

/**
 * Upgrades model settings saved before there were several providers: the one provider becomes
 * the only saved provider, and the default. Anything else passes through.
 *
 * @param value - The stored value.
 * @returns The value in the current shape.
 */
export function upgradeModelSettings(value: unknown): unknown {
  const legacy = modelSettingsSchema.safeParse(value);
  if (!legacy.success || (value as { providers?: unknown }).providers !== undefined) return value;
  const { provider, baseUrl, models, limits, behaviour } = legacy.data;
  const { id, name } = upgradedNames[provider];
  const config = { id, name, provider, baseUrl, models };
  return { providers: [config], defaultProviderId: id, limits, behaviour };
}

/** The schema of every settings section. A section is stored under its name. */
const sectionSchemas = {
  auth: z.object({ mode: authModeSchema }),
  /** The model gateway: the saved providers, the default, the limits and the behaviour. */
  model: z.preprocess(upgradeModelSettings, modelGatewaySchema),
  /** The key saved before there were several providers, sealed; moved to `model-keys` on read. */
  'model-key': z.object({ sealed: z.string().nullable() }),
  /** Each provider's API key, sealed and base64-encoded, by provider id. */
  'model-keys': z.object({ sealed: z.record(z.string(), z.string()) }),
};

/** A settings section name. */
type SectionName = keyof typeof sectionSchemas;

/** The value of one settings section. */
type SectionValue<Name extends SectionName> = z.infer<(typeof sectionSchemas)[Name]>;

/** The value of each section before anyone has saved it. */
const sectionDefaults: { readonly [Name in SectionName]: SectionValue<Name> } = {
  auth: { mode: 'none' },
  model: defaultModelGateway,
  'model-key': { sealed: null },
  'model-keys': { sealed: {} },
};

/** Reads and writes settings sections. */
export interface SettingsStore {
  /**
   * Reads a section, falling back to its default when it was never saved.
   *
   * @param section - The section name.
   * @returns The validated section value.
   * @throws {Error} When the stored value no longer matches the section schema.
   */
  read<Name extends SectionName>(section: Name): SectionValue<Name>;
  /**
   * Validates and saves a section.
   *
   * @param section - The section name.
   * @param value - The new value.
   * @throws {z.ZodError} When the value does not match the section schema.
   */
  write<Name extends SectionName>(section: Name, value: SectionValue<Name>): void;
}

/**
 * Creates the store over a repository.
 *
 * @param repository - Where section values are persisted.
 * @returns The store.
 */
export function createSettingsStore(repository: SettingsRepository): SettingsStore {
  return {
    read<Name extends SectionName>(section: Name): SectionValue<Name> {
      const stored = repository.read(section);
      if (stored === undefined) return sectionDefaults[section];
      const parsed = sectionSchemas[section].safeParse(JSON.parse(stored));
      if (!parsed.success) throw new Error(`Stored settings section "${section}" is invalid.`);
      // The value comes from this section's own schema; TypeScript cannot follow the key.
      return parsed.data as SectionValue<Name>;
    },
    write(section, value) {
      repository.write(section, JSON.stringify(sectionSchemas[section].parse(value)));
    },
  };
}
