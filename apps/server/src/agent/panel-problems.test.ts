import { describe, expect, test } from 'bun:test';
import type { DashboardSpec } from '@quanthea/shared';
import { atMarkerSets } from './panel-problems.ts';

/**
 * A spec with two sets of markers and the given variables; only what the issues read.
 *
 * @param variables - The names of its variables.
 * @returns The spec.
 */
function specWith(...variables: string[]): DashboardSpec {
  return {
    variables: variables.map((name) => ({ kind: 'text', name, default: 'x' })),
    annotations: [{ id: 'deploys' }, { id: 'incidents' }],
  } as unknown as DashboardSpec;
}

const unknownTeam = { path: 'annotations[1].query.sql', message: 'Unknown variables: :team.' };

describe('issues of the sets of markers an edit sets', () => {
  test('moves them to the set the edit sent, with the variables there are', () => {
    const issues = atMarkerSets(specWith('service', 'env'), [{ id: 'incidents' }], [unknownTeam]);
    expect(issues).toEqual([
      {
        path: 'markers[0]',
        message:
          'Unknown variables: :team. The dashboard\'s variables are $service, $env: use one, or declare it in "variables".',
      },
    ]);
  });

  test('says when the dashboard has no variables, and keeps other messages as they are', () => {
    const failing = { path: 'annotations[0].query.sql', message: 'Use one read statement.' };
    const issues = atMarkerSets(
      specWith(),
      [{ id: 'deploys' }, { id: 'incidents' }],
      [failing, unknownTeam],
    );
    expect(issues).toEqual([
      { path: 'markers[0]', message: 'Use one read statement.' },
      {
        path: 'markers[1]',
        message:
          'Unknown variables: :team. The dashboard has no variables: declare it in "variables", or filter on a value.',
      },
    ]);
  });

  test('leaves the issues of panels and of sets the edit leaves out where they are', () => {
    const panel = { path: 'panels[0].queries[0].sql', message: 'Unknown variables: :team.' };
    expect(atMarkerSets(specWith(), [{ id: 'deploys' }], [panel, unknownTeam])).toEqual([
      panel,
      unknownTeam,
    ]);
  });
});
