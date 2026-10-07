/**
 * Lists the models a provider offers, from its own API, so the settings screen can offer them in
 * a dropdown. Only models that can chat are kept.
 */
import { type ModelProvider, providerProfiles } from '@quanthea/shared';
import { gatewayFetch } from '../settings/gateway-fetch.ts';

/** Where to ask, and with which key. */
export interface CatalogRequest {
  /** The provider. */
  readonly provider: ModelProvider;
  /** The base URL, or `null` for the provider's own API. */
  readonly baseUrl: string | null;
  /** The API key, or `null` when there is none. */
  readonly apiKey: string | null;
}

/** The models, or why they could not be listed. */
export type Catalog =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** Model ids that do not chat: embeddings, speech, images, video, music, live audio. */
const notChat =
  /embed|tts|whisper|transcri|dall-e|image|moderation|audio|veo|lyria|robotics|aqa|live|computer-use|ocr|imagen|sora/i;

/** How long listing may take. */
const timeoutMs = 15_000;

/**
 * The headers that authenticate a listing.
 *
 * @param provider - The provider.
 * @param apiKey - The key, if any.
 * @returns The headers.
 */
function headersFor(provider: ModelProvider, apiKey: string | null): Record<string, string> {
  if (apiKey === null) return {};
  if (provider === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * The model ids of a `/models` answer, which every provider shapes as `{ data: [{ id }] }`.
 *
 * @param body - The answer.
 * @returns The chat model ids, without Gemini's `models/` prefix, sorted and without repeats.
 */
function idsOf(body: unknown): string[] {
  const data = (body as { data?: readonly { id?: unknown }[] } | null)?.data ?? [];
  const ids = data.flatMap((model) =>
    typeof model.id === 'string' ? [model.id.replace(/^models\//, '')] : [],
  );
  return [...new Set(ids.filter((id) => !notChat.test(id)))].sort();
}

/**
 * Lists the models of a provider.
 *
 * @param request - The provider, its base URL and the key.
 * @param fetchFunction - Sends the request; the gateway fetch, with its outbound checks, by
 *   default.
 * @returns The chat models, or why they could not be listed.
 */
export async function listModels(
  request: CatalogRequest,
  fetchFunction: typeof gatewayFetch = gatewayFetch,
): Promise<Catalog> {
  const base = request.baseUrl ?? providerProfiles[request.provider].baseUrl;
  if (base === null) return { ok: false, message: 'Enter the gateway’s base URL first.' };
  if (request.apiKey === null && request.provider !== 'openai-compatible') {
    return { ok: false, message: 'Enter the API key to list every model the provider offers.' };
  }
  try {
    const response = await fetchFunction(`${base.replace(/\/+$/, '')}/models`, {
      headers: headersFor(request.provider, request.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok)
      return {
        ok: false,
        message: `The provider answered ${response.status} ${response.statusText}.`,
      };
    return { ok: true, models: idsOf(await response.json()) };
  } catch (error) {
    return {
      ok: false,
      message: `The provider could not be reached: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
}
