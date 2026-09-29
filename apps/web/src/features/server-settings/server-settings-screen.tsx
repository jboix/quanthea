import type { ServerSettingsView, SettingSource } from '@querent/shared';
import { useLoaderData } from 'react-router';
import { Card } from '../../ui/card.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './server-settings.module.css';

/**
 * Where a value comes from, in words.
 *
 * @param source - The source.
 * @returns Such as `QUERENT_PORT`, `querent.yaml` or `default`.
 */
function sourceText(source: SettingSource): string {
  if (source.kind === 'environment') return source.variable;
  if (source.kind === 'file') return source.path;
  if (source.kind === 'generated') return `generated in ${source.path}`;
  return 'default';
}

/**
 * The configuration files read, or how to use one.
 *
 * @param props - The files.
 * @param props.files - The files read, in order.
 * @returns The card.
 */
function FilesCard({ files }: { readonly files: readonly string[] }) {
  return (
    <Card title="Configuration file">
      {files.length === 0 ? (
        <p className={styles.note}>
          None. Set QUERENT_CONFIG to a YAML or JSON file, or a directory of them, to keep these
          settings in a file.
        </p>
      ) : (
        <ul className={styles.files}>
          {files.map((file) => (
            <li key={file}>
              <code>{file}</code>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The system settings, each with its value, its source and how to set it.
 *
 * @param props - The settings.
 * @param props.settings - The settings.
 * @returns The card.
 */
function SettingsCard({ settings }: { readonly settings: ServerSettingsView['settings'] }) {
  return (
    <Card
      title="Settings"
      description="A variable wins over the file, and the file over the default. Changes apply at the next restart."
    >
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
              <th>From</th>
              <th>Set with</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((setting) => (
              <tr key={setting.key}>
                <td>{setting.label}</td>
                <td className={styles.mono}>{setting.value ?? 'not set'}</td>
                <td className={styles.source} title={sourceText(setting.source)}>
                  {setting.source.kind === 'file'
                    ? setting.source.path.split('/').at(-1)
                    : sourceText(setting.source)}
                </td>
                <td className={styles.mono}>
                  {setting.variable} or server.{setting.key}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The keys, each by where it comes from. Their values never leave the server.
 *
 * @param props - The keys.
 * @param props.keys - The keys.
 * @returns The card.
 */
function KeysCard({ keys }: { readonly keys: ServerSettingsView['keys'] }) {
  return (
    <Card
      title="Keys"
      description="Back them up apart from the data directory: whoever holds both reads everything."
    >
      <dl className={styles.keys}>
        {keys.map((key) => (
          <div key={key.label}>
            <dt>{key.label}</dt>
            <dd className={styles.source}>
              {sourceText(key.source)}
              {key.file && ` (${key.file})`}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Settings → Server: what the server runs with, read-only.
 *
 * @returns The screen.
 */
export function ServerSettingsScreen() {
  const view = useLoaderData() as ServerSettingsView;
  return (
    <Page
      title="Server"
      subtitle="Set in environment variables or the configuration file, never here."
    >
      <FilesCard files={view.configFiles} />
      <SettingsCard settings={view.settings} />
      <KeysCard keys={view.keys} />
    </Page>
  );
}
