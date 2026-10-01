/** The typed settings store: one Zod-validated JSON document per section. */
import {
  chartSettingsSchema,
  defaultModelGateway,
  modelGatewaySchema,
  querySettingsSchema,
  retentionSettingsSchema,
  storedSignInSchema,
} from '@querent/shared';
import { z } from 'zod';
import type { SettingsRepository } from '../db/settings-repository.ts';

/** The schema of every settings section. A section is stored under its name. */
const sectionSchemas = {
  /** The model gateway: the saved providers, the default, the limits and the behaviour. */
  model: modelGatewaySchema,
  /** The key saved before there were several providers, sealed; moved to `model-keys` on read. */
  /** Each provider's API key, sealed and base64-encoded, by provider id. */
  'model-keys': z.object({ sealed: z.record(z.string(), z.string()) }),
  /** Query builders switched off, and the saved queries. The key predates the name. */
  recipes: querySettingsSchema,
  /** Chart recipes switched off. */
  charts: chartSettingsSchema,
  /** How long deleted threads stay in the bin. */
  retention: retentionSettingsSchema,
  /** The sign-in providers, and whether passwords sign in. */
  'sign-in': storedSignInSchema,
  /** Each provider's client id and secret, sealed together, by provider id. */
  'sign-in-credentials': z.object({ sealed: z.record(z.string(), z.string()) }),
};

/** A settings section name. */
type SectionName = keyof typeof sectionSchemas;

/** The value of one settings section. */
type SectionValue<Name extends SectionName> = z.infer<(typeof sectionSchemas)[Name]>;

/** The value of each section before anyone has saved it. */
const sectionDefaults: { readonly [Name in SectionName]: SectionValue<Name> } = {
  model: defaultModelGateway,
  'model-keys': { sealed: {} },
  recipes: { disabled: [], saved: [] },
  charts: { disabled: [] },
  retention: { binDays: 30 },
  'sign-in': { providers: [], passwordSignIn: true },
  'sign-in-credentials': { sealed: {} },
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
