/** Settings → Links and images: where dashboards may link to, and load images from. */
import { type ExternalHosts, hostNameSchema, maxExternalHosts, type Reach } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import type { HostsOutcome } from './data.ts';
import styles from './hosts.module.css';

/** Whether any host is allowed, or only those listed. */
type Scope = 'any' | 'listed';

/** What one kind of reach is called, and what each scope means for it. */
interface ReachWords {
  /** The card's title. */
  readonly title: string;
  /** The card's line under the title. */
  readonly description: string;
  /** What happens elsewhere when only the listed hosts are allowed. */
  readonly elsewhere: string;
  /** The scope before an admin chooses one. */
  readonly initial: Scope;
}

/** The words of links. */
const linkWords: ReachWords = {
  title: 'Links',
  description: 'Where a link in a table or a stat may go.',
  elsewhere: 'Other links show as text.',
  initial: 'any',
};

/** The words of images. */
const imageWords: ReachWords = {
  title: 'Images',
  description: 'Where an image in a table or a stat may load from.',
  elsewhere: 'Other images do not load.',
  initial: 'listed',
};

/**
 * The two scopes, as cards.
 *
 * @param words - The words of the reach.
 * @returns The options.
 */
function scopeOptions(words: ReachWords) {
  const tag = (scope: Scope) => (scope === words.initial ? { tag: 'default' } : {});
  return [
    { value: 'any' as const, title: 'Any host', description: 'No list to keep.', ...tag('any') },
    {
      value: 'listed' as const,
      title: 'Only these hosts',
      description: words.elsewhere,
      ...tag('listed'),
    },
  ];
}

/**
 * Whether a reach holds a host that is not a valid name, ignoring empty rows.
 *
 * @param reach - The reach.
 * @returns Whether one is invalid.
 */
function hasInvalid(reach: Reach): boolean {
  return reach.hosts.some((host) => host !== '' && !hostNameSchema.safeParse(host).success);
}

/**
 * The reach as saved: empty rows dropped.
 *
 * @param reach - The reach as edited.
 * @returns The reach to save.
 */
function cleaned(reach: Reach): Reach {
  return { ...reach, hosts: reach.hosts.filter((host) => host !== '') };
}

/** Props of {@link ReachCard}. */
interface ReachCardProps {
  /** The words of the reach. */
  readonly words: ReachWords;
  /** The reach as edited. */
  readonly reach: Reach;
  /** Called with the reach after a change. */
  readonly onChange: (reach: Reach) => void;
}

/**
 * One host of a list, and Remove.
 *
 * @param props - The card's props and the host's place.
 * @param props.index - The host's place in the list.
 * @returns The row.
 */
function HostRow({ reach, onChange, index }: ReachCardProps & { readonly index: number }) {
  const host = reach.hosts[index] ?? '';
  const valid = host === '' || hostNameSchema.safeParse(host).success;
  const set = (value: string) =>
    onChange({ ...reach, hosts: reach.hosts.map((each, at) => (at === index ? value : each)) });
  const remove = () => onChange({ ...reach, hosts: reach.hosts.filter((_, at) => at !== index) });
  return (
    <li className={styles.row}>
      <Input
        label="Host"
        hideLabel
        mono
        placeholder="media.example.com"
        value={host}
        onChange={(event) => set(event.target.value.trim())}
        error={valid ? undefined : 'A name such as media.example.com, with no https:// or path.'}
      />
      <Button size="small" onClick={remove}>
        Remove
      </Button>
    </li>
  );
}

/**
 * The hosts of a list, and Add a host.
 *
 * @param props - The card's props.
 * @returns The list.
 */
function HostList(props: ReachCardProps) {
  const { reach, onChange } = props;
  const add = () => onChange({ ...reach, hosts: [...reach.hosts, ''] });
  return (
    <div className={styles.hosts}>
      {reach.hosts.length > 0 && (
        <ul className={styles.list}>
          {reach.hosts.map((_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id, and are edited in place
            <HostRow key={index} {...props} index={index} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className={styles.add}
        onClick={add}
        disabled={reach.hosts.length >= maxExternalHosts}
      >
        + Add a host
      </button>
    </div>
  );
}

/**
 * Where one kind of reach may go: any host, or only the hosts listed under it.
 *
 * @param props - The words, the reach and the change callback.
 * @returns The card.
 */
function ReachCard(props: ReachCardProps) {
  const { words, reach, onChange } = props;
  const scope: Scope = reach.anyHost ? 'any' : 'listed';
  return (
    <Card title={words.title} description={words.description}>
      <RadioCards<Scope>
        label={words.title}
        value={scope}
        onChange={(next) => onChange({ ...reach, anyHost: next === 'any' })}
        options={scopeOptions(words)}
      />
      {scope === 'listed' && <HostList {...props} />}
    </Card>
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
 * The external hosts screen: a card for links and one for images, then Save.
 *
 * @returns The screen.
 */
export function ExternalHostsScreen() {
  const saved = useLoaderData() as ExternalHosts;
  const [links, setLinks] = useState(saved.links);
  const [images, setImages] = useState(saved.images);
  const settings: ExternalHosts = { links: cleaned(links), images: cleaned(images) };
  const { save, refused, saving } = useSave(settings);
  const invalid = hasInvalid(links) || hasInvalid(images);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  return (
    <Page title="Links and images" subtitle="Where dashboards may link to and load images from.">
      <ReachCard words={linkWords} reach={links} onChange={setLinks} />
      <ReachCard words={imageWords} reach={images} onChange={setImages} />
      <div className={styles.actions}>
        {refused && <p className={styles.error}>{refused}</p>}
        <Button variant="primary" onClick={save} disabled={!dirty || invalid || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Page>
  );
}
