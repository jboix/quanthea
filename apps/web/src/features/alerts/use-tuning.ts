/**
 * Hand tuning on a live alert's page. An editor drags the threshold or changes a value of the
 * condition; the changes are held unsaved in the page, never applied, until they are activated
 * as a new version or discarded. They start from the active version and lapse once another is
 * active.
 */
import {
  type AlertDetail,
  type AlertSpec,
  alertSpecChanges,
  alertSpecSchema,
  hasRole,
} from '@quanthea/shared';
import { useMemo, useState } from 'react';
import { withThreshold } from '../alert-draft/index.ts';
import { useRole } from './use-role.ts';

/** The page's hand tuning. */
export interface Tuning {
  /** The active version's spec; none for an alert that can't be tuned here. */
  readonly saved: AlertSpec | undefined;
  /** The changes held unsaved over the saved spec, or the saved spec; none like `saved`. */
  readonly base: AlertSpec | undefined;
  /** The spec as shown: the changes and the threshold being dragged, over the saved one. */
  readonly shown: AlertSpec | undefined;
  /** The changes held unsaved, with the threshold being dragged; none when nothing changed. */
  readonly unsaved: AlertSpec | undefined;
  /** The threshold while it is dragged. */
  readonly dragged: number | null;
  /** Moves the threshold while it is dragged. */
  readonly drag: (value: number | null) => void;
  /** Lets the dragged threshold go at a value, held unsaved. */
  readonly release: (value: number) => void;
  /** Holds a changed spec unsaved. */
  readonly change: (spec: AlertSpec) => void;
  /** Drops the changes. */
  readonly discard: () => void;
}

/**
 * The spec of the active version an editor may tune: active and evaluated.
 *
 * @param alert - The alert.
 * @param editor - Whether the person is an editor.
 * @returns The spec, or nothing.
 */
function tunableSpec(alert: AlertDetail, editor: boolean): AlertSpec | undefined {
  if (!editor || alert.activeVersion === null || alert.deactivated) return undefined;
  const active = alert.versions.find((each) => each.version === alert.activeVersion);
  const parsed = alertSpecSchema.safeParse(active?.spec);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The spec with the threshold where it is dragged.
 *
 * @param spec - The spec.
 * @param dragged - The threshold being dragged, if it is.
 * @returns The spec as shown.
 */
function withDragged(spec: AlertSpec, dragged: number | null): AlertSpec {
  const { condition } = spec;
  if (dragged === null || condition.kind !== 'threshold') return spec;
  return withThreshold(spec, condition.op, dragged);
}

/** The changes held, with the active version they start from. */
interface Held {
  /** The active version they start from. */
  readonly basedOn: number | null;
  /** The spec with the changes. */
  readonly spec: AlertSpec;
}

/**
 * The page's hand tuning, for editors on a live alert.
 *
 * @param alert - The alert.
 * @returns The saved, shown and unsaved specs, and the changes' setters.
 */
export function useTuning(alert: AlertDetail): Tuning {
  const editor = hasRole(useRole(), 'editor');
  const saved = useMemo(() => tunableSpec(alert, editor), [alert, editor]);
  const [held, hold] = useState<Held>();
  const [dragged, drag] = useState<number | null>(null);
  // Changes start from the active version: once another is active, they lapse.
  const base = saved && (held?.basedOn === alert.activeVersion ? held.spec : saved);
  const shown = base && withDragged(base, dragged);
  const unsaved = useMemo(
    () => (saved && shown && alertSpecChanges(saved, shown).length > 0 ? shown : undefined),
    [saved, shown],
  );
  const change = (spec: AlertSpec) => hold({ basedOn: alert.activeVersion, spec });
  return {
    ...{ saved, base, shown, unsaved, dragged, drag, change },
    release: (value) => {
      drag(null);
      if (base) change(withDragged(base, value));
    },
    discard: () => {
      hold(undefined);
      drag(null);
    },
  };
}
