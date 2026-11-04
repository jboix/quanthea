/**
 * The progress of a build of an approved plan, read from the answer's work: a step for reading
 * the data, then a step for each panel the plan names, ready once a saved write holds it.
 */
import { isDashboardPlan, type Plan, type PlanView, type Repair } from '@quanthea/shared';
import {
  buildTools,
  exploreTools,
  isToolPart,
  type ThreadMessage,
  type ThreadPart,
  type ToolPart,
  toolName,
} from './messages.ts';

/** Where one step of the build is. */
export type StepState = 'done' | 'running' | 'retrying' | 'waiting' | 'missing';

/** One step of the build. */
export interface BuildStep {
  /** What it does, such as a panel's title. */
  readonly title: string;
  /** Where it is. */
  readonly state: StepState;
  /** A quiet line under it, such as how a retry goes. */
  readonly note?: string;
}

/** The progress of a build. */
export interface BuildProgress {
  /** The planned panels a saved write holds. */
  readonly ready: number;
  /** The panels the plan names. */
  readonly planned: number;
  /** The steps, reading the data first. */
  readonly steps: readonly BuildStep[];
  /** How many writes failed and were tried again. */
  readonly retries: number;
  /** The last version a write saved, if any. */
  readonly version?: number;
}

/** What a write returned, as far as the progress reads it. */
interface WriteOutput {
  readonly ok?: boolean;
  readonly version?: number;
}

/**
 * A title as the progress compares it: trimmed and in lower case.
 *
 * @param title - The title.
 * @returns The key.
 */
function keyOf(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * The titles of the panels a write sends.
 *
 * @param part - The write.
 * @returns The keys of its panels' titles.
 */
function writtenTitles(part: ToolPart): string[] {
  const panels = (part.input as { panels?: unknown } | undefined)?.panels;
  if (!Array.isArray(panels)) return [];
  return panels.flatMap((panel: { title?: unknown }) =>
    typeof panel?.title === 'string' ? [keyOf(panel.title)] : [],
  );
}

/**
 * Whether a tool part has ended.
 *
 * @param part - The part.
 * @returns Whether its output or its error came.
 */
function ended(part: ToolPart): boolean {
  return part.state === 'output-available' || part.state === 'output-error';
}

/** What the work says of each planned panel. */
interface PanelMarks {
  /** The titles a saved write holds. */
  readonly saved: Set<string>;
  /** The titles a running write sends. */
  readonly running: Set<string>;
  /** The titles the last failed write could not save, with that try. */
  readonly failing: Map<string, Repair>;
}

/**
 * The set of marks a write's titles go to: running while it runs, saved once it saved.
 *
 * @param part - The write.
 * @param marks - The marks.
 * @returns The set, or none for a write that saved nothing.
 */
function writeMarks(part: ToolPart, marks: PanelMarks): Set<string> | undefined {
  if (!ended(part)) return marks.running;
  return (part.output as WriteOutput | undefined)?.ok ? marks.saved : undefined;
}

/**
 * Adds what one part of the work says to the marks.
 *
 * @param part - The part.
 * @param marks - The marks so far.
 */
function mark(part: ThreadPart, marks: PanelMarks): void {
  if (part.type === 'data-repair') {
    for (const panel of part.data.panels) marks.failing.set(keyOf(panel.title), part.data);
    return;
  }
  if (!isToolPart(part) || !buildTools.has(toolName(part))) return;
  const into = writeMarks(part, marks);
  for (const title of writtenTitles(part)) into?.add(title);
}

/**
 * Reads the work for the panels saved, the ones being written, and the ones that failed last.
 *
 * @param parts - The work, in order.
 * @returns The marks.
 */
function marksOf(parts: readonly ThreadPart[]): PanelMarks {
  const marks: PanelMarks = { saved: new Set(), running: new Set(), failing: new Map() };
  for (const part of parts) mark(part, marks);
  for (const title of marks.saved) marks.failing.delete(title);
  return marks;
}

/** The words of the try a retry is on. */
const tryWords = ['first', 'second', 'third', 'fourth', 'fifth'];

/**
 * One planned panel's step.
 *
 * @param title - The panel's title.
 * @param marks - What the work says of the panels.
 * @param live - Whether the build still runs.
 * @returns The step.
 */
function panelStep(title: string, marks: PanelMarks, live: boolean): BuildStep {
  const key = keyOf(title);
  if (marks.saved.has(key)) return { title, state: 'done' };
  const failed = marks.failing.get(key);
  if (failed && live) {
    const next = tryWords[failed.attempt] ?? `try ${failed.attempt + 1}`;
    return { title, state: 'retrying', note: `Fixing its query · ${next} try` };
  }
  if (marks.running.has(key)) return { title, state: 'running' };
  return { title, state: live ? 'waiting' : 'missing' };
}

/**
 * The step of reading the data: done once a write starts or the build ends.
 *
 * @param parts - The work.
 * @param live - Whether the build still runs.
 * @returns The step, or none when the work read nothing.
 */
function readStep(parts: readonly ThreadPart[], live: boolean): BuildStep[] {
  const tools = parts.flatMap((part) => (isToolPart(part) ? [part] : []));
  const reads = tools.filter((part) => exploreTools.has(toolName(part))).length;
  if (reads === 0) return [];
  const writing = tools.some((part) => buildTools.has(toolName(part)));
  const title = `Read the data · ${reads} ${reads === 1 ? 'look' : 'looks'}`;
  return [{ title, state: writing || !live ? 'done' : 'running' }];
}

/**
 * The progress of a build of a plan.
 *
 * @param parts - The answer's work, in order.
 * @param plan - The approved plan it builds.
 * @param live - Whether the build still runs.
 * @returns The progress.
 */
export function buildProgress(
  parts: readonly ThreadPart[],
  plan: Plan,
  live: boolean,
): BuildProgress {
  const marks = marksOf(parts);
  const panels = plan.panels.map((panel) => panelStep(panel.title, marks, live));
  const repairs = parts.flatMap((part) => (part.type === 'data-repair' ? [part.data] : []));
  const versions = parts.flatMap((part) => {
    if (!isToolPart(part) || !buildTools.has(toolName(part))) return [];
    const output = part.output as WriteOutput | undefined;
    return output?.ok && output.version !== undefined ? [output.version] : [];
  });
  const version = versions.at(-1);
  return {
    ready: panels.filter((step) => step.state === 'done').length,
    planned: panels.length,
    steps: [...readStep(parts, live), ...panels],
    retries: repairs.filter((repair) => repair.outcome !== 'repaired').length,
    ...(version === undefined ? {} : { version }),
  };
}

/**
 * Whether some work builds: it holds a write of panels.
 *
 * @param parts - The work.
 * @returns Whether a write of a dashboard is among it.
 */
export function buildsPanels(parts: readonly ThreadPart[]): boolean {
  return parts.some((part) => isToolPart(part) && toolName(part) === 'edit_dashboard');
}

/**
 * The approved plan each message builds: the last dashboard plan shown before it, while that
 * plan stays approved.
 *
 * @param messages - The messages, in order.
 * @param plans - The thread's plans, for their statuses.
 * @returns The plan of each message, by position; `undefined` for one that builds none.
 */
export function plansBuilt(
  messages: readonly ThreadMessage[],
  plans: readonly PlanView[],
): (Plan | undefined)[] {
  let shown: string | undefined;
  return messages.map((message) => {
    const view = plans.find((plan) => plan.id === shown);
    const building =
      view?.status === 'approved' && isDashboardPlan(view.body) ? view.body : undefined;
    for (const part of message.parts) if (part.type === 'data-plan') shown = part.data.planId;
    return building;
  });
}
