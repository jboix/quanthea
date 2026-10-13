/**
 * The one setting that lets a query hold a script: on an Elasticsearch or OpenSearch connector, an
 * admin may allow an expression of the query's own in `bucket_script` and `bucket_selector`. This
 * is what the connector's page says of it and the change it sends.
 */

/**
 * Whether a connector has the setting: only a search has the two bucket aggregations.
 *
 * @param language - The query language of the connector's kind, if its kind is offered.
 * @returns `true` for a search connector.
 */
export function offersBucketScripts(language: string | undefined): boolean {
  return language === 'search';
}

/**
 * What the setting does as it stands, in one sentence under the switch.
 *
 * @param allowed - Whether the switch is on.
 * @returns The sentence.
 */
export function bucketScriptsEffect(allowed: boolean): string {
  return allowed
    ? 'A query, one the agent writes included, may hold one arithmetic expression of its own in these two aggregations. It receives the numbers of the buckets it names and nothing else.'
    : 'A query runs the two fixed ratio scripts and no other. The agent is told an admin can allow more here.';
}

/**
 * The change to send for a switch that was flipped.
 *
 * @param stored - Whether the connector allows bucket scripts.
 * @param draft - Whether the switch is on.
 * @returns The patch, or `undefined` when nothing changed.
 */
export function bucketScriptsPatch(
  stored: boolean,
  draft: boolean,
): { readonly bucketScripts: boolean } | undefined {
  return stored === draft ? undefined : { bucketScripts: draft };
}
