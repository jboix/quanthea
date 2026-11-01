import { describe, expect, test } from 'bun:test';
import type { Operation } from '../spec/operations.ts';
import type { Dataset } from './contract.ts';
import { OperationError, runOperations } from './operations.ts';

const errors: Dataset = {
  dimensions: [
    { name: 'type', type: 'string' },
    { name: 'errors', type: 'number' },
    { name: 'sessions', type: 'number' },
  ],
  source: [
    ['network', 30, 1000],
    ['drm', 5, 0],
    ['decode', null, 500],
  ],
};

describe('calculate', () => {
  test('each function of two number columns, a new column last', () => {
    const cases = [
      ['ratio', [0.03, 0, null]],
      ['complement', [0.97, 0, null]],
      ['difference', [-970, 5, null]],
      ['sum', [1030, 5, null]],
      ['product', [30_000, 0, null]],
    ] as const;
    for (const [fn, expected] of cases) {
      const { table } = runOperations({ refId: 'A', table: errors }, [
        { op: 'calculate', name: 'value', fn, of: ['errors', 'sessions'] },
      ]);
      expect(table.dimensions.at(-1)).toEqual({ name: 'value', type: 'number' });
      expect(table.source.map((row) => row[3])).toEqual([...expected]);
    }
  });

  test('a column of the same name is replaced in place', () => {
    const { table } = runOperations({ refId: 'A', table: errors }, [
      { op: 'calculate', name: 'errors', fn: 'sum', of: ['errors', 'errors'] },
    ]);
    expect(table.dimensions.map((column) => column.name)).toEqual(['type', 'errors', 'sessions']);
    expect(table.source.map((row) => row[1])).toEqual([60, 10, null]);
  });

  test('a missing or text column fails, named by its step', () => {
    const missing = () =>
      runOperations({ refId: 'A', table: errors }, [
        { op: 'calculate', name: 'a', fn: 'sum', of: ['errors', 'sessions'] },
        { op: 'calculate', name: 'b', fn: 'ratio', of: ['errors', 'plays'] },
      ]);
    expect(missing).toThrow(OperationError);
    expect(missing).toThrow(
      'operations[1] (calculate): no column "plays" (columns: type, errors, sessions, a).',
    );
    const text = () =>
      runOperations({ refId: 'A', table: errors }, [
        { op: 'calculate', name: 'a', fn: 'sum', of: ['type', 'errors'] },
      ]);
    expect(text).toThrow('operations[0] (calculate): the column "type" does not hold numbers.');
  });
});

const errorsOverTime: Dataset = {
  dimensions: [
    { name: 'time', type: 'time' },
    { name: 'type', type: 'string' },
    { name: 'value', type: 'number' },
  ],
  source: [
    [1000, 'network', 3],
    [1000, 'drm', 1],
    [2000, 'network', 2],
  ],
};

const sessionsOverTime: Dataset = {
  dimensions: [
    { name: 'time', type: 'time' },
    { name: 'value', type: 'number' },
  ],
  source: [
    [1000, 100],
    [3000, 50],
  ],
};

describe('join', () => {
  const tables = new Map([['B', sessionsOverTime]]);
  const joinStep: Extract<Operation, { op: 'join' }> = {
    op: 'join',
    with: 'B',
    on: ['time'],
    how: 'outer',
    rename: { value: 'sessions' },
  };

  test('an outer join keeps every key, and a ratio follows', () => {
    const { table, origins } = runOperations(
      { refId: 'A', table: errorsOverTime },
      [joinStep, { op: 'calculate', name: 'share', fn: 'ratio', of: ['value', 'sessions'] }],
      tables,
    );
    expect(table.dimensions.map((column) => column.name)).toEqual([
      'time',
      'type',
      'value',
      'sessions',
      'share',
    ]);
    expect(table.source).toEqual([
      [1000, 'network', 3, 100, 0.03],
      [1000, 'drm', 1, 100, 0.01],
      [2000, 'network', 2, null, null],
      [3000, null, null, 50, null],
    ]);
    expect(origins).toEqual([
      { column: 'time', from: ['A', 'B'] },
      { column: 'type', from: ['A'] },
      { column: 'value', from: ['A'] },
      { column: 'sessions', from: ['B'] },
      { column: 'share', from: ['A', 'B'] },
    ]);
  });

  test('an inner join keeps the keys both have', () => {
    const { table, origins } = runOperations(
      { refId: 'A', table: errorsOverTime },
      [{ ...joinStep, how: 'inner' }],
      tables,
    );
    expect(table.source.map((row) => row[0])).toEqual([1000, 1000]);
    expect(origins[0]).toEqual({ column: 'time', from: ['A'] });
  });

  test('refuses a column both sides name, a key of another type, a missing key or query', () => {
    const run =
      (step: object, others = tables) =>
      () =>
        runOperations({ refId: 'A', table: errorsOverTime }, [step as never], others);
    expect(run({ ...joinStep, rename: undefined })).toThrow(
      'operations[0] (join): both tables have a column "value": rename the other\'s with "rename", or join on it.',
    );
    const textTime = new Map([
      [
        'B',
        {
          ...sessionsOverTime,
          dimensions: [
            { name: 'time', type: 'string' as const },
            { name: 'n', type: 'number' as const },
          ],
        },
      ],
    ]);
    expect(run({ ...joinStep, rename: { n: 'sessions' } }, textTime)).toThrow(
      'the column "time" holds time on one side and string',
    );
    expect(run({ ...joinStep, on: ['type'] })).toThrow(
      'B has no column "type" (columns: time, sessions)',
    );
    expect(run({ ...joinStep, with: 'C' })).toThrow('no query C in this panel');
    expect(run({ ...joinStep, rename: { plays: 'x' } })).toThrow('B has no column "plays"');
  });

  test('refuses a join that makes more rows than a query may return', () => {
    const many: Dataset = {
      dimensions: [{ name: 'k', type: 'string' }],
      source: Array.from({ length: 300 }, () => ['same']),
    };
    expect(() =>
      runOperations(
        { refId: 'A', table: many },
        [{ op: 'join', with: 'B', on: ['k'], how: 'inner' }],
        new Map([['B', many]]),
      ),
    ).toThrow('it makes 90000 rows, more than 50000');
  });
});

describe('append', () => {
  test('adds the rows under the table, columns matched by name after the rename', () => {
    const web: Dataset = {
      dimensions: [
        { name: 'application', type: 'string' },
        { name: 'errors', type: 'number' },
      ],
      source: [['www.example.ch', 12]],
    };
    const mobile: Dataset = {
      dimensions: [
        { name: 'app_id', type: 'string' },
        { name: 'errors', type: 'number' },
        { name: 'platform', type: 'string' },
      ],
      source: [['ch.example.ios', 4, 'iOS']],
    };
    const { table, origins } = runOperations(
      { refId: 'A', table: web },
      [{ op: 'append', with: 'B', rename: { app_id: 'application' } }],
      new Map([['B', mobile]]),
    );
    expect(table.dimensions.map((column) => column.name)).toEqual([
      'application',
      'errors',
      'platform',
    ]);
    expect(table.source).toEqual([
      ['www.example.ch', 12, null],
      ['ch.example.ios', 4, 'iOS'],
    ]);
    expect(origins.map((origin) => origin.from)).toEqual([['A', 'B'], ['A', 'B'], ['B']]);
  });

  test('refuses a column of another type on the two sides', () => {
    const other: Dataset = { dimensions: [{ name: 'type', type: 'number' }], source: [[1]] };
    expect(() =>
      runOperations(
        { refId: 'A', table: errors },
        [{ op: 'append', with: 'B' }],
        new Map([['B', other]]),
      ),
    ).toThrow('the column "type" holds string on one side and number on the other');
  });
});

describe('pivot', () => {
  const byVersion: Dataset = {
    dimensions: [
      { name: 'type', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'count', type: 'number' },
    ],
    source: [
      ['network', '2.10', 4],
      ['network', '2.9', 1],
      ['drm', '2.10', 2],
      ['network', '2.10', 1],
      ['drm', null, 3],
    ],
  };

  test('a row per value, a column per value in natural order, sums and zeros', () => {
    const { table, origins } = runOperations({ refId: 'A', table: byVersion }, [
      { op: 'pivot', rows: 'type', columns: 'version', value: 'count' },
    ]);
    expect(table.dimensions.map((column) => column.name)).toEqual([
      'type',
      '2.9',
      '2.10',
      '(none)',
    ]);
    expect(table.source).toEqual([
      ['network', 1, 5, 0],
      ['drm', 0, 2, 3],
    ]);
    expect(origins).toEqual([
      { column: 'type', from: ['A'] },
      { column: '2.9', from: ['A'], nameFromData: true },
      { column: '2.10', from: ['A'], nameFromData: true },
      { column: '(none)', from: ['A'], nameFromData: true },
    ]);
  });

  test('refuses more than 50 columns, and a message lists no column named by data', () => {
    const wide: Dataset = {
      ...byVersion,
      source: Array.from({ length: 51 }, (_, index) => ['network', `v${index}`, 1]),
    };
    expect(() =>
      runOperations({ refId: 'A', table: wide }, [
        { op: 'pivot', rows: 'type', columns: 'version', value: 'count' },
      ]),
    ).toThrow('"version" has 51 values, more than the 50 columns a pivot makes: ask for fewer');
    expect(() =>
      runOperations({ refId: 'A', table: byVersion }, [
        { op: 'pivot', rows: 'type', columns: 'version', value: 'count' },
        { op: 'calculate', name: 'x', fn: 'sum', of: ['plays', 'type'] },
      ]),
    ).toThrow('(columns: type).');
  });
});

describe('concat and sort', () => {
  const sessions: Dataset = {
    dimensions: [
      { name: 'os', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'plays', type: 'number' },
    ],
    source: [
      ['iOS', '18.10', 4],
      ['iOS', '18.9', null],
      ['Android', null, 7],
      [null, null, 1],
    ],
  };

  test('concat joins text with a separator and leaves out what is missing', () => {
    const { table, origins } = runOperations({ refId: 'A', table: sessions }, [
      { op: 'concat', name: 'label', columns: ['os', 'version'], separator: ' ' },
    ]);
    expect(table.dimensions.at(-1)).toEqual({ name: 'label', type: 'string' });
    expect(table.source.map((row) => row[3])).toEqual(['iOS 18.10', 'iOS 18.9', 'Android', null]);
    expect(origins.at(-1)).toEqual({ column: 'label', from: ['A'] });
  });

  test('sort orders text naturally and numbers by value, missing values last', () => {
    const byVersion = runOperations({ refId: 'A', table: sessions }, [
      { op: 'sort', by: 'version', descending: false },
    ]);
    expect(byVersion.table.source.map((row) => row[1])).toEqual(['18.9', '18.10', null, null]);
    const byPlays = runOperations({ refId: 'A', table: sessions }, [
      { op: 'sort', by: 'plays', descending: true },
    ]);
    expect(byPlays.table.source.map((row) => row[2])).toEqual([7, 4, 1, null]);
  });
});
