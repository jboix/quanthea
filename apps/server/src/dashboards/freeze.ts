/**
 * Freezes the runs of a spec's panels for a snapshot: each panel once, and each panel of a
 * repeated section once for every value its variable takes, under `id#value`. The variables are
 * resolved once for each set of choices, and the panels run four at a time.
 */
import { copyLimit, type DashboardSpec, type PanelRun, type Section } from '@quanthea/shared';
import {
  type PreparedRun,
  prepareRun,
  type RunChoices,
  type RunnerDependencies,
  runPanel,
} from './run-panel.ts';

/** How many panels run at once while freezing. */
const poolSize = 4;

/** One run to freeze: the key it is stored under, the panel, and its choices. */
interface FreezeTask {
  /** The panel's id, with `#` and the value in a copy of a repeated section. */
  readonly key: string;
  /** The panel. */
  readonly panelId: string;
  /** The choices it runs on. */
  readonly choices: RunChoices;
}

/**
 * The values a repeated section takes: its variable's binding, at most the copies it may draw.
 *
 * @param spec - The spec.
 * @param section - The section, which repeats.
 * @param prepared - The page's run, its variables bound.
 * @returns The values.
 */
function copyValues(spec: DashboardSpec, section: Section, prepared: PreparedRun): string[] {
  const bound = prepared.resolved[section.repeat ?? '']?.value;
  return [bound ?? []].flat().map(String).slice(0, copyLimit(spec, section.id));
}

/**
 * The runs to freeze: every panel on the page's choices, and the panels of a repeated section
 * once for each of its values instead.
 *
 * @param spec - The spec.
 * @param choices - The page's choices.
 * @param prepared - The page's run, its variables bound.
 * @returns The runs.
 */
function freezeTasks(
  spec: DashboardSpec,
  choices: RunChoices,
  prepared: PreparedRun,
): FreezeTask[] {
  const repeated = (spec.sections ?? []).filter((section) => section.repeat !== undefined);
  const copied = new Set(repeated.map((section) => section.id));
  const plain = spec.panels.filter(
    (panel) => panel.section === undefined || !copied.has(panel.section),
  );
  const tasks = plain.map((panel) => ({ key: panel.id, panelId: panel.id, choices }));
  const copies = repeated.flatMap((section) =>
    copyValues(spec, section, prepared).flatMap((value) => {
      const variables = { ...choices.variables, [section.repeat ?? '']: value };
      return spec.panels
        .filter((panel) => panel.section === section.id)
        .map((panel) => ({
          key: `${panel.id}#${value}`,
          panelId: panel.id,
          choices: { ...choices, variables },
        }));
    }),
  );
  return [...tasks, ...copies];
}

/**
 * Runs tasks a few at a time, keeping their order.
 *
 * @param tasks - The tasks.
 * @param run - Runs one.
 * @returns Each task's result, in order.
 */
async function pooled<Task, Result>(
  tasks: readonly Task[],
  run: (task: Task) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < tasks.length; index = next++) {
      results[index] = await run(tasks[index] as Task);
    }
  };
  await Promise.all(Array.from({ length: Math.min(poolSize, tasks.length) }, worker));
  return results;
}

/**
 * Freezes the runs of every panel and every copy of a repeated section.
 *
 * @param dependencies - The connectors, the executor and the clock.
 * @param spec - The spec.
 * @param choices - The page's variables and its absolute time range.
 * @param signal - Aborted when the caller gives up.
 * @returns Each run, by panel id, or by panel id, `#` and value for a copy.
 */
export async function freezeRuns(
  dependencies: RunnerDependencies,
  spec: DashboardSpec,
  choices: RunChoices,
  signal?: AbortSignal,
): Promise<Record<string, PanelRun>> {
  const page = await prepareRun(dependencies, spec, choices, signal);
  const tasks = freezeTasks(spec, choices, page);
  const prepared = new Map<RunChoices, Promise<PreparedRun>>([[choices, Promise.resolve(page)]]);
  const preparedFor = (task: FreezeTask) => {
    const known =
      prepared.get(task.choices) ?? prepareRun(dependencies, spec, task.choices, signal);
    prepared.set(task.choices, known);
    return known;
  };
  const runs = await pooled(tasks, async (task) =>
    runPanel(dependencies, spec, task.panelId, task.choices, signal, await preparedFor(task)),
  );
  return Object.fromEntries(tasks.map((task, index) => [task.key, runs[index] as PanelRun]));
}
