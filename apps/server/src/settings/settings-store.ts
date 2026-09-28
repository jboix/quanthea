/** The typed settings store: one Zod-validated JSON document per section. */
import { authModeSchema, defaultModelSettings, modelSettingsSchema } from '@querent/shared';
import { z } from 'zod';
import type { SettingsRepository } from '../db/settings-repository.ts';

/** The schema of every settings section. A section is stored under its name. */
const sectionSchemas = {
  auth: z.object({ mode: authModeSchema }),
  model: modelSettingsSchema,
  /** The model gateway's API key, sealed and base64-encoded, or `null`. */
  'model-key': z.object({ sealed: z.string().nullable() }),
};

/** A settings section name. */
type SectionName = keyof typeof sectionSchemas;

/** The value of one settings section. */
type SectionValue<Name extends SectionName> = z.infer<(typeof sectionSchemas)[Name]>;

/** The value of each section before anyone has saved it. */
const sectionDefaults: { readonly [Name in SectionName]: SectionValue<Name> } = {
  auth: { mode: 'none' },
  model: defaultModelSettings,
  'model-key': { sealed: null },
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
