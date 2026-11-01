import { expect, test } from 'bun:test';
import type { Frame, LogView } from '@quanthea/shared';
import { logLines } from './log-lines.ts';

const logs: Frame = {
  refId: 'A',
  fields: [
    { name: 'time', type: 'time' },
    { name: 'level', type: 'string' },
    { name: 'service', type: 'string' },
    { name: 'message', type: 'string' },
  ],
  values: [
    [Date.UTC(2026, 0, 5, 9, 1), Date.UTC(2026, 0, 5, 9, 0)],
    ['ERROR', 'info'],
    ['checkout', 'cart'],
    ['Payment timed out', null],
  ],
  meta: { rowCount: 2, truncated: false, durationMs: 1 },
};

const view: LogView = {
  kind: 'log',
  ref: 'A',
  time: 'time',
  message: ['service', 'message'],
  level: 'level',
};

test('a line has its time, its message from its columns, its level, its tone and every column', () => {
  const { lines, truncated } = logLines(view, [{ refId: 'A', frames: [logs], error: null }], 'UTC');
  expect(truncated).toBe(false);
  expect(lines[0]).toMatchObject({
    key: '0',
    level: 'ERROR',
    tone: 'bad',
    message: 'checkout  Payment timed out',
  });
  expect(lines[0]?.time).toContain('09:01');
  expect(lines[0]?.fields.map((field) => field.name)).toEqual([
    'time',
    'level',
    'service',
    'message',
  ]);
  expect(lines[1]).toMatchObject({ level: 'info', message: 'cart' });
  expect(lines[1]?.tone).toBeUndefined();
});

test('a log stops at its limit and says it left lines out', () => {
  const limited = logLines(
    { ...view, limit: 1 },
    [{ refId: 'A', frames: [logs], error: null }],
    'UTC',
  );
  expect(limited.lines).toHaveLength(1);
  expect(limited.truncated).toBe(true);
});
