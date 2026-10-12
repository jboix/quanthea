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
});
