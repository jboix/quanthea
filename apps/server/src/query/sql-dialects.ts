/** How the binder writes each SQL dialect: its literals, its placeholders, and what it refuses. */
import type {
  SqlDialect,
  SqlParameter,
  SqlPlaceholderStyle,
  SqlRowLimit,
} from '../connectors/_shared/index.ts';
import type { SqlLexicon } from './sql-lexer.ts';
import { clickhouseLexicon } from './sql-lexicon-clickhouse.ts';
import { mysqlLexicon } from './sql-lexicon-mysql.ts';
import { postgresLexicon } from './sql-lexicon-postgres.ts';
import { standardLexicon } from './sql-lexicon-standard.ts';

/** What the binder needs to know of a dialect. */
export interface SqlDialectRules {
  /** How it writes its literals. */
  readonly lexicon: SqlLexicon;
  /**
   * The placeholder of one parameter.
   *
   * @param position - The parameter's position, from 1.
   * @param value - The parameter's value, for a dialect whose placeholders carry a type.
   * @returns Such as `$1`, `?` or `{p1:String}`.
   */
  placeholder(position: number, value: SqlParameter): string;
  /** Whether a placeholder names its position, so a variable used twice binds once. */
  readonly numbered: boolean;
  /** A placeholder a template writes itself, which templates may not do. */
  readonly writtenPlaceholder: RegExp;
  /** Why a written placeholder is refused. */
  readonly writtenPlaceholderMessage: string;
  /** A keyword the dialect refuses in code, with the reason. */
  readonly forbidden?: { readonly keyword: RegExp; readonly message: string };
}

/**
 * The ClickHouse type of a parameter, which its placeholder names.
 *
 * @param value - The value.
 * @returns The type.
 */
function clickhouseType(value: SqlParameter): string {
  if (value === null) return 'Nullable(String)';
  if (value instanceof Date) return "DateTime64(3, 'UTC')";
  if (typeof value === 'number') return 'Float64';
  return typeof value === 'boolean' ? 'Bool' : 'String';
}

/** A standard SQL source: its placeholder style and how it limits rows. */
export interface AnsiFlavor {
  /** The dialect. */
  readonly dialect: 'ansi';
  /** How it writes a placeholder. */
  readonly placeholders: SqlPlaceholderStyle;
  /** How it limits rows. */
  readonly rowLimit: SqlRowLimit;
}

/**
 * How a connector's SQL is written: a built-in dialect by name, or standard SQL with the kind's
 * placeholder and row-limit styles.
 */
export type SqlFlavor = Exclude<SqlDialect, 'ansi'> | AnsiFlavor;

/**
 * The flavor of a connector kind's SQL.
 *
 * @param kind - The kind's dialect and, for `ansi`, its styles.
 * @returns The flavor, or `undefined` for a kind that runs no SQL.
 */
export function sqlFlavorOf(kind: {
  readonly dialect?: SqlDialect | undefined;
  readonly placeholders?: SqlPlaceholderStyle | undefined;
  readonly rowLimit?: SqlRowLimit | undefined;
}): SqlFlavor | undefined {
  if (kind.dialect !== 'ansi') return kind.dialect;
  return {
    dialect: 'ansi',
    placeholders: kind.placeholders ?? '?',
    rowLimit: kind.rowLimit ?? 'fetch',
  };
}

/**
 * What standard SQL refuses beyond writes: statements and a function that reach other files from a
 * read-only connection. SQLite attaches an existing file and reads it, and VACUUM INTO creates
 * one, even when the connection is read-only. The pragma_*() table functions stay allowed: they
 * only read.
 */
const ansiForbidden = {
  keyword: /\b(attach|detach|vacuum|pragma|load_extension)\b/i,
  message:
    'A query cannot attach, detach or vacuum a database, set a pragma or load an extension. Quote an identifier with that name.',
};

/** What sets an ansi source's placeholders apart, by style. */
const ansiPlaceholders: Readonly<
  Record<SqlPlaceholderStyle, Omit<SqlDialectRules, 'lexicon' | 'forbidden'>>
> = {
  '?': {
    placeholder: () => '?',
    numbered: false,
    writtenPlaceholder: /\?/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not ?.',
  },
  $1: {
    placeholder: (position) => `$${position}`,
    numbered: true,
    writtenPlaceholder: /(?<![A-Za-z0-9_$])\$\d+/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not $1.',
  },
  ':1': {
    placeholder: (position) => `:${position}`,
    numbered: true,
    writtenPlaceholder: /(?<![A-Za-z0-9_:]):\d+/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not :1.',
  },
  '@p1': {
    placeholder: (position) => `@p${position}`,
    numbered: true,
    writtenPlaceholder: /@p\d+/i,
    writtenPlaceholderMessage: 'Use named variables such as :service, not @p1.',
  },
};

/**
 * The binder's rules for a flavor: a built-in dialect's, or standard SQL's with its placeholders.
 *
 * @param flavor - The flavor.
 * @returns The rules.
 */
export function rulesOf(flavor: SqlFlavor): SqlDialectRules {
  if (typeof flavor === 'string') return sqlDialectRules[flavor];
  return {
    lexicon: standardLexicon,
    ...ansiPlaceholders[flavor.placeholders],
    forbidden: ansiForbidden,
  };
}

/** The rules of each built-in dialect. */
const sqlDialectRules: Readonly<Record<Exclude<SqlDialect, 'ansi'>, SqlDialectRules>> = {
  postgres: {
    lexicon: postgresLexicon,
    placeholder: (position) => `$${position}`,
    numbered: true,
    writtenPlaceholder: /(?<![A-Za-z0-9_$])\$\d+/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not $1.',
  },
  mysql: {
    lexicon: mysqlLexicon,
    placeholder: () => '?',
    numbered: false,
    writtenPlaceholder: /\?/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not ?.',
  },
  clickhouse: {
    lexicon: clickhouseLexicon,
    placeholder: (position, value) => `{p${position}:${clickhouseType(value)}}`,
    numbered: true,
    writtenPlaceholder: /\{/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not {name:Type}.',
    // A SETTINGS clause could lift the connector's row cap and timeout.
    forbidden: {
      keyword: /\bSETTINGS\b/i,
      message:
        'A query cannot change settings; "SETTINGS" is not allowed. Quote an identifier with that name.',
    },
  },
  // InfluxDB 3 lexes SQL as PostgreSQL does, and names its parameters.
  influxdb: {
    lexicon: postgresLexicon,
    placeholder: (position) => `$p${position}`,
    numbered: true,
    writtenPlaceholder: /(?<![A-Za-z0-9_$])\$(?:\d|[A-Za-z_])/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not $name.',
  },
  trino: {
    lexicon: standardLexicon,
    placeholder: () => '?',
    numbered: false,
    writtenPlaceholder: /\?/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not ?.',
  },
};

export type { SqlDialect } from '../connectors/_shared/index.ts';
