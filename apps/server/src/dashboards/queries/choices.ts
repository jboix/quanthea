/**
 * Which query builder gives what a panel shows, in each language that has one, and what a raw
 * query returns where none does. The agent's guide renders it for the builders a thread may use,
 * so the choice of a builder is read from a table rather than left to habit.
 */
import {
  type BuilderLanguage,
  builderLanguages,
  type QueryLanguage,
  type ShapeKind,
} from '@quanthea/shared';

/** One thing a panel may show, and how to get it. */
export interface Choice {
  /** What the panel shows, in a few words. */
  readonly want: string;
  /** The shape of the data that shows it. */
  readonly shape: ShapeKind;
  /** The builder that gives it, by language; a language left out has none. */
  readonly builders: Partial<Record<BuilderLanguage, string>>;
  /** What a raw query returns for it, where no builder fits. */
  readonly otherwise: string;
}

/** The choices, from the most asked for. */
export const choices: readonly Choice[] = [
  {
    want: 'a count or a rate over time',
    shape: 'long',
    builders: {
      promql: 'rate',
      sql: 'sql-series',
      search: 'search-series',
      logql: 'logql-series',
      mongodb: 'mongodb-series',
    },
    otherwise: 'a row per time bucket',
  },
  {
    want: 'a level over time',
    shape: 'long',
    builders: {
      promql: 'gauge',
      sql: 'sql-series',
      search: 'search-series',
      logql: 'logql-series',
      mongodb: 'mongodb-series',
    },
    otherwise: 'a row per time bucket',
  },
  {
    want: 'a share of a total',
    shape: 'long',
    builders: {
      promql: 'ratio',
      sql: 'sql-ratio',
      search: 'search-ratio',
      logql: 'logql-ratio',
      mongodb: 'mongodb-ratio',
    },
    otherwise: 'matching over all, from 0 to 1',
  },
  {
    want: 'percentiles over time',
    shape: 'long',
    builders: {
      promql: 'latency',
      search: 'search-series',
      logql: 'logql-series',
      mongodb: 'mongodb-series',
    },
    otherwise: 'a series per percentile',
  },
  {
    want: 'by a category, largest first',
    shape: 'long',
    builders: {
      promql: 'top',
      sql: 'sql-breakdown',
      search: 'search-breakdown',
      logql: 'logql-breakdown',
      mongodb: 'mongodb-breakdown',
    },
    otherwise: 'grouped, largest first, with a limit',
  },
  {
    want: 'one number',
    shape: 'single',
    builders: {
      sql: 'sql-stat',
      search: 'search-stat',
      logql: 'logql-stat',
      mongodb: 'mongodb-stat',
    },
    otherwise: 'one row, "instant" in PromQL',
  },
  {
    want: 'how a number spreads',
    shape: 'long',
    builders: { search: 'search-histogram', mongodb: 'mongodb-histogram' },
    otherwise: 'a count per bin',
  },
  {
    want: 'the latest rows',
    shape: 'rows',
    builders: {
      sql: 'sql-rows',
      search: 'search-rows',
      logql: 'logql-lines',
      mongodb: 'mongodb-rows',
    },
    otherwise: 'newest first',
  },
];

/**
 * One choice as the guide writes it: its builders among those offered, and what a raw query
 * returns when a language in use that has builders offers none for it.
 *
 * @param choice - The choice.
 * @param offered - The builders the thread may use.
 * @param languages - The query languages of the connectors in use.
 * @returns Such as `- one number (single): sql-stat; else raw: one row`, or nothing when no
 *   builder of the choice is offered.
 */
function choiceLine(
  choice: Choice,
  offered: readonly string[],
  languages: readonly QueryLanguage[],
): string[] {
  const inUse = builderLanguages.filter((language) => languages.includes(language));
  const fits = (language: BuilderLanguage) => offered.includes(choice.builders[language] ?? '');
  const ids = builderLanguages.filter(fits).map((language) => choice.builders[language]);
  if (ids.length === 0) return [];
  const raw = inUse.every(fits) ? '' : `; else raw: ${choice.otherwise}`;
  return [`- ${choice.want} (${choice.shape}): ${ids.join(', ')}${raw}`];
}

/**
 * The choices a thread has, one line each, for the guide.
 *
 * @param offered - The builders the thread may use.
 * @param languages - The query languages of the connectors in use.
 * @returns The lines, without the choices none of its builders gives.
 */
export function choiceLines(
  offered: readonly string[],
  languages: readonly QueryLanguage[],
): string[] {
  return choices.flatMap((choice) => choiceLine(choice, offered, languages));
}
