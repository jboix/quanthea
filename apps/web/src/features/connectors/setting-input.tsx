import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { SettingField, SettingValue } from './settings-form.ts';

/** Props of {@link SettingInput}. */
interface SettingInputProps {
  /** The setting. */
  readonly field: SettingField;
  /** Its value in the form. */
  readonly value: SettingValue | undefined;
  /** What the server said is wrong with it. */
  readonly error: string | undefined;
  /** The masked stored value of a secret, when editing. */
  readonly stored: string | undefined;
  /** Called with the new value. */
  readonly onChange: (value: SettingValue) => void;
}

/**
 * The hint of a text setting: its description, and for a stored secret how to keep it.
 *
 * @param field - The setting.
 * @param stored - The masked stored value, if any.
 * @returns The hint.
 */
function hintOf(field: SettingField, stored: string | undefined): string | undefined {
  if (stored === undefined) return field.description;
  const keep = `Stored as ${stored}. Leave empty to keep it.`;
  return field.description === undefined ? keep : `${field.description} ${keep}`;
}

/**
 * A setting edited with a switch.
 *
 * @param props - The setting, its value and error, and the change callback.
 * @returns The switch row.
 */
function SwitchSetting({ field, value, error, onChange }: SettingInputProps) {
  return (
    <Switch
      label={field.title}
      description={error ?? field.description}
      checked={value === true}
      onChange={onChange}
    />
  );
}

/**
 * The label of a setting, marking the ones that may stay empty.
 *
 * @param field - The setting.
 * @returns The label.
 */
function labelOf(field: SettingField): string {
  const mayBeEmpty = !field.required && field.defaultValue === undefined;
  return mayBeEmpty ? `${field.title} (optional)` : field.title;
}

/**
 * A setting edited with a select of its schema's choices.
 *
 * @param props - The setting, its value and error, and the change callback.
 * @returns The select.
 */
function SelectSetting({ field, value, error, onChange }: SettingInputProps) {
  return (
    <Select
      label={labelOf(field)}
      options={field.options.map((option) => ({ value: option, label: option }))}
      hint={field.description}
      error={error}
      mono
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * A setting edited as text: plain, numeric, or a password.
 *
 * @param props - The setting, its value, error and stored secret, and the change callback.
 * @returns The input.
 */
function TextSetting({ field, value, error, stored, onChange }: SettingInputProps) {
  const secret = field.control === 'password';
  const numeric = field.control === 'integer' || field.control === 'number';
  return (
    <Input
      label={labelOf(field)}
      mono
      type={secret ? 'password' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      autoComplete={secret ? 'new-password' : 'off'}
      placeholder={field.example}
      hint={hintOf(field, stored)}
      error={error}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * One setting of a kind's form, with the control its schema calls for.
 *
 * @param props - The setting, its value and error, and the change callback.
 * @returns The control.
 */
export function SettingInput(props: SettingInputProps) {
  if (props.field.control === 'switch') return <SwitchSetting {...props} />;
  if (props.field.control === 'select') return <SelectSetting {...props} />;
  return <TextSetting {...props} />;
}
