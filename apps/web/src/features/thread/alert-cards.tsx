/**
 * The cards of an alert thread: the alert plan the agent proposes, approved like a dashboard plan,
 * and the card that says the person changed the draft by hand, with the fields that changed.
 */
import type { PlanView, ThreadData } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';

/** An alert plan's data. */
type AlertPlanData = ThreadData['alertPlan'];

/**
 * The plan's facts: what it watches, when it fires, how often, whom it notifies.
 *
 * @param props - The plan.
 * @param props.plan - The plan.
 * @returns The list.
 */
function AlertPlanFacts({ plan }: { readonly plan: AlertPlanData['body'] }) {
  const channels = plan.channels.map((channel) => channel.name).join(', ') || 'no channel yet';
  return (
    <dl className={styles.planFacts}>
      <dt>Watch</dt>
      <dd>
        {plan.watch} <span className={styles.mono}>({plan.connector})</span>
      </dd>
      <dt>Fires when</dt>
      <dd>{plan.condition}</dd>
      <dt>Checks</dt>
      <dd>{plan.every}</dd>
      <dt>Notifies</dt>
      <dd>{plan.notify ? `${channels}, ${plan.notify}` : channels}</dd>
    </dl>
  );
}

/** Props of {@link AlertPlanCard}. */
interface AlertPlanCardProps {
  /** The plan part's data. */
  readonly data: AlertPlanData;
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
 * An alert plan: approve it, edit it, or reply to change it. Once decided, it folds into a line.
 *
 * @param props - The plan, its status and the callbacks.
 * @returns The card.
 */
export function AlertPlanCard({ data, status, busy, onApprove, onEdit }: AlertPlanCardProps) {
  const [open, setOpen] = useState(false);
  if (status !== 'pending') {
    return (
      <div className={styles.folded} data-status={status}>
        {status === 'approved' && <CheckIcon />}
        <span>Alert plan {status}</span>
        <button type="button" className={styles.link} onClick={() => setOpen(!open)}>
          {open ? 'Hide plan' : 'Show plan'}
        </button>
        {open && <AlertPlanFacts plan={data.body} />}
      </div>
    );
  }
  return (
    <section className={styles.plan} aria-label="Alert plan">
      <header className={styles.planHead}>
        <span className={styles.planLabel}>Alert plan</span>
        <span className={styles.planTitle}>{data.body.title}</span>
      </header>
      <div className={styles.planBody}>
        <AlertPlanFacts plan={data.body} />
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

/**
 * The person's change to the draft: the versions, and each field before and after.
 *
 * @param props - The hand edit.
 * @param props.data - The hand edit.
 * @returns The card.
 */
export function HandEditCard({ data }: { readonly data: ThreadData['handEdit'] }) {
  return (
    <section className={styles.diff} aria-label="Changed by hand">
      <div className={styles.diffPanel}>
        <header className={styles.diffHead}>
          <span>You changed it by hand</span>
          <span className={styles.mono}>
            v{data.from} → v{data.to}
          </span>
        </header>
        <ul className={styles.diffLines}>
          {data.changes.flatMap((change) => [
            ...(change.before === undefined
              ? []
              : [
                  <li key={`${change.path}-`} data-kind="-">
                    − {change.path}: {change.before}
                  </li>,
                ]),
            ...(change.after === undefined
              ? []
              : [
                  <li key={`${change.path}+`} data-kind="+">
                    + {change.path}: {change.after}
                  </li>,
                ]),
          ])}
        </ul>
      </div>
    </section>
  );
}
