/**
 * Resolves an index expression as a search would: the open indices, the aliases and the data
 * streams it reaches. It reads names, never documents.
 */
import type { ResolvedObject } from '../_shared/index.ts';
import type { SearchApi } from './api.ts';

/** The answer of the resolve index API, as far as it is read. */
interface ResolveAnswer {
  /** The indices the expression reaches. */
  readonly indices?: readonly { readonly name: string }[];
  /** The aliases, each with the indices behind it. */
  readonly aliases?: readonly { readonly name: string; readonly indices?: readonly string[] }[];
  /** The data streams. Their backing indices are their own. */
  readonly data_streams?: readonly { readonly name: string }[];
}

/**
 * Resolves an index expression.
 *
 * @param api - The API.
 * @param expression - The index, pattern or comma-separated list, as a search takes it.
 * @param signal - The caller's signal.
 * @returns Every index, alias and data stream it reaches; an alias with the indices behind it.
 * @throws {ConnectorError} When an index it names does not exist, or the server refuses.
 */
export async function resolveIndices(
  api: SearchApi,
  expression: string,
  signal: AbortSignal,
): Promise<ResolvedObject[]> {
  const answer = await api.request<ResolveAnswer>({
    path: `/_resolve/index/${expression}`,
    query: { expand_wildcards: 'open' },
    signal,
  });
  return [
    ...(answer.indices ?? []).map(({ name }) => ({ name })),
    ...(answer.aliases ?? []).map(({ name, indices }) => ({ name, members: indices ?? [] })),
    ...(answer.data_streams ?? []).map(({ name }) => ({ name })),
  ];
}
