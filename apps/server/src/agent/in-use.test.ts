import { describe, expect, test } from 'bun:test';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { connectorsInUse } from './in-use.ts';

const connectors = [
  { name: 'metrics', kind: 'prometheus', language: 'promql' },
  { name: 'orders', kind: 'postgres', language: 'sql' },
  { name: 'events', kind: 'opensearch', language: 'search' },
];

/**
 * The services the lookup reads, for a thread in a state with a draft.
 *
 * @param thread - The thread's kind and state, and whether it has a draft, which reads `events`.
 * @returns The context.
 */
function contextOf(thread: { kind?: string; state: string; draft?: boolean }) {
  const row = { kind: thread.kind ?? 'dashboard', state: thread.state, dashboardId: 'd1' };
  const versions = thread.draft ? [{ version: 1 }] : [];
  return {
    threadId: 't1',
    threads: { row: () => ({ ...row, reportId: null }) },
    dashboards: {
      get: () => ({ versions }),
      getVersion: () => ({ spec: eventsSpec() }),
    },
    reports: undefined,
    modelView: { connectors: () => connectors },
  } as never;
}

/** A plan whose panels read some connectors. */
const planOn = (status: string, ...names: string[]) => ({
  status,
  body: { title: 'Plan', panels: names.map((connector) => ({ title: 'P', connector })) },
});

/**
 * The names of the connectors in use.
 *
 * @param thread - The thread.
 * @param plans - Its plans.
 * @returns The names.
 */
function inUse(thread: Parameters<typeof contextOf>[0], plans: ReturnType<typeof planOn>[] = []) {
  return connectorsInUse(contextOf(thread), plans).map((connector) => connector.name);
}

describe('the connectors a run is about', () => {
  test('are all of them while the thread plans, and in an alert thread', () => {
    expect(inUse({ state: 'idle' })).toEqual(['metrics', 'orders', 'events']);
    expect(inUse({ state: 'plan_pending' }, [planOn('pending', 'orders')])).toHaveLength(3);
    expect(inUse({ kind: 'alert', state: 'ready', draft: true })).toHaveLength(3);
  });

  test('are those of the approved plan while it is built', () => {
    expect(inUse({ state: 'building' }, [planOn('approved', 'metrics', 'orders')])).toEqual([
      'metrics',
      'orders',
    ]);
  });

  test('are those the draft reads, with those of a plan approved to change it', () => {
    expect(inUse({ state: 'ready', draft: true })).toEqual(['events']);
    const plans = [planOn('approved', 'events'), planOn('approved', 'orders')];
    expect(inUse({ state: 'building', draft: true }, plans)).toEqual(['orders', 'events']);
    expect(inUse({ state: 'ready', draft: true }, [planOn('rejected', 'orders')])).toEqual([
      'events',
    ]);
  });

  test('are all of them when the plan and the draft name none that is connected', () => {
    expect(inUse({ state: 'building' }, [planOn('approved', 'gone')])).toHaveLength(3);
    expect(inUse({ state: 'ready' })).toHaveLength(3);
  });
});
