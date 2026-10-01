/** A chart's datasets: each query's frames as one dataset, with the view's filter or sort applied. */
import {
  type ChartView,
  type Dataset,
  type DatasetTransform,
  datasetOfFrames,
  filterRows,
  type QueryOutcome,
  sortRows,
} from '@quanthea/shared';

/**
 * Applies a view's transform.
 *
 * @param dataset - The dataset.
 * @param transform - The transform, if any.
 * @returns The transformed dataset.
 */
export function transformDataset(
  dataset: Dataset,
  transform: DatasetTransform | undefined,
): Dataset {
  if (!transform) return dataset;
  if (transform.type === 'filter') return filterRows(dataset, transform.field, transform.in);
  return sortRows(dataset, transform.field, transform.dir);
}

/**
 * The datasets of a chart view, one per query it reads.
 *
 * @param view - The chart view.
 * @param queries - The outcome of each query of the panel.
 * @returns The datasets, in the view's order.
 */
export function viewDatasets(view: ChartView, queries: readonly QueryOutcome[]): Dataset[] {
  return view.datasets.map((entry) => {
    const frames = queries.find((query) => query.refId === entry.ref)?.frames ?? [];
    return transformDataset(datasetOfFrames(frames), entry.transform);
  });
}
