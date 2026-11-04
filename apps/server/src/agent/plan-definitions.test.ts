import { describe, expect, test } from 'bun:test';
import { type DefinitionVersion, definitionSchema, type Plan } from '@quanthea/shared';
import { planSchemaFor, unknownDefinitionsError } from './plan-definitions.ts';

/** A defined term, as a run reads it. */
const failures = {
  definition: definitionSchema.parse({
    id: 'failures',
    name: 'Failures',
    meaning: 'Events at the error level.',
    bodies: [],
  }),
  version: 1,
} as DefinitionVersion;

/**
 * A plan of one stat panel that names a definition.
 *
 * @param definition - What the panel names.
 * @returns The plan.
 */
function planNaming(definition: string): Plan {
  const panel = { kind: 'stat', title: 'Paid orders', language: 'sql', connector: 'orders' };
  return {
    title: 'Orders',
    variables: [],
    panels: [{ ...panel, definition } as Plan['panels'][0]],
  };
}

describe('the definitions of a plan', () => {
  test('have no field in a run without definitions, so words put there are dropped', () => {
    const parsed = planSchemaFor([]).parse(planNaming('Count orders, status=paid'));
    expect(parsed.panels[0]).not.toHaveProperty('definition');
  });

  test('keep the field in a run with definitions', () => {
    const parsed = planSchemaFor([failures]).parse(planNaming('failures'));
    expect(parsed.panels[0]?.definition).toBe('failures');
  });

  test('refuse an id no definition has, and name the ids there are', () => {
    const error = unknownDefinitionsError(planNaming('Count orders, status=paid'), [failures]);
    expect(error).toContain('No definition has the id Count orders, status=paid.');
    expect(error).toContain('one of failures');
  });

  test('accept a plan whose definitions exist', () => {
    expect(unknownDefinitionsError(planNaming('failures'), [failures])).toBeUndefined();
  });
});
