/**
 * What the user of a MongoDB connector may do beyond reading, from the privileges
 * `connectionStatus` lists. It reads what the server says of the user, and tries no write.
 */

/** The actions that change data, the schema, the users or the server. */
const writeActions: ReadonlySet<string> = new Set([
  'insert',
  'update',
  'remove',
  'createCollection',
  'dropCollection',
  'dropDatabase',
  'createIndex',
  'dropIndex',
  'collMod',
  'renameCollectionSameDB',
  'createUser',
  'dropUser',
  'grantRole',
  'createRole',
  'applyOps',
  'shutdown',
  'anyAction',
  'emptycapped',
  'convertToCapped',
  'compact',
  'bypassDocumentValidation',
  'changePassword',
  'revokeRole',
  'dropRole',
  'setParameter',
  'replSetConfigure',
  'killop',
  'enableProfiler',
]);

/**
 * The actions that only read: those of the built-in `read`, `readAnyDatabase` and
 * `clusterMonitor` roles, as MongoDB 9 lists them. An action in neither list is not called a
 * read, so a role that gains an action in a later server reads as unknown until it is added.
 */
const readActions: ReadonlySet<string> = new Set([
  'find',
  'listCollections',
  'listIndexes',
  'listSearchIndexes',
  'listDatabases',
  'collStats',
  'dbStats',
  'dbHash',
  'indexStats',
  'changeStream',
  'killCursors',
  'planCacheRead',
  'serverStatus',
  'top',
  'inprog',
  'hostInfo',
  'getParameter',
  'getLog',
  'getCmdLineOpts',
  'connPoolStats',
  'replSetGetStatus',
  'replSetGetConfig',
  'listSessions',
  'listShards',
  'getShardMap',
  'shardingState',
  'viewRole',
  'viewUser',
  'useUUID',
  'performRawDataOperations',
  'allCollectionStats',
  'getDatabaseVersion',
  'getDefaultRWConcern',
  'getClusterParameter',
  'getShardVersion',
  'getTransitionToDedicatedConfigServerStatus',
  'listClusterCatalog',
  'listExtensions',
  'listSampledQueries',
  'netstat',
  'queryStatsRead',
  'queryStatsReadTransformed',
  'shardDrainingStatus',
  'shardedDataDistribution',
]);

/** One privilege, as `connectionStatus` gives it. */
export interface Privilege {
  /** What it applies to: a database (`''` for every one), the cluster, or everything. */
  readonly resource?: {
    readonly db?: string;
    readonly cluster?: boolean;
    readonly anyResource?: boolean;
  };
  /** What it allows. */
  readonly actions?: readonly string[];
}

/** What a connection test says about the user. */
export interface UserAccess {
  /** Whether the user only reads, or `null` when it is not known. */
  readonly readOnly: boolean | null;
  /** What it can do beyond reading, one sentence each. */
  readonly canDo: readonly string[];
  /** One sentence for the test's message. */
  readonly sentence: string;
}

/**
 * The write actions of a privilege.
 *
 * @param privilege - The privilege.
 * @returns Its actions that write.
 */
function writesOf(privilege: Privilege): string[] {
  return (privilege.actions ?? []).filter((action) => writeActions.has(action));
}

/**
 * The actions of some privileges that the test knows neither as reads nor as writes.
 *
 * @param privileges - The user's privileges.
 * @returns Their names, once each, five at most.
 */
export function unknownActions(privileges: readonly Privilege[]): string[] {
  const actions = privileges.flatMap((privilege) => privilege.actions ?? []);
  const unknown = actions.filter((action) => !readActions.has(action) && !writeActions.has(action));
  return [...new Set(unknown)].slice(0, 5);
}

/**
 * Whether a privilege applies to a database.
 *
 * @param privilege - The privilege.
 * @param database - The database.
 * @returns `true` for that database, every database, the cluster or everything.
 */
function appliesTo(privilege: Privilege, database: string): boolean {
  const { resource } = privilege;
  if (resource?.anyResource || resource?.cluster) return true;
  return resource?.db === '' || resource?.db === database;
}

/**
 * What privileges allow beyond reading: in the connector's database, and in others.
 *
 * @param privileges - The user's privileges.
 * @param database - The database the connector reads.
 * @returns One sentence per finding.
 */
export function writeFindings(privileges: readonly Privilege[], database: string): string[] {
  const writing = privileges.filter((privilege) => writesOf(privilege).length > 0);
  const here = new Set(writing.filter((p) => appliesTo(p, database)).flatMap(writesOf));
  const others = new Set(
    writing.filter((p) => !appliesTo(p, database)).map((p) => p.resource?.db ?? '?'),
  );
  return [
    ...(here.size > 0 ? [`It can ${[...here].join(', ')} in the database ${database}.`] : []),
    ...(others.size > 0 ? [`It can write in other databases: ${[...others].join(', ')}.`] : []),
  ];
}

/**
 * The access of a signed-in user.
 *
 * @param user - The user.
 * @param privileges - Its privileges.
 * @param database - The database the connector reads.
 * @returns Able to write when a privilege holds a write action, read-only when every action is a
 *   known read, and unknown when one is neither.
 */
export function userAccess(
  user: string,
  privileges: readonly Privilege[],
  database: string,
): UserAccess {
  const canDo = writeFindings(privileges, database);
  if (canDo.length > 0)
    return {
      readOnly: false,
      canDo,
      sentence: `User ${user} can write: use a user with the read role only.`,
    };
  const unknown = unknownActions(privileges);
  if (unknown.length === 0)
    return { readOnly: true, canDo, sentence: `User ${user} cannot write.` };
  const sentence = `User ${user} holds actions the test does not know as reads (${unknown.join(', ')}), so whether it can write is unknown.`;
  return { readOnly: null, canDo, sentence };
}

/**
 * The access of a connection no user signed in on. A server that lists its collections to it
 * checks no access, so whoever reaches it can write. One that refuses says nothing more.
 *
 * @param lists - Whether the server listed the database's collections.
 * @returns Able to write, or unknown.
 */
export function anonymousAccess(lists: boolean): UserAccess {
  if (!lists)
    return {
      readOnly: null,
      canDo: [],
      sentence: 'No user signed in, so whether it can write is unknown.',
    };
  return {
    readOnly: false,
    canDo: [
      'The server asks for no sign-in: whoever reaches it can write, and drop every database.',
    ],
    sentence: 'No user signed in and the server checks no access, so the connection can write.',
  };
}

/**
 * The command that makes a user that only reads the database, for the admin to copy into
 * `mongosh`.
 *
 * @param database - The database the connector reads.
 * @returns The command.
 */
export function readOnlyUser(database: string): string {
  const name = JSON.stringify(database);
  return `db.getSiblingDB(${name}).createUser({
  user: "quanthea_read",
  pwd: "choose-a-password",
  roles: [{ role: "read", db: ${name} }]
})`;
}
