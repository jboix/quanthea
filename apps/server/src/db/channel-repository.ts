/** Reads and writes notification channels and the log of what was sent to them. */
import type { Database } from 'bun:sqlite';
import type { NotificationEvent } from '@quanthea/shared';

/** The last failure of a channel. */
export interface ChannelFailure {
  /** When it failed, in epoch milliseconds. */
  readonly at: number;
  /** Why, without the target. */
  readonly message: string;
  /** The service's HTTP status, or `null` when it never answered. */
  readonly status: number | null;
}

/** A notification channel as stored. `kind` is checked by the code, not here. */
export interface ChannelRow {
  /** The ULID. */
  readonly id: string;
  /** The unique name admins and editors pick it by. */
  readonly name: string;
  /** The channel kind, such as `slack`. */
  readonly kind: string;
  /** The masked target the settings show. */
  readonly targetHint: string;
  /** The mentions added when an alert starts firing. */
  readonly mentions: readonly string[];
  /** Whether a signing secret is sealed with the target. */
  readonly signed: boolean;
  /** The sealed target and signing secret, bound to the id. */
  readonly secret: Uint8Array;
  /** The id of the admin who added it. */
  readonly createdBy: string;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
  /** Last change, in epoch milliseconds. */
  readonly updatedAt: number;
  /** The last time a message got through. */
  readonly lastSentAt: number | null;
  /** The last failure. */
  readonly lastError: ChannelFailure | null;
}

/** One message sent to a channel, after its retries. */
export interface SendRow {
  /** The ULID. */
  readonly id: string;
  /** The channel. */
  readonly channelId: string;
  /** What the message reported. */
  readonly event: NotificationEvent;
  /** The alert it came from. */
  readonly alertId: string;
  /** The series it was about. */
  readonly seriesKey: string;
  /** When the last attempt ended, in epoch milliseconds. */
  readonly at: number;
  /** Whether it got through. */
  readonly ok: boolean;
  /** The service's last HTTP status, or `null` when it never answered. */
  readonly httpStatus: number | null;
  /** How many attempts it took. */
  readonly attempts: number;
  /** Why it failed, without the target. */
  readonly error: string | null;
}

/** Stores notification channels and their sends. */
export interface ChannelRepository {
  /**
   * Lists every channel.
   *
   * @returns The channels, by name.
   */
  list(): ChannelRow[];
  /**
   * Finds a channel.
   *
   * @param id - The channel id.
   * @returns The channel, or `undefined`.
   */
  get(id: string): ChannelRow | undefined;
  /**
   * Inserts a channel or replaces the settings of the one with the same id. Its status stays.
   *
   * @param row - The channel.
   */
  save(row: ChannelRow): void;
  /**
   * Deletes a channel and its log.
   *
   * @param id - The channel id.
   * @returns `true` when a channel was deleted.
   */
  remove(id: string): boolean;
  /**
   * Logs a send and updates its channel's status, in one transaction.
   *
   * @param send - The send.
   */
  recordSend(send: SendRow): void;
  /**
   * Lists a channel's sends.
   *
   * @param channelId - The channel id.
   * @param limit - How many, at most.
   * @returns The newest first.
   */
  sends(channelId: string, limit: number): SendRow[];
  /**
   * Deletes the sends older than a time, and those beyond the newest of each channel.
   *
   * @param before - The oldest time kept, in epoch milliseconds.
   * @param keepPerChannel - How many of each channel's newest sends are kept.
   * @returns How many were deleted.
   */
  purgeSends(before: number, keepPerChannel: number): number;
}

/** A `notification_channels` row as SQLite returns it. */
interface StoredChannel {
  /** The id. */
  id: string;
  /** The name. */
  name: string;
  /** The kind. */
  kind: string;
  /** The masked target. */
  target_hint: string;
  /** The mentions JSON. */
  mentions: string;
  /** 1 when signed. */
  signed: number;
  /** The sealed target and secret. */
  secret: Uint8Array;
  /** Who added it. */
  created_by: string;
  /** Creation time. */
  created_at: number;
  /** Last change. */
  updated_at: number;
  /** The last send that got through. */
  last_sent_at: number | null;
  /** The last failure's time. */
  last_error_at: number | null;
  /** The last failure's message. */
  last_error: string | null;
  /** The last failure's HTTP status. */
  last_error_status: number | null;
}

/** A `notification_sends` row as SQLite returns it. */
interface StoredSend {
  /** The id. */
  id: string;
  /** The channel. */
  channel_id: string;
  /** The event. */
  event: NotificationEvent;
  /** The alert. */
  alert_id: string;
  /** The series. */
  series_key: string;
  /** When. */
  at: number;
  /** 1 when it got through. */
  ok: number;
  /** The HTTP status. */
  http_status: number | null;
  /** The attempts. */
  attempts: number;
  /** The failure. */
  error: string | null;
}

/**
 * Turns a stored row into a channel.
 *
 * @param stored - The row.
 * @returns The channel.
 */
function toChannel(stored: StoredChannel): ChannelRow {
  const failed = stored.last_error_at !== null && stored.last_error !== null;
  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind,
    targetHint: stored.target_hint,
    mentions: JSON.parse(stored.mentions) as string[],
    signed: stored.signed === 1,
    secret: new Uint8Array(stored.secret),
    createdBy: stored.created_by,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    lastSentAt: stored.last_sent_at,
    lastError: failed
      ? {
          at: stored.last_error_at ?? 0,
          message: stored.last_error ?? '',
          status: stored.last_error_status,
        }
      : null,
  };
}

/**
 * Turns a stored row into a send.
 *
 * @param stored - The row.
 * @returns The send.
 */
function toSend(stored: StoredSend): SendRow {
  return {
    id: stored.id,
    channelId: stored.channel_id,
    event: stored.event,
    alertId: stored.alert_id,
    seriesKey: stored.series_key,
    at: stored.at,
    ok: stored.ok === 1,
    httpStatus: stored.http_status,
    attempts: stored.attempts,
    error: stored.error,
  };
}

/**
 * Turns a send into the values of its insert, in column order.
 *
 * @param send - The send.
 * @returns The values.
 */
function sendValues(send: SendRow) {
  const { id, channelId, event, alertId, seriesKey, at, ok, httpStatus, attempts, error } = send;
  return [id, channelId, event, alertId, seriesKey, at, ok ? 1 : 0, httpStatus, attempts, error];
}

/**
 * Creates the function that logs a send and updates its channel's status in one transaction.
 *
 * @param database - A database the migrations have run on.
 * @returns The function.
 */
function sendRecorder(database: Database): (send: SendRow) => void {
  const insert = database.query(
    `INSERT INTO notification_sends
       (id, channel_id, event, alert_id, series_key, at, ok, http_status, attempts, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const sent = database.query('UPDATE notification_channels SET last_sent_at = ? WHERE id = ?');
  const failed = database.query(
    `UPDATE notification_channels SET last_error_at = ?, last_error = ?, last_error_status = ?
     WHERE id = ?`,
  );
  return database.transaction((send: SendRow) => {
    insert.run(...sendValues(send));
    if (send.ok) sent.run(send.at, send.channelId);
    else failed.run(send.at, send.error ?? '', send.httpStatus, send.channelId);
  });
}

/**
 * Creates the log half of the repository.
 *
 * @param database - A database the migrations have run on.
 * @returns The methods that log, list and purge sends.
 */
function sendLog(
  database: Database,
): Pick<ChannelRepository, 'recordSend' | 'sends' | 'purgeSends'> {
  const select = database.query<StoredSend, [string, number]>(
    'SELECT * FROM notification_sends WHERE channel_id = ? ORDER BY at DESC, id DESC LIMIT ?',
  );
  const record = sendRecorder(database);
  return {
    recordSend: (send) => record(send),
    sends: (channelId, limit) => select.all(channelId, limit).map(toSend),
    purgeSends: (before, keepPerChannel) => purge(database, before, keepPerChannel),
  };
}

/**
 * Deletes the sends older than a time, and those beyond the newest of each channel.
 *
 * @param database - The database.
 * @param before - The oldest time kept.
 * @param keepPerChannel - How many of each channel's newest sends are kept.
 * @returns How many were deleted.
 */
function purge(database: Database, before: number, keepPerChannel: number): number {
  return database.run(
    `DELETE FROM notification_sends WHERE at < ? OR id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY channel_id ORDER BY at DESC, id DESC) AS rank
         FROM notification_sends)
       WHERE rank > ?)`,
    [before, keepPerChannel],
  ).changes;
}

/**
 * Turns a channel into the values of its insert, in column order.
 *
 * @param row - The channel.
 * @returns The values.
 */
function channelValues(row: ChannelRow) {
  const { id, name, kind, targetHint, signed, secret, createdBy, createdAt, updatedAt } = row;
  const mentions = JSON.stringify(row.mentions);
  return [
    id,
    name,
    kind,
    targetHint,
    mentions,
    signed ? 1 : 0,
    secret,
    createdBy,
    createdAt,
    updatedAt,
  ];
}

/**
 * Creates the function that inserts a channel or replaces its settings, keeping its status.
 *
 * @param database - A database the migrations have run on.
 * @returns The function.
 */
function channelSaver(database: Database): (row: ChannelRow) => void {
  const upsert = database.query(
    `INSERT INTO notification_channels (id, name, kind, target_hint, mentions, signed, secret,
       created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, target_hint = excluded.target_hint,
       mentions = excluded.mentions, signed = excluded.signed, secret = excluded.secret,
       updated_at = excluded.updated_at`,
  );
  return (row) => {
    upsert.run(...channelValues(row));
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createChannelRepository(database: Database): ChannelRepository {
  const all = database.query<StoredChannel, []>(
    'SELECT * FROM notification_channels ORDER BY name',
  );
  const one = database.query<StoredChannel, [string]>(
    'SELECT * FROM notification_channels WHERE id = ?',
  );
  const remove = database.query('DELETE FROM notification_channels WHERE id = ?');
  return {
    list: () => all.all().map(toChannel),
    get: (id) => {
      const stored = one.get(id);
      return stored ? toChannel(stored) : undefined;
    },
    save: channelSaver(database),
    remove: (id) => remove.run(id).changes > 0,
    ...sendLog(database),
  };
}
