import { describe, expect, test } from 'bun:test';
import { type Definition, definitionSchema } from '@quanthea/shared';
import type { ThreadMessage } from './messages.ts';
import { bodyOfRequest, builderRequestOf, withBody } from './panel-body.ts';

const ratio = {
  kind: 'search-ratio',
  connector: 'events',
  index: 'core_events',
  match: [{ field: 'event_name', value: 'ERROR' }],
  of: [{ field: 'event_name', value: 'START' }],
  by: 'platform',
  over: 'time',
};

/**
 * A thread whose edits wrote panels.
 *
 * @param edits - Each edit's panels, and whether it saved a version.
 * @returns The messages.
 */
function thread(...edits: { panels: unknown[]; ok: boolean }[]): ThreadMessage[] {
  const parts = edits.map((edit, index) => ({
    type: 'tool-edit_dashboard',
    toolCallId: `call-${index}`,
    state: 'output-available',
    input: { panels: edit.panels },
    output: { ok: edit.ok },
  }));
  return [{ id: 'a1', role: 'assistant', parts }] as unknown as ThreadMessage[];
}

describe('a built panel', () => {
  test('is found by its title or by the panel it replaced, the latest saved edit first', () => {
    const first = { title: 'Error rate', data: ratio };
    const rebuilt = { title: 'Error share', replaces: 'error-rate', data: { ...ratio, by: 'os' } };
    const failed = { title: 'Error rate', data: { ...ratio, index: 'other' } };
    const messages = thread(
      { panels: [first], ok: true },
      { panels: [rebuilt], ok: true },
      { panels: [failed], ok: false },
    );
    expect(builderRequestOf(messages, { id: 'error-rate', title: 'Error share' })).toMatchObject({
      by: 'os',
    });
  });

  test('built with a raw query, or not built in the thread, has no builder request', () => {
    const raw = {
      title: 'Raw',
      data: { kind: 'raw', connector: 'events', language: 'sql', query: 'x' },
    };
    const messages = thread({ panels: [raw], ok: true });
    expect(builderRequestOf(messages, { id: 'raw', title: 'Raw' })).toBeUndefined();
    expect(builderRequestOf(messages, { id: 'other', title: 'Other' })).toBeUndefined();
  });
});

describe('a body from a panel', () => {
  test('keeps what the filters mean and leaves how the panel presents them', () => {
    expect(bodyOfRequest(ratio)).toEqual({
      shape: 'ratio',
      request: {
        kind: 'search-ratio',
        index: 'core_events',
        match: [{ field: 'event_name', value: 'ERROR' }],
        of: [{ field: 'event_name', value: 'START' }],
      },
    });
    expect(bodyOfRequest({ kind: 'sql-stat', table: 't' }).shape).toBe('measure');
    expect(bodyOfRequest({ kind: 'sql-rows', table: 't' }).shape).toBe('segment');
  });

  test('replaces the body a definition had for that language', () => {
    const definition: Definition = definitionSchema.parse({
      id: 'error-rate',
      name: 'Error rate',
      meaning: 'ERROR over START.',
      bodies: [{ shape: 'ratio', request: { kind: 'search-ratio', index: 'old' } }],
    });
    const replaced = withBody(definition, bodyOfRequest(ratio));
    expect(replaced.bodies).toHaveLength(1);
    expect(replaced.bodies[0]?.request.index).toBe('core_events');
  });
});
