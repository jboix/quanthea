import { expect, test } from 'bun:test';
import { variableSchema } from './variables.ts';

const interval = { kind: 'interval', name: 'window', options: ['auto', '1m', '1h'] };

test('an interval variable offers auto beside durations, and may default to it', () => {
  expect(variableSchema.safeParse({ ...interval, default: 'auto' }).success).toBe(true);
  expect(variableSchema.safeParse({ ...interval, default: '1m' }).success).toBe(true);
});

test('an interval variable refuses an option that is neither a duration nor auto', () => {
  const often = { ...interval, options: ['often'], default: 'often' };
  expect(variableSchema.safeParse(often).success).toBe(false);
  expect(variableSchema.safeParse({ ...interval, default: 'auto1m' }).success).toBe(false);
});
