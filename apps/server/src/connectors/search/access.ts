/**
 * What the credentials of a search connector may do beyond reading, as the server's own security
 * says it: Elasticsearch lists the user's privileges, the security plugin of OpenSearch its
 * roles. Both calls only read. A server without security takes every request from whoever
 * reaches it. Where the answer does not say, the access is unknown, never read-only.
 */
import type { SearchApi, ServerInfo } from './api.ts';

/** What a connection test says about the credentials. */
export interface SearchAccess {
  /** Whether the credentials can only read, or `null` when the server does not say. */
  readonly readOnly: boolean | null;
  /** What they can do beyond reading, one sentence each. */
  readonly canDo: readonly string[];
  /** One sentence for the test's message. */
  readonly sentence: string;
}

/** The answer of Elasticsearch's `GET /_security/user/_privileges`, as far as it is read. */
interface PrivilegesAnswer {
  /** The cluster privileges, such as `monitor` or `manage`. */
  readonly cluster?: readonly string[];
  /** The index privileges, by the names they hold on. */
  readonly indices?: readonly {
    readonly names?: readonly string[];
    readonly privileges?: readonly string[];
  }[];
  /** The users it can act as. */
  readonly run_as?: readonly string[];
}

/** The answer of the security plugin's `GET /_plugins/_security/authinfo`, as far as it is read. */
interface AuthInfoAnswer {
  /** The user. */
  readonly user_name?: string;
  /** The roles of the security plugin the user is mapped to. */
  readonly roles?: readonly string[];
}

/** The cluster privileges of Elasticsearch that only read. */
const readingClusterPrivilege =
  /^(?:none|monitor(?:_\w+)?|read_\w+|cross_cluster_search|transport_client|manage_own_api_key)$/;

/** The index privileges of Elasticsearch that only read. */
const readingIndexPrivileges: ReadonlySet<string> = new Set([
  'none',
  'read',
  'read_cross_cluster',
  'view_index_metadata',
  'monitor',
]);

/** The roles OpenSearch ships that only read, and cannot be changed. */
const readingRoles: ReadonlySet<string> = new Set(['readall', 'readall_and_monitor']);

/** The roles OpenSearch ships that can do everything. */
const fullRoles: ReadonlySet<string> = new Set(['all_access']);

/** What is said of a server whose security is off. */
const openServer: SearchAccess = {
  readOnly: false,
  canDo: ['The server asks for no sign-in: whoever reaches it can write, and delete every index.'],
  sentence: 'Its security is off, so the connection can write.',
};

/**
 * The access when the server does not say.
 *
 * @param why - Why, as a sentence.
 * @returns The access, unknown.
 */
function unknown(why: string): SearchAccess {
  return { readOnly: null, canDo: [], sentence: `${why} Whether it can write is unknown.` };
}

/**
 * The access a list of findings gives.
 *
 * @param canDo - What the credentials can do beyond reading.
 * @param user - The user, for the sentence.
 * @returns Read-only when there is no finding.
 */
function found(canDo: readonly string[], user: string): SearchAccess {
  if (canDo.length === 0) return { readOnly: true, canDo, sentence: `${user} can only read.` };
  return { readOnly: false, canDo, sentence: `${user} can write.` };
}

/**
 * What a user's Elasticsearch privileges allow beyond reading.
 *
 * @param answer - The user's privileges.
 * @returns One sentence per finding.
 */
export function elasticsearchFindings(answer: PrivilegesAnswer): string[] {
  const cluster = (answer.cluster ?? []).filter((name) => !readingClusterPrivilege.test(name));
  const indices = (answer.indices ?? []).flatMap((entry) => {
    const writes = (entry.privileges ?? []).filter((name) => !readingIndexPrivileges.has(name));
    if (writes.length === 0) return [];
    return [`It holds ${writes.join(', ')} on ${(entry.names ?? []).join(', ')}.`];
  });
  const runAs = answer.run_as ?? [];
  return [
    ...(cluster.length > 0 ? [`It holds the cluster privileges ${cluster.join(', ')}.`] : []),
    ...indices,
    ...(runAs.length > 0 ? [`It can act as the users ${runAs.join(', ')}.`] : []),
  ];
}

/**
 * The access the roles of an OpenSearch user give. The plugin names the roles and not what they
 * allow, so only the roles it ships and never changes are known.
 *
 * @param answer - The user and its roles.
 * @returns The access.
 */
export function opensearchAccess(answer: AuthInfoAnswer): SearchAccess {
  const roles = answer.roles ?? [];
  const user = `User ${answer.user_name ?? '?'}`;
  const full = roles.filter((role) => fullRoles.has(role));
  if (full.length > 0)
    return found([`It holds the role ${full.join(', ')}, which can do everything.`], user);
  if (roles.length > 0 && roles.every((role) => readingRoles.has(role))) return found([], user);
  const named = roles.length > 0 ? roles.join(', ') : 'none';
  return unknown(`${user} holds the roles ${named}, and OpenSearch does not say what they allow.`);
}

/**
 * Whether an answer says the server has no such endpoint: its security is off.
 *
 * @param status - The HTTP status.
 * @param body - The answer.
 * @returns `true` when the server knows no security endpoint.
 */
function noSecurity(status: number, body: unknown): boolean {
  const error = (body as { error?: unknown } | undefined)?.error;
  const text = typeof error === 'string' ? error : JSON.stringify(error ?? '');
  return [400, 404, 405].includes(status) && /no handler found/i.test(text);
}

/** Where each product says what the signed-in user may do, and how its answer is read. */
const probes: Readonly<
  Record<ServerInfo['product'], { path: string; read: (body: unknown) => SearchAccess }>
> = {
  Elasticsearch: {
    path: '/_security/user/_privileges',
    read: (body) => found(elasticsearchFindings(body as PrivilegesAnswer), 'The user'),
  },
  OpenSearch: {
    path: '/_plugins/_security/authinfo',
    read: (body) => opensearchAccess(body as AuthInfoAnswer),
  },
};

/**
 * Asks the server what the connector's credentials may do. It reads, and tries no write.
 *
 * @param api - The API.
 * @param product - The server's product.
 * @param signal - The caller's signal.
 * @returns The access: read-only, able to write with what was found, or unknown.
 */
export async function searchAccess(
  api: SearchApi,
  product: ServerInfo['product'],
  signal: AbortSignal,
): Promise<SearchAccess> {
  const probe = probes[product];
  try {
    const { status, body } = await api.ask(probe.path, signal);
    if (status === 200) return probe.read(body);
    if (noSecurity(status, body)) return openServer;
    return unknown(`The server did not say what the user may do (HTTP ${status}).`);
  } catch {
    return unknown('The server did not say what the user may do.');
  }
}

/**
 * How to make a user that only reads, by product, for the admin to copy. Each request creates
 * something of its own name. OpenSearch gives the role on the user: a `PUT` of the role's mapping
 * would replace it, and take the role from everyone mapped to it.
 */
export const readOnlySetups: Readonly<Record<ServerInfo['product'], string>> = {
  Elasticsearch: `POST /_security/role/quanthea_read
{
  "cluster": ["monitor"],
  "indices": [
    { "names": ["logs-*"], "privileges": ["read", "view_index_metadata", "monitor"] }
  ]
}

POST /_security/user/quanthea_read
{ "password": "choose-a-password", "roles": ["quanthea_read"] }`,
  OpenSearch: `PUT /_plugins/_security/api/internalusers/quanthea_read
{ "password": "choose-a-password", "opendistro_security_roles": ["readall"] }`,
};
