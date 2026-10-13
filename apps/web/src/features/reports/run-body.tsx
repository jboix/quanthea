/**
 * The body of a run's page: the headline numbers with their change against the period before,
 * the other panels drawn from the frozen results with the dashboard's panel components, through
 * the layout of the run's version, and the links to dashboards opened on the run's period.
 * Nothing runs to draw it.
 */

import {
  type DashboardLayout,
  type DashboardSpec,
  dashboardOfReport,
  type Headline,
  type ReportDetail,
  type ReportRunDetail,
  reportCanvasPanels,
  shownReport,
} from '@quanthea/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fittedNumber } from '../../ui/fitted-number.ts';
import { FrozenCanvas } from '../dashboard/index.ts';
import { drawnPanels } from './redraw-data.ts';
import styles from './run.module.css';
import { RunInterval } from './run-interval.tsx';
import { useRedraw } from './use-redraw.ts';

/**
 * The panels of the report's grid as a layout shows them: without its headline numbers, at the
 * layout's places with the hidden ones left out, or moved up to the top row without a layout.
 *
 * @param run - The run.
 * @param layout - The layout to draw it through: its version's, or the one being arranged.
 * @returns The dashboard the frozen canvas draws.
 */
export function canvasSpec(
  run: ReportRunDetail,
  layout: DashboardLayout | undefined,
): DashboardSpec {
  const shown = shownReport(run.spec, layout);
  return dashboardOfReport({ ...shown, panels: reportCanvasPanels(shown) }, run.period);
}

/**
 * A run as the layout editor arranges it: the panels of its grid, and whether the reader may
 * arrange them. Only the active version is arranged, from a run that has results to show, by
 * those who may change the report.
 *
 * @param report - The report.
 * @param run - The run shown, or `null` before the first.
 * @returns The version arranged, and whether Edit layout is offered.
 */
export function arrangedRun(report: ReportDetail, run: ReportRunDetail | null) {
  const panels = run ? reportCanvasPanels(run.spec) : [];
  const arranged = { version: run?.version ?? 0, panels, layout: run?.layout ?? null };
  const shown = run?.status === 'ok' && run.version === report.activeVersion;
  return { arranged, allowed: report.canChange && shown && panels.length > 0 };
}

/**
 * One headline number: the panel's title, the number, and its change against the period before.
 *
 * @param props - The headline and the period it compares with.
 * @param props.headline - The headline.
 * @param props.before - The name of the period before, such as `week 39`, if any.
 * @returns The card.
 */
function HeadlineCard({
  headline,
  before,
}: {
  readonly headline: Headline;
  readonly before: string | undefined;
}) {
  const against = before && headline.change ? ` vs ${before}` : '';
  return (
    <section className={styles.headline} aria-label={headline.title}>
      <h2 className={styles.headlineTitle}>{headline.title}</h2>
      <p className={styles.headlineValue} style={fittedNumber(headline.text, 26)}>
        {headline.text}
      </p>
      {headline.change && (
        <p className={styles.headlineChange} data-direction={headline.change.direction}>
          {headline.change.text}
          {against}
        </p>
      )}
      {!headline.change && headline.previousText !== null && (
        <p className={styles.headlineChange}>Before: {headline.previousText}</p>
      )}
    </section>
  );
}

/**
 * The links to dashboards, each opened on the run's period.
 *
 * @param props - The links and the period's short name.
 * @param props.links - The links.
 * @param props.period - Such as `week 40`.
 * @returns The section, or nothing without links.
 */
function SeeAlso({
  links,
  period,
}: {
  readonly links: ReportRunDetail['seeAlso'];
  readonly period: string;
}) {
  if (links.length === 0) return null;
  return (
    <section className={styles.seeAlso} aria-labelledby="see-also">
      <h2 id="see-also" className={styles.sectionTitle}>
        See also
      </h2>
      <ul className={styles.links}>
        {links.map((link) => (
          <li key={link.dashboardId}>
            <Link to={link.path}>
              {link.label}, on {period}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Props of {@link RunBody}. */
interface RunBodyProps {
  /** The run, with its frozen results. */
  readonly run: ReportRunDetail;
  /** The layout its panels are drawn through: its version's, or the one being arranged. */
  readonly layout: DashboardLayout | undefined;
  /** The frames over the panels, while the layout is arranged. */
  readonly overlay?: ReactNode;
}

/**
 * The body of a run that succeeded.
 *
 * @param props - The run, and how its panels are arranged.
 * @param props.run - The run, with its frozen results.
 * @param props.layout - The layout its panels are drawn through, if any.
 * @param props.overlay - The frames over the panels, while the layout is arranged.
 * @returns The headlines, the interval of the charts, the panels and the links.
 */
export function RunBody({ run, layout, overlay }: RunBodyProps) {
  const short = (label: string) => label.split(',')[0] ?? label;
  const spec = canvasSpec(run, layout);
  const drawn = useRedraw(run);
  return (
    <>
      {run.headlines.length > 0 && (
        <div className={styles.headlines}>
          {run.headlines.map((headline) => (
            <HeadlineCard
              key={headline.panelId}
              headline={headline}
              before={run.comparison ? short(run.comparison.label) : undefined}
            />
          ))}
        </div>
      )}
      <RunInterval run={run} drawn={drawn} />
      {spec.panels.length > 0 && run.panels && (
        <FrozenCanvas
          spec={spec}
          panels={drawnPanels(run.panels, drawn.redraw)}
          time={run.period}
          variables={run.variables}
          hiddenMarkers={[]}
          overlay={overlay}
        />
      )}
      <SeeAlso links={run.seeAlso} period={short(run.period.label)} />
    </>
  );
}
