import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createDashboardRepository } from './dashboard-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';
import { createQuestionRepository, type QuestionRow } from './question-repository.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

const dashboardId = '01K0000000000000000000000D';

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const dashboard = {
    id: dashboardId,
    title: 'Checkout incident',
    description: null,
    tags: [],
    parentDashboardId: null,
    parentVersion: null,
    pinnedVersionId: null,
    deletedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
  const version = {
    id: '01K0000000000000000000000V',
    dashboardId,
    version: 1,
    spec: { specVersion: 1, title: 'Checkout incident' },
    changeSummary: 'imported',
    pinnedAt: null,
    actor: 'admin-1',
    createdAt: 1000,
  };
  createDashboardRepository(database).create(dashboard, version);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * A question with its answer, or its failure when the answer is `null`.
 *
 * @param id - Its id.
 * @param question - The question.
 * @param answer - The answer's text, or `null` for a failure.
 * @param askedAt - When it was asked.
 * @returns The row.
 */
function questionRow(
  id: string,
  question: string,
  answer: string | null,
  askedAt: number,
): QuestionRow {
  return {
    id,
    dashboardId,
    version: 1,
    parentId: null,
    timeFrom: 1000,
    timeTo: 2000,
    timeZone: 'Europe/Zurich',
    variables: { env: 'prod' },
    hiddenMarkers: [],
    explainOnly: false,
    askedBy: 'analyst-1',
    askedAt,
    question,
    answer,
    failure: answer === null ? 'No model is set up.' : null,
    citations: answer === null ? [] : [{ n: 1, panelId: 'errors' }],
    evidence: [],
    usage: { 'claude-sonnet-5': { input: 20, cachedInput: 0, cacheWrite: 0, output: 10 } },
    tokens: 30,
  };
}

describe('question repository', () => {
  test('stores questions with their outcome and lists them, the newest first', () => {
    const repository = createQuestionRepository(database);
    const answered = questionRow('q1', 'What happened at 14:00?', 'Errors rose [1].', 3000);
    const failed = questionRow('q2', 'Why?', null, 4000);
    repository.insert(answered);
    repository.insert(failed);
    expect(repository.get('q1')).toEqual(answered);
    expect(repository.list(dashboardId, 10).map((row) => row.id)).toEqual(['q2', 'q1']);
    expect(repository.list(dashboardId, 1).map((row) => row.id)).toEqual(['q2']);
    expect(repository.get('q2')).toMatchObject({ answer: null, failure: 'No model is set up.' });
  });

  test('keeps a follow-up linked to the question it follows', () => {
    const repository = createQuestionRepository(database);
    repository.insert(questionRow('q1', 'What happened?', 'Errors rose [1].', 3000));
    repository.insert({ ...questionRow('q2', 'Why?', 'A deploy [1].', 4000), parentId: 'q1' });
    expect(repository.get('q2')?.parentId).toBe('q1');
  });

  test('finds answered questions by words of the question or of the answer', () => {
    const repository = createQuestionRepository(database);
    repository.insert(questionRow('q1', 'What happened to checkout?', 'Errors rose [1].', 3000));
    repository.insert(questionRow('q2', 'Is latency fine?', 'Payments slowed down [1].', 4000));
    repository.insert(questionRow('q3', 'Checkout errors again?', null, 5000));
    const ids = (words: string[]) => repository.search(dashboardId, words, 3).map(({ id }) => id);
    expect(ids(['checkout'])).toEqual(['q1']);
    expect(ids(['error'])).toEqual(['q1']);
    expect(ids(['payment'])).toEqual(['q2']);
    expect(ids(['checkout', 'payments']).sort()).toEqual(['q1', 'q2']);
    expect(ids(['"OR*'])).toEqual([]);
    expect(ids([])).toEqual([]);
    expect(repository.search('another', ['checkout'], 3)).toEqual([]);
  });

  test('goes with its dashboard, out of the index too', () => {
    const repository = createQuestionRepository(database);
    repository.insert(questionRow('q1', 'What happened to checkout?', 'Errors rose [1].', 3000));
    repository.insert({ ...questionRow('q2', 'Why?', 'A deploy [1].', 4000), parentId: 'q1' });
    database.run('DELETE FROM dashboards');
    expect(repository.list(dashboardId, 10)).toEqual([]);
    const indexed = database.query<{ count: number }, []>(
      'SELECT count(*) AS count FROM question_fts',
    );
    expect(indexed.get()?.count).toBe(0);
  });
});
