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

// A resolved binding as the engine (prod Lens Data Engine / dev MiniEngine)
// hands it to the widget. The engine passes the `resolveAndCompute` response
// items through AS-IS:
//   • scalar item → { key, value }
//   • series item → { key, slots, meta, range, path }  (series fields at the
//     top level — NOT wrapped under `value`)
// The optional `value: SeriesPayload` form is kept only for backward-compat
// with any caller that still wraps; readers tolerate both.
export interface DataEntry {
  key: string;
  value?: string | number | null | SeriesPayload;
  // Raw series-item fields (present when value is absent).
  slots?: SeriesSlot[];
  meta?: SeriesMeta;
  range?: { from: number; to: number };
  path?: string;
  __type?: string;
}

export interface Duration {
  id: string;
  label?: string;
  navigation?: string;            // e.g. 'Previous'
  x?: number;                     // start offset count
  xPeriod: string;                // 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
  xEvent?: string;                // 'Start' | 'End' | 'Now' — boundary the start snaps to
  y?: number;                     // end offset count
  yPeriod?: string;
  yEvent?: string;                // 'Start' | 'End' | 'Now' — boundary the end snaps to
  calendarType?: string;          // e.g. 'today' | 'yesterday' | 'current_month'
  periodicities?: string[];
}

// Raw cycle-time config (matches the platform's GTPCycleTimeConfig). The
// resolver reads these fields directly, mirroring the GlobalTimePicker
// reference: hour:minute = day boundary, dayOfWeek = week boundary (0=Sun),
// date = month boundary day, month = year boundary (month NAME e.g. "January").
export interface CycleTime {
  identifier?: string;            // 'start' | 'end'
  hour?: string | number;
  minute?: string | number;
  dayOfWeek?: number | null;
  date?: string | number;
  month?: string;                 // month name, e.g. "January"
}

export interface TimeConfig {
  timezone: string;
  type: 'local' | 'fixed' | string;
  // Cycle-time boundaries used when resolving Start/End of day/week/month/year.
  cycleTime?: CycleTime;
  // The time-picker mode the user selected in the time tab (TimeTab's
  // `linkTimeWith`). `local` = user-controllable rolling window; `fixed` and
  // `global` = time is controlled externally, so the widget hides its picker.
  pickerType?: 'local' | 'fixed' | 'global';
  startTime: number | null;
  endTime: number | null;
  // The single "set duration" of the Fixed time picker, resolved at runtime
  // via resolveDurationWindow (x/xPeriod/xEvent + y/yPeriod/yEvent + navigation).
  fixedDuration?: Duration;
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
  precision?: number;
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

export interface AxisConfig {
  _id: string;
  name: string;
  yAxis: 0 | 1;
  seriesIds: string[];   // _id refs into series[] and fixedSeries[]
}

export type PlotLinePeriodicity = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface PlotLineConfig {
  _id: string;
  value: number | string;  // string = {{topic}} binding resolved at runtime
  label: string;
  color: string;
  width?: number;
  dashStyle?: 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'LongDash' | 'ShortDash';
  periodicityType?: 'independent' | 'dependent';
  periodicities?: PlotLinePeriodicity[];
}

export interface PlotBandConfig {
  _id: string;
  from: number | string;   // string = {{topic}} binding resolved at runtime
  to: number | string;
  label: string;
  color: string;
}

export type WidgetSizePreset = 'Small' | 'Medium' | 'Large' | 'Custom';

export interface WidgetSizeConfig {
  preset: WidgetSizePreset;
  width: number;
  height: number;
  locked?: boolean;
}

export interface WidgetElementsConfig {
  hideWidgetElements: boolean;
  hideSettingsIcon: boolean;
  hideExportIcon: boolean;
  hideChartTitle: boolean;
}

export type WidgetFontWeight = 'Regular' | 'Medium' | 'Semi-Bold' | 'Bold';

export interface WidgetAdvancedSettingsConfig {
  enabled: boolean;
  titleFontSize: number;
  titleFontColor: string;
  titleFontWeight: WidgetFontWeight;
  xAxisTextColor: string;
  xAxisLineColor: string;
  yAxisTextColor: string;
  yAxisLineColor: string;
  gridLineColor: string;
  legendTextColor: string;
}

export interface ChartConfig {
  _id: string;
  title: string;
  description?: string;
  series: ColumnChartSeriesConfig[];
  fixedSeries: FixedSeriesConfig[];
  axes: AxisConfig[];
  stacks: StackConfig[];
  plotLines: PlotLineConfig[];
  plotBands: PlotBandConfig[];
}

export interface ColumnChartUIConfig {
  title: string;
  description?: string;
  charts: ChartConfig[];
  activeChartId?: string;
  style: {
    card: { wrapInCard: boolean; bg: string };
    stacked: boolean;
    showLegend: boolean;
    showDataLabels: boolean;
    yAxisUnit: string;
    widgetSize?: WidgetSizeConfig;
    widgetElements?: WidgetElementsConfig;
    advancedSettings?: WidgetAdvancedSettingsConfig;
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
