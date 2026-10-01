/**
 * The query builders: common queries written from a few fields, in each language that has them.
 * Each returns a table of a known shape, which any chart for that shape can draw.
 */

/** The query languages that have builders, in the order the queries screen lists them. */
export const builderLanguages = ['promql', 'sql', 'search', 'logql', 'mongodb'] as const;

/** A query language that has builders. */
export type BuilderLanguage = (typeof builderLanguages)[number];

/** A query builder as the queries screen and the agent's guide describe it. */
export interface QueryBuilder {
  /** The id the agent names it by. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** The query language it writes. */
  readonly language: BuilderLanguage;
  /** What it returns, in one sentence. */
  readonly description: string;
}

/** The built-in queries. */
export const queryBuilders: readonly QueryBuilder[] = [
  {
    id: 'rate',
    name: 'Rate',
    language: 'promql',
    description: 'A counter per second, such as requests per second.',
  },
  {
    id: 'ratio',
    name: 'Ratio',
    language: 'promql',
    description:
      'The share of a counter that also matches "match", such as 5xx over all requests: error rates.',
  },
  {
    id: 'latency',
    name: 'Latency percentiles',
    language: 'promql',
    description: 'Percentiles of a histogram, with or without _bucket, such as p50, p95 and p99.',
  },
  {
    id: 'gauge',
    name: 'Gauge',
    language: 'promql',
    description: 'A current value, aggregated, such as memory in use.',
  },
  {
    id: 'top',
    name: 'Top values',
    language: 'promql',
    description: "A counter's largest totals over the range, by label, largest first.",
  },
  {
    id: 'sql-series',
    name: 'SQL over time',
    language: 'sql',
    description: 'A measure over time in buckets, one series per value of "by".',
  },
  {
    id: 'sql-breakdown',
    name: 'SQL breakdown',
    language: 'sql',
    description: 'A measure by the values of a column, largest first.',
  },
  {
    id: 'sql-stat',
    name: 'SQL number',
    language: 'sql',
    description: 'One number over the range, such as failed orders.',
  },
  {
    id: 'sql-rows',
    name: 'Latest rows',
    language: 'sql',
    description: 'The latest rows of a table, newest first.',
  },
  {
    id: 'sql-ratio',
    name: 'SQL ratio',
    language: 'sql',
    description:
      'The share of rows matching "match" among those matching "of", such as failed orders, over time or over the range.',
  },
  {
    id: 'search-series',
    name: 'Search over time',
    language: 'search',
    description:
      'A count or a metric of documents over time, such as events per minute or a median duration, one series per value of "by".',
  },
  {
    id: 'search-ratio',
    name: 'Search ratio',
    language: 'search',
    description:
      'The share of documents matching "match" among those matching "of", such as an error or success rate, over time or over the range.',
  },
  {
    id: 'search-breakdown',
    name: 'Search breakdown',
    language: 'search',
    description:
      'A count or a metric by the values of a field, largest first, such as errors by type.',
  },
  {
    id: 'search-stat',
    name: 'Search number',
    language: 'search',
    description: 'One count or metric over the range, such as sessions started.',
  },
  {
    id: 'search-histogram',
    name: 'Search histogram',
    language: 'search',
    description: 'How the values of a numeric field spread, in bins, such as load times.',
  },
  {
    id: 'search-rows',
    name: 'Latest documents',
    language: 'search',
    description: 'The latest documents of an index, newest first, such as the last errors.',
  },
  {
    id: 'logql-series',
    name: 'Logs over time',
    language: 'logql',
    description:
      'Lines counted, a rate, or a number read from the lines (a duration, a size) over time, one series per label value.',
  },
  {
    id: 'logql-ratio',
    name: 'Logs ratio',
    language: 'logql',
    description:
      'The share of lines that also match, such as error lines, over time or over the range.',
  },
  {
    id: 'logql-breakdown',
    name: 'Logs breakdown',
    language: 'logql',
    description:
      'Lines or a number by label over the range, largest first, such as timeouts by service.',
  },
  {
    id: 'logql-stat',
    name: 'Logs number',
    language: 'logql',
    description: 'One count or number over the range, such as error lines.',
  },
  {
    id: 'logql-lines',
    name: 'Latest lines',
    language: 'logql',
    description: 'The latest log lines, newest first, with their labels.',
  },
  {
    id: 'mongodb-series',
    name: 'MongoDB over time',
    language: 'mongodb',
    description:
      'A count or a measure of documents over time, one series per value of "by", such as orders per country.',
  },
  {
    id: 'mongodb-ratio',
    name: 'MongoDB ratio',
    language: 'mongodb',
    description:
      'The share of documents matching "match" among those matching "of", such as a failure rate, over time or over the range.',
  },
  {
    id: 'mongodb-breakdown',
    name: 'MongoDB breakdown',
    language: 'mongodb',
    description: 'A count or a measure by the values of a field, largest first.',
  },
  {
    id: 'mongodb-stat',
    name: 'MongoDB number',
    language: 'mongodb',
    description: 'One count or measure over the range, such as revenue.',
  },
  {
    id: 'mongodb-histogram',
    name: 'MongoDB histogram',
    language: 'mongodb',
    description: 'How the values of a numeric field spread, in bins, such as order totals.',
  },
  {
    id: 'mongodb-rows',
    name: 'Latest MongoDB documents',
    language: 'mongodb',
    description: 'The latest documents of a collection, newest first.',
  },
];
