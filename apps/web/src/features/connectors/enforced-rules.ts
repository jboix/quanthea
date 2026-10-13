/**
 * The rules the server enforces on every query of a language, whatever the connector's settings.
 * Each sentence says what the query binder of that language refuses. Nobody can turn one off:
 * allowing a script, a write or a second statement would run text a model wrote on the data
 * source.
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
      rule: 'No scripts',
      stops:
        'A key that holds or runs a script is refused, because a script is code the search server runs; only the two fixed ratio scripts of a bucket_script pass.',
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
      rule: 'No remote index',
      stops:
        'An index name that starts with _, or that names another cluster with a colon, is refused.',
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
        'A request whose method or path the connection does not allow is refused; both are set under Edit connection.',
    },
    {
      rule: 'No path tricks',
      stops:
        'A path with a . or .. segment, a ?, a #, a backslash or a control character is refused, so it cannot leave the allowed paths.',
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

/**
 * The rules always enforced on a query language.
 *
 * @param language - The query language of the connector's kind, if its kind is offered.
 * @returns The rules, or none for a language this screen does not know.
 */
export function enforcedRules(language: string | undefined): readonly EnforcedRule[] {
  return rulesByLanguage[language as QueryLanguage] ?? [];
}
