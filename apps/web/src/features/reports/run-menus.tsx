/**
 * The run page's menus. Change, for editors, opens the conversation that wrote the report, runs it
 * now, and stops or resumes its schedule. Share copies the page's link. Versions lists the
 * versions, the active one marked; editors activate another.
 */
import { dayMonth, type ReportDetail } from '@quanthea/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { ChevronDownIcon, HistoryIcon } from '../../ui/icons.tsx';
import { MenuItem, MenuItemText, menuItemClassName } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './run.module.css';
import { useReportChange } from './use-report-change.ts';

/** Props of the menus' contents. */
export interface MenuProps {
  /** The report. */
  readonly report: ReportDetail;
  /** Closes the menu. */
  readonly close: () => void;
}

/**
 * The item that stops or resumes the schedule, and what it says.
 *
 * @param report - The report.
 * @returns The intent, its label and its hint.
 */
export function scheduleAction(report: ReportDetail) {
  if (report.activeVersion !== null && !report.deactivated)
    return {
      intent: { intent: 'deactivate' as const },
      label: 'Deactivate',
      hint: 'Stops the schedule. The runs and the active version stay.',
    };
  const version = report.activeVersion ?? report.latestVersion ?? 1;
  return {
    intent: { intent: 'activate' as const, version },
    label: report.activeVersion === null ? `Activate v${version}` : 'Activate again',
    hint: 'Puts it back on its schedule, once its queries run.',
  };
}

/**
 * What the Change menu holds: Edit with the agent, Run now, and Deactivate or Activate.
 *
 * @param props - The report and the closer.
 * @returns The items.
 */
export function ChangeItems({ report, close }: MenuProps) {
  const { submit, busy } = useReportChange(report.id);
  const action = scheduleAction(report);
  const act = (intent: Parameters<typeof submit>[0]) => {
    submit(intent);
    close();
  };
  return (
    <div className={styles.menu}>
      {report.threadId && (
        <Link to={`/threads/${report.threadId}`} className={menuItemClassName}>
          <MenuItemText
            label="Edit with the agent"
            hint="Opens the conversation that wrote it. A change is a new version."
          />
        </Link>
      )}
      <MenuItem
        label="Run now"
        hint="Runs it over its latest period and opens the run. Sends nothing."
        disabled={busy}
        onClick={() => act({ intent: 'run' })}
      />
      <MenuItem
        label={action.label}
        hint={action.hint}
        disabled={busy}
        onClick={() => act(action.intent)}
      />
    </div>
  );
}

/**
 * Copies the page's address, and says so for two seconds.
 *
 * @returns The item.
 */
export function CopyLinkItem() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <MenuItem
      label={<span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>}
      onClick={() => void copy()}
    />
  );
}

/**
 * The versions, newest first, each with when it was saved and whether it is active; editors
 * activate another.
 *
 * @param props - The report and the closer.
 * @returns The list.
 */
export function VersionItems({ report, close }: MenuProps) {
  const { submit, busy } = useReportChange(report.id);
  const zone = report.schedule.timezone;
  return (
    <ul className={styles.versions}>
      {report.versions.map((version) => {
        const active = version.version === report.activeVersion;
        const inactive = version.activatedAt === null ? 'draft' : 'was active';
        const state = active ? 'active' : inactive;
        return (
          <li key={version.version} className={styles.version}>
            <span>
              <span className={styles.mono}>v{version.version}</span> · {state}
              <span className={styles.versionMeta}>
                {version.createdBy}, {dayMonth(version.createdAt, zone)}
                {version.note ? ` · ${version.note}` : ''}
              </span>
            </span>
            {!active && (
              <Button
                size="small"
                disabled={busy}
                onClick={() => {
                  submit({ intent: 'activate', version: version.version });
                  close();
                }}
              >
                Activate
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A menu button of the header.
 *
 * @param props - Its name and its items.
 * @param props.label - The name.
 * @param props.children - The items, given the closer.
 * @returns The popover.
 */
function MenuButton({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
}) {
  const trigger = (
    <>
      {label} <ChevronDownIcon />
    </>
  );
  return (
    <Popover label={label} shape="button" align="end" trigger={trigger}>
      {children}
    </Popover>
  );
}

/**
 * The header's Change, Share and Versions buttons: Change and Versions for whoever may change the
 * report, the owner of its thread or an admin.
 *
 * @param props - The report.
 * @param props.report - The report.
 * @returns The buttons.
 */
export function MenuButtons({ report }: { readonly report: ReportDetail }) {
  const editor = report.canChange;
  return (
    <>
      {editor && (
        <MenuButton label="Change">
          {(close) => <ChangeItems report={report} close={close} />}
        </MenuButton>
      )}
      <MenuButton label="Share">
        {() => (
          <div className={styles.menu}>
            <CopyLinkItem />
          </div>
        )}
      </MenuButton>
      {editor && (
        <Popover
          label="Versions"
          shape="iconButton"
          tip="Versions"
          align="end"
          trigger={<HistoryIcon />}
        >
          {(close) => <VersionItems report={report} close={close} />}
        </Popover>
      )}
    </>
  );
}
