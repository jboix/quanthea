/**
 * A table a panel's operations made, as the model receives it. Each connector's data is shown at
 * that connector's own access level: the table is cut into one part per connector, and each part
 * is shaped as a result of that connector. A column computed from several connectors goes to the
 * part of the strictest of them. A column whose name is a value of the data is renamed where its
 * connector's level hides values.
 */
import type { ColumnOrigin, Frame } from '@quanthea/shared';
import type { GateSubject } from './subject.ts';
import { type ModelTestResult, modelPanelResult, visibleFrames } from './test-run.ts';

/** The lowest level that shows values. */
const valuesLevel = 3;

/** One connector's part of a derived table. */
interface Part {
  /** The connector. */
  readonly subject: GateSubject;
  /** Its columns, as a frame. */
  readonly frame: Frame;
}

/**
 * The connector a column is shown at: the strictest of those its values come from.
 *
 * @param origin - The column's origin.
 * @param subjects - The connectors, by refId.
 * @returns The connector, or `undefined` when one of them is unknown, so the column is left out.
 */
function ownerOf(
  origin: ColumnOrigin,
  subjects: ReadonlyMap<string, GateSubject>,
): GateSubject | undefined {
  const sources = origin.from.map((refId) => subjects.get(refId));
  if (sources.length === 0 || sources.some((subject) => subject === undefined)) return undefined;
  return (sources as GateSubject[]).reduce((strictest, subject) =>
    subject.accessLevel < strictest.accessLevel ? subject : strictest,
  );
}

/**
 * The columns of a derived table, grouped by the connector each is shown at.
 *
 * @param frame - The table.
 * @param origins - Where each column comes from.
 * @param subjects - The connectors, by refId.
 * @returns The column indexes of each connector, by connector id.
 */
function groupsOf(
  frame: Frame,
  origins: readonly ColumnOrigin[],
  subjects: ReadonlyMap<string, GateSubject>,
): Map<string, { subject: GateSubject; columns: number[] }> {
  const groups = new Map<string, { subject: GateSubject; columns: number[] }>();
  for (const [index, field] of frame.fields.entries()) {
    const origin = origins.find((each) => each.column === field.name);
    const owner = origin && ownerOf(origin, subjects);
    if (!owner) continue;
    const group = groups.get(owner.id) ?? { subject: owner, columns: [] };
    group.columns.push(index);
    groups.set(owner.id, group);
  }
  return groups;
}

/**
 * One connector's columns of a derived table, as a frame of that connector. Columns named by data
 * are renamed `column 1`, `column 2` and so on below the level that shows values.
 *
 * @param frame - The table.
 * @param columns - The connector's column indexes.
 * @param named - The names that are values of the data.
 * @param subject - The connector.
 * @returns The frame.
 */
function partFrame(
  frame: Frame,
  columns: readonly number[],
  named: ReadonlySet<string>,
  subject: GateSubject,
): Frame {
  let renamed = 0;
  const fields = columns.map((index) => {
    const field = frame.fields[index] as Frame['fields'][number];
    if (subject.accessLevel >= valuesLevel || !named.has(field.name)) return field;
    renamed += 1;
    return { ...field, name: `column ${renamed}` };
  });
  const values = columns.map((index) => frame.values[index] ?? []);
  return { ...frame, fields, values };
}

/**
 * Cuts a derived table into one frame per connector, each without that connector's hidden fields.
 *
 * @param frame - The table.
 * @param origins - Where each column comes from.
 * @param subjects - The connectors, by refId.
 * @returns The parts, in the order their first column comes.
 */
export function derivedParts(
  frame: Frame,
  origins: readonly ColumnOrigin[],
  subjects: ReadonlyMap<string, GateSubject>,
): Part[] {
  const named = new Set(origins.filter((each) => each.nameFromData).map((each) => each.column));
  return [...groupsOf(frame, origins, subjects).values()].map(({ subject, columns }) => {
    const [visible] = visibleFrames(subject, [partFrame(frame, columns, named, subject)]);
    return { subject, frame: visible ?? { ...frame, fields: [], values: [] } };
  });
}

/**
 * A derived table as the model receives it. A table from one connector reads as any result of
 * it; a table from several gives one part per connector, each shaped at its own level.
 *
 * @param frames - The table, as the operations left it in one frame.
 * @param origins - Where each column comes from.
 * @param subjects - The connectors, by refId.
 * @param timeZone - The reader's time zone, as a panel result takes it.
 * @returns What the model receives.
 */
export function modelDerivedResult(
  frames: readonly Frame[],
  origins: readonly ColumnOrigin[],
  subjects: ReadonlyMap<string, GateSubject>,
  timeZone?: string,
): ModelTestResult {
  const [frame] = frames;
  if (!frame) return { ok: true };
  const parts = derivedParts(frame, origins, subjects);
  const [only] = parts;
  if (parts.length === 1 && only) return modelPanelResult(only.subject, [only.frame], timeZone);
  return {
    ok: true,
    parts: parts.map(({ subject, frame: part }) => ({
      connector: subject.name,
      ...modelPanelResult(subject, [part], timeZone),
    })),
  };
}
