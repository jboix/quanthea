import { describe, expect, test } from 'bun:test';
import type { Panel } from './dashboard.ts';
import { copyLimit, sectionGroups, sectionProblems } from './sections.ts';
import type { Variable } from './variables.ts';

/**
 * A panel in a section, or in none.
 *
 * @param id - Its id.
 * @param section - Its section, if any.
 * @returns The panel.
 */
function panel(id: string, section?: string): Panel {
  const view = { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } } as const;
  const query = { refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1' } as const;
  const grid = { x: 0, y: 0, w: 6, h: 4 };
  return { id, title: id, grid, queries: [query], view, ...(section ? { section } : {}) };
}

describe('sections', () => {
  const sections = [
    { id: 'web', title: 'Web' },
    { id: 'apps', title: 'Apps' },
  ];

  test('group the panels of no section first, then each section in order', () => {
    const groups = sectionGroups({
      panels: [panel('a', 'apps'), panel('b'), panel('c', 'web')],
      sections,
    });
    expect(groups.map((group) => [group.section?.id, group.panels.map((each) => each.id)])).toEqual(
      [
        [undefined, ['b']],
        ['web', ['c']],
        ['apps', ['a']],
      ],
    );
  });

  test('refuse an id used twice and a panel naming a section there is not', () => {
    const twice = [...sections, { id: 'web', title: 'Web again' }];
    expect(sectionProblems({ panels: [panel('a', 'tv')], sections: twice, variables: [] })).toEqual(
      [
        { path: 'sections[2].id', message: 'Two sections are named "web".' },
        { path: 'panels[0].section', message: 'No section "tv": they are web, apps.' },
      ],
    );
    expect(sectionProblems({ panels: [panel('a', 'tv')], variables: [] })[0]?.message).toBe(
      'No section "tv": there are none.',
    );
  });
});

describe('a repeated section', () => {
  const several: Variable = {
    kind: 'custom',
    name: 'platform',
    options: ['web', 'ios', 'android'],
    default: ['web'],
    multi: true,
  };
  const one: Variable = { kind: 'custom', name: 'env', options: ['prod'], default: 'prod' };

  test('draws at most 12 copies, and at most 60 panels in all', () => {
    const panels = [panel('a', 'by'), panel('b', 'by'), panel('c')];
    expect(copyLimit({ panels }, 'by')).toBe(12);
    const many = Array.from({ length: 10 }, (_, index) => panel(`p${index}`, 'by'));
    expect(copyLimit({ panels: [...many, panel('top')] }, 'by')).toBe(5);
  });

  test('repeats over a declared variable that holds several values, with room for two copies', () => {
    const sections = [{ id: 'by', title: 'By platform', repeat: 'platform' }];
    const panels = [panel('a', 'by')];
    expect(sectionProblems({ panels, sections, variables: [several] })).toEqual([]);
    const messages = (variables: Variable[], repeat: string) =>
      sectionProblems({
        panels,
        sections: [{ ...sections[0], id: 'by', title: 'x', repeat }],
        variables,
      }).map((problem) => problem.message);
    expect(messages([one], 'env')[0]).toContain('$env holds one value');
    expect(messages([], 'platform')[0]).toBe('No variable $platform to repeat the section for.');
    const crowded = Array.from({ length: 31 }, (_, index) => panel(`p${index}`, 'by'));
    expect(sectionProblems({ panels: crowded, sections, variables: [several] })[0]?.message).toBe(
      'The section has too many panels to draw two copies within 60 panels.',
    );
  });
});
