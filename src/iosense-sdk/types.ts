export interface UNSNode {
  id: string;
  type: string;
  name?: string;
  path: string | null;
  parentId: string | null;
}

export interface SeriesSlot {
  from: number;
  to: number;
  label: string;
  value: number | null;
  quality: string;
  isPartial?: boolean;
}

export interface SeriesAggregation {
  operator: string;
  downscale: number;
  resolution: string;
}

export interface SeriesMeta {
  type: string;
  key: string;
  unit: string | null;
  dataPrecision: number | null;
  aggregation: SeriesAggregation;
  devID: string;
  sensor: string;
}

export interface SeriesPayload {
  __type: 'series';
  path: string;
  meta: SeriesMeta;
  range: { from: number; to: number };
  slots: SeriesSlot[];
}

export interface ScalarBinding { key: string; topic: string; }
export interface SeriesBinding  { key: string; topic: string; type: 'series'; }
export type BindingEntry = ScalarBinding | SeriesBinding;

export interface DataEntry {
  key: string;
  value: string | number | null | SeriesPayload;
}

export interface Duration {
  id: string;
  label?: string;
  x?: number;
  xPeriod: string;
}

export interface TimeConfig {
  timezone: string;
  type: 'local' | 'fixed' | string;
  startTime: number | null;
  endTime: number | null;
  defaultDurationId: string;
  allDurations: Duration[];
  defaultPeriodicity: 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export type WidgetEvent =
  | { type: 'TIME_CHANGE'; payload: { startTime: string; endTime: string; periodicity: string } }
  | { type: 'FILTER_CHANGE'; payload: Record<string, unknown> };

// ---------------------------------------------------------------------------
// ColumnChart — widget-specific types
// ---------------------------------------------------------------------------

export interface ColumnChartSeriesConfig {
  _id: string;
  unsPath: string;   // bindable — stores {{uns:wsId://path}} (series binding)
  label: string;
  color?: string;
  unit?: string;
  yAxis?: 0 | 1;    // 0 = left (default), 1 = right
}

export interface FixedSeriesConfig {
  _id: string;
  unsPath: string;   // bindable — stores {{uns:wsId://path}} (scalar binding)
  label: string;
  color?: string;
  yAxis?: 0 | 1;
}

export interface StackConfig {
  _id: string;
  name: string;
  seriesIds: string[];   // _id refs into series[] and fixedSeries[]
}

export interface PlotLineConfig {
  _id: string;
  value: number | string;  // string = {{topic}} binding resolved at runtime
  label: string;
  color: string;
  width?: number;
  dashStyle?: 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'LongDash' | 'ShortDash';
}

export interface PlotBandConfig {
  _id: string;
  from: number | string;   // string = {{topic}} binding resolved at runtime
  to: number | string;
  label: string;
  color: string;
}

export interface ChartConfig {
  _id: string;
  title: string;
  series: ColumnChartSeriesConfig[];
  fixedSeries: FixedSeriesConfig[];
  stacks: StackConfig[];
  plotLines: PlotLineConfig[];
  plotBands: PlotBandConfig[];
}

export interface ColumnChartUIConfig {
  title: string;
  description?: string;
  charts: ChartConfig[];
  style: {
    card: { wrapInCard: boolean; bg: string };
    stacked: boolean;
    showLegend: boolean;
    showDataLabels: boolean;
    yAxisUnit: string;
  };
}

export interface ColumnChartEnvelope {
  _id: string;
  type: 'ColumnChart';
  general: { title: string };
  timeConfig?: TimeConfig;
  timeTabConfig?: Record<string, unknown>;
  uiConfig: ColumnChartUIConfig;
  dynamicBindingPathList: Array<BindingEntry>;
}
