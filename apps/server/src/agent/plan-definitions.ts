/**
 * What a plan may say of definitions: a panel names one by id, and only one the run has. A plan
 * of a run without definitions has no field for them, so the model never fills it with words.
 */
import { type DefinitionVersion, type Plan, planSchema } from '@quanthea/shared';
import { z } from 'zod';

/** A plan whose panels name no definition. */
const planWithoutDefinitionsSchema = planSchema.extend({
  panels: z
    .array(planSchema.shape.panels.element.omit({ definition: true }))
    .min(1)
    .max(30),
});

/**
 * The plan schema a run offers: with the definition field only when there are definitions.
 *
 * @param definitions - The definitions the run may build from.
 * @returns The schema.
 */
export function planSchemaFor(definitions: readonly DefinitionVersion[]): z.ZodType<Plan> {
  return definitions.length > 0 ? planSchema : planWithoutDefinitionsSchema;
}

/**
 * Why a plan names definitions the run does not have, with the ids it has.
 *
 * @param plan - The plan.
 * @param definitions - The definitions the run may build from.
 * @returns The error, or `undefined` when every definition it names exists.
 */
export function unknownDefinitionsError(
  plan: Plan,
  definitions: readonly DefinitionVersion[],
): string | undefined {
  const known = new Set(definitions.map((each) => each.definition.id));
  const named = plan.panels.flatMap((panel) => (panel.definition ? [panel.definition] : []));
  const unknown = [...new Set(named.filter((id) => !known.has(id)))];
  if (unknown.length === 0) return undefined;
  const ids = [...known].join(', ');
  return `No definition has the id ${unknown.join(', ')}. definition names a defined term by id, one of ${ids}; leave it out of a panel that follows none, and say what a panel shows in its title.`;
}
