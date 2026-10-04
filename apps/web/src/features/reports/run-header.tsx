/**
 * The top of a run's page: the breadcrumb, the period with ‹ and › to the runs of the periods
 * before and after, the line saying when it ran and where it went (or why it failed), and the
 * actions: Ask about this, Change, Share and Versions. Below 720 px the actions fold into one menu.
 */
import { hasRole, type ReportDetail, type ReportRunDetail } from '@quanthea/shared';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { MoreIcon, QuestionIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import styles from './run.module.css';
import { ChangeItems, CopyLinkItem, MenuButtons, VersionItems } from './run-menus.tsx';
import { useRole } from './use-role.ts';
import { ranLine, runTitle } from './words.ts';

/** Below this width the header actions fold into one menu. */
const narrowScreen = '(max-width: 720px)';

/** Props of {@link RunHeader}. */
interface RunHeaderProps {
  /** The report. */
  readonly report: ReportDetail;
  /** The run shown, or `null` before the first. */
  readonly run: ReportRunDetail | null;
  /** Opens the Ask tab; left out where there is nothing to ask about. */
  readonly onAsk?: (() => void) | undefined;
  /** Whether the side panel is open. */
  readonly asking: boolean;
}

/**
 * A step to the run of another period, or a quiet arrow when there is none.
 *
 * @param props - The neighbour, the arrow and which way it goes.
 * @param props.reportId - The report.
 * @param props.to - The neighbouring run, if any.
 * @param props.arrow - `‹` or `›`.
 * @param props.which - `Previous` or `Next`.
 * @returns The link, or the disabled arrow.
 */
function Step({
  reportId,
  to,
  arrow,
  which,
}: {
  readonly reportId: string;
  readonly to: ReportRunDetail['previous'];
  readonly arrow: string;
  readonly which: string;
}) {
  if (!to)
    return (
      <span className={styles.step} aria-disabled="true" title={`No ${which.toLowerCase()} run`}>
        {arrow}
      </span>
    );
  const label = `${which} run: ${to.period.label}`;
  return (
    <Link
      to={`/reports/${reportId}/runs/${to.id}`}
      className={styles.step}
      aria-label={label}
      title={label}
    >
      {arrow}
    </Link>
  );
}

/**
 * The actions folded into one menu: Ask about this, then Change, Share and Versions.
 *
 * @param props - The header's props and the closer.
 * @param props.close - Closes the menu.
 * @returns The menu's content.
 */
function FoldedActions({ report, onAsk, close }: RunHeaderProps & { readonly close: () => void }) {
  const editor = hasRole(useRole(), 'editor');
  return (
    <div className={styles.folded}>
      {onAsk && (
        <MenuItem
          label="Ask about this"
          onClick={() => {
            close();
            onAsk();
          }}
        />
      )}
      {editor && <h2 className={styles.menuHeading}>Change</h2>}
      {editor && <ChangeItems report={report} close={close} />}
      <h2 className={styles.menuHeading}>Share</h2>
      <CopyLinkItem />
      {editor && <h2 className={styles.menuHeading}>Versions</h2>}
      {editor && <VersionItems report={report} close={close} />}
    </div>
  );
}

/**
 * The header's actions, folded into one menu on a narrow screen.
 *
 * @param props - The header's props.
 * @returns The actions.
 */
function HeaderActions(props: RunHeaderProps) {
  const narrow = useMediaQuery(narrowScreen);
  if (narrow)
    return (
      <Popover label="Run actions" trigger={<MoreIcon />} align="end">
        {(close) => <FoldedActions {...props} close={close} />}
      </Popover>
    );
  return (
    <div className={styles.actions}>
      {props.onAsk && (
        <Button aria-pressed={props.asking} onClick={props.onAsk}>
          <QuestionIcon /> Ask about this
        </Button>
      )}
      <MenuButtons report={props.report} />
    </div>
  );
}

/**
 * The header of a run's page.
 *
 * @param props - The report, the run, and the way into the Ask tab.
 * @returns The header.
 */
export function RunHeader(props: RunHeaderProps) {
  const { report, run } = props;
  const zone = report.schedule.timezone;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/reports">Reports</Link> / {report.title}
        </nav>
        <div className={styles.titleRow}>
          {run && <Step reportId={report.id} to={run.previous} arrow="‹" which="Previous" />}
          <h1 className={styles.title}>{run ? runTitle(run.period.label) : report.title}</h1>
          {run && <Step reportId={report.id} to={run.next} arrow="›" which="Next" />}
        </div>
        <p className={styles.ran} data-tone={run?.status === 'failed' ? 'danger' : undefined}>
          {run ? ranLine(run, zone) : 'No run yet. Opening a run runs no query.'}
        </p>
      </div>
      <HeaderActions {...props} />
    </header>
  );
}
