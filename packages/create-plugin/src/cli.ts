/**
 * `npm create @quanthea/plugin`: asks what the plugin is, then writes its project. Flags answer
 * questions without a prompt; `--yes` takes the defaults for the rest. It runs on Node, from npm,
 * npx or bunx, so it uses no Bun API.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createPlugin, type Versions } from './generate.ts';
import { type Draft, type Field, UsageError } from './questions.ts';

/** What `--help` prints. */
const usage = `Creates a quanthea plugin project.

Usage: npm create @quanthea/plugin -- [options]

Options:
  --name <name>            the npm package name: quanthea-plugin-<name> or @scope/quanthea-plugin-<name>
  --kind <id>              the connector kind identifier
  --display-name <name>    the kind's name in the interface
  --language <language>    sql, promql, search, logql, http, redis or mongodb
  --dialect <dialect>      for SQL: postgres, mysql, clickhouse, trino, influxdb or ansi
  --placeholders <style>   for ansi: ?, $1, :1 or @p1
  --row-limit <style>      for ansi: fetch or limit
  --author <name>          the licence's copyright holder
  --dir <folder>           where to write the project (the package name without its scope)
  --kit <spec>             the @quanthea/plugin-kit dependency (the newest on npm)
  --yes                    take the defaults instead of asking
  --help                   print this
`;

/** The defaults written at build time: the tool versions and the kit version then. */
interface Defaults extends Versions {
  /** The kit version when this generator was built, for when npm cannot be reached. */
  readonly kit: string;
}

/**
 * Reads the defaults written next to this file at build time.
 *
 * @returns The defaults.
 */
function readDefaults(): Defaults {
  return JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'));
}

/**
 * The newest kit version on npm, as a caret range, or the one this generator was built with.
 *
 * @param fallback - The version this generator was built with.
 * @returns The dependency range.
 */
async function newestKit(fallback: string): Promise<string> {
  try {
    const url = 'https://registry.npmjs.org/@quanthea/plugin-kit/latest';
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const { version } = (await response.json()) as { version?: unknown };
    return `^${typeof version === 'string' ? version : fallback}`;
  } catch {
    return `^${fallback}`;
  }
}

/**
 * The git user name, the licence's default holder, when git knows one.
 *
 * @returns The name, if any.
 */
function gitUserName(): string | undefined {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the flags.
 *
 * @param argv - The arguments after the command.
 * @returns The flags, by name.
 */
function readFlags(argv: string[]) {
  const text = { type: 'string' } as const;
  const options = {
    name: text,
    kind: text,
    'display-name': text,
    language: text,
    dialect: text,
    placeholders: text,
    'row-limit': text,
    author: text,
    dir: text,
    kit: text,
    yes: { type: 'boolean' },
    help: { type: 'boolean' },
  } as const;
  return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
}

/**
 * The answers the flags give.
 *
 * @param flags - The flags.
 * @returns The answers, by field.
 */
function draftOf(flags: ReturnType<typeof readFlags>): Draft {
  const draft: Record<Field, string | undefined> = {
    name: flags.name,
    kind: flags.kind,
    displayName: flags['display-name'],
    language: flags.language,
    dialect: flags.dialect,
    placeholders: flags.placeholders,
    rowLimit: flags['row-limit'],
    author: flags.author,
  };
  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value !== undefined),
  ) as Draft;
}

/**
 * Generates a project from the flags and the answers, then says what to run next.
 *
 * @param argv - The arguments after the command.
 * @returns The exit code.
 */
async function main(argv: string[]): Promise<number> {
  const flags = readFlags(argv);
  if (flags.help) {
    process.stdout.write(usage);
    return 0;
  }
  const defaults = readDefaults();
  if (!flags.yes)
    process.stdout.write(
      'Creating a quanthea plugin. Press Enter to keep the answer shown in brackets.\n\n',
    );
  const { folder, answers } = await createPlugin(draftOf(flags), {
    templates: fileURLToPath(new URL('./templates', import.meta.url)),
    cwd: process.cwd(),
    dir: flags.dir,
    kit: flags.kit ?? (await newestKit(defaults.kit)),
    versions: defaults,
    year: new Date().getFullYear(),
    gitName: gitUserName(),
    interactive: !flags.yes,
  });
  const where = relative(process.cwd(), folder) || '.';
  process.stdout.write(
    `\nCreated ${answers.name} in ${where}. It needs Bun (https://bun.sh):\n\n  cd ${where}\n  bun install\n  bun run verify\n\n`,
  );
  return 0;
}

/**
 * Whether an error is the person's: a refused answer or flag, not a failure of the generator.
 *
 * @param error - The error.
 * @returns Whether to point at `--help`.
 */
function isUsageError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    error instanceof UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'))
  );
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const usageError = isUsageError(error);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n${usageError ? 'Run with --help.\n' : ''}`);
  process.exitCode = usageError ? 2 : 1;
}
