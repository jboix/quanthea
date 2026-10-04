import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createConversationBinRepository } from './conversation-bin.ts';
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
 * An answered question of a conversation.
 *
 * @param id - Its id.
 * @param question - The question.
 * @param parentId - The question it follows up on, `null` for a first one.
 * @param rootId - Its conversation's first question.
 * @returns The row.
 */
function questionRow(
  id: string,
  question: string,
  parentId: string | null,
  rootId: string,
): QuestionRow {
  return {
    id,
    dashboardId,
    version: 1,
    parentId,
    rootId,
    timeFrom: 1000,
    timeTo: 2000,
    timeZone: 'Europe/Zurich',
    timeChosen: { from: 'now-1h', to: 'now' },
    variables: {},
    hiddenMarkers: [],
    explainOnly: false,
    askedBy: 'analyst-1',
    askedAt: 3000,
    question,
    answer: `${question} Answered [1].`,
    failure: null,
    citations: [{ n: 1, panelId: 'errors' }],
    evidence: [],
    usage: {},
    tokens: 30,
  };
}

/**
 * Stores a conversation of two questions, and another of one.
 *
 * @returns The question repository.
 */
function seed() {
  const questions = createQuestionRepository(database);
  questions.insert(questionRow('a1', 'What happened to checkout?', null, 'a1'));
  questions.insert(questionRow('a2', 'Why the payments errors?', 'a1', 'a1'));
  questions.insert(questionRow('b1', 'Is checkout latency fine?', null, 'b1'));
  return questions;
}

/**
 * How many rows the full-text index holds.
 *
 * @returns The count.
 */
function indexed(): number {
  const count = database.query<{ count: number }, []>('SELECT count(*) AS count FROM question_fts');
  return count.get()?.count ?? 0;
}

describe('conversation bin repository', () => {
  test('bins first questions only, once', () => {
    seed();
    const bin = createConversationBinRepository(database);
    expect(bin.bin('a2', 5000, 'analyst-1')).toBe(false);
    expect(bin.bin('nope', 5000, 'analyst-1')).toBe(false);
    expect(bin.bin('a1', 5000, 'analyst-1')).toBe(true);
    expect(bin.bin('a1', 6000, 'admin-1')).toBe(false);
    expect(bin.get('a1')).toEqual({
      id: 'a1',
      dashboardId,
      dashboardTitle: 'Checkout incident',
      question: 'What happened to checkout?',
      startedBy: 'analyst-1',
      startedAt: 3000,
      count: 2,
      binnedAt: 5000,
      binnedBy: 'analyst-1',
    });
  });

  test('hides a binned conversation from every read until it is restored', () => {
    const questions = seed();
    const bin = createConversationBinRepository(database);
    bin.bin('a1', 5000, 'analyst-1');
    expect(questions.conversations(dashboardId, 10).map(({ id }) => id)).toEqual(['b1']);
    expect(questions.conversation(dashboardId, 'a1')).toBeUndefined();
    expect(questions.inConversation(dashboardId, 'a1')).toEqual([]);
    expect(questions.get('a2')).toBeUndefined();
    expect(questions.search(dashboardId, ['payments'], 3)).toEqual([]);
    expect(questions.searchConversations(dashboardId, ['checkout'], 10)).toEqual([
      expect.objectContaining({ id: 'b1' }),
    ]);
    expect(bin.restore('a1')).toBe(true);
    expect(bin.restore('a1')).toBe(false);
    expect(questions.inConversation(dashboardId, 'a1')).toHaveLength(2);
  });

  test('lists by binning time, and purges a conversation with its index rows', () => {
    const questions = seed();
    const bin = createConversationBinRepository(database);
    bin.bin('a1', 5000, 'analyst-1');
    bin.bin('b1', 7000, 'admin-1');
    expect(bin.list().map(({ id }) => id)).toEqual(['b1', 'a1']);
    expect(bin.binnedBefore(6000)).toEqual(['a1']);
    expect(indexed()).toBe(3);
    expect(bin.purge('a1')).toBe(true);
    expect(bin.purge('a1')).toBe(false);
    expect(indexed()).toBe(1);
    expect(bin.list().map(({ id }) => id)).toEqual(['b1']);
    bin.restore('b1');
    expect(questions.conversations(dashboardId, 10).map(({ id }) => id)).toEqual(['b1']);
  });

  test('goes with its dashboard', () => {
    seed();
    const bin = createConversationBinRepository(database);
    bin.bin('a1', 5000, 'analyst-1');
    database.run('DELETE FROM dashboards');
    expect(bin.list()).toEqual([]);
  });
});
