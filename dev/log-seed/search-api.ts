/** How the search seeds talk to Elasticsearch and OpenSearch: one JSON call, and bulk indexing. */

/** Documents per bulk request. */
const batchSize = 5000;

/**
 * Sends a JSON request and fails on an error status.
 *
 * @param url - The URL.
 * @param method - The method.
 * @param body - The body: an object as JSON, a string as is.
 * @returns The parsed answer.
 */
export async function call(url: string, method: string, body?: unknown): Promise<unknown> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const contentType = typeof body === 'string' ? 'application/x-ndjson' : 'application/json';
  const response = await fetch(url, {
    method,
    headers: { 'content-type': contentType },
    ...(body === undefined ? {} : { body: text }),
  });
  if (!response.ok)
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * Indexes documents in bulk requests, in order.
 *
 * @param base - The server URL.
 * @param documents - The documents.
 * @param indexOf - The index each document goes to.
 * @returns Once every document is indexed.
 * @throws {Error} When the server refuses a document.
 */
export async function bulkIndex<Document>(
  base: string,
  documents: readonly Document[],
  indexOf: (document: Document) => string,
): Promise<void> {
  for (let start = 0; start < documents.length; start += batchSize) {
    const lines = documents
      .slice(start, start + batchSize)
      .map((document) => {
        const action = JSON.stringify({ index: { _index: indexOf(document) } });
        return `${action}\n${JSON.stringify(document)}\n`;
      })
      .join('');
    const result = (await call(`${base}/_bulk`, 'POST', lines)) as { errors?: boolean };
    if (result.errors) throw new Error(`${base}: some documents were not indexed.`);
  }
}
