import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineConnector } from './connector-kind.ts';

/** A kind with nothing but what defineConnector checks. */
const kind = {
  kind: 'events',
  displayName: 'Events',
  language: 'sql',
  dialect: 'postgres',
  configSchema: z.object({ host: z.string() }),
  secretSchema: z.object({ password: z.string() }),
  open: () => {
    throw new Error('Not opened in this test.');
  },
} as const;

test('defineConnector rejects an identifier that is not lowercase with dashes', () => {
  expect(() => defineConnector({ ...kind, kind: 'My Source' })).toThrow(
    'must be lowercase letters, digits and dashes',
  );
});

test('defineConnector rejects a SQL kind without a dialect', () => {
  const { dialect: _dialect, ...withoutDialect } = kind;
  expect(() => defineConnector(withoutDialect)).toThrow('must declare its dialect');
});

test('defineConnector rejects an icon that is not path data and a colour', () => {
  const icon = { path: 'M0 0<script>', color: '#000000' };
  expect(() => defineConnector({ ...kind, icon })).toThrow('icon');
});
