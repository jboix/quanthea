/**
 * The model view's shaping of saved panels' results. A result the panel's operations made is cut
 * by connector (`derived.ts`); any other is shaped as a result of its query's connector.
 */
import type { ColumnOrigin, Frame } from '@quanthea/shared';
import { derivedParts, modelDerivedResult } from './derived.ts';
import type { GateSubject } from './subject.ts';
import { type ModelTestResult, modelPanelResult, visibleFrames } from './test-run.ts';

/** Where a table that a panel's operations made comes from. */
export interface DerivedFrom {
  /** Where each column comes from. */
  readonly origins: readonly ColumnOrigin[];
  /** The connector of each of the panel's queries, by refId. */
  readonly connectors: Readonly<Record<string, string>>;
}

/** A saved panel's query outcome, as the gate shapes it. */
export interface PanelOutcome {
  /** The frames. */
  readonly frames: readonly Frame[];
  /** Its error message, already free of data, or `null`. */
  readonly error: string | null;
  /** When the panel's operations made the table: where it comes from. */
  readonly derived?: DerivedFrom | undefined;
}

/** The methods. */
export interface ResultMethods {
  /**
   * Shapes a saved panel's result for the model.
   *
   * @param name - The connector the query ran on.
   * @param outcome - Its frames, or its error message, and where a derived table comes from.
   * @param timeZone - The reader's time zone: from level 3, numbers are profiled on that clock.
   * @returns What the access levels let through.
   */
  panelResult(name: string, outcome: PanelOutcome, timeZone?: string): ModelTestResult;
  /**
   * A result without its connectors' hidden fields, for what is derived from it and shown to the
   * model, such as the roles a chart infers from its columns.
   *
   * @param name - The connector the query ran on.
   * @param frames - The frames.
   * @param derived - Where a table that operations made comes from.
   * @returns The frames without hidden fields; none when the connector is unknown.
   */
  visibleFrames(name: string, frames: readonly Frame[], derived?: DerivedFrom): Frame[];
}

/**
 * A safe message for a failure to reach a connector.
 *
 * @param name - The connector name.
 * @returns The message.
 */
export function unreachable(name: string): string {
  return `Cannot use connector "${name}": it does not exist or cannot be reached.`;
}

/**
 * The connectors of a panel's queries, by refId, as the gate sees them.
 *
 * @param derived - Where the table comes from.
 * @param subjects - The connectors by name.
 * @returns The connectors by refId; a refId whose connector is unknown is left out.
 */
function subjectsByRef(
  derived: DerivedFrom,
  subjects: ReadonlyMap<string, GateSubject>,
): Map<string, GateSubject> {
  return new Map(
    Object.entries(derived.connectors).flatMap(([refId, name]) => {
      const subject = subjects.get(name);
      return subject ? [[refId, subject] as const] : [];
    }),
  );
}

/**
 * The parts of a derived table joined back into one frame, each part without its hidden fields
 * and without the columns named by data.
 *
 * @param frames - The table.
 * @param derived - Where it comes from.
 * @param subjects - The connectors by name.
 * @returns The frame, or none.
 */
function visibleDerived(
  frames: readonly Frame[],
  derived: DerivedFrom,
  subjects: ReadonlyMap<string, GateSubject>,
): Frame[] {
  const [frame] = frames;
  if (!frame) return [];
  // A column named by data is never a role: its name changes from run to run.
  const origins = derived.origins.filter((origin) => !origin.nameFromData);
  const parts = derivedParts(frame, origins, subjectsByRef(derived, subjects));
  const fields = parts.flatMap((part) => part.frame.fields);
  const values = parts.flatMap((part) => part.frame.values);
  return [{ ...frame, fields, values }];
}

/**
 * The model view's shaping of saved panels' results, by connector.
 *
 * @param subjects - The connectors by name, as the gate sees them.
 * @returns The methods.
 */
export function resultMethods(subjects: () => ReadonlyMap<string, GateSubject>): ResultMethods {
  return {
    panelResult(name, outcome, timeZone) {
      const subject = subjects().get(name);
      if (!subject) return { ok: false, error: unreachable(name) };
      if (outcome.error !== null) return { ok: false, error: outcome.error };
      if (!outcome.derived) return modelPanelResult(subject, outcome.frames, timeZone);
      const byRef = subjectsByRef(outcome.derived, subjects());
      return modelDerivedResult(outcome.frames, outcome.derived.origins, byRef, timeZone);
    },
    visibleFrames(name, frames, derived) {
      if (derived) return visibleDerived(frames, derived, subjects());
      const subject = subjects().get(name);
      return subject ? visibleFrames(subject, frames) : [];
    },
  };
}

/**
 * Where a panel's query outcome comes from, when its operations made it.
 *
 * @param panel - The panel's queries.
 * @param panel.queries - Its queries.
 * @param outcome - The outcome.
 * @param outcome.origins - Where each column comes from, when operations made it.
 * @returns The origins and the connector of each query, or `undefined` for a plain result.
 */
export function derivedFrom(
  panel: { readonly queries: readonly { readonly refId: string; readonly connector: string }[] },
  outcome: { readonly origins?: readonly ColumnOrigin[] | undefined },
): DerivedFrom | undefined {
  if (!outcome.origins) return undefined;
  const connectors = Object.fromEntries(
    panel.queries.map((query) => [query.refId, query.connector]),
  );
  return { origins: outcome.origins, connectors };
}
