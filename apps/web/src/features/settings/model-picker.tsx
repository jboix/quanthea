import type { ModelProvider } from '@querent/shared';
import { useEffect } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome } from './data.ts';

/** The models a provider offers, as the picker loads them. */
export interface ModelList {
  /** The chat models, empty until they load or when they cannot. */
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
 * @returns The list.
 */
export function useModelList(
  provider: ModelProvider,
  baseUrl: string | null,
  apiKey: string | undefined,
): ModelList {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const { submit } = fetcher;
  useEffect(() => {
    const intent: ModelSettingsIntent = {
      intent: 'models',
      provider,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    };
    const timer = setTimeout(
      () => void submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' }),
      400,
    );
    return () => clearTimeout(timer);
  }, [submit, provider, baseUrl, apiKey]);
  const data = fetcher.data?.intent === 'models' ? fetcher.data : undefined;
  return {
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
 * The options of the dropdown: "same as build" when allowed, the chosen model when the provider
 * does not list it, then the provider's models.
 *
 * @param props - The picker's props.
 * @returns The options.
 */
function optionsOf({ value, sameAsBuild, list }: ModelPickerProps) {
  const options = list.models.map((model) => ({ value: model, label: model }));
  const unlisted =
    value !== '' && !list.models.includes(value) ? [{ value, label: `${value} (not listed)` }] : [];
  const same = sameAsBuild ? [{ value: '', label: 'same as build' }] : [];
  return [...same, ...unlisted, ...options];
}

/**
 * The text field used when the provider's models cannot be listed.
 *
 * @param props - The picker's props.
 * @returns The field, saying why there is no list.
 */
function ModelField({ label, value, sameAsBuild, list, onChange, error }: ModelPickerProps) {
  const hint = list.loading
    ? 'Loading the models…'
    : (list.message ?? 'The provider listed no chat models.');
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
 * Picks a model: a dropdown of the provider's models, or a text field when they cannot be listed.
 *
 * @param props - The label, the value, the list and the change callback.
 * @returns The picker.
 */
export function ModelPicker(props: ModelPickerProps) {
  if (props.list.models.length === 0) return <ModelField {...props} />;
  return (
    <Select
      label={props.label}
      hideLabel
      mono
      options={optionsOf(props)}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      error={props.error}
    />
  );
}
