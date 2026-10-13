/**
 * The top of a run's page: the breadcrumb, the period with ‹ and › to the runs of the periods
 * before and after, the line saying when it ran and where it went (or why it failed), and the
 * actions: Ask about this, Edit layout for those who may arrange the active version, Change, Share
 * and Versions. Below 720 px the actions fold into one menu, without Edit layout.
 */
import type { ReportDetail, ReportRunDetail } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { LayoutIcon, MoreIcon, QuestionIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import { TitleHeader } from '../../ui/title-header.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import styles from './run.module.css';
import { ChangeItems, CopyLinkItem, MenuButtons, VersionItems } from './run-menus.tsx';
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
  /** Starts arranging the panels; left out for who may not, or where there is nothing to arrange. */
  readonly onArrange?: (() => void) | undefined;
  /** The layout edit's bar, which takes the actions' place while the edit lasts. */
  readonly bar?: ReactNode;
  /** The layout edit's hint and the reason of a refused save, shown under the title. */
  readonly notes?: ReactNode;
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
  const editor = report.canChange;
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
 * The header's actions, folded into one menu on a narrow screen, where nothing is arranged.
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
      {props.onArrange && (
        <Button onClick={props.onArrange}>
          <LayoutIcon /> Edit layout
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
  // No step to another run while the layout is arranged: the edit is of this page.
  const stepped = props.bar ? null : run;
  return (
    <TitleHeader
      className={styles.header}
      level={1}
      size="screen"
      align="end"
      title={run ? runTitle(run.period.label) : report.title}
      eyebrow={
        <nav aria-label="Breadcrumb">
          <Link to="/reports">Reports</Link> / {report.title}
        </nav>
      }
      before={
        stepped && <Step reportId={report.id} to={stepped.previous} arrow="‹" which="Previous" />
      }
      after={stepped && <Step reportId={report.id} to={stepped.next} arrow="›" which="Next" />}
      below={
        <>
          <p className={styles.ran} data-tone={run?.status === 'failed' ? 'danger' : undefined}>
            {run ? ranLine(run, zone) : 'No run yet. Opening a run runs no query.'}
          </p>
          {props.notes}
        </>
      }
      actions={props.bar || <HeaderActions {...props} />}
    />
  );
}
