/**
 * Reads what surrounds an alert for its pages: the channels it names, the messages sent about it
 * and what people did to it. Channels show by name and kind only, never by their targets.
 */
import type { Database } from 'bun:sqlite';
import type { NotificationEvent } from '@quanthea/shared';

/** A channel by name and kind. */
export interface NamedChannel {
  /** The channel id. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** Its kind, such as `slack`. */
  readonly kind: string;
}

/** A message sent about an alert, with its channel's name. */
export interface AlertSend {
  /** The channel's name. */
  readonly channel: string;
  /** The channel's kind. */
  readonly kind: string;
  /** What the message reported. */
  readonly event: NotificationEvent;
  /** The series it was about. */
  readonly seriesKey: string;
  /** When it was sent. */
  readonly at: number;
  /** Whether it got through. */
  readonly ok: boolean;
}

/** Something someone did to an alert, from the audit log. */
export interface AlertChange {
  /** The audit action, such as `alert.mute`. */
  readonly action: string;
  /** When. */
  readonly at: number;
  /** The user id of whoever did it. */
  readonly actor: string;
  /** The audit detail, parsed. */
  readonly detail: unknown;
}

/** Reads what surrounds alerts. */
export interface AlertActivityRepository {
  /**
   * Names channels.
   *
   * @param ids - The channel ids.
   * @returns The channels that exist, in the order of the ids.
   */
  channels(ids: readonly string[]): NamedChannel[];
  /**
   * The latest messages sent about an alert.
   *
   * @param alertId - The alert.
   * @param limit - The most to return.
   * @returns The sends, the latest first.
   */
  sends(alertId: string, limit: number): AlertSend[];
  /**
   * The latest message sent about each alert.
   *
   * @returns The send, by alert id.
   */
  lastSends(): Map<string, AlertSend>;
  /**
   * What people did to an alert: activations, deactivations, mutes and unmutes.
   *
   * @param alertId - The alert.
   * @param limit - The most to return.
   * @returns The changes, the latest first.
   */
  changes(alertId: string, limit: number): AlertChange[];
}

/** A send as SQLite returns it. */
interface StoredSend {
  /** The alert. */
  alert_id: string;
  /** The channel's name. */
  name: string;
  /** The channel's kind. */
  kind: string;
  /** The event. */
  event: NotificationEvent;
  /** The series key. */
  series_key: string;
  /** When. */
  at: number;
  /** 0 or 1. */
  ok: number;
}

/** The columns of a send with its channel. */
const sendColumns = `s.alert_id, c.name, c.kind, s.event, s.series_key, s.at, s.ok
  FROM notification_sends s JOIN notification_channels c ON c.id = s.channel_id`;

/**
 * Turns a stored send into a send.
 *
 * @param stored - The stored send.
 * @returns The send.
 */
function sendOf(stored: StoredSend): AlertSend {
  const { name, kind, event, at } = stored;
  return { channel: name, kind, event, seriesKey: stored.series_key, at, ok: stored.ok === 1 };
}

/**
 * Parses an audit detail.
 *
 * @param detail - The stored JSON, or `null`.
 * @returns The value, or `null`.
 */
function parsed(detail: string | null): unknown {
  return detail === null ? null : JSON.parse(detail);
}

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function activityStatements(database: Database) {
  return {
    channels: database.query<NamedChannel, []>('SELECT id, name, kind FROM notification_channels'),
    sends: database.query<StoredSend, [string, number]>(
      `SELECT ${sendColumns} WHERE s.alert_id = ? ORDER BY s.at DESC, s.id DESC LIMIT ?`,
    ),
    lastSends: database.query<StoredSend, []>(
      `SELECT * FROM (SELECT s.alert_id, c.name, c.kind, s.event, s.series_key, s.at, s.ok,
           row_number() OVER (PARTITION BY s.alert_id ORDER BY s.at DESC, s.id DESC) AS rank
         FROM notification_sends s JOIN notification_channels c ON c.id = s.channel_id)
       WHERE rank = 1`,
    ),
    changes: database.query<
      { action: string; at: number; actor: string; detail: string | null },
      [string, number]
    >(
      `SELECT action, at, actor, detail FROM audit_log WHERE target = ?
         AND action IN ('alert.activate', 'alert.deactivate', 'alert.mute', 'alert.unmute')
       ORDER BY at DESC, id DESC LIMIT ?`,
    ),
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAlertActivityRepository(database: Database): AlertActivityRepository {
  const statements = activityStatements(database);
  return {
    channels: (ids) => {
      const byId = new Map(statements.channels.all().map((channel) => [channel.id, channel]));
      return ids.flatMap((id) => {
        const channel = byId.get(id);
        return channel ? [{ ...channel }] : [];
      });
    },
    sends: (alertId, limit) => statements.sends.all(alertId, limit).map(sendOf),
    lastSends: () =>
      new Map(statements.lastSends.all().map((stored) => [stored.alert_id, sendOf(stored)])),
    changes: (alertId, limit) =>
      statements.changes
        .all(alertId, limit)
        .map(({ detail, ...change }) => ({ ...change, detail: parsed(detail) })),
  };
}
