/**
 * What the generated plugin says about each query language: its name, a starting query guide for
 * the agent, and a valid and an invalid bound query for the conformance fixture. All of it is
 * source text the templates write as is, already laid out as Biome formats it.
 */
import type { QueryLanguage } from '@quanthea/plugin-kit/contract';

/** The text a template writes for one language. */
export interface LanguageText {
  /** The language's name in a sentence. */
  readonly title: string;
  /** A first query guide, one line per shape of answer. */
  readonly guide: string;
  /** A bound query the source answers, as TypeScript. */
  readonly query: string;
  /** A bound query the source refuses, as TypeScript. */
  readonly invalidQuery: string;
}

/**
 * An HTTP fixture query, laid out over several lines as Biome writes an object this long.
 *
 * @param path - The request path, also where the rows are.
 * @returns The query, as TypeScript.
 */
function httpQuery(path: string): string {
  const fields = [
    "language: 'http'",
    "method: 'GET'",
    `path: '${path}'`,
    'query: []',
    `extract: { rows: '${path}' }`,
  ];
  const lines = fields.map((field) => `    ${field},\n`).join('');
  return `{\n${lines}  }`;
}

/** The text for each language. */
export const languageText: Readonly<Record<QueryLanguage, LanguageText>> = {
  sql: {
    title: 'SQL',
    guide:
      '- single: SELECT count(*) AS value FROM orders WHERE created_at BETWEEN :__from AND :__to.',
    query: "{ language: 'sql', text: 'SELECT 1 AS value', parameters: [] }",
    invalidQuery: "{ language: 'sql', text: 'SELECT nope FROM nowhere', parameters: [] }",
  },
  promql: {
    title: 'PromQL',
    guide: '- long over time: sum by (job) (rate(http_requests_total[$__rate_interval])).',
    query: "{ language: 'promql', expr: 'up', instant: false, stepSeconds: 60 }",
    invalidQuery: "{ language: 'promql', expr: 'up{', instant: false, stepSeconds: 60 }",
  },
  search: {
    title: 'the Elasticsearch query DSL',
    guide: '- long by category: a terms aggregation on a keyword field, size 10.',
    query: "{ language: 'search', index: 'logs', body: { query: { match_all: {} } } }",
    invalidQuery: "{ language: 'search', index: 'logs', body: { query: { nope: {} } } }",
  },
  logql: {
    title: 'LogQL',
    guide: '- long over time: sum by (level) (count_over_time({app="web"}[$__interval])).',
    query: "{ language: 'logql', expr: '{app=\"web\"}', instant: false, stepSeconds: 60 }",
    invalidQuery: "{ language: 'logql', expr: '{app=', instant: false, stepSeconds: 60 }",
  },
  http: {
    title: 'HTTP JSON requests',
    guide: '- rows: GET /items, rows at /items, one field per JSON pointer.',
    query: httpQuery('/items'),
    invalidQuery: httpQuery('/nope'),
  },
  redis: {
    title: 'Redis commands',
    guide: '- single: GET a counter key; rows: HGETALL a hash.',
    query: "{ language: 'redis', command: 'GET', args: ['visits'] }",
    invalidQuery: "{ language: 'redis', command: 'NOPE', args: [] }",
  },
  mongodb: {
    title: 'MongoDB aggregation pipelines',
    guide: '- long by category: $match on the time range, $group by a field with $sum: 1.',
    query: "{ language: 'mongodb', collection: 'events', pipeline: [{ $limit: 10 }] }",
    invalidQuery: "{ language: 'mongodb', collection: 'events', pipeline: [{ $nope: 1 }] }",
  },
};
