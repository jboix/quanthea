/** How the binder writes each SQL dialect: its literals, its placeholders, and what it refuses. */
import type { SqlDialect, SqlParameter } from '../connectors/_shared/index.ts';
import type { SqlLexicon } from './sql-lexer.ts';
import { clickhouseLexicon } from './sql-lexicon-clickhouse.ts';
import { mysqlLexicon } from './sql-lexicon-mysql.ts';
import { postgresLexicon } from './sql-lexicon-postgres.ts';
import { trinoLexicon } from './sql-lexicon-trino.ts';

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

/** The rules of each dialect. */
export const sqlDialectRules: Readonly<Record<SqlDialect, SqlDialectRules>> = {
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
    lexicon: trinoLexicon,
    placeholder: () => '?',
    numbered: false,
    writtenPlaceholder: /\?/,
    writtenPlaceholderMessage: 'Use named variables such as :service, not ?.',
  },
};
export type { SqlDialect } from '../connectors/_shared/index.ts';
