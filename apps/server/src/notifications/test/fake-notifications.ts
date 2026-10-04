/** The notifications service over a fresh database, posting to a fake `fetch`. */
import { createAuditRepository } from '../../db/audit-repository.ts';
import { createChannelRepository } from '../../db/channel-repository.ts';
import { openDatabase } from '../../db/database.ts';
import { runMigrations } from '../../db/migrate.ts';
import { openSecretBox } from '../../secrets/secret-box.ts';
import { createNotifications, type Notifications } from '../notifications.ts';

/** The service, what it posted, and how to close it. */
export interface FakeNotifications {
  /** The service. */
  readonly notifications: Notifications;
  /** The URL of every request posted, in order. */
  readonly posted: string[];
  /** Closes the database. */
  readonly close: () => void;
}

/**
 * Builds the notifications service over a fresh database in a directory. Every request gets a 200,
 * no host resolves, and retries do not wait.
 *
 * @param dataDir - A temporary directory for the database.
 * @returns The service, the posted URLs, and a function that closes the database.
 */
export async function fakeNotifications(dataDir: string): Promise<FakeNotifications> {
  const database = openDatabase(dataDir);
  runMigrations(database);
  const posted: string[] = [];
  const notifications = createNotifications({
    repository: createChannelRepository(database),
    secretBox: await openSecretBox(crypto.getRandomValues(new Uint8Array(32))),
    audit: createAuditRepository(database),
    delivery: {
      fetch: (url) => {
        posted.push(url);
        return Promise.resolve(new Response('ok'));
      },
      resolve: () => Promise.resolve([]),
      sleep: () => Promise.resolve(),
    },
  });
  return { notifications, posted, close: () => database.close() };
}
