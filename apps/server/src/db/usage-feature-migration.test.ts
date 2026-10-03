import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

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
const minute = 60_000;

/**
 * Applies the shipped migrations before the usage feature one.
 *
 * @returns The directory the files were copied to.
 */
function migrateBeforeFeature(): string {
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of readdirSync(shipped).filter((each) => each < '0006'))
    copyFileSync(join(shipped, name), join(migrationsDir, name));
  runMigrations(database, migrationsDir);
  return migrationsDir;
}

/**
 * Stores a model step the way the ledger stored them before the feature column.
 *
 * @param id - The id.
 * @param at - When, epoch milliseconds.
 * @param step - Its thread, job, person and dashboard.
 */
function storeStep(
  id: string,
  at: number,
  step: { thread?: string; job: string; user?: string; dashboard?: string },
): void {
  database.run(
    `INSERT INTO usage_events (id, at, kind, thread_id, dashboard_id, user_id, provider, model, job)
     VALUES (?, ?, 'model', ?, ?, ?, 'p', 'm', ?)`,
    [id, at, step.thread ?? null, step.dashboard ?? null, step.user ?? null, step.job],
  );
}

/**
 * Stores a question about the dashboard `d`.
 *
 * @param id - The id.
 * @param askedBy - Who asked.
 * @param askedAt - When, epoch milliseconds.
 */
function storeQuestion(id: string, askedBy: string, askedAt: number): void {
  database.run(
    `INSERT INTO dashboard_questions (id, dashboard_id, version, time_from, time_to, time_zone,
       variables, hidden_markers, explain_only, asked_by, asked_at, question, answer, citations,
       evidence, usage, tokens)
     VALUES (?, 'd', 1, 0, 1, 'UTC', '{}', '[]', 0, ?, ?, 'Why?', 'Because.', '[]', '[]', '{}', 10)`,
    [id, askedBy, askedAt],
  );
}

/**
 * Stores the dashboard `d`, an explanation of it by grace, a question by ada at the same time, and
 * a question by grace a little later.
 */
function storeDashboardRecords(): void {
  database.run(
    "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'D', 0, 0)",
  );
  database.run(
    `INSERT INTO panel_explanations (id, dashboard_id, version, panel_id, explained_by,
       explained_at, text, usage, tokens)
     VALUES ('e1', 'd', 1, 'p1', 'grace', ?, 'It counts.', '{}', 10)`,
    [100 * minute],
  );
  storeQuestion('q1', 'ada', 100 * minute);
  storeQuestion('q2', 'grace', 103 * minute);
}

/**
 * The feature of each event.
 *
 * @returns The id and feature of each, by id.
 */
function features(): Record<string, string | null> {
  const rows = database
    .query<{ id: string; feature: string | null }, []>('SELECT id, feature FROM usage_events')
    .all();
  return Object.fromEntries(rows.map((row) => [row.id, row.feature]));
}

describe('the usage feature migration', () => {
  test('fills the feature of past steps: threads build, answers ask or explain', () => {
    const migrationsDir = migrateBeforeFeature();
    storeDashboardRecords();
    storeStep('thread-step', 50 * minute, { thread: 't1', job: 'build' });
    storeStep('tags', 51 * minute, { job: 'metadata' });
    const explained = { job: 'answer', user: 'grace', dashboard: 'd' };
    storeStep('explanation', 101 * minute, explained);
    storeStep('long-after', 120 * minute, explained);
    storeStep('question', 102 * minute, { job: 'answer', user: 'ada', dashboard: 'd' });
    storeStep('later-question', 104 * minute, explained);
    database.run(
      "INSERT INTO usage_events (id, at, kind, dashboard_id) VALUES ('view', 1, 'pinned_view', 'd')",
    );
    copyFileSync(
      join(shipped, '0006-usage-feature.sql'),
      join(migrationsDir, '0006-usage-feature.sql'),
    );
    expect(runMigrations(database, migrationsDir)).toEqual(['0006-usage-feature.sql']);
    expect(features()).toEqual({
      'thread-step': 'building',
      tags: 'building',
      explanation: 'explanation',
      'long-after': 'question',
      question: 'question',
      'later-question': 'question',
      view: null,
    });
  });

  test('refuses a feature it does not know', () => {
    runMigrations(database);
    expect(() =>
      database.run(
        "INSERT INTO usage_events (id, at, kind, feature) VALUES ('x', 1, 'model', 'chatting')",
      ),
    ).toThrow('CHECK');
  });
});
