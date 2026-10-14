import type { ReactNode } from 'react';
import { CheckIcon } from '../../ui/icons.tsx';
import { exploreTools, isToolPart, type ThreadPart, type ToolPart, toolName } from './messages.ts';
import { RepairCard } from './repair-card.tsx';
import { BuildLog, ExploreLog } from './tool-logs.tsx';
import styles from './work-log.module.css';
import { workSummary } from './work-summary.ts';

/**
 * The detail of some work, as the thread showed it before it folded: explore calls grouped into
 * one log, then each write's log and each try's card, in order.
 *
 * @param parts - The work parts, in order.
 * @returns The logs and cards.
 */
function workNodes(parts: readonly ThreadPart[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let explored: ToolPart[] = [];
  const flush = () => {
    if (explored.length > 0) nodes.push(<ExploreLog key={`e${nodes.length}`} parts={explored} />);
    explored = [];
  };
  parts.forEach((part, index) => {
    if (isToolPart(part) && exploreTools.has(toolName(part))) explored.push(part);
    else {
      flush();
      nodes.push(workNode(part, `w${index}`));
    }
  });
  flush();
  return nodes;
}

/**
 * One write's log, or one try's card. A folded try never offers Try again: the agent still fixes
 * it, or fixed it.
 *
 * @param part - A write or a try.
 * @param key - Its key.
 * @returns The element.
 */
function workNode(part: ThreadPart, key: string): ReactNode {
  if (part.type === 'data-repair')
    return (
      <RepairCard key={key} repair={part.data} answerable={false} busy onTryAgain={() => {}} />
    );
  return isToolPart(part) ? <BuildLog key={key} part={part} /> : null;
}

/** Props of {@link WorkLog}. */
interface WorkLogProps {
  /** The work parts, in order. */
  readonly parts: readonly ThreadPart[];
  /** Whether the agent is still at it. */
  readonly live: boolean;
}

/**
 * The agent's work in a turn, folded into one line: what it is doing while it works, such as
 * "Fixing a problem with a query…", and what it did after. Opening it shows every call, write
 * and failed try.
 *
 * @param props - The work and whether it is still going.
 * @returns The folded work.
 */
export function WorkLog({ parts, live }: WorkLogProps) {
  const summary = workSummary(parts, live);
  const moving = summary.state === 'working' || summary.state === 'fixing';
  return (
    <details className={styles.work} data-state={summary.state}>
      <summary className={styles.line} aria-busy={moving}>
        {moving && <span className={styles.pulse} aria-hidden="true" />}
        {summary.state === 'fixed' && <CheckIcon />}
        <span className={styles.text}>{summary.text}</span>
      </summary>
      <div className={styles.detail}>{workNodes(parts)}</div>
    </details>
  );
}
