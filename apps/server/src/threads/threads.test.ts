import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Plan } from '@quanthea/shared';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createDashboardRepository } from '../db/dashboard-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { auditActions } from '../db/test/inspect.ts';
import { createThreadRepository } from '../db/thread-repository.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { createThreads, type Threads } from './threads.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let threads: Threads;
let clock = 1000;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  threads = createThreads({
    repository: createThreadRepository(database),
    audit: createAuditRepository(database),
    now: () => clock++,
  });
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const plan: Plan = {
  title: 'Checkout incident',
  variables: ['time = last 6 hours'],
  panels: [{ kind: 'stat', title: 'Error rate', language: 'promql', connector: 'prometheus-dev' }],
};

/**
 * The error a call throws.
 *
 * @param call - The call.
 * @returns The error.
 */
function failureOf(call: () => unknown): AppError {
  try {
    call();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to fail.');
}

describe('threads', () => {
  test('start idle, and walk through plan, approval and build', () => {
    const { id } = threads.create('editor-1');
    expect(threads.row(id).state).toBe('idle');
    const proposed = threads.proposePlan(id, plan, false);
    expect(proposed).toMatchObject({ status: 'pending', body: plan });
    expect(threads.row(id).state).toBe('plan_pending');
    expect(threads.decidePlan(id, proposed.id, 'approve', 'editor-1').state).toBe('building');
    expect(threads.apply(id, 'built')).toBe('ready');
    expect(auditActions(database)).toEqual(['plan.approve']);
  });

  test('refuse events the state does not allow', () => {
    const { id } = threads.create('editor-1');
    expect(failureOf(() => threads.apply(id, 'approve')).message).toBe(
      'A thread in state "idle" cannot approve.',
    );
    expect(failureOf(() => threads.apply(id, 'built')).code).toBe('bad_request');
  });

  test('supersede a pending plan with a new one, and decide a plan only once', () => {
    const { id } = threads.create('editor-1');
    const first = threads.proposePlan(id, plan, false);
    const second = threads.proposePlan(id, { ...plan, title: 'Second' }, false);
    expect(threads.get(id).plans.map((each) => [each.id, each.status])).toEqual([
      [first.id, 'superseded'],
      [second.id, 'pending'],
    ]);
    expect(failureOf(() => threads.decidePlan(id, first.id, 'approve', 'editor-1')).message).toBe(
      'The plan is superseded already.',
    );
    threads.decidePlan(id, second.id, 'reject', 'editor-1');
    expect(threads.row(id).state).toBe('idle');
  });

  test('approve plans straight away when approval is off', () => {
    const { id } = threads.create('editor-1');
    expect(threads.proposePlan(id, plan, true).status).toBe('approved');
    expect(threads.row(id).state).toBe('building');
  });

  test('keep a plan to its own thread', () => {
    const one = threads.create('editor-1');
    const other = threads.create('editor-1');
    const proposed = threads.proposePlan(one.id, plan, false);
    expect(
      failureOf(() => threads.decidePlan(other.id, proposed.id, 'approve', 'editor-1')).code,
    ).toBe('not_found');
  });

  test('store the conversation, keeping the time and author of known messages', () => {
    const { id } = threads.create('editor-1');
    const question = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'What happened?' }] };
    threads.saveMessages(id, [question], 'editor-1');
    const answer = {
      id: 'm2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'A deploy.' }],
      metadata: { tokens: 12 },
    };
    threads.saveMessages(id, [question, answer], 'editor-2');
    expect(threads.get(id).messages).toEqual([question, answer]);
    const rows = createThreadRepository(database).messages(id);
    expect(rows.map((row) => row.actor)).toEqual(['editor-1', null]);
  });

  test('attach a dashboard, count tokens, and delete a thread', () => {
    const { id } = threads.create('editor-1');
    const dashboard = {
      id: 'dashboard-1',
      title: 'Checkout',
      description: null,
      tags: [],
      parentDashboardId: null,
      parentVersion: null,
      pinnedVersionId: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const version = {
      id: 'version-1',
      dashboardId: 'dashboard-1',
      version: 1,
      spec: {},
      changeSummary: null,
      pinnedAt: null,
      actor: null,
      createdAt: 1,
    };
    createDashboardRepository(database).create(dashboard, version);
    threads.attachDashboard(id, 'dashboard-1', 'Checkout');
    threads.attachDashboard(id, 'dashboard-1', 'Renamed');
    threads.addTokens(id, 1200);
    threads.addTokens(id, 300);
    expect(threads.get(id)).toMatchObject({
      dashboardId: 'dashboard-1',
      title: 'Checkout',
      tokensUsed: 1500,
    });
    threads.remove(id, 'editor-1');
    expect(failureOf(() => threads.get(id)).code).toBe('not_found');
  });
});
