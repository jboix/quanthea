/** Settings → Links and images: where dashboards may link, and load images from. */
import { type ExternalHosts, hostNameSchema, maxExternalHosts } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { HostsOutcome } from './data.ts';
import styles from './hosts.module.css';

/** Where links may go. */
type LinkScope = 'any' | 'listed';

/** The two scopes of links. */
const scopes = [
  {
    value: 'any',
    title: 'Any host',
    tag: 'default',
    description: 'A link in a table or a stat opens wherever its address points.',
  },
  {
    value: 'listed',
    title: 'Only the hosts listed',
    description: 'A link to any other host shows as text.',
  },
] as const;

/**
 * The form's state: the scope, the hosts as typed, and whether they are valid and changed.
 *
 * @param saved - The saved settings.
 * @returns The state and its changes.
 */
function useHostsForm(saved: ExternalHosts) {
  const [scope, setScope] = useState<LinkScope>(saved.linksToAnyHost ? 'any' : 'listed');
  const [hosts, setHosts] = useState(saved.hosts);
  const settings: ExternalHosts = { linksToAnyHost: scope === 'any', hosts };
  const invalid = hosts.findIndex((each) => !hostNameSchema.safeParse(each.host).success);
  const change = (index: number, host: Partial<ExternalHosts['hosts'][number]>) =>
    setHosts((current) => current.map((each, at) => (at === index ? { ...each, ...host } : each)));
  const add = () => setHosts((current) => [...current, { host: '', images: false }]);
  const remove = (index: number) => setHosts((current) => current.filter((_, at) => at !== index));
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  return { scope, setScope, hosts, settings, invalid, change, add, remove, dirty };
}

/**
 * One host: its name, whether images load from it, and Remove.
 *
 * @param props - The form and the host's place.
 * @param props.form - The form's state.
 * @param props.index - The host's place in the list.
 * @returns The row.
 */
function HostRow({ form, index }: { form: ReturnType<typeof useHostsForm>; index: number }) {
  const host = form.hosts[index] ?? { host: '', images: false };
  const valid = host.host === '' || index !== form.invalid;
  return (
    <li className={styles.row}>
      <Input
        label="Host"
        hideLabel
        mono
        placeholder="media.example.com"
        value={host.host}
        onChange={(event) => form.change(index, { host: event.target.value.trim() })}
        error={valid ? undefined : 'A name such as media.example.com, with no https:// or path.'}
      />
      <Switch
        label="Images"
        checked={host.images}
        onChange={(images) => form.change(index, { images })}
      />
      <Button size="small" onClick={() => form.remove(index)}>
        Remove
      </Button>
    </li>
  );
}

/**
 * Saving the form.
 *
 * @param settings - The settings as edited.
 * @returns The save function, whether a save runs, and a refusal.
 */
function useSave(settings: ExternalHosts) {
  const fetcher = useFetcher<HostsOutcome>();
  const save = () =>
    void fetcher.submit(settings as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  const refused = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { save, refused, saving: fetcher.state !== 'idle' };
}

/**
 * The external hosts screen.
 *
 * @returns The screen.
 */
export function ExternalHostsScreen() {
  const form = useHostsForm(useLoaderData() as ExternalHosts);
  const { save, refused, saving } = useSave(form.settings);
  return (
    <Page
      title="Links and images"
      subtitle="Where tables and stats may link to, and the hosts their images may load from. An image loads when a dashboard opens, so it tells its host who looked: images load only from the hosts marked here."
    >
      <RadioCards<LinkScope>
        label="Links go to"
        value={form.scope}
        onChange={form.setScope}
        options={scopes}
      />
      <ul className={styles.list}>
        {form.hosts.map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id, and are edited in place
          <HostRow key={index} form={form} index={index} />
        ))}
      </ul>
      <div className={styles.actions}>
        <Button onClick={form.add} disabled={form.hosts.length >= maxExternalHosts}>
          Add a host
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!form.dirty || form.invalid >= 0 || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {refused && <p className={styles.error}>{refused}</p>}
    </Page>
  );
}
