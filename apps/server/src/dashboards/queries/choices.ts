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
  /** What else its builders give, said after them. */
  readonly also?: string;
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
    also: 'one value (single) with "over": "range", where the builder takes it',
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
 * returns when a language in use that has builders offers none for it. A choice none of whose
 * builders is offered keeps its line, as a raw query, so its hint is not lost.
 *
 * @param choice - The choice.
 * @param offered - The builders the thread may use.
 * @param languages - The query languages of the connectors in use.
 * @returns Such as `- one number (single): sql-stat; else raw: one row`, or
 *   `- how a number spreads (long): raw: a count per bin`.
 */
function choiceLine(
  choice: Choice,
  offered: readonly string[],
  languages: readonly QueryLanguage[],
): string {
  const inUse = builderLanguages.filter((language) => languages.includes(language));
  const fits = (language: BuilderLanguage) => offered.includes(choice.builders[language] ?? '');
  const ids = builderLanguages.filter(fits).map((language) => choice.builders[language]);
  const head = `- ${choice.want} (${choice.shape}):`;
  if (ids.length === 0) return `${head} raw: ${choice.otherwise}`;
  const also = choice.also ? `; ${choice.also}` : '';
  const raw = inUse.every(fits) ? '' : `; else raw: ${choice.otherwise}`;
  return `${head} ${ids.join(', ')}${also}${raw}`;
}

/**
 * The choices a thread has, one line each, for the guide.
 *
 * @param offered - The builders the thread may use.
 * @param languages - The query languages of the connectors in use.
 * @returns A line per choice, or none when the thread may use no builder of any choice: its
 *   guide then says every panel's data is a raw query.
 */
export function choiceLines(
  offered: readonly string[],
  languages: readonly QueryLanguage[],
): string[] {
  const named = choices.flatMap((choice) => Object.values(choice.builders));
  if (!named.some((id) => offered.includes(id))) return [];
  return choices.map((choice) => choiceLine(choice, offered, languages));
}
