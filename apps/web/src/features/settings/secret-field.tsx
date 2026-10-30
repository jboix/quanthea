/** A provider's stored secret: its API key, or the client secret of its identity provider. */
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './model-settings.module.css';
import type { SectionProps } from './model-settings-form.ts';

/** Props of {@link SecretField}. */
interface SecretFieldProps extends SectionProps {
  /** The stored secret, masked, or `null`. */
  readonly stored: string | null;
  /** The label, such as `API key`. */
  readonly label: string;
  /** What the empty field says. */
  readonly placeholder: string;
}

/**
 * The secret: the stored one masked, with Replace, or a field for a new one.
 *
 * @param props - The form, the stored secret, the label and the issues.
 * @returns The field.
 */
export function SecretField({ form, stored, label, placeholder, issues }: SecretFieldProps) {
  const [replacing, setReplacing] = useState(stored === null);
  if (!replacing && stored !== null) {
    return (
      <div className={styles.keyRow}>
        <Input label={label} mono readOnly value={stored} />
        <Button onClick={() => setReplacing(true)}>Replace</Button>
      </div>
    );
  }
  return (
    <Input
      label={label}
      mono
      type="password"
      autoComplete="new-password"
      placeholder={placeholder}
      value={form.apiKey ?? ''}
      onChange={(event) =>
        form.setApiKey(event.target.value === '' ? undefined : event.target.value)
      }
      error={issues.apiKey}
    />
  );
}
