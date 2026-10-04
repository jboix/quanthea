import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';
import { createThreadRepository, type ThreadRow } from './thread-repository.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const thread: ThreadRow = {
  id: '01K0000000000000000000000T',
  title: null,
  state: 'idle',
  dashboardId: null,
  tokensUsed: 0,
  createdBy: 'editor-1',
  providerId: null,
  queries: { mode: 'default' },
  kind: 'dashboard',
  seed: null,
  alertId: null,
  alertActive: false,
  createdAt: 1000,
  updatedAt: 1000,
};

/**
 * A message.
 *
 * @param id - The message id.
 * @param text - Its text.
 * @returns The message row.
 */
function message(id: string, text: string) {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: undefined,
    actor: 'editor-1',
    createdAt: 1000,
  };
}

describe('thread repository', () => {
  test('creates, changes, lists and deletes threads', () => {
    const repository = createThreadRepository(database);
    repository.create(thread);
    repository.create({ ...thread, id: '01K0000000000000000000000U', updatedAt: 2000 });
    repository.update(thread.id, { title: 'Checkout', state: 'plan_pending', updatedAt: 3000 });
    expect(repository.get(thread.id)).toEqual({
      ...thread,
      title: 'Checkout',
      state: 'plan_pending',
      updatedAt: 3000,
    });
    repository.update(thread.id, { tokensUsed: 1200, updatedAt: 3100 });
    expect(repository.get(thread.id)).toMatchObject({
      title: 'Checkout',
      state: 'plan_pending',
      tokensUsed: 1200,
    });
    expect(repository.list().map((row) => row.id)).toEqual([
      thread.id,
      '01K0000000000000000000000U',
    ]);
    expect(repository.remove(thread.id)).toBe(true);
    expect(repository.get(thread.id)).toBeUndefined();
  });

  test('refuses a state the machine does not know', () => {
    const repository = createThreadRepository(database);
    repository.create(thread);
    expect(() => repository.update(thread.id, { state: 'done' as never, updatedAt: 2 })).toThrow();
  });

  test('replaces the messages of a thread in order', () => {
    const repository = createThreadRepository(database);
    repository.create(thread);
    repository.saveMessages(thread.id, [message('m1', 'hello'), message('m2', 'again')]);
    repository.saveMessages(thread.id, [
      message('m1', 'hello'),
      message('m3', 'third'),
      message('m2', 'again'),
    ]);
    expect(repository.messages(thread.id).map((row) => row.id)).toEqual(['m1', 'm3', 'm2']);
    expect(repository.messages(thread.id)[1]).toEqual(message('m3', 'third'));
  });

  test('decides a pending plan once, and deletes plans and messages with the thread', () => {
    const repository = createThreadRepository(database);
    repository.create(thread);
    const plan = {
      id: 'p1',
      threadId: thread.id,
      body: { title: 'Plan' },
      status: 'pending' as const,
      decidedBy: null,
      createdAt: 1,
      decidedAt: null,
    };
    repository.addPlan(plan);
    expect(repository.decidePlan('p1', 'approved', 'editor-1', 5)).toBe(true);
    expect(repository.decidePlan('p1', 'rejected', 'editor-1', 6)).toBe(false);
    expect(repository.plan('p1')).toEqual({
      ...plan,
      status: 'approved',
      decidedBy: 'editor-1',
      decidedAt: 5,
    });
    repository.saveMessages(thread.id, [message('m1', 'hi')]);
    repository.remove(thread.id);
    expect(repository.plans(thread.id)).toEqual([]);
    expect(repository.messages(thread.id)).toEqual([]);
  });
});
