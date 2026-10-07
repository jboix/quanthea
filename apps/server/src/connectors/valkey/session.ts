/**
 * A connection to Valkey or Redis over Bun's built-in client: one command at a time, each raced
 * against the caller's signal. A command the caller gave up on is left to finish, since every
 * command a query runs is a quick read, and the connection is opened again for the next one.
 */
import { ConnectorError } from '../_shared/index.ts';

/** How a connector reaches the server. */
export interface SessionOptions {
  /** The server name or address. */
  readonly host: string;
  /** The port. */
  readonly port: number;
  /** The database number. */
  readonly database: number;
  /** The ACL user, or none for the default user. */
  readonly username?: string | undefined;
  /** The password. */
  readonly password?: string | undefined;
  /** Whether and how TLS is used. */
  readonly tls: 'verify-full' | 'require' | 'disable';
}

/** Sends commands to one server. */
export interface ValkeySession {
  /**
   * Sends a command.
   *
   * @param command - The command.
   * @param args - Its arguments.
   * @param signal - Aborts the wait.
   * @returns The answer, as RESP3 maps to objects and arrays.
   * @throws {ConnectorError} When the server refuses or fails, or the signal fires.
   */
  send(command: string, args: readonly string[], signal: AbortSignal): Promise<unknown>;
  /** Closes the connection. */
  close(): void;
}

/**
 * The connection URL, with the credentials encoded.
 *
 * @param options - Where and how to connect.
 * @returns Such as `redis://dash_ro:…@valkey:6379/0`.
 */
function urlOf(options: SessionOptions): string {
  const scheme = options.tls === 'disable' ? 'redis' : 'rediss';
  const user = options.username ? encodeURIComponent(options.username) : '';
  const password = options.password ? `:${encodeURIComponent(options.password)}` : '';
  const credentials = user || password ? `${user}${password}@` : '';
  return `${scheme}://${credentials}${options.host}:${options.port}/${options.database}`;
}

/**
 * Turns what the client threw into a connector error. The server's message may quote a key.
 *
 * @param error - What the client threw.
 * @returns The connector error.
 */
export function toConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/^NOPERM/.test(message))
    return new ConnectorError(
      'permission',
      "The connector's user may not run this command or read this key.",
      message,
    );
  if (/^(WRONGPASS|NOAUTH|ERR AUTH)\b/.test(message))
    return new ConnectorError('authentication', 'The username or password was refused.', message);
  if (/^WRONGTYPE/.test(message))
    return new ConnectorError(
      'syntax',
      'The key holds another type than the command reads.',
      message,
    );
  if (/^ERR (syntax|wrong number|value is not)/i.test(message))
    return new ConnectorError('syntax', 'The command has a wrong argument.', message);
  if (/connect|closed|ECONNREFUSED|timed out/i.test(message))
    return new ConnectorError('unreachable', 'The server cannot be reached.', message);
  return new ConnectorError('internal', 'The server failed the command.', message);
}

/**
 * Starts a command and waits for it, or rejects when the signal fires first. A command left behind
 * may still fail; nobody waits for it then.
 *
 * @param work - Starts the command.
 * @param signal - The caller's signal.
 * @returns The answer.
 * @throws {ConnectorError} `timeout` when the signal fires first.
 */
function raced<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(
      new ConnectorError('timeout', 'The query was cancelled before it started.'),
    );
  const running = work();
  running.catch(() => undefined);
  const aborted = new Promise<never>((_, reject) => {
    const cancelled = () =>
      reject(
        new ConnectorError(
          'timeout',
          'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
        ),
      );
    signal.addEventListener('abort', cancelled, { once: true });
  });
  return Promise.race([running, aborted]);
}

/**
 * Opens a client, which connects on its first command.
 *
 * @param options - Where and how to connect.
 * @returns The client.
 */
function clientOf(options: SessionOptions): Bun.RedisClient {
  return new Bun.RedisClient(urlOf(options), {
    connectionTimeout: 10_000,
    autoReconnect: false,
    enableOfflineQueue: false,
    ...(options.tls === 'require' ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

/**
 * Opens a session. It connects on the first command.
 *
 * @param options - Where and how to connect.
 * @returns The session.
 */
export function openSession(options: SessionOptions): ValkeySession {
  let client: Bun.RedisClient | undefined;
  const drop = (): void => {
    client?.close();
    client = undefined;
  };
  return {
    async send(command, args, signal) {
      client ??= clientOf(options);
      try {
        const open = client;
        if (!open.connected) await raced(() => open.connect(), signal);
        return await raced(() => open.send(command, [...args]), signal);
      } catch (error) {
        if (error instanceof ConnectorError || !client?.connected) drop();
        throw toConnectorError(error);
      }
    },
    close: drop,
  };
}
