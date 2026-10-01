import { describe, expect, test } from 'bun:test';
import type { Plan } from '@querent/shared';
import { instructionsFor, type TurnFacts } from './prompt.ts';

const plan: Plan = {
  title: 'Checkout',
  variables: [],
  panels: [{ kind: 'stat', title: 'Errors', language: 'sql', connector: 'events' }],
};

const facts: TurnFacts = {
  now: Date.parse('2026-09-28T14:51:00Z'),
  catalog: '## events (memory, sql): level 2',
  state: 'idle',
  plan: undefined,
  draft: undefined,
  mentions: [],
  queries: { builtIn: ['rate', 'sql-stat'], saved: [] },
  languages: ['sql'],
  guides: [{ kind: 'postgres' }],
};

describe('instructionsFor', () => {
  test('gives the time in UTC and in the person’s zone', () => {
    expect(instructionsFor({ ...facts, timeZone: 'Europe/Madrid' })).toContain(
      'The person is in Europe/Madrid, where it is 2026-09-28, 16:51.',
    );
    expect(instructionsFor(facts)).toContain("The person's time zone is unknown; assume UTC.");
    expect(instructionsFor({ ...facts, timeZone: 'Mars/Olympus' })).toContain('assume UTC');
  });

  test('says what the thread state asks for', () => {
    expect(instructionsFor(facts)).toContain('No plan yet.');
    expect(
      instructionsFor({ ...facts, state: 'plan_pending', plan: { body: plan, status: 'pending' } }),
    ).toContain('A plan waits for the person to approve it.');
    expect(
      instructionsFor({ ...facts, state: 'building', plan: { body: plan, status: 'approved' } }),
    ).toContain('The approved plan "Checkout"');
  });

  test('gives the panel guide only once there is something to write', () => {
    expect(instructionsFor(facts)).not.toContain('Building with edit_dashboard');
    expect(instructionsFor({ ...facts, state: 'ready' })).toContain('Building with edit_dashboard');
  });

  test('lists the thread’s builders with their columns, the shapes, the charts and the guides to read', () => {
    const text = instructionsFor({ ...facts, state: 'ready' });
    expect(text).toContain(
      '- rate: a counter per second; columns time, the "by" labels, series, value',
    );
    expect(text).toContain('- sql-stat: one number; column value');
    expect(text).not.toContain('- latency:');
    expect(text).toContain('- matrix: One row per cell');
    expect(text).toContain('trend.line (long): A number over time');
    expect(text).toContain("Read a kind's guide with read_guide");
    expect(text).toContain('Kinds: postgres.');
  });

  test('writes the raw query syntax of the languages in use only', () => {
    const text = instructionsFor({ ...facts, state: 'ready' });
    expect(text).toContain('SQL uses :name variables');
    expect(text).not.toContain('PromQL uses $name');
    expect(text).not.toContain('MongoDB query');
  });

  test('lists saved queries with their placeholders', () => {
    const saved = instructionsFor({
      ...facts,
      state: 'ready',
      queries: {
        builtIn: [],
        saved: [
          {
            id: 'queue-depth',
            name: 'Queue depth',
            description: 'Messages waiting in a queue.',
            language: 'promql',
            query: 'sum({{metric}})',
            params: [{ name: 'metric', kind: 'metric', description: 'A gauge' }],
            shape: 'long',
          },
        ],
      },
    });
    expect(saved).toContain(
      '- "queue-depth" (promql, long): Messages waiting in a queue. Placeholders: metric (metric: A gauge).',
    );
    expect(saved).not.toContain('PromQL builders');
  });

  test('says every panel’s data is a raw query when the thread uses no builders', () => {
    const text = instructionsFor({ ...facts, state: 'ready', queries: { builtIn: [], saved: [] } });
    expect(text).toContain('This thread uses no query builders: every panel');
  });

  test('ends with what the phase asks for', () => {
    expect(instructionsFor(facts).endsWith('No plan yet.')).toBe(true);
  });

  test('names the mentioned panels', () => {
    const text = instructionsFor({
      ...facts,
      state: 'ready',
      mentions: [{ panelId: 'errors', title: 'Errors' }],
    });
    expect(text).toContain('The person mentions these panels: errors ("Errors").');
  });
});
