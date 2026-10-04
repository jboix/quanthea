/**
 * The agent's offer to show the alert on a dashboard panel whose query matches: Link or Not now.
 * Nothing is linked until the person clicks Link; Not now dismisses the suggestion, so it is not
 * offered again. The card reads where the alert is shown, so it says what was decided after a
 * reload too.
 */
import type { AlertLinks, ThreadData } from '@quanthea/shared';
import { useEffect } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import type { LinkIntent, LinkLoad } from '../alerts/index.ts';
import styles from './cards.module.css';

/** The proposal's data. */
type Proposal = ThreadData['linkProposal'];

/** What the person decided, if anything yet. */
type Decision = 'linked' | 'declined' | undefined;

/**
 * What was decided about the proposed panel, from where the alert is shown.
 *
 * @param links - Where the alert is shown, and the dismissed suggestions.
 * @param data - The proposal.
 * @returns Linked, declined, or nothing yet.
 */
function decisionOf(links: AlertLinks | undefined, data: Proposal): Decision {
  const same = (each: { readonly dashboardId: string; readonly panelId: string }) =>
    each.dashboardId === data.dashboardId && each.panelId === data.panelId;
  if (links?.links.some(same)) return 'linked';
  return links?.dismissed.some(same) ? 'declined' : undefined;
}

/**
 * Where the alert is shown, loaded when the card shows and again after each change.
 *
 * @param alertId - The alert.
 * @returns Where it is shown, once loaded.
 */
function useAlertLinks(alertId: string): AlertLinks | undefined {
  const fetcher = useFetcher<LinkLoad<AlertLinks>>({ key: `alert-links-${alertId}` });
  const { load } = fetcher;
  useEffect(() => void load(`/alerts/${alertId}/links`), [load, alertId]);
  return fetcher.data?.ok ? fetcher.data.value : undefined;
}

/**
 * Submits a link intent to the alert page's action.
 *
 * @param alertId - The alert.
 * @returns The submit function, whether one is on its way, and why the last was refused.
 */
function useLinkChange(alertId: string) {
  const change = useFetcher<{ readonly ok: boolean; readonly message?: string }>();
  const submit = (intent: LinkIntent) =>
    void change.submit(intent as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
      action: `/alerts/${alertId}`,
    });
  const refused = change.data?.ok === false ? change.data.message : undefined;
  return { submit, busy: change.state !== 'idle', refused };
}

/**
 * The panel proposed, on its dashboard, with a link to it.
 *
 * @param props - The proposal.
 * @param props.data - The proposal.
 * @returns The words.
 */
function Where({ data }: { readonly data: Proposal }) {
  return (
    <>
      <em>{data.panelTitle}</em> on{' '}
      <Link to={`/d/${data.dashboardId}#panel-${encodeURIComponent(data.panelId)}`}>
        {data.dashboardTitle}
      </Link>
    </>
  );
}

/**
 * What was decided, folded into a line.
 *
 * @param props - The proposal and the decision.
 * @param props.data - The proposal.
 * @param props.decision - Linked or declined.
 * @returns The line.
 */
function Decided({
  data,
  decision,
}: {
  readonly data: Proposal;
  readonly decision: NonNullable<Decision>;
}) {
  const linked = decision === 'linked';
  return (
    <div className={styles.folded} data-status={linked ? 'approved' : undefined}>
      {linked && <CheckIcon />}
      <span>
        {linked ? 'Shown on ' : 'Not shown on '}
        <Where data={data} />
      </span>
    </div>
  );
}

/**
 * The card: the offer with Link and Not now, or, once decided, a line that says what was.
 *
 * @param props - The proposal.
 * @param props.data - The proposal.
 * @returns The card.
 */
export function LinkProposalCard({ data }: { readonly data: Proposal }) {
  const links = useAlertLinks(data.alertId);
  const { submit, busy, refused } = useLinkChange(data.alertId);
  const decision = decisionOf(links, data);
  const panel = { dashboardId: data.dashboardId, panelId: data.panelId };
  if (decision !== undefined) return <Decided data={data} decision={decision} />;
  const waiting = busy || links === undefined;
  return (
    <section className={styles.plan} aria-label="Show the alert on a panel">
      <p className={styles.proposal}>
        This watches the same thing as <Where data={data} />. Show it there?
      </p>
      <footer className={styles.planActions}>
        <Button
          variant="primary"
          disabled={waiting}
          onClick={() => submit({ intent: 'link', ...panel, how: 'agent' })}
        >
          Link
        </Button>
        <Button disabled={waiting} onClick={() => submit({ intent: 'dismissLink', ...panel })}>
          Not now
        </Button>
        {refused && <span className={styles.hint}>{refused}</span>}
      </footer>
    </section>
  );
}
