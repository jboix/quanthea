/**
 * Watches the model's responses during an answer, so `give_answer` knows every tool its own step
 * calls. The AI SDK runs a tool as soon as its call is read, before the rest of the response, so
 * without this an answer could be checked while a read from the same step is still unknown.
 */
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

/** Holds the latest response: the names of the tools it calls, once it is complete. */
export interface ResponseWatch {
  /** Resolves with the tools the latest response calls; `undefined` before the first. */
  latest: Promise<readonly string[]> | undefined;
}

/**
 * The middleware that records each response's tool calls in the watch.
 *
 * @param watch - Where the latest response's calls go.
 * @returns The middleware.
 */
function watching(watch: ResponseWatch): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      const names: string[] = [];
      let settle: (calls: readonly string[]) => void = () => undefined;
      watch.latest = new Promise((resolve) => {
        settle = resolve;
      });
      const stream = result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === 'tool-call') names.push(chunk.toolName);
            // The response is complete at its finish, or broken at an error.
            if (chunk.type === 'finish' || chunk.type === 'error') settle(names);
            controller.enqueue(chunk);
          },
          flush: () => settle(names),
        }),
      );
      return { ...result, stream };
    },
  };
}

/**
 * Wraps a model so the watch learns each response's tool calls.
 *
 * @param model - The model.
 * @param watch - The watch to fill.
 * @returns The wrapped model; a model given by id alone is returned as it is, unwatched.
 */
export function watchedModel(model: LanguageModel, watch: ResponseWatch): LanguageModel {
  if (typeof model === 'string') return model;
  return wrapLanguageModel({ model, middleware: watching(watch) });
}
