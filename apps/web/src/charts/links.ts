/** Keeps a chart from navigating its viewer: no link and no click event survives in an option. */
import { isObject, type Loose } from './loose.ts';

/** Keys that open a URL or emit a click event: a chart never navigates its viewer. */
const linkKeys: readonly string[] = ['link', 'sublink', 'target', 'subtarget', 'triggerEvent'];

/**
 * A value of the option without links, click events or nodes that open a link, at any depth.
 *
 * @param value - Any value of the option.
 * @returns The value without them.
 */
function unlinked(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unlinked);
  if (!isObject(value)) return value;
  const kept = Object.entries(value).filter(
    ([key, child]) => !linkKeys.includes(key) && !(key === 'nodeClick' && child === 'link'),
  );
  return Object.fromEntries(kept.map(([key, child]) => [key, unlinked(child)]));
}

/**
 * The spec's option without links and click events, but for the axes `axisPointer.link` moves
 * together. Validation refuses them too; this covers specs stored before it did.
 *
 * @param option - The spec's option.
 * @returns The option that cannot navigate its viewer.
 */
export function withoutLinks(option: Loose): Loose {
  const cleaned = unlinked(option) as Loose;
  const { axisPointer } = option;
  if (!isObject(axisPointer) || !Array.isArray(axisPointer.link)) return cleaned;
  return {
    ...cleaned,
    axisPointer: { ...(cleaned.axisPointer as Loose), link: unlinked(axisPointer.link) },
  };
}
