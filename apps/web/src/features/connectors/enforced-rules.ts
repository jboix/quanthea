/**
 * The rules the server enforces on every query of a language, whatever the connector's settings.
 * Each sentence says what the query binder of that language refuses. Nobody can turn one off:
 * allowing a script that reads documents, a write or a second statement would run text a model
 * wrote on the data source. A search has one rule that follows a setting: what a `bucket_script`
 * and a `bucket_selector` may hold, which receive bucket numbers and no document.
 */
import type { QueryLanguage } from '@quanthea/shared';

/** One rule the server always enforces. */
export interface EnforcedRule {
  /** The rule, in a few words. */
  readonly rule: string;
  /** One sentence of what it stops. */
  readonly stops: string;
}

/** Where a PromQL or LogQL expression goes. */
const queryEndpoints =
  "An expression goes to the source's query endpoints, which evaluate it and change nothing.";

/** A variable in a quoted value or a duration, as PromQL and LogQL bind it. */
const quotedValues =
  'A variable is replaced only inside a quoted value, escaped for it, or as a checked duration, so a value never becomes part of the expression.';

/** A variable in a JSON template, as the search, HTTP and MongoDB binders place it. */
const jsonValues =
  'A variable is replaced by a JSON value, never by text inside the query, so a value never becomes part of it.';

/** The rules of each query language, in the order the screen lists them. */
const rulesByLanguage: Readonly<Record<QueryLanguage, readonly EnforcedRule[]>> = {
  sql: [
    {
      rule: 'One statement',
      stops:
        'A second statement after a semicolon is refused, so nothing rides along with a query.',
    },
    {
      rule: 'Reads only',
      stops:
        'A query starts with SELECT, WITH, VALUES or TABLE, and a keyword that writes or changes the schema, such as INSERT, UPDATE, DROP or INTO, is refused.',
    },
    {
      rule: 'No way out of the tables',
      stops:
        "A function that reads or writes the server's files, reaches another server, runs a program or runs text as SQL, such as pg_read_file, dblink, LOAD_FILE or url(), is refused, because a read-only session does not stop it.",
    },
    {
      rule: 'Values are bound',
      stops:
        'A variable reaches the database as a parameter, never as SQL text, so a value never becomes part of the statement.',
    },
  ],
  promql: [
    { rule: 'Query endpoints only', stops: queryEndpoints },
    { rule: 'Values stay values', stops: quotedValues },
  ],
  logql: [
    { rule: 'Query endpoints only', stops: queryEndpoints },
    {
      rule: 'No formatting templates',
      stops:
        'line_format and label_format are refused, because the source runs the template they hold.',
    },
    { rule: 'Values stay values', stops: quotedValues },
  ],
  search: [
    {
      rule: 'No scripts that read documents',
      stops:
        'script_fields, scripted_metric, a script query, sort or score, a scripted terms, a stored script and any other script key are refused whatever the settings, because such a script reads documents and so goes around hidden fields and access levels.',
    },
    {
      rule: 'No runtime fields',
      stops:
        'runtime_mappings is refused, because a runtime field runs a script for each document.',
    },
    {
      rule: 'No lookups of another index',
      stops:
        'A terms lookup, an indexed shape, a percolator and a document list that names an _index are refused, so a query reads only the index it names.',
    },
    {
      rule: 'No wrapped queries',
      stops:
        'A wrapper query is refused, because it hides a query in base64 where no check can read it.',
    },
    {
      rule: 'Index names only',
      stops:
        'An index name that starts with _, names another cluster with a colon, holds a slash, a % or a ?, or is dots alone is refused, so a query reaches the search endpoint of its indices and no other.',
    },
    { rule: 'Values are bound', stops: jsonValues },
  ],
  http: [
    {
      rule: 'One origin',
      stops:
        'Requests go to the base URL only, and a redirect to another origin or to a cloud metadata address is refused.',
    },
    {
      rule: 'Allowed methods and paths only',
      stops:
        'A request whose method or path the connection does not allow is refused, and so is a redirect to such a path; both are set under Edit connection.',
    },
    {
      rule: 'No path tricks',
      stops:
        'A path with a . or .. segment, also between encoded slashes, a ?, a #, a backslash or a control character is refused, so it cannot leave the allowed paths.',
    },
    {
      rule: 'Values are bound',
      stops:
        'A variable is URL-encoded in the path and a JSON value in the body, and a header takes none, so a value never changes where a request goes.',
    },
  ],
  redis: [
    {
      rule: 'Read commands only',
      stops:
        'A command outside the fixed list of reads, such as SET, DEL, KEYS, SCAN or EVAL, is refused, so nothing writes, scans every key or runs a script.',
    },
    {
      rule: 'Values stay arguments',
      stops:
        'Each argument reaches the server as one argument whatever it holds, so a value never becomes a command.',
    },
  ],
  mongodb: [
    {
      rule: 'No writes',
      stops:
        '$out and $merge are refused anywhere in a pipeline, so a query never writes a collection.',
    },
    {
      rule: 'No JavaScript',
      stops: '$where, $function and $accumulator are refused, because they run code on the server.',
    },
    {
      rule: 'No server internals',
      stops:
        "A stage that waits for changes or reads the server's operations, sessions, queries, plans, catalog or statistics is refused.",
    },
    {
      rule: 'One database',
      stops:
        "Every collection a pipeline reads, through $lookup, $graphLookup and $unionWith too, is in the connector's database.",
    },
    {
      rule: 'Values are bound',
      stops:
        'A variable is replaced by a JSON value, and one that starts with $ goes in $literal, so a value is never read as a field.',
    },
  ],
};

/** What a search's two bucket aggregations may hold, by whether the connector allows scripts there. */
const bucketScriptRules: Readonly<Record<'off' | 'on', EnforcedRule>> = {
  off: {
    rule: 'Ratio scripts only',
    stops:
      'A bucket_script names one of the two fixed ratio scripts and a bucket_selector is refused, since bucket scripts are off for this connector.',
  },
  on: {
    rule: 'Bucket scripts are one short expression',
    stops:
      'A script in bucket_script or bucket_selector is written in the query, short, and one arithmetic expression over the buckets it names in buckets_path, with no statement, loop, string or stored script, so it reads bucket numbers only and cannot exhaust the search server.',
  },
};

/** The settings of a connector that a rule follows. */
interface RuleSettings {
  /** Whether the connector allows bucket scripts. */
  readonly bucketScripts?: boolean;
}

/**
 * The rules always enforced on a query language.
 *
 * @param language - The query language of the connector's kind, if its kind is offered.
 * @param settings - The connector's settings a rule follows: whether it allows bucket scripts.
 * @returns The rules, or none for a language this screen does not know.
 */
export function enforcedRules(
  language: string | undefined,
  settings: RuleSettings = {},
): readonly EnforcedRule[] {
  const rules = rulesByLanguage[language as QueryLanguage] ?? [];
  if (language !== 'search') return rules;
  const [first, ...rest] = rules;
  const scripts = bucketScriptRules[settings.bucketScripts ? 'on' : 'off'];
  return first ? [first, scripts, ...rest] : rules;
}
