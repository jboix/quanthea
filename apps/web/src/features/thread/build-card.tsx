/**
 * The build of an approved plan as one card: while it runs, how many panels are ready, for how
 * long, a step per panel and Stop; once it ends, the version it built, in how long and at what
 * cost. The calls and test runs behind it stay folded under Details.
 */
import type { Plan, TurnUsage } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { ProgressLine } from '../../ui/progress-line.tsx';
import styles from './build-card.module.css';
import {
  type BuildProgress,
  type BuildStep,
  buildProgress,
  buildsPanels,
} from './build-progress.ts';
import type { ThreadMessage, ThreadPart } from './messages.ts';
import { costText } from './usage-line.tsx';
import { WorkLog, workNodes } from './work-log.tsx';

/** Props of {@link BuildCard}. */
interface BuildCardProps {
  /** The answer's work, in order. */
  readonly parts: readonly ThreadPart[];
  /** The plan it builds. */
  readonly plan: Plan;
  /** Whether the build still runs. */
  readonly live: boolean;
  /** What the answer cost, once it ends. */
  readonly usage?: TurnUsage | undefined;
  /** How long the answer worked, in milliseconds, once it ends. */
  readonly workedMs?: number | undefined;
  /** Stops the run. */
  readonly onStop?: (() => void) | undefined;
}

/**
 * A duration as a clock while it runs, such as `1:29`.
 *
 * @param milliseconds - The duration.
 * @returns The clock.
 */
export function clockText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A duration in words once it ended, such as `2 min 10 s` or `40 s`.
 *
 * @param milliseconds - The duration.
 * @returns The words.
 */
export function durationText(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`;
}

/**
 * The milliseconds since the card first showed, ticking each second while the build runs.
 *
 * @param live - Whether the build runs.
 * @returns The elapsed time.
 */
function useElapsed(live: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now - start;
}

/**
 * The heading of the card and its one line of numbers.
 *
 * @param progress - The progress.
 * @param live - Whether the build runs.
 * @param elapsed - The live time, or the time worked once it ended.
 * @param usage - What the answer cost, once it ends.
 * @returns The heading and the line.
 */
function headingOf(
  progress: BuildProgress,
  live: boolean,
  elapsed: number,
  usage: TurnUsage | undefined,
) {
  const count = `${progress.ready} of ${progress.planned} panels ready`;
  if (live) return { title: 'Building your dashboard', line: `${count} · ${clockText(elapsed)}` };
  const all = progress.ready === progress.planned;
  const title =
    progress.version === undefined ? 'Nothing was built' : `Built version ${progress.version}`;
  const panels = all ? `${progress.planned} panels` : count;
  const cost = usage && Object.keys(usage).length > 0 ? ` · ${costText(usage)}` : '';
  const time = elapsed > 0 ? ` · ${durationText(elapsed)}` : '';
  return { title, line: `${panels}${time}${cost}` };
}

/**
 * One step of the build, with its mark and its quiet line.
 *
 * @param props - The step.
 * @param props.step - The step.
 * @returns The item.
 */
function StepItem({ step }: { readonly step: BuildStep }) {
  return (
    <li className={styles.step} data-state={step.state}>
      <span className={styles.mark} aria-hidden="true" />
      <span className={styles.stepText}>
        <span>{step.title}</span>
        {step.note && <span className={styles.note}>{step.note}</span>}
      </span>
    </li>
  );
}

/**
 * The steps of the build, in order.
 *
 * @param props - The steps.
 * @param props.steps - The steps.
 * @returns The list.
 */
function StepList({ steps }: { readonly steps: readonly BuildStep[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((step) => (
        <StepItem key={step.title} step={step} />
      ))}
    </ol>
  );
}

/**
 * The card's heading, its line of numbers, and Stop while the build runs.
 *
 * @param props - The heading and Stop.
 * @param props.heading - The title and the line.
 * @param props.onStop - Stops the run, while it runs.
 * @returns The header.
 */
function CardHeader({
  heading,
  onStop,
}: {
  readonly heading: { readonly title: string; readonly line: string };
  readonly onStop?: (() => void) | undefined;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h3 className={styles.title}>{heading.title}</h3>
        <p className={styles.line}>{heading.line}</p>
      </div>
      {onStop && (
        <Button size="small" onClick={onStop}>
          Stop
        </Button>
      )}
    </header>
  );
}

/**
 * What a running build shows: how far along, and its steps.
 *
 * @param props - The progress.
 * @param props.progress - The progress.
 * @returns The line and the steps.
 */
function LiveBody({ progress }: { readonly progress: BuildProgress }) {
  return (
    <>
      <ProgressLine value={progress.ready / Math.max(1, progress.planned)} />
      <StepList steps={progress.steps} />
    </>
  );
}

/**
 * The failed tries an ended build fixed on its way, if any.
 *
 * @param props - The count.
 * @param props.retries - How many writes failed and were tried again.
 * @returns The line, or nothing.
 */
function RetryLine({ retries }: { readonly retries: number }) {
  if (retries === 0) return null;
  return (
    <p className={styles.line}>
      {retries} failed {retries === 1 ? 'try' : 'tries'} fixed on the way
    </p>
  );
}

/**
 * The folded details: the calls and test runs, after the steps once the build ended.
 *
 * @param props - Whether it runs, its steps and its work.
 * @param props.live - Whether the build runs.
 * @param props.steps - Its steps.
 * @param props.parts - Its work.
 * @returns The details.
 */
function CardDetails({
  live,
  steps,
  parts,
}: {
  readonly live: boolean;
  readonly steps: readonly BuildStep[];
  readonly parts: readonly ThreadPart[];
}) {
  return (
    <details className={styles.details}>
      <summary className={styles.detailsToggle}>{live ? 'Details' : 'Steps and details'}</summary>
      {!live && <StepList steps={steps} />}
      <div className={styles.logs}>{workNodes(parts)}</div>
    </details>
  );
}

/**
 * The build of an approved plan. While it runs its steps show; once it ends they fold under
 * Details with the calls and test runs.
 *
 * @param props - The work, the plan, whether it runs, its cost and time, and Stop.
 * @returns The card.
 */
export function BuildCard({ parts, plan, live, usage, workedMs, onStop }: BuildCardProps) {
  const progress = buildProgress(parts, plan, live);
  const elapsed = useElapsed(live);
  const heading = headingOf(progress, live, live ? elapsed : (workedMs ?? 0), usage);
  return (
    <section className={styles.card} aria-label="Build" aria-busy={live}>
      <CardHeader heading={heading} onStop={live ? onStop : undefined} />
      {live ? <LiveBody progress={progress} /> : <RetryLine retries={progress.retries} />}
      <CardDetails live={live} steps={progress.steps} parts={parts} />
    </section>
  );
}

/** Props of {@link WorkView}. */
interface WorkViewProps {
  /** The work parts, in order. */
  readonly parts: readonly ThreadPart[];
  /** Whether the agent is still at it. */
  readonly live: boolean;
  /** The approved plan the answer builds, if it builds one. */
  readonly building: Plan | undefined;
  /** The answer's metadata: what it cost and how long it worked. */
  readonly metadata: ThreadMessage['metadata'];
  /** Stops the run. */
  readonly onStop?: (() => void) | undefined;
}

/**
 * The agent's work in an answer: the build card when it writes a dashboard for an approved plan,
 * else the work folded into one line.
 *
 * @param props - The work, whether it runs, the plan it builds, the answer's metadata and Stop.
 * @returns The card or the line.
 */
export function WorkView({ parts, live, building, metadata, onStop }: WorkViewProps) {
  if (!building || !buildsPanels(parts)) return <WorkLog parts={parts} live={live} />;
  return (
    <BuildCard
      parts={parts}
      plan={building}
      live={live}
      usage={metadata?.usage}
      workedMs={metadata?.workedMs}
      onStop={onStop}
    />
  );
}
