/**
 * The alert's versions behind an icon button: each with who saved it and when, the active one
 * marked. Editors activate another version, after confirming.
 */
import { type AlertDetail, hasRole } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { HistoryIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './alert.module.css';
import { useAlertChange } from './use-alert-change.ts';
import { useRole } from './use-role.ts';
import { clockWhen } from './words.ts';

/** A version of the alert. */
type AlertVersion = AlertDetail['versions'][number];

/** Props of {@link VersionRow}. */
interface VersionRowProps {
  /** The version. */
  readonly entry: AlertVersion;
  /** The alert. */
  readonly alert: AlertDetail;
  /** Asks to activate it, for editors. */
  readonly onActivate: ((version: number) => void) | undefined;
}

/**
 * One version: its number, who saved it and when, whether it is active, and Activate for editors.
 * Its note shows on hover.
 *
 * @param props - The version, the alert and the activate callback.
 * @returns The row.
 */
function VersionRow({ entry, alert, onActivate }: VersionRowProps) {
  const active = entry.version === alert.activeVersion;
  const label = `v${entry.version}`;
  return (
    <li data-active={active} title={entry.note ?? undefined}>
      <strong className={styles.versionNumber}>{label}</strong>
      <span className={styles.versionWho}>
        {entry.createdBy}, {clockWhen(entry.createdAt, Date.now())}
      </span>
      {active && <Pill tone="ok">{alert.deactivated ? 'active, stopped' : 'active'}</Pill>}
      {onActivate && !active && (
        <Button
          size="small"
          aria-label={`Activate ${label}`}
          onClick={() => onActivate(entry.version)}
        >
          Activate
        </Button>
      )}
    </li>
  );
}

/**
 * The confirmation before another version is activated.
 *
 * @param props - The version, the alert, and the callbacks.
 * @param props.version - The version to activate.
 * @param props.alert - The alert.
 * @param props.onCancel - Goes back to the list.
 * @param props.onConfirm - Activates it.
 * @returns The question and its buttons.
 */
function ConfirmActivation({
  version,
  alert,
  onCancel,
  onConfirm,
}: {
  readonly version: number;
  readonly alert: AlertDetail;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const replaces = alert.activeVersion === null ? '' : ` in place of v${alert.activeVersion}`;
  return (
    <fieldset className={styles.confirm}>
      <legend className={styles.visuallyHidden}>Activate v{version}</legend>
      <p className={styles.menuNote}>
        Activate v{version}
        {replaces}? Its query runs once first, and evaluation follows it from now on.
      </p>
      <div className={styles.confirmButtons}>
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="small" variant="primary" onClick={onConfirm}>
          Activate v{version}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * The versions list, newest first, or the confirmation of an activation.
 *
 * @param props - The alert and the closer.
 * @param props.alert - The alert.
 * @param props.close - Closes the popover once an activation is sent.
 * @returns The content.
 */
function VersionsBody({
  alert,
  close,
}: {
  readonly alert: AlertDetail;
  readonly close: () => void;
}) {
  const editor = hasRole(useRole(), 'editor');
  const { submit } = useAlertChange();
  const [confirming, setConfirming] = useState<number | null>(null);
  if (confirming !== null) {
    const onConfirm = () => {
      submit({ intent: 'activate', version: confirming });
      close();
    };
    return (
      <ConfirmActivation
        {...{ version: confirming, alert, onConfirm }}
        onCancel={() => setConfirming(null)}
      />
    );
  }
  return (
    <ul className={styles.versions}>
      {alert.versions.map((entry) => (
        <VersionRow
          key={entry.version}
          entry={entry}
          alert={alert}
          onActivate={editor ? setConfirming : undefined}
        />
      ))}
    </ul>
  );
}

/**
 * The Versions icon button, named by a tip under it, and its list.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The popover.
 */
export function VersionsPopover({ alert }: { readonly alert: AlertDetail }) {
  return (
    <Popover
      label="Versions"
      tip="Versions"
      shape="iconButton"
      align="end"
      trigger={<HistoryIcon />}
    >
      {(close) => <VersionsBody alert={alert} close={close} />}
    </Popover>
  );
}
