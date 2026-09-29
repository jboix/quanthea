/**
 * The system settings: the address, ports, directories, logging and keys the server runs with.
 * They come from environment variables or the configuration file's `server` section, never from
 * the interface, which shows them read-only with where each comes from.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Where a system setting's value comes from. */
export const settingSourceSchema = z.discriminatedUnion('kind', [
  /** An environment variable. */
  z.object({ kind: z.literal('environment'), variable: z.string() }),
  /** The configuration file at this path. */
  z.object({ kind: z.literal('file'), path: z.string() }),
  /** A key querent generated in this file. */
  z.object({ kind: z.literal('generated'), path: z.string() }),
  /** querent's default. */
  z.object({ kind: z.literal('default') }),
]);

/** Where a system setting's value comes from. */
export type SettingSource = z.infer<typeof settingSourceSchema>;

/** Validates one system setting as the interface shows it. */
const serverSettingSchema = z.object({
  /** Its key in the file's `server` section. */
  key: z.string(),
  /** What it is, in words. */
  label: z.string(),
  /** Its value as text, or `null` when it is not set. */
  value: z.string().nullable(),
  /** Where the value comes from. */
  source: settingSourceSchema,
  /** The environment variable that sets it. */
  variable: z.string(),
});

/** Validates one key as the interface shows it: where it comes from, never its value. */
const serverKeySchema = z.object({
  /** What the key is for, in words. */
  label: z.string(),
  /** Where it comes from. */
  source: settingSourceSchema,
  /** The file a variable names, for a key read from a file. */
  file: z.string().nullable(),
});

/** Validates the system settings view. */
export const serverSettingsSchema = z.object({
  /** The configuration files read, in order; empty when there are none. */
  configFiles: z.array(z.string()),
  /** The settings. */
  settings: z.array(serverSettingSchema),
  /** The keys. */
  keys: z.array(serverKeySchema),
});

/** The system settings view. */
export type ServerSettingsView = z.infer<typeof serverSettingsSchema>;

/** Validates which settings sections the configuration file manages. */
export const managedSettingsSchema = z.object({
  /** The file that manages each section, by section: `model`, `retention`, `charts`, `queries`. */
  sections: z.record(z.string(), z.string()),
  /** Why the last change to the file was not applied, or `null` when it was. */
  problem: z.string().nullable(),
  /** The system settings changed in the file since startup, which apply at the next restart. */
  restartNeeded: z.array(z.string()),
});

/** Which settings sections the configuration file manages. */
export type ManagedSettings = z.infer<typeof managedSettingsSchema>;

/** Which settings sections the configuration file manages, so the interface shows them read-only. */
export const getManagedSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/managed',
  output: managedSettingsSchema,
});

/** The system settings, read-only, for admins. */
export const getServerSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/server',
  output: serverSettingsSchema,
});
