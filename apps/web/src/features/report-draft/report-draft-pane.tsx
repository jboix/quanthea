/**
 * The draft pane of a report thread: the draft's title and version, Send a test now and Activate,
 * then a link to the report's page once a version is active; the schedule as a sentence of values
 * to change; the preview on the latest period; the dashboards it links to; and where it is sent.
 * Every change made here saves a new draft version by hand, which the conversation shows and the
 * agent reads.
 */
import type { ReportSpec } from '@quanthea/shared';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import type { ReportDraftData } from './data.ts';
import { PreviewSection } from './preview-section.tsx';
import styles from './report-draft.module.css';
import { ScheduleSentence } from './schedule-sentence.tsx';

/** What the pane tells the person after an action. */
export interface PaneNotice {
  /** The words. */
  readonly text: string;
  /** Whether it says what failed. */
  readonly failed: boolean;
}

/** Props of {@link ReportDraftPane}. */
export interface ReportDraftPaneProps {
  /** The thread. */
  readonly threadId: string;
  /** The draft, or `null` before the agent writes it. */
  readonly draft: ReportDraftData | null;
  /** Whether a run or an action is on its way, or the person may only read. */
  readonly busy: boolean;
  /** What the last action said, if anything. */
  readonly notice: PaneNotice | undefined;
  /** Saves the spec changed by hand as a new version. */
  readonly onHandEdit: (spec: ReportSpec) => void;
  /** Activates the version. */
  readonly onActivate: (reportId: string, version: number) => void;
  /** Sends the version's message to its channels as a test. */
  readonly onTest: (reportId: string, version: number) => void;
}

/** The pane's props for a written draft. */
type DraftProps = ReportDraftPaneProps & { readonly draft: ReportDraftData };

/**
 * The pane's header: title, version, the test and Activate, and the report's page once active.
 *
 * @param props - The pane's props.
 * @returns The header.
 */
function PaneHead(props: DraftProps) {
  const { draft, busy } = props;
  const { report, version, spec } = draft;
  const active = report.activeVersion === version && !report.deactivated;
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>{spec.title}</h2>
      <Pill tone={active ? 'ok' : 'draft'} mono>
        v{version} · {active ? 'active' : 'draft'}
      </Pill>
      <span className={styles.spacer} />
      <div className={styles.actions}>
        {report.activeVersion !== null && (
          <Link className={styles.link} to={`/reports/${report.id}`}>
            Open the report page
          </Link>
        )}
        <Button
          disabled={busy || spec.delivery.channels.length === 0}
          onClick={() => props.onTest(report.id, version)}
        >
          Send a test now
        </Button>
        <Button
          variant="dark"
          disabled={busy || active}
          onClick={() => props.onActivate(report.id, version)}
        >
          Activate
        </Button>
      </div>
    </header>
  );
}

/**
 * The pinned dashboards the report links to, each opened on the run's period.
 *
 * @param props - The draft.
 * @param props.draft - The draft.
 * @returns The card.
 */
function SeeAlso({ draft }: { readonly draft: ReportDraftData }) {
  return (
    <section className={styles.card} aria-label="See also">
      <h3 className={styles.cardTitle}>See also</h3>
      {draft.links.length === 0 ? (
        <p className={styles.hint}>No dashboard yet. Ask the agent to link a pinned one.</p>
      ) : (
        <ul className={styles.list}>
          {draft.links.map((link) => (
            <li key={link.dashboardId}>
              <Link className={styles.link} to={`/d/${link.dashboardId}`}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.hint}>Each run opens them on its period.</p>
    </section>
  );
}

/**
 * Where the report is sent: its channels, and the Reports page.
 *
 * @param props - The draft.
 * @param props.draft - The draft.
 * @returns The card.
 */
function SendsTo({ draft }: { readonly draft: ReportDraftData }) {
  const named = draft.spec.delivery.channels.map((id) => {
    const channel = draft.channels.find((each) => each.id === id);
    return channel ? `${channel.name} · ${channel.kind}` : id;
  });
  const headlines = draft.spec.summaryPanels.length;
  return (
    <section className={styles.card} aria-label="Sends to">
      <h3 className={styles.cardTitle}>Sends to</h3>
      <p className={styles.note}>
        {named.length === 0 ? 'The Reports page only' : `${named.join(', ')}, and the Reports page`}
      </p>
      <p className={styles.hint}>
        {headlines === 1
          ? 'The message carries the headline number and a link to the run.'
          : `The message carries the ${headlines} headline numbers and a link to the run.`}
      </p>
    </section>
  );
}

/**
 * The pane's body for a written draft.
 *
 * @param props - The pane's props and the draft.
 * @returns The header and the body.
 */
function DraftBody(props: DraftProps) {
  const { draft, busy, notice, onHandEdit, threadId } = props;
  return (
    <>
      <PaneHead {...props} />
      <div className={styles.body}>
        {notice && (
          <p className={styles.notice} role="status" data-failed={notice.failed}>
            {notice.text}
          </p>
        )}
        <ScheduleSentence spec={draft.spec} disabled={busy} onChange={onHandEdit} />
        <PreviewSection threadId={threadId} version={draft.version} spec={draft.spec} />
        <div className={styles.grid}>
          <SeeAlso draft={draft} />
          <SendsTo draft={draft} />
        </div>
      </div>
    </>
  );
}

/**
 * The draft pane of a report thread.
 *
 * @param props - The thread, the draft, the state and the actions.
 * @returns The pane.
 */
export function ReportDraftPane(props: ReportDraftPaneProps) {
  const { draft } = props;
  return (
    <section className={styles.pane} aria-label="Report draft">
      {draft ? (
        <DraftBody key={`${draft.report.id}-${draft.version}`} {...props} draft={draft} />
      ) : (
        <p className={styles.empty}>
          The report appears here once the agent writes it: when it runs, a preview on its latest
          period, the dashboards it links to and where it is sent.
        </p>
      )}
    </section>
  );
}
