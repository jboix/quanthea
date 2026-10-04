import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';
import { createQuestionRepository } from './question-repository.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const shipped = join(import.meta.dir, 'migrations');
const conversations = '0007-question-conversations.sql';

/**
 * Applies the shipped migrations before the conversations one.
 *
 * @returns The directory the files were copied to.
 */
function migrateBeforeConversations(): string {
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of readdirSync(shipped).filter((each) => each < '0007'))
    copyFileSync(join(shipped, name), join(migrationsDir, name));
  runMigrations(database, migrationsDir);
  database.run(
    "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'D', 0, 0)",
  );
  return migrationsDir;
}

/**
 * Stores a question about the dashboard `d` the way questions were stored before conversations.
 *
 * @param id - The id.
 * @param parentId - The question it follows up on, or `null`.
 * @param askedAt - When, epoch milliseconds.
 */
function storeQuestion(id: string, parentId: string | null, askedAt: number): void {
  database.run(
    `INSERT INTO dashboard_questions (id, dashboard_id, version, parent_id, time_from, time_to,
       time_zone, variables, hidden_markers, explain_only, asked_by, asked_at, question, answer,
       citations, evidence, usage, tokens)
     VALUES (?, 'd', 1, ?, 0, 1, 'UTC', '{}', '[]', 0, 'ada', ?, ?, 'Because.', '[]', '[]', '{}', 1)`,
    [id, parentId, askedAt, `Question ${id}?`],
  );
}

describe('the conversations migration', () => {
  test('puts every stored question in the conversation of its first question', () => {
    const migrationsDir = migrateBeforeConversations();
    storeQuestion('a', null, 1000);
    storeQuestion('a-1', 'a', 2000);
    storeQuestion('a-2', 'a-1', 3000);
    // A follow-up of an earlier question of the chain, not its latest: a branch.
    storeQuestion('a-branch', 'a', 2500);
    storeQuestion('b', null, 1500);
    copyFileSync(join(shipped, conversations), join(migrationsDir, conversations));
    expect(runMigrations(database, migrationsDir)).toEqual([conversations]);
    const repository = createQuestionRepository(database);
    const ids = repository.inConversation('d', 'a').map(({ id }) => id);
    expect(ids).toEqual(['a', 'a-1', 'a-branch', 'a-2']);
    expect(repository.get('a')?.timeChosen).toBeNull();
    expect(repository.conversations('d', 10)).toEqual([
      {
        id: 'a',
        question: 'Question a?',
        startedBy: 'ada',
        startedAt: 1000,
        count: 4,
        lastAt: 3000,
      },
      {
        id: 'b',
        question: 'Question b?',
        startedBy: 'ada',
        startedAt: 1500,
        count: 1,
        lastAt: 1500,
      },
    ]);
  });
});
