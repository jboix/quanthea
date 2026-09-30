/** How the binder writes each SQL dialect: its literals, and its placeholders. */
import type { SqlDialect } from '../connectors/_shared/index.ts';
import type { SqlLexicon } from './sql-lexer.ts';
import { mysqlLexicon } from './sql-lexicon-mysql.ts';
import { postgresLexicon } from './sql-lexicon-postgres.ts';

/** What the binder needs to know of a dialect. */
export interface SqlDialectRules {
  /** How it writes its literals. */
  readonly lexicon: SqlLexicon;
  /**
   * The placeholder of one parameter.
   *
   * @param position - The parameter's position, from 1.
   * @returns Such as `$1` or `?`.
   */
  placeholder(position: number): string;
  /** Whether a placeholder names its position, so a variable used twice binds once. */
  readonly numbered: boolean;
  /** A placeholder a template writes itself, which templates may not do. */
  readonly writtenPlaceholder: RegExp;
  /** Why a written placeholder is refused. */
  readonly writtenPlaceholderMessage: string;
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
};
export type { SqlDialect } from '../connectors/_shared/index.ts';
