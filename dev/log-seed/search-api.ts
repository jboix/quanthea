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

/** What a bulk request answers: whether a document was refused, and each document's outcome. */
interface BulkAnswer {
  /** Whether the server refused a document. */
  readonly errors?: boolean;
  /** One outcome per document, with the reason of a refusal. */
  readonly items?: readonly { readonly index?: { readonly error?: unknown } }[];
}

/**
 * Says why the first refused document of a bulk request was refused.
 *
 * @param answer - The bulk answer.
 * @returns The message, with the server's reason.
 */
function firstRefusal(answer: BulkAnswer): string {
  const refused = answer.items?.find((item) => item.index?.error !== undefined);
  return `some documents were not indexed: ${JSON.stringify(refused?.index?.error)}`;
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
    const result = (await call(`${base}/_bulk`, 'POST', lines)) as BulkAnswer;
    if (result.errors) throw new Error(`${base}: ${firstRefusal(result)}`);
  }
}
