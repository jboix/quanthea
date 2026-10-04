/**
 * The report settings, in a dialog on the Reports page, for admins: how many times a failed run
 * tries again and after how long, and how many days runs are kept.
 */
import { type ReportSettings, reportSettingsSchema } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Input } from '../../ui/input.tsx';
import { type ReportOutcome, reportSettingsPath } from './data.ts';
import styles from './reports.module.css';

/** The typed fields, as text. */
interface SettingsText {
  /** The retries. */
  readonly maxRetries: string;
  /** The delay, such as `15m`. */
  readonly retryDelay: string;
  /** The days runs are kept; empty keeps them for good. */
  readonly keepRunsDays: string;
}

/**
 * Reads the typed fields as settings.
 *
 * @param text - What is typed.
 * @returns The settings, or the message of each field that does not read.
 */
export function settingsFrom(text: SettingsText): {
  readonly settings: ReportSettings | undefined;
  readonly issues: Partial<Record<keyof SettingsText, string>>;
} {
  const parsed = reportSettingsSchema.safeParse({
    maxRetries: text.maxRetries.trim() === '' ? Number.NaN : Number(text.maxRetries),
    retryDelay: text.retryDelay.trim(),
    keepRunsDays: text.keepRunsDays.trim() === '' ? null : Number(text.keepRunsDays),
  });
  if (parsed.success) return { settings: parsed.data, issues: {} };
  const issues: Partial<Record<keyof SettingsText, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof SettingsText;
    issues[field] ??= fieldHints[field];
  }
  return { settings: undefined, issues };
}

/** What each field takes, said when it does not read. */
const fieldHints: Readonly<Record<keyof SettingsText, string>> = {
  maxRetries: 'A whole number from 0 to 10.',
  retryDelay: 'A duration from 1m to 1d, such as 15m or 2h.',
  keepRunsDays: 'A whole number of days from 1 to 3,650, or empty to keep runs for good.',
};

/** A field's value, its error and its change handler, as the inputs take them. */
type FieldOf = (name: keyof SettingsText) => {
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (event: { target: { value: string } }) => void;
};

/**
 * The typed fields, read as settings.
 *
 * @param saved - The saved settings.
 * @returns The settings when every field reads, and each field's props.
 */
function useSettingsText(saved: ReportSettings) {
  const [text, setText] = useState<SettingsText>({
    maxRetries: String(saved.maxRetries),
    retryDelay: saved.retryDelay,
    keepRunsDays: saved.keepRunsDays === null ? '' : String(saved.keepRunsDays),
  });
  const { settings, issues } = settingsFrom(text);
  const field: FieldOf = (name) => ({
    value: text[name],
    error: issues[name],
    onChange: (event) => setText((current) => ({ ...current, [name]: event.target.value })),
  });
  return { settings, field };
}

/**
 * The three fields.
 *
 * @param props - Each field's props.
 * @param props.field - Gives a field's value, error and change handler.
 * @returns The fields.
 */
function SettingsFields({ field }: { readonly field: FieldOf }) {
  return (
    <>
      <Input
        label="Tries again after a failed run"
        type="number"
        min={0}
        max={10}
        mono
        {...field('maxRetries')}
        hint="A run that still fails then is marked failed, and tells its channels when failures notify."
      />
      <Input
        label="Waits before each new try"
        mono
        {...field('retryDelay')}
        hint="Such as 15m or 2h, from 1m to 1d."
      />
      <Input
        label="Keeps runs for, in days"
        type="number"
        min={1}
        mono
        {...field('keepRunsDays')}
        hint="Empty keeps them for good. Older runs go with their conversations; reports stay."
      />
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
  readonly saved: ReportSettings;
  readonly onClose: () => void;
}) {
  const { settings, field } = useSettingsText(saved);
  const fetcher = useFetcher<ReportOutcome>();
  useEffect(() => {
    if (fetcher.data?.ok) onClose();
  }, [fetcher.data, onClose]);
  const target = {
    method: 'post',
    action: reportSettingsPath,
    encType: 'application/json',
  } as const;
  const save = () => void fetcher.submit(settings as SubmitTarget, target);
  return (
    <div className={styles.settings}>
      <SettingsFields field={field} />
      {fetcher.data?.ok === false && <p className={styles.failure}>{fetcher.data.message}</p>}
      <Button variant="primary" disabled={!settings || fetcher.state !== 'idle'} onClick={save}>
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
  const fetcher = useFetcher<ReportSettings>();
  const { load } = fetcher;
  useEffect(() => {
    void load(reportSettingsPath);
  }, [load]);
  if (!fetcher.data) return <p className={styles.aside}>Loading…</p>;
  return <SettingsForm saved={fetcher.data} onClose={onClose} />;
}

/**
 * The report settings dialog.
 *
 * @param props - Whether it is open, and the close handler.
 * @param props.open - Whether the dialog is open.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
export function ReportSettingsDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Dialog title="Report settings" open={open} onClose={onClose}>
      <LoadedForm onClose={onClose} />
    </Dialog>
  );
}
