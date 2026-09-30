/**
 * The chart types and components that only some charts use, registered the first time a chart
 * needs one of them.
 */
import {
  BoxplotChart,
  CandlestickChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  MapChart,
  ParallelChart,
  RadarChart,
  SankeyChart,
  SunburstChart,
  TreemapChart,
} from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GeoComponent,
  ParallelComponent,
  RadarComponent,
  VisualMapComponent,
} from 'echarts/components';
import { use } from 'echarts/core';

use([
  BoxplotChart,
  CandlestickChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  MapChart,
  ParallelChart,
  RadarChart,
  SankeyChart,
  SunburstChart,
  TreemapChart,
  CalendarComponent,
  DataZoomComponent,
  GeoComponent,
  ParallelComponent,
  RadarComponent,
  VisualMapComponent,
]);
