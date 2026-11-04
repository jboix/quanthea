import { describe, expect, test } from 'bun:test';
import { allValue, type ChosenVariable } from '@quanthea/shared';
import { afterToggle, chosenValues, toggleOptions } from './option-toggles.ts';

/** Six countries, which hold several values. */
const countries: ChosenVariable = {
  kind: 'custom',
  name: 'country',
  options: ['AT', 'DE', 'CH', 'FR', 'IT', { value: 'NL', label: 'Netherlands' }],
  default: ['AT'],
  multi: true,
};

describe('option toggles', () => {
  test('show for a custom variable of several values with a few short options', () => {
    expect(toggleOptions(countries)).toHaveLength(6);
    expect(toggleOptions({ ...countries, multi: false })).toBeUndefined();
    const many = Array.from({ length: 9 }, (_, index) => `c${index}`);
    expect(toggleOptions({ ...countries, options: many })).toBeUndefined();
    const long = ['A country with a long name', 'DE'];
    expect(toggleOptions({ ...countries, options: long })).toBeUndefined();
  });

  test('read "All" as every option, in their order', () => {
    expect(chosenValues(countries.options, allValue)).toHaveLength(6);
    expect(chosenValues(countries.options, ['DE', 'AT'])).toEqual(['AT', 'DE']);
  });

  test('add an option, take one out, and keep the last one chosen', () => {
    expect(afterToggle(countries.options, ['DE'], 'AT')).toEqual(['AT', 'DE']);
    expect(afterToggle(countries.options, ['AT', 'DE'], 'AT')).toEqual(['DE']);
    expect(afterToggle(countries.options, ['DE'], 'DE')).toEqual(['DE']);
    expect(afterToggle(countries.options, allValue, 'NL')).toEqual(['AT', 'DE', 'CH', 'FR', 'IT']);
  });
});
