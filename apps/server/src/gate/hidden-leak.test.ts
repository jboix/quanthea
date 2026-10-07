/**
 * The gate's promise for hidden fields: from level 2 to 4, no hidden column, nested field or
 * label reaches the model, whatever its case, and fields next to it stay.
 */
import { describe, expect, test } from 'bun:test';
import type { Field, Frame } from '@quanthea/shared';
import { modelAlertCheck, modelAlertReplay } from './alert-view.ts';
import type { GateSubject } from './subject.ts';
import { modelPanelResult, modelTestResult } from './test-run.ts';

/** A result column that must not reach the model, the setting that hides it, and a sibling. */
interface HiddenCase {
  /** What the case is. */
  readonly title: string;
  /** The connector kind. */
  readonly kind: string;
  /** The hidden field setting. */
  readonly hiddenField: string;
  /** The result column the source returns for it. */
  readonly column: string;
  /** A visible column next to it, which must stay. */
  readonly sibling: string;
}

const cases: readonly HiddenCase[] = [
  {
    title: 'a flat SQL column',
    kind: 'postgres',
    hiddenField: 'customers.email',
    column: 'email',
    sibling: 'name',
  },
  {
    title: 'a MySQL column in another case',
    kind: 'mysql',
    hiddenField: 'customers.email',
    column: 'EMAIL',
    sibling: 'name',
  },
  {
    title: 'a nested search field',
    kind: 'elasticsearch',
    hiddenField: 'logs.user.email',
    column: 'user.email',
    sibling: 'user.name',
  },
  {
    title: 'a nested field of a dotted index',
    kind: 'opensearch',
    hiddenField: 'app.logs.user.email',
    column: 'user.email',
    sibling: 'user.name',
  },
  {
    title: 'every field under a hidden object',
    kind: 'elasticsearch',
    hiddenField: 'logs.user',
    column: 'user.email',
    sibling: 'host.name',
  },
  {
    title: 'a nested MongoDB field',
    kind: 'mongodb',
    hiddenField: 'orders.customer.email',
    column: 'customer.email',
    sibling: 'customer.city',
  },
  {
    title: 'a nested MongoDB field in another case',
    kind: 'mongodb',
    hiddenField: 'orders.customer.email',
    column: 'Customer.Email',
    sibling: 'customer.city',
  },
  {
    title: 'a search object array that holds a hidden field',
    kind: 'elasticsearch',
    hiddenField: 'logs.user.email',
    column: 'user',
    sibling: 'host.name',
  },
  {
    title: 'a nested search field under a dotted index, as an array',
    kind: 'opensearch',
    hiddenField: 'app.logs.user.email',
    column: 'User',
    sibling: 'message',
  },
  {
    title: 'a MongoDB array that holds a hidden field',
    kind: 'mongodb',
    hiddenField: 'orders.customer.email',
    column: 'customer',
    sibling: 'total',
  },
  {
    title: 'a column with a table qualifier',
    kind: 'clickhouse',
    hiddenField: 'customers.email',
    column: 'c.email',
    sibling: 'c.name',
  },
  {
    title: 'a column with a table qualifier in another case',
    kind: 'clickhouse',
    hiddenField: 'customers.email',
    column: 'c.EMAIL',
    sibling: 'c.name',
  },
];

const secret = 'ana.secret@example.com';

/**
 * A frame with the hidden column, its visible sibling, and a hidden label on a value field.
 *
 * @param column - The hidden column.
 * @param sibling - The visible column.
 * @returns The frame.
 */
function frameWith(column: string, sibling: string): Frame {
  const fields: Field[] = [
    { name: column, type: 'string' },
    { name: sibling, type: 'string' },
    { name: 'value', type: 'number', labels: { Owner: secret, service: 'checkout' } },
  ];
  return {
    refId: 'A',
    fields,
    values: [
      [secret, secret],
      ['visible', 'visible'],
      [1, 2],
    ],
    meta: { rowCount: 2, truncated: false, durationMs: 1 },
  };
}

/**
 * A subject that hides the case's field and the `owner` label.
 *
 * @param each - The case.
 * @param accessLevel - The level.
 * @returns The subject.
 */
function subjectFor(each: HiddenCase, accessLevel: 2 | 3 | 4): GateSubject {
  return {
    name: 'source',
    kind: each.kind,
    accessLevel,
    hiddenFields: [each.hiddenField, 'owner'],
    descriptions: {},
  };
}

describe.each([2, 3, 4] as const)('at level %i', (accessLevel) => {
  test.each([...cases])('a test query never shows $title', (each) => {
    const frame = frameWith(each.column, each.sibling);
    const text = JSON.stringify(modelTestResult(subjectFor(each, accessLevel), [frame]));
    expect(text).not.toContain(secret);
    expect(text).not.toContain(`"${each.column}"`);
    expect(text.toLowerCase()).not.toContain('owner');
    expect(text).toContain(`"${each.sibling}"`);
  });

  test.each([...cases])("a panel's columns never name $title", (each) => {
    const frame = frameWith(each.column, each.sibling);
    const result = modelPanelResult(subjectFor(each, accessLevel), [frame]);
    const columns = result.ok ? (result.columns ?? []) : [];
    expect(columns.join(' ').toLowerCase()).not.toContain(each.column.toLowerCase());
    expect(columns.join(' ').toLowerCase()).not.toContain('owner');
    expect(columns).toContain(`${each.sibling}: string`);
  });

  test('an alert check never shows a hidden label, whatever its case or nesting', () => {
    const subject: GateSubject = {
      name: 'source',
      kind: 'elasticsearch',
      accessLevel,
      hiddenFields: ['owner', 'logs.user'],
      descriptions: {},
    };
    const labels = { OWNER: secret, 'user.email': secret, service: 'checkout' };
    const text = JSON.stringify(modelAlertCheck(subject, [{ labels, value: 1, holds: true }]));
    expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain('owner');
    expect(text).not.toContain('user.email');
    expect(text).toContain('service');
  });
});

test('a replay never shows a hidden label, whatever its case or nesting', () => {
  const subject: GateSubject = {
    name: 'source',
    kind: 'elasticsearch',
    accessLevel: 4,
    hiddenFields: ['owner', 'logs.user'],
    descriptions: {},
  };
  const series = {
    labels: { Owner: secret, 'user.email': secret, service: 'checkout' },
    firing: [],
    firings: 0,
    firingMs: 0,
    tooShort: [],
  };
  const replay = {
    replayable: true as const,
    from: 0,
    to: 60_000,
    truncated: false,
    series: [series],
  };
  const text = JSON.stringify(modelAlertReplay(subject, replay));
  expect(text).not.toContain(secret);
  expect(text).toContain('service=checkout');
});
