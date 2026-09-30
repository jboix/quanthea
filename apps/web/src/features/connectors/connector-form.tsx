import type { ConnectorDetail, ConnectorKindInfo } from '@querent/shared';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useActionData, useLoaderData, useNavigation, useSubmit } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './connector-form.module.css';
import type { ChangeOutcome, ConnectorData } from './data.ts';
import { KindPicker } from './kind-picker.tsx';
import { SettingInput } from './setting-input.tsx';
import {
  fieldKey,
  initialValues,
  orderFields,
  readPart,
  type SettingField,
  type SettingValues,
  settingFields,
} from './settings-form.ts';
import { asJsonBody, failureOf, useConnectorChange } from './use-connector-change.ts';
import { useConnectorsData } from './use-connectors-data.ts';

/**
 * The settings fields of a kind, with its credentials next to the username.
 *
 * @param kind - The kind, if one is picked.
 * @returns The fields.
 */
function fieldsOf(kind: ConnectorKindInfo | undefined): SettingField[] {
  if (!kind) return [];
  return orderFields(
    settingFields(kind.configSchema, 'config'),
    settingFields(kind.secretSchema, 'secret'),
  );
}

/** Props of {@link ConnectorForm}. */
interface ConnectorFormProps {
  /** The kinds on offer. */
  readonly kinds: readonly ConnectorKindInfo[];
  /** The connector to edit, or `undefined` to add one. */
  readonly connector?: ConnectorDetail | undefined;
}

/**
 * The form state: name, kind, and the values of the kind's settings. Picking another kind starts
 * its settings from their defaults.
 *
 * @param props - The kinds and the connector being edited, if any.
 * @returns The state and its setters.
 */
function useConnectorForm({ kinds, connector }: ConnectorFormProps) {
  const [name, setName] = useState(connector?.name ?? '');
  const [kindId, setKindId] = useState(connector?.kind ?? kinds[0]?.kind ?? '');
  const kind = kinds.find((candidate) => candidate.kind === kindId);
  const fields = useMemo(() => fieldsOf(kind), [kind]);
  const [values, setValues] = useState<SettingValues>(() =>
    initialValues(fields, connector?.config),
  );
  const pickKind = (next: string) => {
    setKindId(next);
    setValues(initialValues(fieldsOf(kinds.find((candidate) => candidate.kind === next))));
  };
  const setValue = (key: string, value: SettingValues[string]) =>
    setValues({ ...values, [key]: value });
  const body = () => ({
    name: name.trim(),
    config: readPart(fields, values, 'config'),
    secret: readPart(fields, values, 'secret'),
  });
  return { name, setName, kind, fields, values, pickKind, setValue, body };
}

/**
 * Deletes the connector after the user confirms.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The delete control.
 */
function DeleteConnector({ connector }: { readonly connector: ConnectorDetail }) {
  const change = useConnectorChange(connector.id);
  const [confirming, setConfirming] = useState(false);
  const error = failureOf(change.outcome);
  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete connector
      </Button>
    );
  }
  return (
    <div className={styles.confirm}>
      <span>Dashboards that query {connector.name} stop working. Delete it?</span>
      <Button
        variant="danger"
        disabled={change.pending}
        onClick={() => change.submit({ intent: 'delete' })}
      >
        Delete
      </Button>
      <Button onClick={() => setConfirming(false)}>Keep it</Button>
      {error !== undefined && <span className={styles.error}>{error}</span>}
    </div>
  );
}

/** The form state {@link useConnectorForm} returns. */
type ConnectorFormState = ReturnType<typeof useConnectorForm>;

/** Props of the parts of {@link ConnectorForm}. */
interface FormPartProps {
  /** The form state. */
  readonly form: ConnectorFormState;
  /** The server's issues by field key. */
  readonly issues: Readonly<Record<string, string>>;
  /** The connector being edited, if any. */
  readonly connector: ConnectorDetail | undefined;
}

/**
 * The name field, and the kind picker when adding.
 *
 * @param props - The form state, issues and connector.
 * @param props.kinds - The kinds on offer.
 * @returns The fields.
 */
function IdentityFields({
  form,
  issues,
  connector,
  kinds,
}: FormPartProps & { readonly kinds: readonly ConnectorKindInfo[] }) {
  return (
    <>
      <Input
        label="Name"
        mono
        required
        placeholder="postgres-orders"
        hint="Lowercase letters, digits and dashes. Dashboards refer to the connector by this name."
        error={issues.name}
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
      />
      {!connector && (
        <KindPicker kinds={kinds} value={form.kind?.kind ?? ''} onChange={form.pickKind} />
      )}
    </>
  );
}

/**
 * The kind's settings.
 *
 * @param props - The form state, issues and connector.
 * @returns One control per setting.
 */
function KindSettings({ form, issues, connector }: FormPartProps) {
  return form.fields.map((field) => {
    const key = fieldKey(field);
    return (
      <SettingInput
        key={key}
        field={field}
        value={form.values[key]}
        error={issues[key]}
        stored={field.part === 'secret' ? connector?.secret[field.name] : undefined}
        onChange={(value) => form.setValue(key, value)}
      />
    );
  });
}

/**
 * The submit and cancel buttons.
 *
 * @param props - The connector being edited, if any.
 * @param props.connector - The connector.
 * @returns The buttons.
 */
function FormActions({ connector }: { readonly connector: ConnectorDetail | undefined }) {
  const saving = useNavigation().state === 'submitting';
  const idle = connector ? 'Save connection' : 'Add connector';
  return (
    <div className={styles.actions}>
      <Button type="submit" variant="primary" disabled={saving}>
        {saving ? 'Saving…' : idle}
      </Button>
      <Link
        to={connector ? `/connectors/${connector.id}` : '/connectors'}
        className={buttonClassName()}
      >
        Cancel
      </Link>
    </div>
  );
}

/**
 * The add and edit form. Its settings come from the kind's JSON Schemas, so it holds no code for
 * any kind. It submits JSON to the route action and shows the server's issues by field.
 *
 * @param props - The kinds and the connector being edited, if any.
 * @returns The form.
 */
function ConnectorForm({ kinds, connector }: ConnectorFormProps) {
  const form = useConnectorForm({ kinds, connector });
  const submit = useSubmit();
  const outcome = useActionData() as ChangeOutcome | undefined;
  const issues = outcome && !outcome.ok ? outcome.issues : {};
  const send = (event: FormEvent) => {
    event.preventDefault();
    const body = connector ? form.body() : { ...form.body(), kind: form.kind?.kind ?? '' };
    void submit(asJsonBody(body), { method: 'post', encType: 'application/json' });
  };
  const parts = { form, issues, connector };
  return (
    <form className={styles.form} onSubmit={send}>
      {outcome && !outcome.ok && (
        <p role="alert" className={styles.error}>
          {Object.keys(issues).length > 0 ? 'Check the fields marked below.' : outcome.message}
        </p>
      )}
      <IdentityFields {...parts} kinds={kinds} />
      <KindSettings {...parts} />
      <FormActions connector={connector} />
    </form>
  );
}

/**
 * The screen that adds a connector.
 *
 * @returns The screen.
 */
export function NewConnectorScreen() {
  const { kinds } = useConnectorsData();
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Add a connector</h2>
      <p className={styles.subtitle}>
        Credentials are encrypted on this machine and never sent back, not even to admins.
      </p>
      <ConnectorForm kinds={kinds} />
    </div>
  );
}

/**
 * The screen that edits a connector's connection, and deletes it.
 *
 * @returns The screen.
 */
export function EditConnectorScreen() {
  const { connector } = useLoaderData() as ConnectorData;
  const { kinds } = useConnectorsData();
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Edit {connector.name}</h2>
      <p className={styles.subtitle}>A change reconnects and tests the connection again.</p>
      <ConnectorForm key={connector.id} kinds={kinds} connector={connector} />
      <div className={styles.danger}>
        <DeleteConnector connector={connector} />
      </div>
    </div>
  );
}
