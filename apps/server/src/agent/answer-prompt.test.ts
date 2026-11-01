import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { askInstructions } from './answer-prompt.ts';

describe('how a query bounds its time', () => {
  test('the rules of a question name the built-in bounds and ISO text', () => {
    const facts = {
      spec: dashboardSpecSchema.parse(eventsSpec()),
      connectors: [{ name: 'events', kind: 'elasticsearch', language: 'search', accessLevel: 3 }],
      range: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') },
      timeZone: 'UTC',
      variables: {},
    };
    const instructions = askInstructions(facts, (level) => level >= 3);
    expect(instructions).toContain('with the built-in __from and __to');
    expect(instructions).toContain('ISO 8601 text, such as 2026-10-05T14:47:01Z');
  });

  test('the rules of a question say where the time of day and the weekday are read', () => {
    const facts = {
      spec: dashboardSpecSchema.parse(eventsSpec()),
      connectors: [{ name: 'events', kind: 'elasticsearch', language: 'search', accessLevel: 3 }],
      range: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') },
      timeZone: 'UTC',
      variables: {},
    };
    const instructions = askInstructions(facts, (level) => level >= 3);
    expect(instructions).toContain('buckets of an hour or less over three days or more');
    expect(instructions).toContain('peakHour');
    expect(instructions).toContain('The profile needs one row per bucket');
  });
});

describe('the variables chosen', () => {
  /**
   * The instructions of a question with `$service` chosen, its source at a level.
   *
   * @param accessLevel - The level of the connector `$service` is read from.
   * @returns The instructions.
   */
  function chosenAt(accessLevel: number): string {
    const facts = {
      spec: dashboardSpecSchema.parse(eventsSpec()),
      connectors: [{ name: 'events', kind: 'elasticsearch', language: 'search', accessLevel }],
      range: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') },
      timeZone: 'UTC',
      variables: { service: ['checkout-svc'] },
    };
    return askInstructions(facts, (level) => level >= 3);
  }

  test("a value read from a connector shows at that connector's level, a listed one always", () => {
    expect(chosenAt(3)).toContain(
      'Variables chosen: $env = prod; $service = checkout-svc; $order = A-1.',
    );
    expect(chosenAt(2)).toContain('$env = prod; $service = (hidden at its level); $order = A-1.');
    expect(chosenAt(2)).not.toContain('checkout-svc');
  });
});

test('a computed variable is named as computed, its values never listed', () => {
  const base = eventsSpec();
  const source = { connector: 'events', language: 'sql', sql: 'SELECT id FROM live' };
  const live = { kind: 'computed', name: 'live', source, multi: true };
  const spec = dashboardSpecSchema.parse({ ...base, variables: [...base.variables, live] });
  const facts = {
    spec,
    connectors: [{ name: 'events', kind: 'postgres', language: 'sql', accessLevel: 4 }],
    range: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') },
    timeZone: 'UTC',
    variables: { live: ['m1'] },
  };
  const instructions = askInstructions(facts, (level) => level >= 3);
  expect(instructions).toContain('$live = (computed by the server).');
  expect(instructions).not.toContain('m1');
});
