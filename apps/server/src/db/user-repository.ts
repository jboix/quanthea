/** Stores users. Names and emails arrive sealed, and the email index as a keyed hash. */
import type { Database } from 'bun:sqlite';
import type { Role } from '@querent/shared';

/** A user as stored. */
export interface UserRow {
  /** The ULID. */
  readonly id: string;
  /** A keyed hash of the normalised email, to find the user by email. */
  readonly emailIndex: Uint8Array;
  /** The email, sealed. */
  readonly emailSealed: Uint8Array;
  /** The name, sealed. */
  readonly nameSealed: Uint8Array;
  /** The role. */
  readonly role: Role;
  /** The password hash, or `null` until a password is set. */
  readonly passwordHash: string | null;
  /** Which pepper the password hash was made with. */
  readonly pepperId: string | null;
  /** When the user was disabled, if they were. */
  readonly disabledAt: number | null;
  /** The last sign-in. */
  readonly lastSignInAt: number | null;
  /** Creation time. */
  readonly createdAt: number;
  /** Last change. */
  readonly updatedAt: number;
}

/** The fields a change may set. */
export type UserChange = Partial<
  Pick<
    UserRow,
    | 'emailIndex'
    | 'emailSealed'
    | 'nameSealed'
    | 'role'
    | 'passwordHash'
    | 'pepperId'
    | 'disabledAt'
    | 'lastSignInAt'
  >
> & {
  /** The time of the change. */
  readonly updatedAt: number;
};

/** Stores users. */
export interface UserRepository {
  /**
   * Inserts a user.
   *
   * @param row - The user.
   * @returns `false` when the email index is taken.
   */
  create(row: UserRow): boolean;
  /**
   * Finds a user.
   *
   * @param id - The user id.
   * @returns The user, or `undefined`.
   */
  get(id: string): UserRow | undefined;
  /**
   * Finds a user by the keyed hash of their email.
   *
   * @param emailIndex - The hash.
   * @returns The user, or `undefined`.
   */
  findByEmailIndex(emailIndex: Uint8Array): UserRow | undefined;
  /**
   * Lists every user, the oldest first.
   *
   * @returns The users.
   */
  list(): UserRow[];
  /**
   * Changes a user. A field left out keeps its value; `null` clears a nullable field.
   *
   * @param id - The user id.
   * @param change - The fields and the time.
   */
  update(id: string, change: UserChange): void;
  /**
   * How many enabled admins there are.
   *
   * @returns The count.
   */
  countAdmins(): number;
}

/** A user as SQLite returns it. */
interface StoredUser {
  /** The id. */
  id: string;
  /** The email index. */
  email_index: Uint8Array;
  /** The sealed email. */
  email_sealed: Uint8Array;
  /** The sealed name. */
  name_sealed: Uint8Array;
  /** The role. */
  role: Role;
  /** The password hash. */
  password_hash: string | null;
  /** The pepper id. */
  pepper_id: string | null;
  /** When disabled. */
  disabled_at: number | null;
  /** The last sign-in. */
  last_sign_in_at: number | null;
  /** Creation time. */
  created_at: number;
  /** Last change. */
  updated_at: number;
}

/** Each change field with its column. */
const changeColumns: readonly [keyof UserChange, string][] = [
  ['emailIndex', 'email_index'],
  ['emailSealed', 'email_sealed'],
  ['nameSealed', 'name_sealed'],
  ['role', 'role'],
  ['passwordHash', 'password_hash'],
  ['pepperId', 'pepper_id'],
  ['disabledAt', 'disabled_at'],
  ['lastSignInAt', 'last_sign_in_at'],
];

/**
 * Turns a stored row into a user.
 *
 * @param stored - The row.
 * @returns The user.
 */
function toUser(stored: StoredUser): UserRow {
  return {
    id: stored.id,
    emailIndex: new Uint8Array(stored.email_index),
    emailSealed: new Uint8Array(stored.email_sealed),
    nameSealed: new Uint8Array(stored.name_sealed),
    role: stored.role,
    passwordHash: stored.password_hash,
    pepperId: stored.pepper_id,
    disabledAt: stored.disabled_at,
    lastSignInAt: stored.last_sign_in_at,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/**
 * The statement of a change: only the fields it sets, from a fixed list of columns.
 *
 * @param database - The database.
 * @param id - The user id.
 * @param change - The change.
 */
function runUpdate(database: Database, id: string, change: UserChange): void {
  const set = changeColumns.filter(([field]) => change[field] !== undefined);
  const assignments = [...set.map(([, column]) => `${column} = ?`), 'updated_at = ?'];
  const values = [...set.map(([field]) => change[field] ?? null), change.updatedAt, id];
  database.run(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values);
}

/**
 * The values of an insert, in column order.
 *
 * @param row - The user.
 * @returns The values.
 */
function insertValues(row: UserRow) {
  return [
    row.id,
    row.emailIndex,
    row.emailSealed,
    row.nameSealed,
    row.role,
    row.passwordHash,
    row.pepperId,
    row.disabledAt,
    row.lastSignInAt,
    row.createdAt,
    row.updatedAt,
  ] as const;
}

/**
 * Prepares the statements.
 *
 * @param database - The database.
 * @returns The statements.
 */
function userStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT OR IGNORE INTO users (id, email_index, email_sealed, name_sealed, role, password_hash,
         pepper_id, disabled_at, last_sign_in_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectOne: database.query<StoredUser, [string]>('SELECT * FROM users WHERE id = ?'),
    selectByIndex: database.query<StoredUser, [Uint8Array]>(
      'SELECT * FROM users WHERE email_index = ?',
    ),
    selectAll: database.query<StoredUser, []>('SELECT * FROM users ORDER BY created_at, id'),
    admins: database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL",
    ),
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createUserRepository(database: Database): UserRepository {
  const statements = userStatements(database);
  return {
    create: (row) => statements.insert.run(...insertValues(row)).changes > 0,
    get: (id) => {
      const stored = statements.selectOne.get(id);
      return stored ? toUser(stored) : undefined;
    },
    findByEmailIndex: (emailIndex) => {
      const stored = statements.selectByIndex.get(emailIndex);
      return stored ? toUser(stored) : undefined;
    },
    list: () => statements.selectAll.all().map(toUser),
    update: (id, change) => runUpdate(database, id, change),
    countAdmins: () => statements.admins.get()?.count ?? 0,
  };
}
