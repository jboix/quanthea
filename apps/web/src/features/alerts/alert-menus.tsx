/**
 * The alert page's Change and Mute menus. Change, for editors, opens the conversation that wrote
 * the alert, and deactivates or activates it. Mute, for analysts and above, mutes its
 * notifications until a time, or until someone unmutes for editors.
 */
import { type AlertDetail, hasRole } from '@quanthea/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import { Input } from '../../ui/input.tsx';
import { MenuItem, MenuItemText, menuItemClassName } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './alert.module.css';
import { canMute, customMuteEnd, latestMuteEnd, muteOptions } from './mute-options.ts';
import { muteEnd } from './state-text.ts';
import { useAlertChange } from './use-alert-change.ts';
import { useRole } from './use-role.ts';

/**
 * The item that starts or stops evaluation: deactivate an active alert, activate a deactivated
 * one again, or activate a draft's latest version.
 *
 * @param props - The alert and the closer.
 * @param props.alert - The alert.
 * @param props.close - Closes the menu.
 * @returns The item.
 */
function EvaluationItem({
  alert,
  close,
}: {
  readonly alert: AlertDetail;
  readonly close: () => void;
}) {
  const { submit, busy } = useAlertChange();
  const act = (intent: Parameters<typeof submit>[0]) => {
    submit(intent);
    close();
  };
  const version = alert.activeVersion ?? alert.latestVersion;
  if (version !== null && (alert.deactivated || alert.activeVersion === null)) {
    const label = alert.deactivated ? 'Activate again' : `Activate v${version}`;
    const hint = `Checks v${version}, runs its query once, then evaluates it.`;
    const intent = { intent: 'activate', version } as const;
    return <MenuItem label={label} hint={hint} disabled={busy} onClick={() => act(intent)} />;
  }
  return (
    <MenuItem
      label="Deactivate"
      hint="Stops evaluating it. Its series end, and a firing one sends resolved."
      disabled={busy}
      onClick={() => act({ intent: 'deactivate' })}
    />
  );
}

/**
 * The Change button and menu, for editors.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The popover, or nothing below editor.
 */
export function ChangePopover({ alert }: { readonly alert: AlertDetail }) {
  if (!hasRole(useRole(), 'editor')) return null;
  const trigger = (
    <>
      Change <ChevronDownIcon />
    </>
  );
  return (
    <Popover label="Change" shape="button" align="end" trigger={trigger}>
      {(close) => (
        <div className={styles.menu}>
          {alert.threadId && (
            <Link to={`/threads/${alert.threadId}`} className={menuItemClassName}>
              <MenuItemText
                label="Edit with the agent"
                hint="Opens the conversation that wrote it. A change is a new version."
              />
            </Link>
          )}
          <EvaluationItem alert={alert} close={close} />
        </div>
      )}
    </Popover>
  );
}

/**
 * A custom end: a day and a time, at most seven days ahead below editor.
 *
 * @param props - The closer.
 * @param props.close - Closes the menu once muted.
 * @returns The field and its button.
 */
function CustomEnd({ close }: { readonly close: () => void }) {
  const role = useRole();
  const { submit, busy } = useAlertChange();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const latest = latestMuteEnd(role, Date.now());
  const mute = () => {
    const end = customMuteEnd(value, role, Date.now());
    if ('error' in end) return setError(end.error);
    submit({ intent: 'mute', until: end.until });
    close();
  };
  return (
    <div className={styles.customEnd}>
      <Input
        label="Until"
        type="datetime-local"
        value={value}
        max={latest === null ? undefined : localInputValue(latest)}
        hint={latest === null ? undefined : 'At most 7 days ahead.'}
        error={error}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button size="small" disabled={busy} onClick={mute}>
        Mute until then
      </Button>
    </div>
  );
}

/**
 * A time as a date and time field writes it, in the browser's time zone.
 *
 * @param at - The time.
 * @returns Such as `2026-10-05T18:00`.
 */
function localInputValue(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * What the Mute menu holds: Unmute when muted, the ready-made ends and a custom one.
 *
 * @param props - The alert and the closer.
 * @param props.alert - The alert.
 * @param props.close - Closes the menu.
 * @returns The items.
 */
function MuteItems({ alert, close }: { readonly alert: AlertDetail; readonly close: () => void }) {
  const role = useRole();
  const { submit, busy } = useAlertChange();
  const now = Date.now();
  const act = (intent: Parameters<typeof submit>[0]) => {
    submit(intent);
    close();
  };
  const muted = alert.muted;
  return (
    <div className={styles.menu}>
      {muted && (
        <MenuItem
          label="Unmute"
          hint={`Muted ${muteEnd(muted.until, now)} by ${muted.by}.`}
          disabled={busy}
          onClick={() => act({ intent: 'unmute' })}
        />
      )}
      <p className={styles.menuNote}>Notifications stop; evaluation goes on.</p>
      {muteOptions(role, now).map((option) => (
        <MenuItem
          key={option.id}
          label={option.label}
          disabled={busy}
          onClick={() => act({ intent: 'mute', until: option.until })}
        />
      ))}
      <CustomEnd close={close} />
    </div>
  );
}

/**
 * The Mute button and menu, for analysts and above.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The popover, or nothing for viewers.
 */
export function MutePopover({ alert }: { readonly alert: AlertDetail }) {
  if (!canMute(useRole())) return null;
  const trigger = (
    <>
      {alert.muted ? 'Muted' : 'Mute'} <ChevronDownIcon />
    </>
  );
  return (
    <Popover label="Mute" shape="button" align="end" trigger={trigger}>
      {(close) => <MuteItems alert={alert} close={close} />}
    </Popover>
  );
}
