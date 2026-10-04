/**
 * The report plan the agent proposes in a report thread, approved like a dashboard plan: when it
 * runs, what it covers, what it compares with, what it shows, the dashboards it links to and where
 * it is sent.
 */
import type { PlanView, ThreadData } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';

/** A report plan's data. */
type ReportPlanData = ThreadData['reportPlan'];

/**
 * The names of a plan's links or channels, or what stands for none.
 *
 * @param named - The named ids.
 * @param none - What to say for none.
 * @returns The names, joined.
 */
function namesOf(named: readonly { readonly name: string }[], none: string): string {
  return named.map((each) => each.name).join(', ') || none;
}

/**
 * The plan's facts: Runs, Covers, Compares, Shows, See also, Sends to.
 *
 * @param props - The plan.
 * @param props.plan - The plan.
 * @returns The list.
 */
function ReportPlanFacts({ plan }: { readonly plan: ReportPlanData['body'] }) {
  const connectors = plan.connectors.join(', ');
  return (
    <dl className={styles.planFacts}>
      <dt>Runs</dt>
      <dd>{plan.runs}</dd>
      <dt>Covers</dt>
      <dd>{plan.covers}</dd>
      <dt>Compares</dt>
      <dd>{plan.compares}</dd>
      <dt>Shows</dt>
      <dd>
        {plan.shows} {connectors && <span className={styles.mono}>({connectors})</span>}
      </dd>
      <dt>See also</dt>
      <dd>{namesOf(plan.seeAlso, 'no dashboard')}</dd>
      <dt>Sends to</dt>
      <dd>{`${namesOf(plan.channels, 'no channel yet')}, and the Reports page`}</dd>
    </dl>
  );
}

/** Props of {@link ReportPlanCard}. */
interface ReportPlanCardProps {
  /** The plan part's data. */
  readonly data: ReportPlanData;
  /** Its status, as the thread knows it. */
  readonly status: PlanView['status'];
  /** Whether a decision or a run is on its way. */
  readonly busy: boolean;
  /** Approves the plan. */
  readonly onApprove: (planId: string) => void;
  /** Rejects it and asks for changes in the composer. */
  readonly onEdit: (planId: string) => void;
}

/**
 * A report plan: approve it, edit it, or reply to change it. Once decided, it folds into a line.
 *
 * @param props - The plan, its status and the callbacks.
 * @returns The card.
 */
export function ReportPlanCard({ data, status, busy, onApprove, onEdit }: ReportPlanCardProps) {
  const [open, setOpen] = useState(false);
  if (status !== 'pending') {
    return (
      <div className={styles.folded} data-status={status}>
        {status === 'approved' && <CheckIcon />}
        <span>Report plan {status}</span>
        <button type="button" className={styles.link} onClick={() => setOpen(!open)}>
          {open ? 'Hide plan' : 'Show plan'}
        </button>
        {open && <ReportPlanFacts plan={data.body} />}
      </div>
    );
  }
  return (
    <section className={styles.plan} aria-label="Report plan">
      <header className={styles.planHead}>
        <span className={styles.planLabel}>Report plan</span>
        <span className={styles.planTitle}>{data.body.title}</span>
      </header>
      <div className={styles.planBody}>
        <ReportPlanFacts plan={data.body} />
      </div>
      <footer className={styles.planActions}>
        <Button variant="primary" disabled={busy} onClick={() => onApprove(data.planId)}>
          Approve &amp; write
        </Button>
        <Button disabled={busy} onClick={() => onEdit(data.planId)}>
          Edit plan
        </Button>
        <span className={styles.hint}>or reply to change it</span>
      </footer>
    </section>
  );
}
