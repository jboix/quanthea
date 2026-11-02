import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import { QueryError } from '../queries/index.ts';
import { withSections } from './sections.ts';

const query = { refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1' };
const view = { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } };

const spec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Platforms',
  time: { from: 'now-6h', to: 'now' },
  panels: [
    { id: 'plays', title: 'Plays', grid: { x: 0, y: 0, w: 6, h: 4 }, queries: [query], view },
    {
      id: 'errors',
      title: 'Errors',
      grid: { x: 6, y: 0, w: 6, h: 4 },
      queries: [query],
      view,
      section: 'old',
    },
  ],
  sections: [{ id: 'old', title: 'Old' }],
});

describe('the sections of an edit', () => {
  test('replace the sections, and set each panel named by id or title', () => {
    const edited = withSections(spec, [
      { id: 'web', title: 'Web', folded: true, panels: ['Plays'] },
    ]);
    expect(edited.sections).toEqual([{ id: 'web', title: 'Web', folded: true }]);
    expect(edited.panels.map((panel) => panel.section)).toEqual(['web', undefined]);
  });

  test('leave the dashboard as it is when the edit gives none', () => {
    expect(withSections(spec, undefined)).toBe(spec);
  });

  test('refuse a section that does not fit its form, or names no panel', () => {
    expect(() => withSections(spec, [{ id: 'Web Site', title: 'Web' }])).toThrow(QueryError);
    expect(() => withSections(spec, [{ id: 'web', title: 'Web', panels: ['Latency'] }])).toThrow(
      'A section names "Latency", which no panel is. The panels are: plays (Plays), errors (Errors).',
    );
  });
});
