/**
 * Records, in the thread, the access each connector's data was read at during a run. The record
 * is a data part: stored with the answer, never shown, and never sent to the model. It lets the
 * server tell which threads hold data that a later access change restricts.
 */
import type { UIMessageStreamWriter } from 'ai';
import type { ModelView } from '../gate/model-view.ts';
import type { ThreadMessage } from './run-context.ts';

/** Notes that a connector's data was read. */
type Note = (name: string) => void;

/**
 * A note-taker that writes each distinct access once per run.
 *
 * @param view - The model view, which knows each connector's access.
 * @param writer - The run's stream writer.
 * @returns The note-taker.
 */
function noteTaker(view: ModelView, writer: UIMessageStreamWriter<ThreadMessage>): Note {
  const written = new Set<string>();
  return (name) => {
    const access = view.accessOf(name);
    if (!access) return;
    const key = JSON.stringify(access);
    if (written.has(key)) return;
    written.add(key);
    writer.write({ type: 'data-sourceAccess', data: access });
  };
}

/**
 * The methods that read data from a connector's source, each noting it first.
 *
 * @param view - The model view.
 * @param note - Notes a connector's access.
 * @returns The methods.
 */
function readingMethods(view: ModelView, note: Note) {
  return {
    describe: ((name, scope, signal) => {
      note(name);
      return view.describe(name, scope, signal);
    }) satisfies ModelView['describe'],
    sample: ((name, field, limit, signal) => {
      note(name);
      return view.sample(name, field, limit, signal);
    }) satisfies ModelView['sample'],
    testQuery: ((name, request) => {
      note(name);
      return view.testQuery(name, request);
    }) satisfies ModelView['testQuery'],
  };
}

/**
 * The methods that shape results already read, each noting the connector first.
 *
 * @param view - The model view.
 * @param note - Notes a connector's access.
 * @returns The methods.
 */
function shapingMethods(view: ModelView, note: Note) {
  return {
    panelResult: ((name, outcome) => {
      note(name);
      return view.panelResult(name, outcome);
    }) satisfies ModelView['panelResult'],
    alertCheck: ((name, series) => {
      note(name);
      return view.alertCheck(name, series);
    }) satisfies ModelView['alertCheck'],
    alertReplay: ((name, replay) => {
      note(name);
      return view.alertReplay(name, replay);
    }) satisfies ModelView['alertReplay'],
  };
}

/**
 * The model view of a run, recording in the thread the access of every connector whose data
 * reaches the model.
 *
 * @param view - The model view.
 * @param writer - The run's stream writer.
 * @returns The same view, recording.
 */
export function recordingView(
  view: ModelView,
  writer: UIMessageStreamWriter<ThreadMessage>,
): ModelView {
  const note = noteTaker(view, writer);
  return { ...view, ...readingMethods(view, note), ...shapingMethods(view, note) };
}
