/** How long the bin keeps deleted threads, in a dialog on the bin, for admins. */
import type { RetentionSettings } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Input } from '../../ui/input.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import styles from './bin.module.css';
import type { BinIntent, BinOutcome } from './data.ts';

/** Whether threads stay a number of days, or until deleted. */
type Keep = 'days' | 'forever';

/** The two ways to keep deleted threads. */
const keepOptions = [
  {
    value: 'days',
    title: 'For a number of days',
    tag: 'default',
    description: 'The hourly purge deletes them after that. 0 deletes them at the next run.',
  },
  {
    value: 'forever',
    title: 'Until someone deletes them',
    description: 'Admins delete them from the bin, one by one or all at once.',
  },
] as const;

/**
 * The retention form's state: the choice, the days, and whether they are valid and changed.
 *
 * @param saved - The saved number of days, or `null` to keep threads until deleted.
 * @returns The state.
 */
function useRetentionForm(saved: number | null) {
  const [keep, setKeep] = useState<Keep>(saved === null ? 'forever' : 'days');
  const [days, setDays] = useState(String(saved ?? 30));
  const parsed = Number(days);
  const valid = keep === 'forever' || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650);
  const settings: RetentionSettings = { binDays: keep === 'forever' ? null : parsed };
  return { keep, setKeep, days, setDays, valid, settings, changed: settings.binDays !== saved };
}

/** Props of {@link RetentionDialog}. */
interface RetentionDialogProps {
  /** The saved number of days, or `null`. */
  readonly binDays: number | null;
  /** The configuration file that sets the retention, when one does. */
  readonly managedBy: string | undefined;
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Closes it. */
  readonly onClose: () => void;
}

/**
 * The choice between days and forever, and the number of days.
 *
 * @param props - The form.
 * @param props.form - The form's state.
 * @returns The fields.
 */
function KeepFields({ form }: { readonly form: ReturnType<typeof useRetentionForm> }) {
  return (
    <>
      <RadioCards<Keep>
        label="Keep deleted threads"
        value={form.keep}
        onChange={form.setKeep}
        options={keepOptions}
      />
      {form.keep === 'days' && (
        <Input
          label="Days in the bin"
          type="number"
          min={0}
          max={3650}
          value={form.days}
          onChange={(event) => form.setDays(event.target.value)}
          error={form.valid ? undefined : 'A whole number from 0 to 3650.'}
        />
      )}
    </>
  );
}

/**
 * The fields and Save. It closes once saved; the bin loads the new retention.
 *
 * @param props - The saved retention, the managing file and the close handler.
 * @returns The form.
 */
function RetentionForm({ binDays, managedBy, onClose }: Omit<RetentionDialogProps, 'open'>) {
  const form = useRetentionForm(binDays);
  const fetcher = useFetcher<BinOutcome>();
  useEffect(() => {
    if (fetcher.data?.ok) onClose();
  }, [fetcher.data, onClose]);
  const intent: BinIntent = { intent: 'retention', binDays: form.settings.binDays };
  const save = () =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return (
    <fieldset className={styles.retention} disabled={managedBy !== undefined}>
      {managedBy && <p className={styles.note}>{managedBy} sets this. Change it there.</p>}
      <KeepFields form={form} />
      {fetcher.data?.ok === false && <p className={styles.failure}>{fetcher.data.message}</p>}
      <Button
        variant="primary"
        disabled={!form.valid || !form.changed || fetcher.state !== 'idle'}
        onClick={save}
      >
        Save
      </Button>
    </fieldset>
  );
}

/**
 * How long deleted threads stay in the bin, before they and their dashboards are deleted for good.
 *
 * @param props - The saved retention, the managing file, and whether the dialog is open.
 * @returns The dialog.
 */
export function RetentionDialog({ open, ...props }: RetentionDialogProps) {
  return (
    <Dialog title="Retention" open={open} onClose={props.onClose}>
      <RetentionForm {...props} />
    </Dialog>
  );
}
