import { describe, expect, test } from 'bun:test';
import {
  type DashboardLayout,
  dashboardLayoutEndpoints,
  reportLayoutEndpoints,
} from '@quanthea/shared';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import { isLayoutIntent, runLayoutIntent } from './layout-data.ts';

/** A layout of one panel. */
const layout: DashboardLayout = {
  panels: [{ id: 'a', grid: { x: 0, y: 0, w: 6, h: 3 }, hidden: false }],
};

/**
 * An API client that records each call and answers with a revision.
 *
 * @returns The client and the calls made, as the method, the path and the input.
 */
function recorder() {
  const calls: unknown[] = [];
  const call = (endpoint: { method: string; path: string }, input: unknown) => {
    calls.push([endpoint.method, endpoint.path, input]);
    return Promise.resolve({ revision: 2 });
  };
  return { api: { call } as unknown as ApiClient, calls };
}

describe('layout intents', () => {
  test('a save goes to the layouts of the kind it is given', async () => {
    const { api, calls } = recorder();
    const save = { intent: 'layout', version: 3, layout, basedOn: 1 } as const;
    await runLayoutIntent(api, dashboardLayoutEndpoints, 'd1', save);
    await runLayoutIntent(api, reportLayoutEndpoints, 'r1', save);
    const body = { layout, basedOn: 1 };
    expect(calls).toEqual([
      [
        'POST',
        '/dashboards/:id/versions/:version/layouts',
        { params: { id: 'd1', version: '3' }, body },
      ],
      [
        'POST',
        '/reports/:id/versions/:version/layouts',
        { params: { id: 'r1', version: '3' }, body },
      ],
    ]);
  });

  test('a restore names the revision, and what it started from', async () => {
    const { api, calls } = recorder();
    const restore = { intent: 'restoreLayout', version: 1, revision: 2, basedOn: 4 } as const;
    const outcome = await runLayoutIntent(api, reportLayoutEndpoints, 'r1', restore);
    expect(outcome).toEqual({ ok: true, value: { revision: 2 } } as never);
    expect(calls).toEqual([
      [
        'POST',
        '/reports/:id/versions/:version/layouts/:revision/restore',
        { params: { id: 'r1', version: '1', revision: '2' }, body: { basedOn: 4 } },
      ],
    ]);
  });

  test('a refusal comes back as a message', async () => {
    const refuse = () => Promise.reject(new ApiError('conflict', 409, 'Reload it first.'));
    const api = { call: refuse } as unknown as ApiClient;
    const save = { intent: 'layout', version: 1, layout, basedOn: null } as const;
    expect(await runLayoutIntent(api, reportLayoutEndpoints, 'r1', save)).toEqual({
      ok: false,
      message: 'Reload it first.',
    });
  });

  test('are told apart from the other intents of a screen', () => {
    expect(isLayoutIntent({ intent: 'layout' })).toBe(true);
    expect(isLayoutIntent({ intent: 'restoreLayout' })).toBe(true);
    expect(isLayoutIntent({ intent: 'activate' })).toBe(false);
  });
});
