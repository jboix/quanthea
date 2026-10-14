import { expect, test } from 'bun:test';
import { dashboardSpecSchema } from './dashboard.ts';
import { labelOfValue, optionLabel, optionValue, optionValues } from './variable-options.ts';

const options = ['all', { value: 'true', label: 'Only SwissTXT' }];

test('an option gives its value to bind and its label to show', () => {
  expect(options.map(optionValue)).toEqual(['all', 'true']);
  expect(options.map(optionLabel)).toEqual(['all', 'Only SwissTXT']);
  expect(optionValues(options)).toEqual(['all', 'true']);
  expect(labelOfValue(options, 'true')).toBe('Only SwissTXT');
  expect(labelOfValue(options, 'other')).toBe('other');
  expect(labelOfValue(undefined, 'web')).toBe('web');
});

test('a stored spec whose options are texts parses as it was', () => {
  const variable = {
    kind: 'custom' as const,
    name: 'env',
    options: ['prod', 'staging'],
    default: 'prod',
  };
  const spec = dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Env',
    time: { from: 'now-1h', to: 'now' },
    variables: [variable],
    panels: [],
  });
  expect(spec.variables[0]).toEqual(variable);
});
