import { type KnownModel, type ModelProvider, providerProfiles } from '@querent/shared';
import { useEffect } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome } from './data.ts';

/** The models a provider offers: the ones querent knows by name, and the ones it lists. */
export interface ModelList {
  /** The models querent knows by name for this provider. */
  readonly known: readonly KnownModel[];
  /** The chat models the provider listed, empty until they load or when they cannot. */
  readonly models: readonly string[];
  /** Why they could not be listed, if they could not. */
  readonly message: string | null;
  /** Whether a listing is on its way. */
  readonly loading: boolean;
}

/**
 * Loads the models of the provider being edited, again whenever the provider, the base URL or a
 * typed key changes, after a short pause.
 *
 * @param provider - The provider.
 * @param baseUrl - The base URL, or `null`.
 * @param apiKey - A key typed but not saved yet, if any.
 * @param providerId - The saved provider being edited, whose stored key may be used.
 * @returns The list.
 */
export function useModelList(
  provider: ModelProvider,
  baseUrl: string | null,
  apiKey: string | undefined,
  providerId: string,
): ModelList {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const { submit } = fetcher;
  useEffect(() => {
    const intent: ModelSettingsIntent = {
      intent: 'models',
      provider,
      baseUrl,
      providerId,
      ...(apiKey ? { apiKey } : {}),
    };
    const timer = setTimeout(
      () => void submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' }),
      400,
    );
    return () => clearTimeout(timer);
  }, [submit, provider, baseUrl, apiKey, providerId]);
  const data = fetcher.data?.intent === 'models' ? fetcher.data : undefined;
  return {
    known: providerProfiles[provider].models,
    models: data?.models ?? [],
    message: data?.message ?? null,
    loading: fetcher.state !== 'idle',
  };
}

/** Props of {@link ModelPicker}. */
interface ModelPickerProps {
  /** The label, kept for screen readers. */
  readonly label: string;
  /** The model id chosen, empty for "same as build". */
  readonly value: string;
  /** Whether an empty value means "same as build". */
  readonly sameAsBuild: boolean;
  /** The provider's models. */
  readonly list: ModelList;
  /** Called with the new model id. */
  readonly onChange: (value: string) => void;
  /** What the server said is wrong with the value. */
  readonly error: string | undefined;
}

/**
 * The options of the dropdown: "same as build" when allowed, the chosen model when neither list
 * has it, the models known by name, then the rest of what the provider lists.
 *
 * @param props - The picker's props.
 * @returns The options.
 */
function optionsOf({ value, sameAsBuild, list }: ModelPickerProps) {
  const knownIds = new Set(list.known.map((model) => model.id));
  const suggested = list.known.map((model) => ({
    value: model.id,
    label: `${model.name} · ${model.id}`,
    group: 'Suggested',
  }));
  const listed = list.models
    .filter((model) => !knownIds.has(model))
    .map((model) => ({ value: model, label: model, group: 'From the provider' }));
  const offered = value === '' || knownIds.has(value) || list.models.includes(value);
  const unlisted = offered ? [] : [{ value, label: `${value} (not listed)` }];
  const same = sameAsBuild ? [{ value: '', label: 'same as build' }] : [];
  return [...same, ...unlisted, ...suggested, ...listed];
}

/**
 * The line under the build model's dropdown: loading, or why the provider did not list its models.
 *
 * @param list - The list.
 * @returns The line, or `undefined` when the provider listed its models.
 */
function listHint(list: ModelList): string | undefined {
  if (list.loading) return 'Loading the provider’s models…';
  return list.message ?? undefined;
}

/**
 * The text field used when the provider's models cannot be listed.
 *
 * @param props - The picker's props.
 * @returns The field, saying why there is no list.
 */
function ModelField({ label, value, sameAsBuild, list, onChange, error }: ModelPickerProps) {
  const reason = list.message ?? 'The provider listed no chat models.';
  const hint = sameAsBuild ? undefined : (listHint(list) ?? reason);
  return (
    <Input
      label={label}
      hideLabel
      mono
      autoComplete="off"
      placeholder={sameAsBuild ? 'same as build' : 'model id'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      hint={hint}
      error={error}
    />
  );
}

/**
 * Picks a model: a dropdown of the provider's models, or a text field when there are none.
 *
 * @param props - The label, the value, the list and the change callback.
 * @returns The picker.
 */
export function ModelPicker(props: ModelPickerProps) {
  const { known, models } = props.list;
  if (known.length === 0 && models.length === 0) return <ModelField {...props} />;
  return (
    <Select
      label={props.label}
      hideLabel
      mono
      options={optionsOf(props)}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      hint={props.sameAsBuild ? undefined : listHint(props.list)}
      error={props.error}
    />
  );
}
