import { expect, test } from 'bun:test';
import { filledTitle } from './title.ts';
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
