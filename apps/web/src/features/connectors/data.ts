/** Loads and changes connectors through the API, for the routes of the connectors screen. */
import {
  type AccessChange,
  type ApiErrorCode,
  type ConnectorDetail,
  type ConnectorKindInfo,
  type ConnectorSummary,
  type connectorInputSchema,
  type connectorPatchSchema,
  countAffectedThreadsEndpoint,
  createConnectorEndpoint,
  deleteConnectorEndpoint,
  getConnectorEndpoint,
  getConnectorSchemaEndpoint,
  listConnectorKindsEndpoint,
  listConnectorsEndpoint,
  refreshConnectorSchemaEndpoint,
  type SchemaView,
  testConnectorEndpoint,
  updateConnectorEndpoint,
} from '@quanthea/shared';
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type Params,
  redirect,
} from 'react-router';
import { z } from 'zod';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import { accessChangeOf } from './access-change.ts';

/** What the connectors layout shows: the list, and the kinds for names and forms. */
export interface ConnectorsData {
  /** The connectors. */
  readonly connectors: readonly ConnectorSummary[];
  /** The kinds on offer. */
  readonly kinds: readonly ConnectorKindInfo[];
}

/** What the screen of one connector shows. */
export interface ConnectorData {
  /** The connector, credentials masked. */
  readonly connector: ConnectorDetail;
  /** Its cached schema, with what the model gets of each field. */
  readonly schema: SchemaView;
}

/** The outcome of a change: done, or refused with a message and issues keyed by field. */
export type ChangeOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      /** Problems by field key, such as `name` or `config.host`. */
      readonly issues: Readonly<Record<string, string>>;
    };

/** A change to a connector, as the API takes it. The server validates it. */
type ConnectorPatch = z.input<typeof connectorPatchSchema>;

/** Validates the shape of the changes the connector screen submits; the server checks the rest. */
const connectorIntentSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('update'),
    patch: z.custom<ConnectorPatch>((value) => typeof value === 'object' && value !== null),
  }),
  z.object({ intent: z.literal('refresh-schema') }),
  z.object({ intent: z.literal('delete') }),
]);

/** A change the connector screen submits to its route action, as JSON. */
export type ConnectorIntent = z.input<typeof connectorIntentSchema>;

/** Refusals the user can act on: invalid settings, or a source that failed. */
const actionableCodes: ReadonlySet<ApiErrorCode> = new Set(['bad_request', 'source_failed']);

/** A new connector, as the API takes it. The server validates it. */
type ConnectorInput = z.input<typeof connectorInputSchema>;

/** Validates the issues the server sends with a `bad_request`. */
const issuesSchema = z.array(z.object({ part: z.string(), path: z.string(), message: z.string() }));

/**
 * The path parameter of the connector a route shows.
 *
 * @param params - The route params.
 * @returns The parameter for the API.
 */
function connectorParams(params: Params): { connectorId: string } {
  return { connectorId: params.connectorId ?? '' };
}

/**
 * Keys the server's validation issues by field. Body issues keep their path (`name`); the kind's
 * issues get their part (`config.host`).
 *
 * @param details - The `details` of the error.
 * @returns The first message of each field.
 */
function issuesByField(details: unknown): Record<string, string> {
  const parsed = issuesSchema.safeParse(details);
  if (!parsed.success) return {};
  const keyed = parsed.data.map((issue) => {
    const key = issue.part === 'body' ? issue.path : `${issue.part}.${issue.path}`;
    return [key, issue.message] as const;
  });
  return Object.fromEntries(keyed.reverse());
}

/**
 * Awaits a change. A refusal the user can fix becomes a failed outcome; anything else is thrown to
 * the error page.
 *
 * @param change - The pending API call.
 * @param next - Where to go when it succeeds, if anywhere.
 * @returns The outcome, or the redirect.
 */
async function outcomeOf<Result>(
  change: Promise<Result>,
  next?: (result: Result) => Response,
): Promise<ChangeOutcome | Response> {
  try {
    const result = await change;
    return next ? next(result) : { ok: true };
  } catch (error) {
    if (!(error instanceof ApiError) || !actionableCodes.has(error.code)) throw error;
    return { ok: false, message: error.message, issues: issuesByField(error.details) };
  }
}

/**
 * The loader of the connectors layout.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadConnectors(api: ApiClient): () => Promise<ConnectorsData> {
  return async () => {
    const [connectors, kinds] = await Promise.all([
      api.call(listConnectorsEndpoint),
      api.call(listConnectorKindsEndpoint),
    ]);
    return { connectors, kinds };
  };
}

/**
 * The loader of one connector's screen and edit form.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadConnector(
  api: ApiClient,
): (args: LoaderFunctionArgs) => Promise<ConnectorData> {
  return async ({ params }) => {
    const input = { params: connectorParams(params) };
    const [connector, schema] = await Promise.all([
      api.call(getConnectorEndpoint, input),
      api.call(getConnectorSchemaEndpoint, input),
    ]);
    return { connector, schema };
  };
}

/**
 * The loader of the health resource route: it tests the connection. Fetchers call it, so a slow
 * source never holds up a navigation.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadHealth(api: ApiClient) {
  return ({ params }: LoaderFunctionArgs) =>
    api.call(testConnectorEndpoint, { params: connectorParams(params) });
}

/**
 * How many threads an access change restricts, or why they could not be counted, with the query
 * the count was asked for.
 */
export type AffectedThreads =
  | {
      /** The number of threads. */
      readonly threads: number;
      /** The query of the request, to match the count with the change it was asked for. */
      readonly query: string;
    }
  | {
      /** Why the threads could not be counted. */
      readonly failure: string;
      /** The query of the request, to match the failure with the change it was asked for. */
      readonly query: string;
    };

/**
 * The count of a change waiting for it, once the fetcher has it, or why it could not be read.
 *
 * @param query - The query the waiting change's count was asked with, if a change waits.
 * @param data - The fetcher's latest result.
 * @returns The number of threads or the failure, when the result is the waiting change's.
 */
export function countFor(
  query: string | undefined,
  data: AffectedThreads | undefined,
): { readonly threads: number } | { readonly failure: string } | undefined {
  if (query === undefined || data === undefined || data.query !== query) return undefined;
  return 'failure' in data ? { failure: data.failure } : { threads: data.threads };
}

/**
 * Asks the server for the count, returning a failure instead of throwing so the screen can offer
 * to save or cancel.
 *
 * @param api - The API client.
 * @param input - The connector and the change.
 * @param input.params - The connector.
 * @param input.body - The change.
 * @returns The number of threads, or why it could not be read.
 */
async function countAffected(
  api: ApiClient,
  input: { readonly params: { connectorId: string }; readonly body: AccessChange },
): Promise<{ threads: number } | { failure: string }> {
  try {
    const { threads } = await api.call(countAffectedThreadsEndpoint, input);
    return { threads };
  } catch (error) {
    if (error instanceof ApiError) return { failure: error.message };
    return { failure: 'The server could not be reached.' };
  }
}

/**
 * The loader of the resource route that counts the threads an access change restricts, before
 * the change is saved. Fetchers call it with the change in the query; without one, it counts none.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAffectedThreads(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<AffectedThreads> => {
    const url = new URL(request.url);
    const body = accessChangeOf(url.searchParams);
    // Without a change in the query there is nothing to restrict.
    if (body === undefined) return { threads: 0, query: url.search };
    const counted = await countAffected(api, { params: connectorParams(params), body });
    return { ...counted, query: url.search };
  };
}

/**
 * The action of the add form. It receives the new connector as JSON.
 *
 * @param api - The API client.
 * @returns The action. It redirects to the new connector.
 */
export function addConnector(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<ChangeOutcome | Response> => {
    const body = (await request.json()) as ConnectorInput;
    return outcomeOf(api.call(createConnectorEndpoint, { body }), (created) =>
      redirect(`/connectors/${created.id}`),
    );
  };
}

/**
 * The action of the edit form. It receives the change as JSON.
 *
 * @param api - The API client.
 * @returns The action. It redirects back to the connector.
 */
export function editConnector(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ChangeOutcome | Response> => {
    const body = (await request.json()) as ConnectorPatch;
    const input = { params: connectorParams(params), body };
    return outcomeOf(api.call(updateConnectorEndpoint, input), (updated) =>
      redirect(`/connectors/${updated.id}`),
    );
  };
}

/**
 * The action of a connector's screen: a {@link ConnectorIntent} as JSON.
 *
 * @param api - The API client.
 * @returns The action. Deleting redirects to the list.
 */
export function changeConnector(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ChangeOutcome | Response> => {
    const intent = connectorIntentSchema.parse(await request.json());
    const input = { params: connectorParams(params) };
    if (intent.intent === 'delete') {
      return outcomeOf(api.call(deleteConnectorEndpoint, input), () => redirect('/connectors'));
    }
    if (intent.intent === 'refresh-schema') {
      return outcomeOf(api.call(refreshConnectorSchemaEndpoint, input));
    }
    return outcomeOf(api.call(updateConnectorEndpoint, { ...input, body: intent.patch }));
  };
}
