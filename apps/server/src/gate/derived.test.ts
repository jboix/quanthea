import { describe, expect, test } from 'bun:test';
import type { AccessLevel, ColumnOrigin, Frame } from '@quanthea/shared';
import { everythingShown } from '../query/scope/object-scope.ts';
import { derivedParts, modelDerivedResult } from './derived.ts';
import { derivedFrom, resultMethods } from './panel-results.ts';
import type { GateSubject } from './subject.ts';
import { modelPanelResult } from './test-run.ts';

/**
 * A connector at a level.
 *
 * @param name - Its name, and its id.
 * @param accessLevel - The level.
 * @param hiddenFields - Its hidden fields.
 * @returns The connector.
 */
function subject(name: string, accessLevel: AccessLevel, hiddenFields: string[] = []): GateSubject {
  return {
    id: name,
    name,
    kind: 'postgres',
    accessLevel,
    hiddenFields,
    scope: everythingShown,
    descriptions: {},
  };
}

const events = subject('events', 4);
const titles = subject('titles', 2, ['owner']);
const subjects = new Map([
  ['A', events],
  ['B', titles],
]);

const table: Frame = {
  refId: 'A',
  fields: [
    { name: 'show', type: 'string' },
    { name: 'plays', type: 'number' },
    { name: 'title', type: 'string' },
    { name: 'owner', type: 'string' },
    { name: 'per_title', type: 'number' },
    { name: 'Web', type: 'number' },
  ],
  values: [['s1'], [10], ['Morning'], ['ann'], [5], [3]],
  meta: { rowCount: 1, truncated: false, durationMs: 1 },
};

const origins: ColumnOrigin[] = [
  { column: 'show', from: ['A'] },
  { column: 'plays', from: ['A'] },
  { column: 'title', from: ['B'] },
  { column: 'owner', from: ['B'] },
  { column: 'per_title', from: ['A', 'B'] },
  { column: 'Web', from: ['B'], nameFromData: true },
];

describe('a derived table through the gate', () => {
  test("each connector's columns at its own level, a mixed one at the stricter", () => {
    const parts = derivedParts(table, origins, subjects);
    expect(parts.map((part) => part.subject.name)).toEqual(['events', 'titles']);
    expect(parts[0]?.frame.fields.map((field) => field.name)).toEqual(['show', 'plays']);
    expect(parts[1]?.frame.fields.map((field) => field.name)).toEqual([
      'title',
      'per_title',
      'column 1',
    ]);
    expect(parts[1]?.frame.values).toEqual([['Morning'], [5], [3]]);
  });

  test('a name from data stays where the level shows values', () => {
    const open = new Map([...subjects, ['B', subject('titles', 3)]]);
    const parts = derivedParts(table, origins, open);
    expect(parts[1]?.frame.fields.map((field) => field.name)).toContain('Web');
  });

  test('gives the model one part per connector, rows only where the level allows', () => {
    const result = modelDerivedResult([table], origins, subjects);
    if (!result.ok) throw new Error('expected a result');
    expect(result.parts?.map((part) => part.connector)).toEqual(['events', 'titles']);
    const [rows, shape] = result.parts ?? [];
    expect(rows?.ok && rows.frames?.[0]?.rows).toEqual([['s1', 10]]);
    expect(shape?.ok && shape.frames?.[0]?.rows).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('ann');
    expect(JSON.stringify(result)).not.toContain('Web');
  });

  test('a table from one connector reads as any result of it', () => {
    const plain = [
      { column: 'show', from: ['A'] },
      { column: 'plays', from: ['A'] },
    ];
    const frame = { ...table, fields: table.fields.slice(0, 2), values: table.values.slice(0, 2) };
    expect(modelDerivedResult([frame], plain, subjects)).toEqual(modelPanelResult(events, [frame]));
  });

  test('a column from a connector the gate does not know is left out', () => {
    const unknown = [{ column: 'show', from: ['C'] }];
    expect(derivedParts(table, unknown, subjects)).toEqual([]);
  });
});

describe('panel results with operations', () => {
  const methods = resultMethods(
    () =>
      new Map([
        ['events', events],
        ['titles', titles],
      ]),
  );
  const derived = derivedFrom(
    {
      queries: [
        { refId: 'A', connector: 'events' },
        { refId: 'B', connector: 'titles' },
      ],
    },
    { origins },
  );

  test('the frames a chart is completed from leave out what each connector hides', () => {
    const [frame] = methods.visibleFrames('events', [table], derived);
    // "Web" is named by data: a role never names it, whatever the level.
    expect(frame?.fields.map((field) => field.name)).toEqual([
      'show',
      'plays',
      'title',
      'per_title',
    ]);
  });

  test('a panel result is cut by connector, and a plain one is not', () => {
    const result = methods.panelResult('events', { frames: [table], error: null, derived });
    expect(result.ok && result.parts?.length).toBe(2);
    expect(derivedFrom({ queries: [] }, {})).toBeUndefined();
  });
});
