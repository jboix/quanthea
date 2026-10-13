/**
 * The draft's preview over its latest period: the headline numbers with their change against the
 * period before, then the other panels drawn by the dashboard's own panel components from the
 * preview's results, through the layout of the version when one was saved. Nothing runs in the browser; the preview route ran the draft once and
 * stored nothing.
 */

import {
  type DashboardLayout,
  dashboardOfReport,
  type Headline,
  type ReportPeriod,
  type ReportPreview,
  type ReportSpec,
  reportCanvasPanels,
  shownReport,
} from '@quanthea/shared';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { fittedNumber } from '../../ui/fitted-number.ts';
import { FrozenCanvas } from '../dashboard/index.ts';
import type { PreviewOutcome } from './data.ts';
import styles from './report-draft.module.css';

/** The latest period of each kind, in words. */
const lastWords: Readonly<Record<ReportPeriod, string>> = {
  previous_day: 'yesterday',
  previous_week: 'last week',
  previous_month: 'last month',
  week_to_date: 'this week so far',
};

/**
 * Loads the preview of the thread's latest draft from the preview route.
 *
 * @param threadId - The thread.
 * @param version - The draft's version, so a new version previews again.
 * @returns The outcome, once loaded.
 */
function usePreview(threadId: string, version: number): PreviewOutcome | undefined {
  const { load, data } = useFetcher<PreviewOutcome>({ key: `report-preview-${threadId}` });
  const url = `/threads/${threadId}/report-preview?v=${version}`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  return data?.ok && data.version !== version ? undefined : data;
}

/**
 * One headline number, with how it moved since the period before.
 *
 * @param props - The headline.
 * @param props.headline - The headline.
 * @returns The tile.
 */
function HeadlineTile({ headline }: { readonly headline: Headline }) {
  const { change, previousText } = headline;
  return (
    <div className={styles.headline}>
      <span className={styles.headlineTitle}>{headline.title}</span>
      <span className={styles.headlineValue} style={fittedNumber(headline.text, 24)}>
        {headline.text}
      </span>
      {change && (
        <span className={styles.change} data-direction={change.direction}>
          {change.text}
          {previousText ? ` · was ${previousText}` : ''}
        </span>
      )}
    </div>
  );
}

/**
 * How many panels the layout hides, in words.
 *
 * @param version - The version shown.
 * @param hidden - How many of its panels the layout hides.
 * @returns Such as `1 panel hidden on v3`, or nothing when none is.
 */
export function hiddenNote(version: number, hidden: number): string | undefined {
  if (hidden === 0) return undefined;
  return `${hidden} ${hidden === 1 ? 'panel' : 'panels'} hidden on v${version}`;
}

/** Props of {@link PreviewResults}. */
interface PreviewResultsProps {
  /** The draft's version. */
  readonly version: number;
  /** Its spec. */
  readonly spec: ReportSpec;
  /** The layout the version is shown with, if one was saved. */
  readonly layout: DashboardLayout | undefined;
  /** The preview. */
  readonly preview: ReportPreview;
}

/**
 * The preview's results: the headlines, then the other panels as the version's layout shows them.
 *
 * @param props - The version, its spec and layout, and the preview.
 * @returns The results.
 */
function PreviewResults({ version, spec, layout, preview }: PreviewResultsProps) {
  const time = { from: preview.period.from, to: preview.period.to };
  const arranged = shownReport(spec, layout);
  const shown = { ...arranged, panels: reportCanvasPanels(arranged) };
  const hidden = hiddenNote(version, spec.panels.length - arranged.panels.length);
  return (
    <>
      {preview.failure && <p className={styles.failure}>{preview.failure}</p>}
      {preview.headlines.length > 0 && (
        <div className={styles.headlines}>
          {preview.headlines.map((headline) => (
            <HeadlineTile key={headline.panelId} headline={headline} />
          ))}
        </div>
      )}
      {shown.panels.length > 0 && (
        <FrozenCanvas
          spec={dashboardOfReport(shown, preview.period)}
          panels={preview.panels}
          time={time}
          variables={{}}
          hiddenMarkers={[]}
          fixedNote="The latest period the report covers"
        />
      )}
      {hidden && <p className={styles.note}>{hidden}</p>}
    </>
  );
}

/**
 * The preview of the draft on its latest period.
 *
 * @param props - The thread, the version, its spec and its layout.
 * @param props.threadId - The thread.
 * @param props.version - The draft's version.
 * @param props.spec - Its spec.
 * @param props.layout - The layout the version is shown with, if one was saved.
 * @returns The section.
 */
export function PreviewSection({
  threadId,
  version,
  spec,
  layout,
}: {
  readonly threadId: string;
  readonly version: number;
  readonly spec: ReportSpec;
  readonly layout: DashboardLayout | undefined;
}) {
  const outcome = usePreview(threadId, version);
  const label = outcome?.ok ? ` · ${outcome.preview.period.label}` : '';
  return (
    <section className={styles.preview} aria-label="Preview">
      <h3 className={styles.previewHead}>
        Preview on {lastWords[spec.period]}
        {label}
      </h3>
      {!outcome && <p className={styles.note}>Running the report over its latest period…</p>}
      {outcome && !outcome.ok && <p className={styles.failure}>{outcome.message}</p>}
      {outcome?.ok && (
        <PreviewResults version={version} spec={spec} layout={layout} preview={outcome.preview} />
      )}
    </section>
  );
}
