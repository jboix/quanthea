/**
 * The alert settings, in a dialog on the Alerts page, for admins: how many alerts may be active
 * per connector, whether an alert that cannot be checked, or a report run that fails, notifies
 * its channels, and the quiet hours of the alerts that set none of their own.
 */
import type { AlertSettings } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Input } from '../../ui/input.tsx';
import { Switch } from '../../ui/switch.tsx';
import styles from './alerts.module.css';
import { type AlertOutcome, alertSettingsPath } from './data.ts';
import { QuietHoursFields } from './quiet-hours-fields.tsx';
import { type DefaultQuiet, quietHoursProblem, startingQuietHours } from './quiet-hours-form.ts';

/** The most a connector may have. */
const highest = 10_000;

/**
 * Reads the typed maximum.
 *
 * @param text - What is typed.
 * @returns The number, or `undefined` when it is not a whole number from 1 to 10,000.
 */
function maximumOf(text: string): number | undefined {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= highest ? value : undefined;
}

/**
 * The default quiet hours being edited: whether there are any, and the ones shown, which stay as
 * edited while the switch is off.
 *
 * @param saved - The saved quiet hours, or `null`.
 * @returns The state, the value to save and whether it can be.
 */
function useQuietHours(saved: DefaultQuiet | null) {
  const [on, setOn] = useState(saved !== null);
  const [edited, setEdited] = useState<DefaultQuiet>(() => saved ?? startingQuietHours());
  const value = on ? edited : null;
  const valid = value === null || quietHoursProblem(value) === undefined;
  return { on, setOn, edited, setEdited, value, valid };
}

/**
 * The form's state: the typed maximum, the switch, the default quiet hours, and whether they are
 * valid and changed.
 *
 * @param saved - The saved settings.
 * @returns The state.
 */
function useSettingsForm(saved: AlertSettings) {
  const [text, setText] = useState(String(saved.maxActivePerConnector));
  const [notifyOnError, setNotifyOnError] = useState(saved.notifyOnError);
  const quiet = useQuietHours(saved.quietHours);
  const maximum = maximumOf(text);
  const settings: AlertSettings = {
    maxActivePerConnector: maximum ?? 1,
    notifyOnError,
    quietHours: quiet.value,
  };
  const changed = JSON.stringify(settings) !== JSON.stringify(saved);
  const valid = maximum !== undefined && quiet.valid;
  return {
    text,
    setText,
    notifyOnError,
    setNotifyOnError,
    quiet,
    maximum,
    settings,
    changed,
    valid,
  };
}

/**
 * The switch of the default quiet hours, and their fields while it is on.
 *
 * @param props - The quiet hours' state.
 * @param props.quiet - The quiet hours' state.
 * @returns The switch and the fields.
 */
function QuietHoursSetting({ quiet }: { readonly quiet: ReturnType<typeof useQuietHours> }) {
  return (
    <>
      <Switch
        label="Quiet hours by default"
        description="Alerts that set none of their own send nothing during them. They are still checked, and what still fires when they end notifies then, saying since when."
        checked={quiet.on}
        onChange={quiet.setOn}
      />
      {quiet.on && <QuietHoursFields value={quiet.edited} onChange={quiet.setEdited} />}
    </>
  );
}

/**
 * The maximum, the switch and the default quiet hours.
 *
 * @param props - The form.
 * @param props.form - The form's state.
 * @returns The fields.
 */
function SettingsFields({ form }: { readonly form: ReturnType<typeof useSettingsForm> }) {
  return (
    <>
      <Input
        label="Active alerts per connector, at most"
        type="number"
        min={1}
        max={highest}
        mono
        value={form.text}
        hint="Each active alert runs its query on its connector at every interval. Past this many on one connector, activating another is refused."
        error={form.maximum === undefined ? 'A whole number from 1 to 10,000.' : undefined}
        onChange={(event) => form.setText(event.target.value)}
      />
      <Switch
        label="Notify when an alert cannot be checked or a report fails"
        description="After its query fails twice in a row, an alert tells its channels once, and again once it can be checked. A report run that still fails after its retries tells its channels."
        checked={form.notifyOnError}
        onChange={form.setNotifyOnError}
      />
      <QuietHoursSetting quiet={form.quiet} />
    </>
  );
}

/**
 * The fields and Save. It closes once saved.
 *
 * @param props - The saved settings and the close handler.
 * @param props.saved - The saved settings.
 * @param props.onClose - Closes the dialog.
 * @returns The form.
 */
function SettingsForm({
  saved,
  onClose,
}: {
  readonly saved: AlertSettings;
  readonly onClose: () => void;
}) {
  const form = useSettingsForm(saved);
  const fetcher = useFetcher<AlertOutcome>();
  useEffect(() => {
    if (fetcher.data?.ok) onClose();
  }, [fetcher.data, onClose]);
  const target = {
    method: 'post',
    action: alertSettingsPath,
    encType: 'application/json',
  } as const;
  const save = () => void fetcher.submit(form.settings as SubmitTarget, target);
  return (
    <div className={styles.settings}>
      <SettingsFields form={form} />
      {fetcher.data?.ok === false && <p className={styles.failure}>{fetcher.data.message}</p>}
      <Button
        variant="primary"
        disabled={!form.valid || !form.changed || fetcher.state !== 'idle'}
        onClick={save}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * Loads the saved settings when the dialog opens, then shows the form.
 *
 * @param props - The close handler.
 * @param props.onClose - Closes the dialog.
 * @returns The form, or a note while the settings load.
 */
function LoadedForm({ onClose }: { readonly onClose: () => void }) {
  const fetcher = useFetcher<AlertSettings>();
  const { load } = fetcher;
  useEffect(() => {
    void load(alertSettingsPath);
  }, [load]);
  if (!fetcher.data) return <p className={styles.note}>Loading…</p>;
  return <SettingsForm saved={fetcher.data} onClose={onClose} />;
}

/** Props of {@link AlertSettingsDialog}. */
interface AlertSettingsDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Closes it. */
  readonly onClose: () => void;
}

/**
 * The alert settings dialog.
 *
 * @param props - Whether it is open, and the close handler.
 * @returns The dialog.
 */
export function AlertSettingsDialog({ open, onClose }: AlertSettingsDialogProps) {
  return (
    <Dialog title="Alert settings" open={open} onClose={onClose}>
      <LoadedForm onClose={onClose} />
    </Dialog>
  );
}
