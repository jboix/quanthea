/**
 * A chart's datasets: each query's frames as one dataset, with the view's filter, sort or pivot
 * applied.
 */
import {
  type ChartView,
  type Dataset,
  type DatasetTransform,
  datasetOfFrames,
  filterRows,
  longToWide,
  type QueryOutcome,
  sortRows,
} from '@querent/shared';

/**
 * Pivots on a column, as views written before chart recipes asked: the first other text or time
 * column is the x, the first number the value.
 *
 * @param dataset - The long table.
 * @param by - The column whose values become columns.
 * @returns The wide table.
 */
function pivotOn(dataset: Dataset, by: string): Dataset {
  const x = dataset.dimensions.find((column) => column.name !== by && column.type !== 'number');
  const value = dataset.dimensions.find((column) => column.type === 'number');
  if (!x || !value) return dataset;
  return longToWide(dataset, { x: x.name, series: by, value: value.name });
}

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
  if (transform.type === 'pivot') return pivotOn(dataset, transform.by);
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
