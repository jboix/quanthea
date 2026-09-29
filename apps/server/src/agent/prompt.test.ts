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
  recipes: { builtIn: ['rate', 'sql-stat'], saved: [] },
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

  test('gives the recipe guide only once there is something to write', () => {
    expect(instructionsFor(facts)).not.toContain('Building with edit_dashboard');
    expect(instructionsFor({ ...facts, state: 'ready' })).toContain('Building with edit_dashboard');
  });

  test('lists only the thread’s recipes, and its saved ones with their placeholders', () => {
    const text = instructionsFor({ ...facts, state: 'ready' });
    expect(text).toContain('PromQL recipes: rate (a counter per second).');
    expect(text).toContain('SQL recipes: sql-stat (one number).');
    expect(text).not.toContain('latency');
    const saved = instructionsFor({
      ...facts,
      state: 'ready',
      recipes: {
        builtIn: [],
        saved: [
          {
            id: 'queue-depth',
            name: 'Queue depth',
            description: 'Messages waiting in a queue.',
            language: 'promql',
            query: 'sum({{metric}})',
            params: [{ name: 'metric', kind: 'metric', description: 'A gauge' }],
            show: 'line',
            unit: 'number',
          },
        ],
      },
    });
    expect(saved).toContain(
      '- "queue-depth" (promql, shows line): Messages waiting in a queue. Placeholders: metric (metric: A gauge).',
    );
    expect(saved).not.toContain('PromQL recipes:');
  });

  test('says every panel is custom when the thread uses no recipes', () => {
    const text = instructionsFor({ ...facts, state: 'ready', recipes: { builtIn: [], saved: [] } });
    expect(text).toContain('This thread uses no recipes: every panel is custom.');
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
