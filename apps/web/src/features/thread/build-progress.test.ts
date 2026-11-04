import { describe, expect, test } from 'bun:test';
import type { Plan, Repair } from '@quanthea/shared';
import { buildProgress, buildsPanels, plansBuilt } from './build-progress.ts';
import type { ThreadMessage, ThreadPart } from './messages.ts';

/** A plan of three panels. */
const plan: Plan = {
  title: 'Orders',
  variables: [],
  panels: ['Paid orders', 'Orders per channel', 'Deploys'].map((title) => ({
    kind: 'stat',
    title,
    language: 'sql',
    connector: 'shop',
  })),
} as Plan;

/**
 * A tool part.
 *
 * @param name - The tool.
 * @param state - How far it got.
 * @param input - What it was sent.
 * @param output - What it returned.
 * @returns The part.
 */
function tool(name: string, state: string, input?: unknown, output?: unknown): ThreadPart {
  return {
    type: `tool-${name}`,
    toolCallId: `${name}-${state}`,
    state,
    input,
    output,
  } as ThreadPart;
}

/**
 * A write of some panels.
 *
 * @param titles - The panels' titles.
 * @param output - What it returned; still running when left out.
 * @returns The part.
 */
function write(titles: string[], output?: { ok: boolean; version?: number }): ThreadPart {
  const input = { panels: titles.map((title) => ({ title })) };
  return tool('edit_dashboard', output ? 'output-available' : 'input-available', input, output);
}

/**
 * A failed try of some panels.
 *
 * @param attempt - How many writes failed so far.
 * @param titles - The panels that failed.
 * @returns The part.
 */
function failed(attempt: number, titles: string[]): ThreadPart {
  const panels = titles.map((title) => ({ id: title, title, problems: ['no such column'] }));
  const data: Repair = { attempt, of: 3, outcome: 'failed', panels, issues: [] };
  return { type: 'data-repair', data } as ThreadPart;
}

describe('the progress of a build', () => {
  test('reads the data first, then has a step per planned panel', () => {
    const parts = [tool('describe', 'output-available'), tool('describe', 'input-available')];
    const progress = buildProgress(parts, plan, true);
    expect(progress.steps.map((step) => [step.title, step.state])).toEqual([
      ['Read the data · 2 looks', 'running'],
      ['Paid orders', 'waiting'],
      ['Orders per channel', 'waiting'],
      ['Deploys', 'waiting'],
    ]);
    expect([progress.ready, progress.planned]).toEqual([0, 3]);
  });

  test('marks saved panels ready, a failed one as retrying, a written one as running', () => {
    const parts = [
      tool('describe', 'output-available'),
      write(['paid orders', 'Orders per channel'], { ok: false }),
      failed(1, ['Orders per channel']),
      write(['Paid orders'], { ok: true, version: 1 }),
      write(['Deploys']),
    ];
    const progress = buildProgress(parts, plan, true);
    expect(progress.steps.slice(1)).toEqual([
      { title: 'Paid orders', state: 'done' },
      { title: 'Orders per channel', state: 'retrying', note: 'Fixing its query · second try' },
      { title: 'Deploys', state: 'running' },
    ]);
    expect([progress.ready, progress.retries, progress.version]).toEqual([1, 1, 1]);
  });

  test('marks a panel no write saved as missing once the build ends', () => {
    const parts = [write(['Paid orders'], { ok: true, version: 2 })];
    const states = buildProgress(parts, plan, false).steps.map((step) => step.state);
    expect(states).toEqual(['done', 'missing', 'missing']);
  });

  test('counts a planned panel written under a title of its own', () => {
    const parts = [
      write(['Paid orders', 'Orders by channel', 'Deploys'], { ok: true, version: 1 }),
    ];
    const progress = buildProgress(parts, plan, false);
    expect(progress.ready).toBe(3);
    expect(progress.steps.map((step) => step.title)).toEqual([
      'Paid orders',
      'Orders per channel',
      'Deploys',
    ]);
  });

  test('tells work that writes a dashboard from work that only reads', () => {
    expect(buildsPanels([write(['Paid orders'])])).toBe(true);
    expect(buildsPanels([tool('describe', 'output-available')])).toBe(false);
  });
});

describe('the plan an answer builds', () => {
  const planPart = { type: 'data-plan', data: { planId: 'p1', body: plan } } as ThreadPart;
  const view = (status: string) =>
    [{ id: 'p1', status, body: plan, decidedBy: null, createdAt: 0, decidedAt: null }] as never;
  const saved = write(['Paid orders'], { ok: true, version: 1 });

  test('is the plan shown in it, built there once approved, and no later answer', () => {
    const messages = [
      { id: 'a', role: 'assistant', parts: [planPart, saved] },
      { id: 'b', role: 'user', parts: [] },
      { id: 'c', role: 'assistant', parts: [write(['Paid orders'], { ok: true, version: 2 })] },
    ] as ThreadMessage[];
    expect(plansBuilt(messages, view('approved'))).toEqual([plan, undefined, undefined]);
    expect(plansBuilt(messages, view('rejected'))).toEqual([undefined, undefined, undefined]);
  });

  test('carries to the next answers until one saves a write, as after a stopped build', () => {
    const failed = write(['Paid orders'], { ok: false });
    const messages = [
      { id: 'a', role: 'assistant', parts: [planPart] },
      { id: 'b', role: 'assistant', parts: [failed] },
      { id: 'c', role: 'assistant', parts: [saved] },
      { id: 'd', role: 'assistant', parts: [saved] },
    ] as ThreadMessage[];
    expect(plansBuilt(messages, view('approved'))).toEqual([plan, plan, plan, undefined]);
  });
});
