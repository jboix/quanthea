import { expect, test } from 'bun:test';
import { computedInTitle, filledTitle } from './title.ts';
import type { Variable } from './variables.ts';

const browser: Variable = {
  kind: 'custom',
  name: 'browser',
  options: ['Firefox', 'Safari', 'Chrome', 'Edge', { value: 'opera', label: 'Opera' }],
  default: 'Firefox',
  multi: true,
  includeAll: true,
};

/** The braced form of a variable, as a title writes it. */
const braced = ['$', '{browser}'].join('');

test('fills $name and its braced form with the value chosen, else the default', () => {
  expect(filledTitle('Most conflicting $browser versions', [browser], { browser: 'Safari' })).toBe(
    'Most conflicting Safari versions',
  );
  expect(filledTitle(`${braced}_versions`, [browser])).toBe('Firefox_versions');
});

test('shows a label, All, and a short list', () => {
  expect(filledTitle('$browser', [browser], { browser: 'opera' })).toBe('Opera');
  expect(filledTitle('$browser', [browser], { browser: '$__all' })).toBe('All');
  expect(
    filledTitle('$browser', [browser], { browser: ['Firefox', 'Safari', 'Chrome', 'Edge'] }),
  ).toBe('Firefox, Safari, Chrome +1');
});

test('leaves a name no variable has as written', () => {
  expect(filledTitle('Cost in $ by $team', [browser])).toBe('Cost in $ by $team');
});

const busiest: Variable = {
  kind: 'computed',
  name: 'busiest',
  source: { connector: 'orders', language: 'sql', sql: 'SELECT country FROM busiest' },
};

test('names the computed variables a title names, once each', () => {
  expect(
    computedInTitle('Busiest: $busiest, again $busiest, in $browser', [browser, busiest]),
  ).toEqual(['busiest']);
  expect(computedInTitle('Orders', [busiest])).toEqual([]);
});

test('fills a computed variable with the value the server read, and an ellipsis before', () => {
  expect(filledTitle('Overview · busiest: $busiest', [busiest], { busiest: 'DE' })).toBe(
    'Overview · busiest: DE',
  );
  expect(filledTitle('Overview · busiest: $busiest', [busiest])).toBe('Overview · busiest: …');
});
