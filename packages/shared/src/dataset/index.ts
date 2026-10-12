/** The dataset's part of the public surface of `@quanthea/shared`. */

export {
  type Cell,
  type Dataset,
  type Dimension,
  type DimensionType,
  datasetSchema,
  type ShapeKind,
  shapeGuides,
  shapeKinds,
} from './contract.ts';
export { datasetOfFrames } from './from-frames.ts';
export {
  columnIndex,
  columnValues,
  compareCells,
  filterRows,
  fiveNumbers,
  histogramBins,
  longToWide,
  rowsToGraph,
  rowsToTree,
  sortRows,
  type TreeNode,
} from './reshape.ts';
export * from './stat.ts';
