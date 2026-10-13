/**
 * The judge on a real model: one fixed model for every run, whichever provider made what it
 * reads, so the runs stay comparable. Its model is built as quanthea builds any model, from
 * settings saved in services of its own. Its temperature is 0 where the provider takes it:
 * Anthropic does, and Google advises leaving its models' sampling alone.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { languageModel } from '@quanthea/server/src/agent/model.ts';
import { connectorKinds } from '@quanthea/server/src/connectors/registry.ts';
import { testServices } from '@quanthea/server/src/test/fixtures.ts';
import { generateText } from 'ai';
import { type EvalProvider, gatewayOf } from '../world/providers.ts';
import { evalsActor } from '../world/setup.ts';
import { type AskJudge, createJudge, type Judge } from './judge.ts';

/** The judge every run uses unless told otherwise: small, and not the model that builds. */
export const defaultJudge = { provider: 'anthropic', model: 'claude-haiku-4-5' } as const;

/** What a live judge needs. */
export interface LiveJudgeOptions {
  /** The judge's provider. */
  readonly provider: EvalProvider;
  /** The judge's model. */
  readonly model: string;
  /** The provider's key. */
  readonly apiKey: string;
  /** Where verdicts are kept. */
  readonly dir: string;
  /** The most calls to the model in a run. */
  readonly budget: number;
  /** Which sample of the judge's answers to draw; 1 unless its own noise is measured. */
  readonly draw?: number | undefined;
}

/** A live judge, and how to close what it opened. */
export interface LiveJudge {
  /** The judge. */
  readonly judge: Judge;
  /** Closes its services and deletes their database. */
  readonly close: () => Promise<void>;
}

/**
 * The JSON object in a text: from its first brace to its last, so a fence around it does no harm.
 *
 * @param text - What the model wrote.
 * @returns The object, or nothing when the text holds none.
 */
export function jsonIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Opens the judge on a real model.
 *
 * @param options - Its provider, model and key, where its verdicts are kept, and its budget.
 * @returns The judge, and how to close what it opened.
 */
export async function openLiveJudge(options: LiveJudgeOptions): Promise<LiveJudge> {
  const { provider, model: modelId, apiKey } = options;
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-evals-judge-'));
  const services = await testServices(dir, connectorKinds, Date.now);
  const gateway = gatewayOf(provider, { model: modelId });
  await services.modelSettings.save(gateway, { [gateway.defaultProviderId]: apiKey }, evalsActor);
  const model = languageModel(await services.modelSettings.resolve(), 'answer');
  const sampling = provider === 'anthropic' ? { temperature: 0 } : {};
  const ask: AskJudge = async (system, prompt) => {
    const { text, usage } = await generateText({ model, system, prompt, ...sampling });
    return { answer: jsonIn(text), tokens: usage.totalTokens ?? 0 };
  };
  const label = `${provider}/${modelId}`;
  const judge = createJudge({
    label,
    ask,
    dir: options.dir,
    budget: options.budget,
    draw: options.draw,
  });
  const close = async () => {
    await services.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { judge, close };
}
