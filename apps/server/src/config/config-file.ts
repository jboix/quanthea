/**
 * The configuration file: `QUERENT_CONFIG` names a file, or a directory whose `*.yaml`, `*.yml`
 * and `*.json` files are read in name order. Each top-level key is a section. A section's keys
 * may be spread over several files, but a key is set in one file only. `${NAME}` in a text value
 * is replaced by the environment variable `NAME`; `$${` writes a literal `${`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** The sections the file may hold. */
export const configSections = ['server'] as const;

/** A section of the file. */
export type ConfigSection = (typeof configSections)[number];

/** The configuration read from the file or files. */
export interface ConfigFile {
  /** The files read, in order. */
  readonly paths: readonly string[];
  /** Each section's keys and values, interpolated. */
  readonly sections: Readonly<Partial<Record<ConfigSection, Readonly<Record<string, unknown>>>>>;
  /** The file each key came from, by `section.key`. */
  readonly origins: Readonly<Record<string, string>>;
}

/** The extensions of configuration files. */
const extensions = new Set(['.yaml', '.yml', '.json']);

/** A `${NAME}` reference, or its `$${` escape. */
const referencePattern = /\$(\$)?\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The files a path names: the file itself, or a directory's configuration files in name order.
 *
 * @param path - The file or directory.
 * @returns The files.
 * @throws {Error} When the path does not exist.
 */
function filesOf(path: string): string[] {
  let directory: boolean;
  try {
    directory = statSync(path).isDirectory();
  } catch {
    throw new Error(`QUERENT_CONFIG names ${path}, which does not exist.`);
  }
  if (!directory) return [path];
  return readdirSync(path)
    .filter((name) => extensions.has(extname(name)))
    .sort()
    .map((name) => join(path, name));
}

/**
 * Parses one file as YAML or JSON.
 *
 * @param path - The file.
 * @returns Its top-level mapping.
 * @throws {Error} When it cannot be read or parsed, or is not a mapping.
 */
function parseFile(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    const text = readFileSync(path, 'utf8');
    parsed = extname(path) === '.json' ? JSON.parse(text) : Bun.YAML.parse(text);
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : error}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${path} must hold a mapping of sections, such as \`server:\`.`);
  return parsed as Record<string, unknown>;
}

/**
 * Replaces `${NAME}` references in every text value.
 *
 * @param value - A parsed value.
 * @param environment - The environment variables.
 * @param missing - Collects the names of unset variables.
 * @returns The value, interpolated.
 */
function interpolate(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>>,
  missing: Set<string>,
): unknown {
  if (typeof value === 'string')
    return value.replace(referencePattern, (reference, escaped, name: string) => {
      if (escaped) return reference.slice(1);
      const found = environment[name];
      if (found === undefined) missing.add(name);
      return found ?? '';
    });
  if (Array.isArray(value)) return value.map((each) => interpolate(each, environment, missing));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, interpolate(each, environment, missing)]),
    );
  return value;
}

/**
 * The mapping of one section of one file.
 *
 * @param path - The file.
 * @param name - The section.
 * @param value - Its parsed value.
 * @returns The section's keys and values.
 * @throws {Error} For an unknown section, or one that is not a mapping.
 */
function sectionOf(path: string, name: string, value: unknown): Record<string, unknown> {
  if (!(configSections as readonly string[]).includes(name))
    throw new Error(
      `${path} has an unknown section \`${name}\`. Known: ${configSections.join(', ')}.`,
    );
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`\`${name}\` in ${path} must be a mapping.`);
  return value as Record<string, unknown>;
}

/**
 * Adds one file's sections to what the earlier files set.
 *
 * @param path - The file.
 * @param parsed - Its parsed sections.
 * @param into - The sections and origins so far, changed in place.
 * @param into.sections - The sections so far.
 * @param into.origins - The file of each key so far.
 * @throws {Error} When a key is already set by another file.
 */
function mergeFile(
  path: string,
  parsed: Record<string, unknown>,
  into: { sections: Record<string, Record<string, unknown>>; origins: Record<string, string> },
): void {
  for (const [name, value] of Object.entries(parsed)) {
    const section = into.sections[name] ?? {};
    into.sections[name] = section;
    for (const [key, each] of Object.entries(sectionOf(path, name, value))) {
      const other = into.origins[`${name}.${key}`];
      if (other) throw new Error(`\`${name}.${key}\` is set in both ${other} and ${path}.`);
      section[key] = each;
      into.origins[`${name}.${key}`] = path;
    }
  }
}

/**
 * Reads the configuration file or directory.
 *
 * @param path - What `QUERENT_CONFIG` names.
 * @param environment - The environment variables, for `${NAME}` references.
 * @returns The configuration.
 * @throws {Error} When a file cannot be read, holds an unknown section, sets a key twice, or
 *   refers to an unset variable.
 */
export function readConfigFile(
  path: string,
  environment: Readonly<Record<string, string | undefined>>,
): ConfigFile {
  const paths = filesOf(path);
  const into = { sections: {}, origins: {} };
  const missing = new Set<string>();
  for (const file of paths) {
    const parsed = interpolate(parseFile(file), environment, missing) as Record<string, unknown>;
    mergeFile(file, parsed, into);
  }
  if (missing.size > 0)
    throw new Error(`The configuration refers to unset variables: ${[...missing].join(', ')}.`);
  return { paths, ...into };
}
