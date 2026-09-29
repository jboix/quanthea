import type { RetentionSettings } from '@querent/shared';
import { useState } from 'react';
import { Link, type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import type { RetentionOutcome } from './data.ts';
import styles from './retention.module.css';

/** How long the bin keeps a thread, as the form holds it. */
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
 * The form's state: the choice and the days as typed.
 *
 * @param saved - The saved settings.
 * @returns The state, its setters, the settings it stands for, and whether the days are valid.
 */
function useRetentionForm(saved: RetentionSettings) {
  const [keep, setKeep] = useState<Keep>(saved.binDays === null ? 'forever' : 'days');
  const [days, setDays] = useState(String(saved.binDays ?? 30));
  const parsed = Number(days);
  const valid = keep === 'forever' || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650);
  const settings: RetentionSettings = { binDays: keep === 'forever' ? null : parsed };
  const changed = settings.binDays !== saved.binDays;
  return { keep, setKeep, days, setDays, valid, settings, changed };
}

/**
 * The choice, and the days when the bin keeps threads for a number of days.
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
 * Save, and how the last save went.
 *
 * @param props - The form.
 * @param props.form - The form's state.
 * @returns The row.
 */
function SaveRow({ form }: { readonly form: ReturnType<typeof useRetentionForm> }) {
  const fetcher = useFetcher<RetentionOutcome>();
  const save = () =>
    void fetcher.submit(form.settings as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  return (
    <div className={styles.actions}>
      <Button
        variant="primary"
        disabled={!form.valid || !form.changed || fetcher.state !== 'idle'}
        onClick={save}
      >
        Save
      </Button>
      {fetcher.data?.ok === false && <span className={styles.failure}>{fetcher.data.message}</span>}
      {fetcher.data?.ok === true && !form.changed && <span className={styles.saved}>Saved.</span>}
    </div>
  );
}

/**
 * What deleting for good does, and where the bin is.
 *
 * @returns The note.
 */
function BinNote() {
  return (
    <>
      Deleting a thread for good deletes its dashboard with every version and frees the space. Usage
      stays in Settings → Usage. The <Link to="/bin">bin</Link> lists what is waiting.
    </>
  );
}

/**
 * Settings → Retention: how long deleted threads wait in the bin before they are deleted for
 * good, with their dashboards.
 *
 * @returns The screen.
 */
export function RetentionScreen() {
  const form = useRetentionForm(useLoaderData() as RetentionSettings);
  return (
    <Page
      title="Retention"
      subtitle="Deleted threads wait in the bin with their dashboards, then are deleted for good."
    >
      <Card title="Deleted threads" description={<BinNote />}>
        <div className={styles.form}>
          <KeepFields form={form} />
          <SaveRow form={form} />
        </div>
      </Card>
    </Page>
  );
}
