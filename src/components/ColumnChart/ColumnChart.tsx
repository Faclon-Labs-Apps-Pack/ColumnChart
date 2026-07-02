import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ColumnChart as ColumnChartDisplay } from '@faclon-labs/design-sdk/ColumnChart';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import { AreaChart } from '@faclon-labs/design-sdk/AreaChart';
import { ChartSwitcher } from '@faclon-labs/design-sdk/ChartSwitcher';
import { exportChart } from '@faclon-labs/design-sdk/Chart';
import type { ChartExportFormat } from '@faclon-labs/design-sdk/Chart';
import { DatePicker, getPresetDateRange } from '@faclon-labs/design-sdk/DatePicker';
import type { DateRange } from '@faclon-labs/design-sdk/DatePicker';
import { Breadcrumb, BreadcrumbItem } from '@faclon-labs/design-sdk/Breadcrumb';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem, ActionListItemGroup } from '@faclon-labs/design-sdk/DropdownMenu';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { Home, Settings, Menu, Info } from 'react-feather';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { EmptyState, NoDataOneIllustration, AddWidgetIllustration } from '@faclon-labs/design-sdk/EmptyState';
import type {
  ChartComparisonConfig,
  ComparisonSeriesInput,
  ChartShiftConfig,
  ShiftSeriesInput,
  DeviationPattern,
} from '@faclon-labs/design-sdk';
import {
  DataEntry,
  WidgetEvent,
  ColumnChartUIConfig,
  ChartConfig,
  SeriesPayload,
  SeriesSlot,
  WidgetAdvancedSettingsConfig,
  WidgetFontWeight,
  TimeConfig,
  Duration,
} from '../../iosense-sdk/types';
import { resolveDurationWindow } from '../../iosense-sdk/time';
import './ColumnChart.css';

interface ColumnChartProps {
  config?: ColumnChartUIConfig;
  /** Resolved data. In Comparison Mode each series entry also carries the prior
   *  window inline as `comparisonSlots` — no separate comparisonData prop. */
  data?: DataEntry[];
  onEvent: (event: WidgetEvent) => void;
  timeConfig?: TimeConfig;
}

// Safe fallback so the widget renders its empty state (rather than crashing)
// when the host mounts it before the envelope/config has resolved.
const EMPTY_UI_CONFIG: ColumnChartUIConfig = {
  title: '',
  charts: [],
  style: {
    card: { wrapInCard: false, bg: '' },
    stacked: false,
    showLegend: true,
    showDataLabels: false,
    yAxisUnit: '',
  },
};

type Periodicity = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly';
const ALL_PERIODICITIES: Periodicity[] = ['Hourly', 'Daily', 'Weekly', 'Monthly'];
const LEVEL_ORDER: Periodicity[] = ['Monthly', 'Weekly', 'Daily', 'Hourly'];

interface DrillEntry { label: string; startTime: number; endTime: number; }

function getAvailablePeriodicities(range: DateRange): Periodicity[] {
  const days = (range.end.getTime() - range.start.getTime()) / 86_400_000;
  if (days <= 2)   return ['Hourly'];
  if (days <= 31)  return ['Hourly', 'Daily'];
  if (days <= 180) return ['Daily', 'Weekly', 'Monthly'];   // Monthly for quarter windows
  return ['Daily', 'Weekly', 'Monthly'];
}

const MINS_MAP: Record<string, number> = {
  minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600,
};

// Ported from GlobalTimePicker.getPresetPeriodicities: the periodicities a
// duration allows. Custom durations carry an explicit list; calendar presets
// have fixed sets; rolling presets derive from their length.
function getPresetPeriodicities(dur: Duration): string[] {
  if (dur.periodicities?.length) return dur.periodicities;
  if (dur.calendarType) {
    switch (dur.calendarType) {
      case 'today':
      case 'yesterday':      return ['hour'];
      case 'current_week':
      case 'previous_week':  return ['hour', 'day'];
      case 'current_month':
      case 'previous_month': return ['day'];
    }
  }
  const mins = (dur.x ?? 1) * (MINS_MAP[dur.xPeriod ?? 'day'] ?? 1440);
  if (mins <= 60)    return ['minute', 'hour'];
  if (mins <= 1440)  return ['hour'];
  if (mins <= 10080) return ['hour', 'day'];
  if (mins <= 43200) return ['day'];
  return ['day', 'month'];
}

const RAW_TO_PERIODICITY: Record<string, Periodicity> = {
  minute: 'Hourly', hour: 'Hourly', hourly: 'Hourly',
  day: 'Daily', daily: 'Daily',
  week: 'Weekly', weekly: 'Weekly',
  month: 'Monthly', monthly: 'Monthly',
};

// Periodicity options for the active duration (mapped to the widget's levels),
// falling back to the range-length heuristic when no duration is selected.
function durationPeriodicities(dur: Duration | undefined, range: DateRange): Periodicity[] {
  if (!dur) return getAvailablePeriodicities(range);
  const mapped = Array.from(
    new Set(getPresetPeriodicities(dur).map((p) => RAW_TO_PERIODICITY[p.toLowerCase()]).filter(Boolean)),
  ) as Periodicity[];
  return mapped.length ? mapped : getAvailablePeriodicities(range);
}

function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry) return null;
  // Raw API item: series fields (slots/meta/range/path) sit at the top level
  // of the entry — this is what the engine passes through as-is.
  if (Array.isArray(entry.slots)) {
    return {
      __type: 'series',
      path: entry.path ?? '',
      meta: entry.meta as SeriesPayload['meta'],
      range: entry.range ?? { from: 0, to: 0 },
      slots: entry.slots,
    };
  }
  // Backward-compat: wrapped DataEntry where value is a SeriesPayload.
  const v = entry.value;
  if (v !== null && typeof v === 'object' && (v as SeriesPayload).__type === 'series') {
    return v as SeriesPayload;
  }
  return null;
}

// Comparison-period counterpart of getSeriesData: the comparison window rides
// inline on the SAME data entry as `comparisonSlots` (Comparison Mode only), so
// we read it straight from `data` — no separate comparisonData array. Returns
// null when the entry carries no comparison slots.
function getComparisonSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry || !Array.isArray(entry.comparisonSlots)) return null;
  return {
    __type: 'series',
    path: entry.path ?? '',
    meta: entry.meta as SeriesPayload['meta'],
    range: entry.range ?? { from: 0, to: 0 },
    slots: entry.comparisonSlots,
  };
}

function getValue(key: string, config: unknown, data: DataEntry[]): string | number | null {
  const entry = data.find((d) => d.key === key);
  if (entry !== undefined) {
    // A series entry (raw slots at top level, or a wrapped SeriesPayload) is
    // not a scalar — never coerce it through getValue.
    if (Array.isArray(entry.slots)) return null;
    const v = entry.value;
    if (v !== null && typeof v === 'object') return null;
    return (v ?? null) as string | number | null;
  }
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  return parts.reduce((acc: unknown, k) => (acc as Record<string, unknown>)?.[k], config) as string | number | null;
}

function nextFinerPeriodicity(p: Periodicity): Periodicity {
  const idx = LEVEL_ORDER.indexOf(p);
  return idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : p;
}

function fontWeightToCss(weight: WidgetFontWeight): number {
  switch (weight) {
    case 'Regular':
      return 400;
    case 'Medium':
      return 500;
    case 'Semi-Bold':
      return 600;
    case 'Bold':
      return 700;
    default:
      return 600;
  }
}

function chartColorFallback(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color.includes('text-default-primary')) {
    return '#1a1a1a';
  }
  return color;
}

// Resolve an SDK CSS custom property to its computed value at render time.
// Highcharts renders to SVG and applies style.color as inline attributes —
// CSS `var()` inside SVG inline styles is unreliable across browsers, so we
// resolve once here and feed real values into the Highcharts options. Falls
// back to the provided value when running outside the DOM (SSR / tests).
function resolveSDKToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface ChartThemeTokens {
  textPrimary:    string;
  textSecondary:  string;
  textTertiary:   string;
  textOnSeries:   string;
  surface:        string;
  borderDefault:  string;
  borderSubtle:   string;
  fontSizeSmall:  string;
  fontSizeBody:   string;
  fontWeightBold: string;
  borderRadiusMd: string;
}
function resolveChartTheme(): ChartThemeTokens {
  return {
    textPrimary:    resolveSDKToken('--text-gray-primary',    '#1a1a1a'),
    textSecondary:  resolveSDKToken('--text-gray-secondary',  '#555555'),
    textTertiary:   resolveSDKToken('--text-gray-tertiary',   '#6b7280'),
    textOnSeries:   resolveSDKToken('--text-neutral-on-default', '#ffffff'),
    surface:        resolveSDKToken('--background-surface-intense', '#ffffff'),
    borderDefault:  resolveSDKToken('--border-gray-default',  'rgba(0,0,0,0.12)'),
    borderSubtle:   resolveSDKToken('--border-gray-subtle',   'rgba(0,0,0,0.08)'),
    fontSizeSmall:  resolveSDKToken('--font-size-25',         '12px'),
    fontSizeBody:   resolveSDKToken('--font-size-50',         '13px'),
    fontWeightBold: resolveSDKToken('--font-weight-600',      '600'),
    borderRadiusMd: resolveSDKToken('--global-border-radius-medium', '8px'),
  };
}

// ── Per-chart data builder ────────────────────────────────────────────────────

type DashStyle = 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'LongDash' | 'ShortDash';

interface ChartDisplayData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedSeries: { name: string; data: any[]; color?: string; yAxis?: number }[];
  resolvedSeriesIds: string[];
  categories: string[];
  plotLines: { value: number; label?: string; color?: string; width?: number; dashStyle?: DashStyle; yAxis?: 0 | 1 }[];
  plotBands: { from: number; to: number; label?: string; color?: string; yAxis?: 0 | 1 }[];
  yAxisUnit: string | undefined;
  firstPayload: SeriesPayload | null;
  highchartsOptions: Record<string, unknown>;
  // Advanced-settings styling (axis/grid/legend colors) as a standalone
  // Highcharts-options fragment. `highchartsOptions` (normal mode) already has
  // this merged in; shift/comparison modes build their own series and take this
  // fragment separately so the same styling still applies. Undefined when
  // advanced settings are off.
  advancedChartOptions: Record<string, unknown> | undefined;
}

function buildChartDisplayData(
  chart: ChartConfig,
  ci: number,
  data: DataEntry[],
  config: ColumnChartUIConfig,
): ChartDisplayData {
  const firstPayload = chart.series.reduce<SeriesPayload | null>((acc, _, i) => {
    if (acc) return acc;
    return getSeriesData(`charts[${ci}].series[${i}].unsPath`, data);
  }, null);

  const timeCategories = firstPayload ? firstPayload.slots.map((s) => s.label) : [];
  const firstSeriesUnit = chart.series.find((s) => s.unit && s.unit.trim())?.unit;
  const yAxisUnit = config.style.yAxisUnit || firstSeriesUnit || firstPayload?.meta?.unit || undefined;
  const axisBySeriesId = new Map<string, { name: string; yAxis: 0 | 1 }>();
  (chart.axes ?? []).forEach((axis) => {
    axis.seriesIds.forEach((seriesId) => {
      if (!axisBySeriesId.has(seriesId)) {
        axisBySeriesId.set(seriesId, { name: axis.name, yAxis: axis.yAxis });
      }
    });
  });

  const fixedValues = chart.fixedSeries.map((_, fi) => {
    const raw = getValue(`charts[${ci}].fixedSeries[${fi}].unsPath`, config, data);
    return typeof raw === 'number' ? raw : (raw !== null ? parseFloat(String(raw)) || null : null);
  });

  const activeFixed = chart.fixedSeries.filter((_, fi) => fixedValues[fi] !== null);
  const categories = [
    ...timeCategories,
    ...activeFixed.map((f, fi) => f.label || `Fixed ${fi + 1}`),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolvedSeries: { name: string; data: any[]; color?: string; yAxis?: number }[] =
    chart.series.map((s, i) => {
      const payload = getSeriesData(`charts[${ci}].series[${i}].unsPath`, data);
      const timeValues: (number | null)[] = payload
        ? payload.slots.map((slot) => slot.value ?? 0)
        : new Array(timeCategories.length).fill(null);
      return {
        name: s.label || `Series ${i + 1}`,
        data: [...timeValues, ...activeFixed.map(() => null)],
        ...(s.color ? { color: s.color } : {}),
        yAxis: axisBySeriesId.get(chart.series[i]._id)?.yAxis ?? s.yAxis ?? 0,
      };
    });

  const activeFixedValues = chart.fixedSeries.map((_, idx) => fixedValues[idx]).filter((v) => v !== null);
  activeFixed.forEach((f, fi) => {
    resolvedSeries.push({
      name: f.label || `Fixed ${fi + 1}`,
      data: [
        ...new Array(timeCategories.length).fill(null),
        ...activeFixed.map((_, j) => (j === fi ? (activeFixedValues[fi] ?? 0) : null)),
      ],
      ...(f.color ? { color: f.color } : {}),
      yAxis: axisBySeriesId.get(f._id)?.yAxis ?? f.yAxis ?? 0,
    });
  });

  const resolvedSeriesIds = [
    ...chart.series.map((s) => s._id),
    ...activeFixed.map((f) => f._id),
  ];

  function resolveNumeric(key: string, fallback: number | string): number | null {
    const raw = getValue(key, config, data) ?? fallback;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    return isNaN(n) ? null : n;
  }

  const plotLines = (chart.plotLines ?? [])
    .map((p, i) => {
      const v = resolveNumeric(`charts[${ci}].plotLines[${i}].value`, p.value);
      if (v === null) return null;
      return { value: v, label: p.label || undefined, color: p.color || undefined,
        ...(p.width !== undefined ? { width: p.width } : {}),
        // Default to a solid line so the rendered style matches the
        // configurator default ("Solid"). The SDK otherwise defaults to Dash.
        dashStyle: (p.dashStyle ?? 'Solid') as DashStyle,
        yAxis: (p.yAxis ?? 0) as 0 | 1 };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const plotBands = (chart.plotBands ?? [])
    .map((p, i) => {
      const from = resolveNumeric(`charts[${ci}].plotBands[${i}].from`, p.from);
      const to   = resolveNumeric(`charts[${ci}].plotBands[${i}].to`,   p.to);
      if (from === null || to === null || to <= from) return null;
      return { from, to, label: p.label || undefined, color: p.color || undefined, yAxis: (p.yAxis ?? 0) as 0 | 1 };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // Highcharts-native versions of the plot lines/bands, mirroring the
  // defaults the design-sdk ColumnChart applies to its own `plotLines`/
  // `plotBands` props. Needed because when we hand the SDK an explicit
  // `yAxis` array (multi-axis), Highcharts.merge replaces the SDK's yAxis
  // object — discarding the plot lines/bands it put there. So we inject
  // them directly onto the left-axis entry to survive the merge.
  const hcPlotLines = plotLines.map((p) => ({
    value: p.value,
    color: p.color ?? '#ef4444',
    width: p.width ?? 2,
    dashStyle: p.dashStyle ?? 'Solid',
    zIndex: 5,
    ...(p.label ? { label: { text: p.label, align: 'right', style: { color: p.color ?? '#ef4444' } } } : {}),
  }));
  const hcPlotBands = plotBands.map((p) => ({
    from: p.from,
    to: p.to,
    color: p.color ?? 'rgba(239,68,68,0.1)',
    zIndex: 0,
    ...(p.label ? { label: { text: p.label, align: 'right' } } : {}),
  }));

  // Auto-hide derives from "does this axis own any plotted series" — there is
  // no stored visible flag. Left owns ≥1 series → left visible; same for right.
  const leftHasSeries  = resolvedSeries.some((s) => (s.yAxis ?? 0) === 0);
  const hasRightAxis   = resolvedSeries.some((s) => s.yAxis === 1);
  // The Right axis entry is included when the chart has a Right axis configured
  // OR a resolved right-pinned series. Right-pinned plot lines/bands fold back
  // to the left when no Right axis exists (safety net for stale `yAxis: 1`).
  const rightAxisExists = hasRightAxis || (chart.axes ?? []).some((a) => a.yAxis === 1);
  const hasStacks    = (chart.stacks ?? []).some((st) => st.seriesIds.length > 1);
  const hasAxes      = (chart.axes ?? []).length > 0;
  const needsSeriesOverride = hasRightAxis || hasStacks || hasAxes;

  const leftAxisName = (chart.axes ?? []).find((axis) => axis.yAxis === 0)?.name?.trim();
  const rightAxisName = (chart.axes ?? []).find((axis) => axis.yAxis === 1)?.name?.trim();
  const advancedSettings = config.style.advancedSettings;
  const highchartsOptions: Record<string, unknown> = {};

  // Split plot lines/bands by their axis. hcPlotLines/hcPlotBands are 1:1 with
  // plotLines/plotBands, so indices align. Right-pinned items fold to left when
  // no Right axis exists.
  const onRight = (ax: 0 | 1 | undefined) => rightAxisExists && ax === 1;
  const leftHcPlotLines  = hcPlotLines.filter((_, i) => !onRight(plotLines[i].yAxis));
  const rightHcPlotLines = hcPlotLines.filter((_, i) => onRight(plotLines[i].yAxis));
  const leftHcPlotBands  = hcPlotBands.filter((_, i) => !onRight(plotBands[i].yAxis));
  const rightHcPlotBands = hcPlotBands.filter((_, i) => onRight(plotBands[i].yAxis));

  if (needsSeriesOverride) {
    const yAxisBase = hasRightAxis || hasAxes
      ? [
          {
            title: { text: leftAxisName || yAxisUnit || '' },
            visible: leftHasSeries,
            ...(leftHcPlotLines.length > 0 ? { plotLines: leftHcPlotLines } : {}),
            ...(leftHcPlotBands.length > 0 ? { plotBands: leftHcPlotBands } : {}),
          },
          ...(rightAxisExists ? [{
            title: { text: rightAxisName || '' },
            opposite: true,
            visible: hasRightAxis,
            ...(rightHcPlotLines.length > 0 ? { plotLines: rightHcPlotLines } : {}),
            ...(rightHcPlotBands.length > 0 ? { plotBands: rightHcPlotBands } : {}),
          }] : []),
        ]
      : undefined;

    if (yAxisBase) {
      highchartsOptions.yAxis = yAxisBase;
    }

    if (hasStacks) {
      highchartsOptions.plotOptions = { column: { stacking: 'normal' } };
    }

    highchartsOptions.series = resolvedSeries.map((s, idx) => {
      const originalId = resolvedSeriesIds[idx];
      const stack = (chart.stacks ?? []).find((st) => st.seriesIds.includes(originalId));
      return {
        type: 'column',
        name: s.name,
        data: s.data,
        ...(s.color ? { color: s.color } : {}),
        yAxis: s.yAxis ?? 0,
        ...(stack?.name ? { stack: stack.name } : {}),
      };
    });
  }

  if (advancedSettings?.enabled) {
    highchartsOptions.xAxis = {
      ...(highchartsOptions.xAxis as Record<string, unknown> | undefined),
      labels: {
        ...(chartColorFallback(advancedSettings.xAxisTextColor) ? { style: { color: chartColorFallback(advancedSettings.xAxisTextColor) } } : {}),
      },
      ...(chartColorFallback(advancedSettings.xAxisLineColor) ? { lineColor: chartColorFallback(advancedSettings.xAxisLineColor), tickColor: chartColorFallback(advancedSettings.xAxisLineColor) } : {}),
    };

    if (highchartsOptions.yAxis && Array.isArray(highchartsOptions.yAxis)) {
      highchartsOptions.yAxis = (highchartsOptions.yAxis as Array<Record<string, unknown>>).map((axis, index) => ({
        ...axis,
        labels: {
          ...(index === 0 && chartColorFallback(advancedSettings.yAxisTextColor) ? { style: { color: chartColorFallback(advancedSettings.yAxisTextColor) } } : {}),
          ...(index === 1 && chartColorFallback(advancedSettings.yAxisTextColor) ? { style: { color: chartColorFallback(advancedSettings.yAxisTextColor) } } : {}),
        },
        ...(chartColorFallback(advancedSettings.yAxisLineColor) ? { lineColor: chartColorFallback(advancedSettings.yAxisLineColor), tickColor: chartColorFallback(advancedSettings.yAxisLineColor) } : {}),
        ...(chartColorFallback(advancedSettings.gridLineColor) ? { gridLineColor: chartColorFallback(advancedSettings.gridLineColor) } : {}),
      }));
    } else {
      highchartsOptions.yAxis = {
        ...(highchartsOptions.yAxis as Record<string, unknown> | undefined),
        labels: {
          ...(chartColorFallback(advancedSettings.yAxisTextColor) ? { style: { color: chartColorFallback(advancedSettings.yAxisTextColor) } } : {}),
        },
        ...(chartColorFallback(advancedSettings.yAxisLineColor) ? { lineColor: chartColorFallback(advancedSettings.yAxisLineColor), tickColor: chartColorFallback(advancedSettings.yAxisLineColor) } : {}),
        ...(chartColorFallback(advancedSettings.gridLineColor) ? { gridLineColor: chartColorFallback(advancedSettings.gridLineColor) } : {}),
      };
    }

    highchartsOptions.legend = {
      itemStyle: {
        ...(chartColorFallback(advancedSettings.legendTextColor) ? { color: chartColorFallback(advancedSettings.legendTextColor) } : {}),
      },
      itemHoverStyle: {
        ...(chartColorFallback(advancedSettings.legendTextColor) ? { color: chartColorFallback(advancedSettings.legendTextColor) } : {}),
      },
    };
  }

  // Standalone advanced-styling fragment for the shift / comparison render
  // paths, which build their own series and DON'T receive the full
  // `highchartsOptions`. Mirrors the axis/grid/legend styling applied above so
  // the Style-tab advanced settings take effect in every chart mode, not just
  // normal mode. Uses a single yAxis object (shift/comparison are single-axis).
  let advancedChartOptions: Record<string, unknown> | undefined;
  if (advancedSettings?.enabled) {
    const xText = chartColorFallback(advancedSettings.xAxisTextColor);
    const xLine = chartColorFallback(advancedSettings.xAxisLineColor);
    const yText = chartColorFallback(advancedSettings.yAxisTextColor);
    const yLine = chartColorFallback(advancedSettings.yAxisLineColor);
    const grid  = chartColorFallback(advancedSettings.gridLineColor);
    const legend = chartColorFallback(advancedSettings.legendTextColor);
    const advXAxis: Record<string, unknown> = {
      ...(xText ? { labels: { style: { color: xText } } } : {}),
      ...(xLine ? { lineColor: xLine, tickColor: xLine } : {}),
    };
    const advYAxis: Record<string, unknown> = {
      ...(yText ? { labels: { style: { color: yText } } } : {}),
      ...(yLine ? { lineColor: yLine, tickColor: yLine } : {}),
      ...(grid  ? { gridLineColor: grid } : {}),
    };
    advancedChartOptions = {
      ...(Object.keys(advXAxis).length ? { xAxis: advXAxis } : {}),
      ...(Object.keys(advYAxis).length ? { yAxis: advYAxis } : {}),
      ...(legend ? { legend: { itemStyle: { color: legend }, itemHoverStyle: { color: legend } } } : {}),
    };
  }

  const slotByCategory = new Map<string, { from: number; to: number }>();
  if (firstPayload) {
    firstPayload.slots.forEach((slot) => {
      slotByCategory.set(slot.label, { from: slot.from, to: slot.to });
    });
  }

  const unitBySeriesName = new Map<string, string>();
  const precisionBySeriesName = new Map<string, number>();
  chart.series.forEach((s, i) => {
    const name = s.label || `Series ${i + 1}`;
    const payload = getSeriesData(`charts[${ci}].series[${i}].unsPath`, data);
    const unit = s.unit || payload?.meta?.unit || yAxisUnit || '';
    if (unit) unitBySeriesName.set(name, unit);
    if (s.precision !== undefined) precisionBySeriesName.set(name, s.precision);
  });

  function formatSeriesValue(value: unknown, seriesName: string): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return String(value ?? '');
    const precision = precisionBySeriesName.get(seriesName);
    if (precision !== undefined) return num.toFixed(precision);
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  }

  function formatTooltipDate(ts: number): string {
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} ${hours}:${mins}`;
  }

  // All chart text (axis labels, axis titles, legend, data labels, tooltip)
  // pulls font-size / color from SDK CSS custom properties so the chart stays
  // in sync with the design system. The SDK ColumnChart already uses these
  // tokens by default for axis / legend; we only need to thread them through
  // our custom data-label and tooltip formatters.
  const theme = resolveChartTheme();

  // Anchor the chart's em-relative font scale at 16px so Highcharts' default
  // multipliers land on familiar pixel values:
  //   axis labels = 0.8em → 12.8px
  //   axis titles ≈ 1em   → 16px
  //   legend     = 0.8em  → 12.8px  (SVG); HTML legend stays 12px via the
  //                                  SDK's BodySmallRegular class)
  //   data labels ≈ 0.7em → 11.2px (then overridden below for column inside-bar)
  highchartsOptions.chart = {
    ...(highchartsOptions.chart as Record<string, unknown> | undefined),
    // X-axis drag-to-zoom is always enabled. Highcharts auto-renders the
    // "Reset zoom" button when a zoom is active.
    zoomType: 'x',
    panKey: 'shift',
    // When the user has the card wrap turned OFF, drop the SDK theme's
    // default white chart background so the chart shows through the host
    // page color instead of a floating white rectangle.
    ...(config.style.card?.wrapInCard !== false ? {} : { backgroundColor: 'transparent' }),
    style: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(((highchartsOptions.chart as any)?.style as Record<string, unknown> | undefined) ?? {}),
      fontSize: '16px',
    },
  };

  const existingPlotOptions = (highchartsOptions.plotOptions as Record<string, Record<string, unknown> | undefined> | undefined) ?? {};
  highchartsOptions.plotOptions = {
    ...existingPlotOptions,
    column: {
      ...(existingPlotOptions.column ?? {}),
      // Per-segment hover: turn off Highcharts' default sticky tracking so
      // moving the cursor between stacked sub-columns swaps the tooltip to
      // the segment under the pointer instead of staying glued to the first
      // one tracked. Without this, only the top segment of a stack is
      // hoverable and the lower segments never trigger their own tooltip.
      stickyTracking: false,
      dataLabels: {
        rotation: -90,
        inside: true,
        align: 'center',
        verticalAlign: 'top',
        y: 8,
        crop: false,
        overflow: 'allow',
        style: {
          // Match the axis label size (0.8em of the 16px chart base) so the
          // data label and axis ticks read at the same visual weight.
          fontSize:    '12.8px',
          fontWeight:  theme.fontWeightBold,
          color:       theme.textOnSeries,
          textOutline: '1px contrast',
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: function (this: any) {
          // Suppress the label entirely when the value is zero (or null) so
          // empty columns aren't visually noisy with a "0" overlay.
          if (this.y == null || this.y === 0) return '';
          return formatSeriesValue(this.y, this.series?.name);
        },
      },
    },
  };

  // Tooltip chrome (bg / border / radius / font / color) is fully covered by
  // the SDK's Highcharts theme — we only override `shared` + `formatter`.
  // Per-block tooltip: each stacked segment shows its own tooltip on hover
  // (one segment = one series = one row). Pair this with
  // `plotOptions.column.stickyTracking: false` above, otherwise the bottom
  // stack segment never triggers and the top one keeps the tooltip.
  highchartsOptions.tooltip = {
    shared: false,
    useHTML: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formatter: function (this: any) {
      const p = this.point;
      if (!p || p.y == null || p.y === 0) return false;

      const seriesName: string = p.series.name;
      const color: string = p.color || p.series.color || theme.textTertiary;
      const valueStr = formatSeriesValue(p.y, seriesName);
      const unit = unitBySeriesName.get(seriesName) || '';
      const row =
        `<div class="BodySmallRegular" style="display:flex;align-items:center;gap:6px;">` +
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>` +
          `<span style="color:${theme.textSecondary};">${seriesName} :</span>` +
          `<span class="BodySmallSemibold" style="color:${theme.textPrimary};">${valueStr}${unit ? ` ${unit}` : ''}</span>` +
        `</div>`;

      const category = String(p.category ?? '');
      const slot = slotByCategory.get(category);
      const dateRow = slot
        ? `<div class="BodySmallRegular" style="color:${theme.textTertiary};margin-top:4px;">${formatTooltipDate(slot.from)} - ${formatTooltipDate(slot.to)}</div>`
        : '';

      return `<div>${row}${dateRow}</div>`;
    },
  };

  return { resolvedSeries, resolvedSeriesIds, categories, plotLines, plotBands, yAxisUnit, firstPayload, highchartsOptions, advancedChartOptions };
}

// ── Mode payload helpers (mirror the LineChart widget) ──────────────────────────
// The widget never fetches: it only appends these fields to the TIME_CHANGE it
// emits, and the host's data layer forwards them to a single resolveAndCompute
// call. The mode then RENDERS off whatever comes back on the `data` prop.

// Previous-period window for Comparison mode: same duration as the current
// window, shifted back so it ENDS exactly where the current window STARTS.
// Returned as the TIME_CHANGE fields the data layer forwards to resolveAndCompute.
function comparisonWindowPayload(
  startMs: number,
  endMs: number,
): { comparisonStartTime: string; comparisonEndTime: string } {
  const dur = endMs - startMs;
  return { comparisonStartTime: String(startMs - dur), comparisonEndTime: String(startMs) };
}

// Map the configurator's Shift Aggregator label (Sum/Average/Min/Max/First/Last)
// to the backend operator vocabulary used by resolveAndCompute's aggregation
// (`mean` for Average; the rest pass through lowercased).
const SHIFT_AGGREGATOR_OPERATOR: Record<string, string> = {
  sum: 'sum',
  average: 'mean',
  mean: 'mean',
  min: 'min',
  max: 'max',
  first: 'first',
  last: 'last',
};
function shiftAggregatorOperator(label?: string): string | undefined {
  if (!label) return undefined;
  return SHIFT_AGGREGATOR_OPERATOR[label.toLowerCase()] ?? label.toLowerCase();
}

// Shift fields for a TIME_CHANGE payload — the configured shift windows plus the
// resolved aggregator operator. The data layer forwards these to
// resolveAndCompute so the backend buckets each series into the shift windows and
// tags each returned slot with its shift name. Returns {} when there are no
// shifts (nothing to send).
function shiftEventPayload(
  shifts: TimeConfig['shifts'],
  aggregator?: string,
): { shifts?: TimeConfig['shifts']; shiftAggregator?: string } {
  if (!shifts || !shifts.length) return {};
  return { shifts, shiftAggregator: shiftAggregatorOperator(aggregator) };
}

// ── Shift time-window fallback ──────────────────────────────────────────────────
// The backend tags each bucket with its shift NAME (slot.shift). These helpers
// are the FALLBACK used only when a bucket carries no tag (older backend): they
// derive the shift from the slot's time-of-day against the configured window.

// Return the time-of-day in minutes (0–1439) for a Unix ms timestamp, respecting
// the configured timezone when provided (falls back to browser-local).
function slotMinutesOfDay(timestampMs: number, timezone?: string): number {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
      }).formatToParts(new Date(timestampMs));
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      return h * 60 + m;
    } catch { /* fall through to local */ }
  }
  const d = new Date(timestampMs);
  return d.getHours() * 60 + d.getMinutes();
}

// True if the slot's time-of-day falls inside the shift window. Handles night
// shifts that cross midnight (startTime > endTime).
function isSlotInShift(
  timestampMs: number,
  startTime: string,
  endTime: string,
  timezone?: string,
): boolean {
  const slotMin = slotMinutesOfDay(timestampMs, timezone);
  const [sh, sm = 0] = startTime.split(':').map(Number);
  const [eh, em = 0] = endTime.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s < e ? slotMin >= s && slotMin < e : slotMin >= s || slotMin < e;
}

// ── Time-config → date-picker mapping ──────────────────────────────────────────

interface InitialTime {
  range: DateRange;
  presetId: string;
  presetLabel: string;
}

// Derive the date-picker range + label from the widget's time config so the
// configured default duration is reflected on load. Mirrors the mini-engine's
// computeWindow so the picker matches the data window that gets fetched.
function initialTimeFromConfig(timeConfig?: TimeConfig): InitialTime {
  const fallback = (): InitialTime => {
    const r = getPresetDateRange('previous_7_days');
    return {
      range: r ?? { start: new Date(Date.now() - 7 * 86_400_000), end: new Date() },
      presetId: 'previous_7_days',
      presetLabel: 'Past 7 days',
    };
  };
  if (!timeConfig) return fallback();
  // Fixed picker: resolve its single "set duration" (x/xEvent/xPeriod + y…).
  if (timeConfig.pickerType === 'fixed' && timeConfig.fixedDuration) {
    const { startTime, endTime } = resolveDurationWindow(timeConfig.fixedDuration, Date.now(), timeConfig.cycleTime);
    return {
      range: { start: new Date(startTime), end: new Date(endTime) },
      presetId: timeConfig.fixedDuration.id,
      presetLabel: timeConfig.fixedDuration.label || 'Fixed',
    };
  }
  // Legacy absolute fixed window.
  if (timeConfig.type === 'fixed' && timeConfig.startTime && timeConfig.endTime) {
    return {
      range: { start: new Date(timeConfig.startTime), end: new Date(timeConfig.endTime) },
      presetId: 'custom',
      presetLabel: 'Fixed range',
    };
  }
  const dur = timeConfig.allDurations?.find((d) => d.id === timeConfig.defaultDurationId);
  if (!dur) return fallback();
  const { startTime, endTime } = resolveDurationWindow(dur, Date.now(), timeConfig.cycleTime);
  return {
    range: { start: new Date(startTime), end: new Date(endTime) },
    presetId: dur.id,
    presetLabel: dur.label || dur.id,
  };
}

// Labels for the design-sdk DatePicker's built-in presets (mirrors its
// internal label map) so the duration text stays readable when the user
// picks a preset from the date picker itself.
const DATEPICKER_PRESET_LABELS: Record<string, string> = {
  custom: 'Custom',
  today: 'Today',
  yesterday: 'Yesterday',
  current_week: 'Current Week',
  previous_7_days: 'Past 7 days',
  current_month: 'Current Month',
  previous_month: 'Previous Month',
  previous_3_month: 'Previous 3 Month',
  previous_12_month: 'Previous 12 Month',
  current_year: 'Current Year',
  previous_year: 'Previous Year',
};

// The SDK DatePicker picks its preset list as `presets ?? DEFAULT_PRESETS` — a
// fallback, not a merge — so passing our configured durations would hide all
// built-ins. `DEFAULT_PRESETS` isn't re-exported, so we mirror the built-in
// ids/labels here and merge them with the configured durations ourselves. The
// window for each built-in still comes from the SDK's `getPresetDateRange`.
const BUILTIN_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'today',             label: 'Today' },
  { id: 'yesterday',         label: 'Yesterday' },
  { id: 'current_week',      label: 'Current Week' },
  { id: 'previous_7_days',   label: 'Past 7 days' },
  { id: 'current_month',     label: 'Current Month' },
  { id: 'previous_month',    label: 'Previous Month' },
  { id: 'previous_3_month',  label: 'Previous 3 Month' },
  { id: 'previous_12_month', label: 'Previous 12 Month' },
  { id: 'current_year',      label: 'Current Year' },
  { id: 'previous_year',     label: 'Previous Year' },
];

function periodicityFromConfig(timeConfig?: TimeConfig): Periodicity {
  switch (timeConfig?.defaultPeriodicity) {
    case 'minute':
    case 'hourly':  return 'Hourly';
    case 'weekly':  return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'daily':   return 'Daily';
    default:        return 'Daily';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ColumnChart({ config = EMPTY_UI_CONFIG, data = [], onEvent, timeConfig }: ColumnChartProps) {
  // eslint-disable-next-line no-console
  console.log('[ColumnChart] props received', { config, data, timeConfig });
  const chartRef = useRef<unknown>(null);
  // Guard: selecting a preset in the SDK DatePicker also fires onRangeChange;
  // this prevents that from clearing the preset / re-emitting (matches GTP).
  const presetSelectingRef = useRef(false);
  // True only when a range change came from a user action (picking a range or a
  // preset in the DatePicker). The periodicity-snap effect emits ONLY in that
  // case — never on first render / programmatic timeConfig sync (host owns the
  // initial resolve).
  const userRangeChangeRef = useRef(false);
  // False until the widget has finished its first commit. The SDK DatePicker
  // echoes its callbacks (onRangeChange / onPresetSelect / onComparisonRange)
  // during mount; this gate ensures TIME_CHANGE never fires on the initial
  // render — the host owns the initial data resolve.
  const didMountRef = useRef(false);
  // Controlled DatePicker popover state — needed so we can sync the draft Shift /
  // Compare toggles from their committed values every time the picker opens.
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [preset, setPreset] = useState(() => initialTimeFromConfig(timeConfig).presetId);
  const [presetLabel, setPresetLabel] = useState(() => initialTimeFromConfig(timeConfig).presetLabel);
  const [range, setRange] = useState<DateRange>(() => initialTimeFromConfig(timeConfig).range);

  // Periodicity options derive from the active duration (its configured
  // periodicities), like GlobalTimePicker — not from the range length.
  const selectedDuration =
    timeConfig?.allDurations?.find((d) => d.id === preset) ??
    (timeConfig?.pickerType === 'fixed' ? timeConfig.fixedDuration : undefined);
  // Ordered coarse→fine (Monthly, Weekly, Daily, Hourly) so the highest-order
  // option is always first — used as the default and the dropdown order.
  const availablePeriodicities = [...durationPeriodicities(selectedDuration, range)]
    .sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  // Local picker defaults to the highest-order available periodicity (e.g. Daily
  // when [Daily, Hourly] are offered); fixed/global stay config-driven.
  const [basePeriodicity, setBasePeriodicity] = useState<Periodicity>(() =>
    (timeConfig?.pickerType ?? 'local') === 'local'
      ? (availablePeriodicities[0] ?? periodicityFromConfig(timeConfig))
      : periodicityFromConfig(timeConfig),
  );
  // ── Shift / Compare mode (DatePicker toggles, driven by DATA not the toggle) ──
  // The golden rule: the toggle only decides whether the widget REQUESTS the
  // extra data via TIME_CHANGE. Once that data lands on `data`, the mode RENDERS
  // regardless of the current toggle state (see hasShiftData / hasComparisonData
  // / chartMode below). Shift and Compare are mutually exclusive.
  const cfgShifts = timeConfig?.shifts ?? [];
  const cfgShiftAggregator = timeConfig?.shiftAggregator;
  const cfgShiftKey = cfgShifts.map((s) => s.id).join('|');
  const cfgComparisonMode = Boolean(timeConfig?.comparisonMode);
  const deviationPattern  = (timeConfig?.deviationPattern ?? 'green-up-positive') as DeviationPattern;
  const perSourceOverrides = timeConfig?.allowPerSourceIndicator ? timeConfig?.sourceDeviationOverrides : undefined;

  // Committed (applied) vs draft (in-picker) toggle state. Draft is synced from
  // committed every time the picker opens; committed is set on Apply
  // (commitToggles, fired from the DatePicker's onRangeChange).
  const [shiftToggleOn, setShiftToggleOn] = useState(false);
  const [draftShiftOn, setDraftShiftOn] = useState(false);
  const [comparisonToggleOn, setComparisonToggleOn] = useState(false);
  const [draftComparisonOn, setDraftComparisonOn] = useState(false);
  // Which shift chips are toggled on in the chart legend — all enabled by
  // default; reset to all-on whenever the configured shift list changes.
  const [enabledShiftIds, setEnabledShiftIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setEnabledShiftIds(new Set(cfgShifts.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgShiftKey]);
  // Turning a mode off in config force-clears its toggles so a stale "on" can't
  // keep requesting data the config no longer supports.
  useEffect(() => {
    if (!cfgComparisonMode) { setComparisonToggleOn(false); setDraftComparisonOn(false); }
  }, [cfgComparisonMode]);
  useEffect(() => {
    if (cfgShifts.length === 0) { setShiftToggleOn(false); setDraftShiftOn(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgShiftKey]);

  // Shift and comparison are mutually exclusive — activating one clears the other.
  const draftActivateShift = (on: boolean) => {
    setDraftShiftOn(on);
    if (on) setDraftComparisonOn(false);
  };
  const draftActivateComparison = (on: boolean) => {
    setDraftComparisonOn(on);
    if (on) setDraftShiftOn(false);
  };
  const commitToggles = () => {
    setShiftToggleOn(draftShiftOn);
    setComparisonToggleOn(draftComparisonOn);
  };
  const syncDraftFromCommitted = () => {
    setDraftShiftOn(shiftToggleOn);
    setDraftComparisonOn(comparisonToggleOn);
  };

  // Latest committed mode flags for the TIME_CHANGE emitters that fire from
  // effects/callbacks whose dependency lists don't track them (mount snap,
  // preset, periodicity, drilldown). onRangeChange builds its fields inline from
  // the just-committed draft values instead (refs haven't re-rendered yet).
  const comparisonActiveRef = useRef(false);
  comparisonActiveRef.current = cfgComparisonMode && comparisonToggleOn;
  const shiftActiveRef = useRef(false);
  shiftActiveRef.current = shiftToggleOn && cfgShifts.length > 0;

  // Extra TIME_CHANGE fields for the currently committed mode (at most one —
  // shift and comparison are mutually exclusive).
  const modeEventFields = (startMs: number, endMs: number) =>
    shiftActiveRef.current
      ? shiftEventPayload(cfgShifts, cfgShiftAggregator)
      : comparisonActiveRef.current
        ? comparisonWindowPayload(startMs, endMs)
        : {};

  // ── Mode detection — DRIVEN BY DATA, not by the toggle ──────────────────────
  // Comparison wins if both are somehow present (they're exclusive by
  // construction). hasComparisonData: any series payload carries comparisonSlots
  // with a numeric value. hasShiftData: any series slot carries a non-empty
  // string `shift` tag (the backend tags each bucket with its shift NAME).
  const hasComparisonData = data.some(
    (d) => Array.isArray(d.comparisonSlots) && d.comparisonSlots.some((sl) => typeof sl?.value === 'number'),
  );
  const hasShiftData = data.some(
    (d) => Array.isArray(d.slots) && d.slots.some((sl) => typeof sl?.shift === 'string' && sl.shift.length > 0),
  );
  const chartMode: 'normal' | 'comparison' | 'shift' =
    hasComparisonData ? 'comparison' : hasShiftData ? 'shift' : 'normal';

  const [periodicityOpen, setPeriodicityOpen] = useState(false);
  const [drillPath, setDrillPath] = useState<DrillEntry[]>([]);

  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number } | null>(null);
  const exportBtnRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPos, setExportPos] = useState<{ top: number; left: number } | null>(null);

  const [timeDrillDown,   setTimeDrillDown]   = useState(true);
  const [showLegend,      setShowLegend]      = useState(config.style.showLegend);
  const [showDataLabels,  setShowDataLabels]  = useState(config.style.showDataLabels);
  const [clipping,        setClipping]        = useState(false);
  // Zoom is permanently on — there's no UI to toggle it. Kept as a const so
  // any code reading `zoomable` keeps working; the SDK ColumnChart silently
  // ignores this prop, so the actual zoom enablement happens in
  // `highchartsOptions.chart.zoomType = 'x'` (see buildChartDisplayData).
  const zoomable = true;
  const [scrollable,      setScrollable]      = useState(false);
  const [inexactMultiple, setInexactMultiple] = useState(false);
  const widgetElements = config.style.widgetElements ?? {
    hideWidgetElements: false,
    hideSettingsIcon: false,
    hideExportIcon: false,
    hideChartTitle: false,
  };
  const advancedSettings = config.style.advancedSettings;
  // Card wrap — when enabled in the configurator, render the widget shell as
  // a card with the user-configured background / border-color / border-width
  // / border-radius. When disabled, the shell renders edge-to-edge with no
  // background or border (default behavior).
  const card = config.style.card;
  // Wrap-in-card defaults to ON — only an explicit `false` turns it off.
  // Anything else (undefined / not set in legacy envelopes) keeps the card.
  const cardEnabled = card?.wrapInCard !== false;
  const cardStyle: CSSProperties = cardEnabled ? {
    background: card.backgroundColor ?? '#FFFFFF',
    borderStyle: 'solid',
    borderColor:  card.borderColor    ?? '#FFFFFF',
    borderWidth:  `${card.borderWidth  ?? 1}px`,
    borderRadius: `${card.borderRadius ?? 4}px`,
    boxSizing: 'border-box',
  } : {};
  const widgetTitleStyle: CSSProperties = {
    ...(advancedSettings?.enabled
      ? {
          '--cc-widget-title-font-size': `${advancedSettings.titleFontSize ?? 20}px`,
          '--cc-widget-title-color': advancedSettings.titleFontColor ?? 'var(--text-default-primary, #1a1a1a)',
          '--cc-widget-title-weight': String(fontWeightToCss(advancedSettings.titleFontWeight ?? 'Semi-Bold')),
          // The design-sdk renders its own HTML legend (.fds-chart-legend__label)
          // instead of the native Highcharts SVG legend, so highchartsOptions.
          // legend.itemStyle never reaches it. Drive the legend text color via a
          // CSS var + scoped override (see ColumnChart.css) — same pattern as the
          // chart title above.
          ...(chartColorFallback(advancedSettings.legendTextColor)
            ? { '--cc-widget-legend-color': chartColorFallback(advancedSettings.legendTextColor) }
            : {}),
        } as CSSProperties
      : {}),
    ...cardStyle,
  };

  // Debug: log the `data` prop the widget receives from the engine each time it changes.
  useEffect(() => {
    console.log('[ColumnChart] data prop:', data);
  }, [data]);

  // Open the emit gate only after the first commit — as a parent effect this
  // runs after the DatePicker's mount callbacks, so their initial echoes are
  // suppressed. Cleanup keeps it correct under StrictMode's double-invoke.
  useEffect(() => {
    didMountRef.current = true;
    return () => { didMountRef.current = false; };
  }, []);

  useEffect(() => {
    setShowLegend(config.style.showLegend);
    setShowDataLabels(config.style.showDataLabels);
  }, [config.style.showLegend, config.style.showDataLabels]);

  // Re-sync the date picker from timeConfig — keeps the widget's internal
  // picker state aligned with externally configured defaults. Never emits:
  // TIME_CHANGE fires only from explicit user interaction (range pick,
  // periodicity change, drill-down, etc.). The host owns the initial resolve.
  useEffect(() => {
    const init = initialTimeFromConfig(timeConfig);
    // Local picker defaults to the highest-order available periodicity for the
    // resolved duration/range (e.g. Daily when [Daily, Hourly] are offered);
    // fixed/global stay config-driven.
    const isLocal = (timeConfig?.pickerType ?? 'local') === 'local';
    const dur =
      timeConfig?.allDurations?.find((d) => d.id === init.presetId) ??
      (timeConfig?.pickerType === 'fixed' ? timeConfig.fixedDuration : undefined);
    const periods = [...durationPeriodicities(dur, init.range)].sort(
      (a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b),
    );
    const periodicity = isLocal
      ? periods[0] ?? periodicityFromConfig(timeConfig)
      : periodicityFromConfig(timeConfig);
    setRange(init.range);
    setPreset(init.presetId);
    setPresetLabel(init.presetLabel);
    setBasePeriodicity(periodicity);
    setDrillPath([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timeConfig?.defaultDurationId,
    timeConfig?.type,
    timeConfig?.pickerType,
    timeConfig?.startTime,
    timeConfig?.endTime,
    timeConfig?.defaultPeriodicity,
    JSON.stringify(timeConfig?.fixedDuration ?? null),
    JSON.stringify(timeConfig?.cycleTime ?? null),
    // Editing a duration (same id, new length/periodicity) must re-resolve the
    // local picker range — without this the picker wouldn't move on edit.
    JSON.stringify(timeConfig?.allDurations ?? []),
  ]);

  useEffect(() => {
    // Consume the user-driven flag once per range change: a programmatic sync
    // (first render / timeConfig arrival) leaves it false, so no emit fires.
    const userDriven = userRangeChangeRef.current;
    userRangeChangeRef.current = false;
    // Periodicity in fixed/global is config-driven — don't clobber it. Only the
    // local picker snaps to the DEFAULT (highest-order available) periodicity
    // when the current one isn't valid for the new range.
    if ((timeConfig?.pickerType ?? 'local') !== 'local') return;
    if (!availablePeriodicities.includes(basePeriodicity)) {
      const next = availablePeriodicities[0];
      if (next) {
        setBasePeriodicity(next);
        // Re-emit so data refetches — but only for a user-driven range change,
        // never on first render / programmatic sync.
        if (userDriven) {
          emitTimeChange(range.start.getTime(), range.end.getTime(), next.toLowerCase());
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      // Ignore clicks on the trigger AND inside the portaled menu — otherwise
      // mousedown closes/unmounts the menu before the item's click toggles.
      if (settingsBtnRef.current?.contains(target)) return;
      if (settingsMenuRef.current?.contains(target)) return;
      setSettingsOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [settingsOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (exportBtnRef.current?.contains(target)) return;
      if (exportMenuRef.current?.contains(target)) return;
      setExportOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [exportOpen]);

  // ── Empty / loading states ────────────────────────────────────────────────

  const hasAnyCharts  = (config.charts ?? []).length > 0;
  // "Has any data source" = either a regular series OR a fixed series. Both
  // ride the same UNS binding flow and both render bars on the chart, so a
  // chart with only fixed series is still a fully-configured chart.
  const hasAnySeries  = (config.charts ?? []).some(
    (c) => c.series.length > 0 || c.fixedSeries.length > 0,
  );

  // Pre-configuration: no chart has been created yet via the chart-settings
  // section. Render a clean, header-less EmptyState — no ChartSwitcher, no
  // Info/Settings/More icons. Once the user creates their first chart via the
  // configurator, this fallback disappears and the standard chrome takes over.
  if (!hasAnyCharts) {
    return (
      <div className="cc-widget cc-widget--empty">
        <EmptyState
          illustration={<NoDataOneIllustration />}
          title="No chart configured"
          description="Add a chart from the configurator's Chart Settings section to get started."
        />
      </div>
    );
  }

  // Skeleton only when at least one chart has series — otherwise the empty
  // state is the canonical render for "no data source yet".
  if (hasAnySeries && data.length === 0) {
    return (
      <div className="cc-widget cc-widget--loading">
        <div className="cc-widget__skeleton" />
      </div>
    );
  }

  // ── Shared time helpers ───────────────────────────────────────────────────

  const baseIdx            = LEVEL_ORDER.indexOf(basePeriodicity);
  const effectiveIdx       = Math.min(baseIdx + drillPath.length, LEVEL_ORDER.length - 1);
  const effectivePeriodicity: Periodicity = LEVEL_ORDER[effectiveIdx];

  // Every emit site funnels through here. `modeEventFields(startTime, endTime)`
  // appends the current committed mode's extra fields (shift OR comparison OR
  // none) — so shift/compare requests ride along automatically from mount snap,
  // preset select, periodicity change, and drilldown. onRangeChange commits the
  // toggles synchronously, so it passes its own draft-derived fields as
  // `modeFieldsOverride` (the refs haven't re-rendered yet at that point).
  function emitTimeChange(
    startTime: number,
    endTime: number,
    periodicity: string,
    modeFieldsOverride?: Record<string, unknown>,
  ) {
    // Never emit during the initial mount — SDK callbacks echo on first render,
    // and the host owns the initial resolve. Only real post-mount user actions
    // reach onEvent.
    if (!didMountRef.current) return;
    const modeFields = modeFieldsOverride ?? modeEventFields(startTime, endTime);
    const payload = {
      startTime: String(startTime),
      endTime:   String(endTime),
      periodicity,
      ...modeFields,
    };
    // eslint-disable-next-line no-console
    console.log('[ColumnChart] emitting TIME_CHANGE', payload);
    onEvent({ type: 'TIME_CHANGE', payload });
  }

  function handleRangeChange(r: DateRange | null) {
    // A preset selection fires onRangeChange too — handlePresetSelect already
    // applied the window, so skip (don't clobber the preset label / re-emit).
    if (presetSelectingRef.current) {
      presetSelectingRef.current = false;
      return;
    }
    if (!r) return;
    // The DatePicker echoes onRangeChange with our own controlled `rangeValue`
    // on mount and whenever we set it programmatically. A pure echo is one where
    // BOTH the window and the draft toggles are unchanged — ignore only those, so
    // that a toggle-only Apply (same window, Shift/Compare flipped) still emits.
    const rangeUnchanged =
      r.start.getTime() === range.start.getTime() && r.end.getTime() === range.end.getTime();
    const togglesUnchanged =
      draftShiftOn === shiftToggleOn && draftComparisonOn === comparisonToggleOn;
    if (rangeUnchanged && togglesUnchanged) return;
    // Apply the draft Shift / Compare toggles.
    commitToggles();
    userRangeChangeRef.current = true;   // allow the snap effect to emit
    setRange(r);
    setDrillPath([]);
    // Build the mode fields from the JUST-committed draft values — the committed
    // refs won't reflect commitToggles() until the next render.
    const s = r.start.getTime();
    const e = r.end.getTime();
    const shiftActive = draftShiftOn && cfgShifts.length > 0;
    const compActive  = cfgComparisonMode && draftComparisonOn;
    const modeFields = shiftActive
      ? shiftEventPayload(cfgShifts, cfgShiftAggregator)
      : compActive
        ? comparisonWindowPayload(s, e)
        : {};
    emitTimeChange(s, e, basePeriodicity.toLowerCase(), modeFields);
    // `preset` / `presetLabel` are owned ONLY by onPresetSelect — the SDK fires
    // onPresetSelect('custom') itself for a manual range/day pick. Touching them
    // here made a named built-in preset's chip fall back to "Custom" (the SDK
    // echoes onRangeChange after applying a preset).
  }

  // Preset list = the configured durations FIRST, then every built-in not
  // already present. Always passed to the picker (no length gate) so the SDK's
  // built-ins stay visible alongside the user's durations.
  const durationPresets = (timeConfig?.allDurations ?? []).map((d) => ({
    label: d.label || d.id,
    value: d.id,
  }));
  const builtinPresetOptions = BUILTIN_PRESETS
    .filter((b) => !durationPresets.some((d) => d.value === b.id))
    .map((b) => ({ label: b.label, value: b.id }));
  const presetOptions = [...durationPresets, ...builtinPresetOptions];

  // Selecting a configured duration: the date picker can't resolve a custom
  // duration id itself (its getPresetDateRange only knows built-ins), so we
  // compute the window here and drive the range/emit ourselves.
  function handlePresetSelect(durationId: string) {
    const dur = (timeConfig?.allDurations ?? []).find((d) => d.id === durationId);
    if (!dur) {
      setPreset(durationId);
      setPresetLabel(DATEPICKER_PRESET_LABELS[durationId] ?? durationId.replace(/_/g, ' '));
      return;
    }
    // Respect the configured cycle time when snapping the duration's window.
    const { startTime, endTime } = resolveDurationWindow(dur, Date.now(), timeConfig?.cycleTime);
    presetSelectingRef.current = true;   // block the simultaneous onRangeChange
    userRangeChangeRef.current = true;   // allow the snap effect to emit
    setRange({ start: new Date(startTime), end: new Date(endTime) });
    setPreset(dur.id);
    setPresetLabel(dur.label || dur.id);
    setDrillPath([]);
    emitTimeChange(startTime, endTime, basePeriodicity.toLowerCase());
  }

  function handlePeriodicityChange(p: Periodicity) {
    setBasePeriodicity(p);
    setPeriodicityOpen(false);
    setDrillPath([]);
    emitTimeChange(range.start.getTime(), range.end.getTime(), p.toLowerCase());
  }

  function handleDrillReset() {
    setDrillPath([]);
    emitTimeChange(range.start.getTime(), range.end.getTime(), basePeriodicity.toLowerCase());
  }

  function handleDrillUp(index: number) {
    const newPath = drillPath.slice(0, index + 1);
    setDrillPath(newPath);
    const crumb = drillPath[index];
    emitTimeChange(crumb.startTime, crumb.endTime, basePeriodicity.toLowerCase());
  }

  function openSettingsDropdown() {
    if (settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setSettingsPos({ top: rect.bottom + 4, left: rect.left });
    }
    setSettingsOpen((v) => !v);
  }

  function openExportDropdown() {
    if (exportBtnRef.current) {
      const rect = exportBtnRef.current.getBoundingClientRect();
      setExportPos({ top: rect.bottom + 4, left: rect.left });
    }
    setExportOpen((v) => !v);
  }

  function handleExport(format: ChartExportFormat) {
    exportChart({
      instance: chartRef.current,
      engine: 'highcharts',
      format,
      fileName: (resolvedTitle || 'chart').replace(/\s+/g, '_').toLowerCase(),
    });
    setExportOpen(false);
  }

  // ── Build one ChartSwitcher item per chart ────────────────────────────────

  const items = (config.charts ?? []).map((chart, ci) => {
    const tabLabel = chart.title || `Chart ${ci + 1}`;
    // Chart has no data source yet (neither regular nor fixed) → render the
    // SDK EmptyState as the chart body so the surrounding header (title +
    // icon container) still appears.
    if (chart.series.length === 0 && chart.fixedSeries.length === 0) {
      return {
        id: chart._id || `chart-${ci}`,
        label: tabLabel,
        type: 'column' as const,
        children: (
          <div className="cc-widget__empty-body">
            <EmptyState
              illustration={<AddWidgetIllustration />}
              title="No data source configured"
              description="Add a data source from the configurator to populate this chart."
            />
          </div>
        ),
      };
    }

    const displayData = buildChartDisplayData(chart, ci, data, config);
    const { resolvedSeries, categories, plotLines, plotBands, yAxisUnit, firstPayload, highchartsOptions, advancedChartOptions } = displayData;

    function handlePointClick(ctx: { category: string }) {
      if (!timeDrillDown || !firstPayload) return;
      if (effectiveIdx >= LEVEL_ORDER.length - 1) return;
      const slot = firstPayload.slots.find((s) => s.label === ctx.category);
      if (!slot) return;
      setDrillPath((prev) => [...prev, { label: ctx.category, startTime: slot.from, endTime: slot.to }]);
      emitTimeChange(slot.from, slot.to, nextFinerPeriodicity(effectivePeriodicity).toLowerCase());
    }

    const sharedChartProps: Record<string, unknown> = {
      categories,
      series: resolvedSeries,
      showLegend,
      showDataLabels,
      yAxisUnit,
      // Auto-stack when the user has configured any Stack for this chart, OR
      // when the explicit style flag is on (kept for legacy envelopes).
      stacked: (chart.stacks ?? []).length > 0 || config.style.stacked,
      zoomable,
      scrollable,
      ...(plotLines.length > 0 ? { plotLines } : {}),
      ...(plotBands.length > 0 ? { plotBands } : {}),
      onChartReady: (instance: unknown) => { chartRef.current = instance; },
      onPointClick: timeDrillDown ? handlePointClick : undefined,
      highchartsOptions,
    };

    // ── Comparison mode (DRIVEN BY DATA) ────────────────────────────────────────
    // Rendered whenever the resolved series carry comparisonSlots (chartMode ===
    // 'comparison') — independent of the current Compare toggle. Per source we
    // emit TWO ComparisonSeriesInput entries: the current-period columns (solid,
    // in legend) and the previous-period columns (patterned, out of legend)
    // carrying the per-bucket deviation % = round(((cur-prev)/|prev|)*1000)/10
    // (null when prev is 0/null). comparisonSlots is index-aligned to the current
    // window's buckets (comparisonSlots[k] pairs with slots[k]). The SDK column
    // encoder colors both periods by the source color and distinguishes them by
    // fill pattern (patternIndex 0 = current / 1 = comparison). Per-source
    // deviation polarity overrides apply only when allowPerSourceIndicator is on.
    if (chartMode === 'comparison') {
      const curPayloads = chart.series.map((_, i) => getSeriesData(`charts[${ci}].series[${i}].unsPath`, data));
      const comparisonCategories =
        chart.series
          .map((_, i) => getComparisonSeriesData(`charts[${ci}].series[${i}].unsPath`, data))
          .find(Boolean)?.slots.map((s) => s.label) ?? categories;
      const out: ComparisonSeriesInput[] = [];
      chart.series.forEach((s, i) => {
        const name = s.label || `Series ${i + 1}`;
        const cur = curPayloads[i];
        const cmp = getComparisonSeriesData(`charts[${ci}].series[${i}].unsPath`, data);
        const currentData = categories.map((_, k) => {
          const v = cur?.slots[k]?.value;
          return typeof v === 'number' ? v : null;
        });
        const prevData = categories.map((_, k) => {
          const v = cmp?.slots[k]?.value;
          return typeof v === 'number' ? v : null;
        });
        const deviation = currentData.map((y, k) => {
          const p = prevData[k];
          if (y === null || p === null || p === 0) return null;
          return Math.round(((y - p) / Math.abs(p)) * 1000) / 10;
        });
        const pattern =
          (perSourceOverrides?.[`${chart._id}:${s._id}`] as DeviationPattern) ?? deviationPattern;
        const meta = { sourceId: s._id, sourceName: name, sourceIndex: i, ...(s.color ? { shiftColor: s.color } : {}) };
        out.push({
          ...meta, shiftId: 'current', shiftName: name, shiftIndex: 0,
          data: currentData, seriesType: 'column', patternIndex: 0, showInLegend: true,
        });
        out.push({
          ...meta, shiftId: 'comparison', shiftName: `${name} (prev)`, shiftIndex: 1,
          data: prevData, seriesType: 'column', patternIndex: 1, dashStyle: 'Dash',
          showInLegend: false, deviation, deviationPattern: pattern,
        });
      });
      const comparisonProp: ChartComparisonConfig = {
        series: out, showDeviation: true, deviationPattern, comparisonCategories,
      };
      return {
        id: chart._id || `chart-${ci}`,
        label: tabLabel,
        type: 'column' as const,
        children: (
          <ColumnChartDisplay
            bare
            categories={categories}
            comparison={comparisonProp}
            stacked={(chart.stacks ?? []).length > 0 || config.style.stacked}
            showLegend={showLegend}
            showDataLabels={showDataLabels}
            yAxisUnit={config.style.yAxisUnit || undefined}
            scrollable={scrollable}
            {...(advancedChartOptions ? { highchartsOptions: advancedChartOptions } : {})}
          />
        ),
      };
    }

    // ── Shift mode (DRIVEN BY DATA) ─────────────────────────────────────────────
    // Rendered whenever the backend tagged any bucket with a shift name
    // (chartMode === 'shift') — independent of the current Shift toggle. Each
    // source × enabled-shift becomes ONE column series; a bucket's value is
    // assigned to the shift whose NAME matches the backend's per-bucket
    // `slot.shift` tag (falling back to a time-window check via isSlotInShift only
    // when a bucket carries no tag — older backend). The SDK column encoder colors
    // each series by its shift and renders a ShiftLegend chip row (onToggleShift
    // flips enabledShiftIds to show/hide each shift). No boundary bridging: columns
    // are discrete, so there is no continuous line to join across shifts.
    if (chartMode === 'shift' && cfgShifts.length > 0 && chart.series.length > 0) {
      const tz = timeConfig?.timezone;
      const resolved = chart.series.map((s, i) => ({
        def: s, payload: getSeriesData(`charts[${ci}].series[${i}].unsPath`, data),
      }));
      const longest = resolved.reduce<SeriesSlot[]>(
        (best, r) => ((r.payload?.slots?.length ?? 0) > best.length ? r.payload!.slots : best),
        [],
      );
      if (longest.length > 0) {
        const catShifts = longest.map((sl) => sl.shift);
        // Collapse the backend's per-(period × shift) slots down to ONE column
        // category per periodicity bucket. In shift mode the backend splits each
        // bucket (e.g. a day) into one slot per shift — all sharing the same
        // `label` and emitted contiguously. Rendering those raw slots directly
        // repeats the axis label ("25 Jun") once per shift; instead we group each
        // contiguous run of identical labels into a single bucket and place every
        // shift's value at that bucket index, so shifts render as grouped columns
        // under one label (matching the design-sdk Shift example).
        const bucketLabels: string[] = [];
        const slotBucket: number[] = [];
        longest.forEach((sl, k) => {
          if (k === 0 || sl.label !== longest[k - 1].label) bucketLabels.push(sl.label);
          slotBucket.push(bucketLabels.length - 1);
        });
        const out: ShiftSeriesInput[] = [];
        resolved.forEach((r, si) => {
          const name = r.def.label || `Series ${si + 1}`;
          cfgShifts.forEach((shift, shIdx) => {
            if (!enabledShiftIds.has(shift.id)) return;
            const data: (number | null)[] = bucketLabels.map(() => null);
            longest.forEach((sl, k) => {
              const raw = r.payload?.slots[k]?.value;
              const v = typeof raw === 'number' ? raw : null;
              if (v === null) return;
              const tag = catShifts[k];
              // Prefer the backend's per-bucket shift tag (authoritative);
              // fall back to a time-of-day window check.
              const belongs = tag !== undefined && tag !== ''
                ? tag === shift.name
                : !!sl.from && isSlotInShift(sl.from, shift.startTime, shift.endTime, tz);
              if (belongs) data[slotBucket[k]] = v;
            });
            out.push({
              sourceId: r.def._id,
              sourceName: name,
              sourceIndex: si,
              shiftId: shift.id,
              shiftName: shift.name,
              shiftIndex: shIdx,
              shiftColor: shift.color,
              seriesType: 'column',
              data,
            });
          });
        });
        if (out.length > 0) {
          const shiftProp: ChartShiftConfig = {
            series: out,
            sources: chart.series.map((s, i) => ({ index: i, name: s.label || `Series ${i + 1}` })),
            shifts: cfgShifts.map((s) => ({ id: s.id, name: s.name, color: s.color, enabled: enabledShiftIds.has(s.id) })),
            onToggleShift: (id: string) =>
              setEnabledShiftIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              }),
            onToggleSource: () => {},
          };
          return {
            id: chart._id || `chart-${ci}`,
            label: tabLabel,
            type: 'column' as const,
            // SDK renders its own ShiftLegend chip row in shift mode; suppress the
            // native series legend so it doesn't show alongside.
            children: (
              <ColumnChartDisplay
                bare
                categories={bucketLabels}
                shift={shiftProp}
                stacked={(chart.stacks ?? []).length > 0 || config.style.stacked}
                showLegend={false}
                showDataLabels={showDataLabels}
                yAxisUnit={config.style.yAxisUnit || undefined}
                scrollable={scrollable}
                {...(advancedChartOptions ? { highchartsOptions: advancedChartOptions } : {})}
              />
            ),
          };
        }
      }
    }

    return {
      id: chart._id || `chart-${ci}`,
      label: tabLabel,
      type: 'column' as const,
      children: <ColumnChartDisplay bare {...sharedChartProps} />,
    };
  });

  // ── Shared slots ──────────────────────────────────────────────────────────

  const resolvedTitle = (getValue('title', config, data) as string) || config.title || 'Column Chart';

  const breadcrumbSlot = drillPath.length > 0 ? (
    <Breadcrumb size="Small">
      <BreadcrumbItem
        type="Icon"
        icon={<Home size={12} />}
        aria-label="Reset to full range"
        onClick={handleDrillReset}
      />
      {drillPath.map((entry, i) => (
        <BreadcrumbItem
          key={`${i}-${entry.label}`}
          value={entry.label}
          currentItem={i === drillPath.length - 1}
          onClick={() => handleDrillUp(i)}
        />
      ))}
    </Breadcrumb>
  ) : undefined;

  // Fixed mode format: `<durationLabel>: <Periodicity>`. The durationLabel
  // comes from the user's "Set Duration" name input (presetLabel resolves to
  // `timeConfig.fixedDuration.label`). Drilldown breadcrumb appends after.
  // Other modes (Local/Global) don't render this slot — handled at the JSX
  // site — so the fallback format is kept only as a safety net.
  const durationSlot = timeConfig?.pickerType === 'fixed'
    ? `${presetLabel}: ${effectivePeriodicity}${drillPath.length > 0 ? ` › ${drillPath[drillPath.length - 1].label}` : ''}`
    : `${effectivePeriodicity} · ${presetLabel}${drillPath.length > 0 ? ` › ${drillPath[drillPath.length - 1].label}` : ''}`;

  // Fixed and Global time pickers control the window externally, so the widget
  // hides its own date picker (the user can't change the range here).
  // Hide the date picker + periodicity selector when:
  //   - Fixed / Global time pickers control the window externally, OR
  //   - No chart has any data source yet (nothing to filter against —
  //     the empty state is rendered as the chart body).
  const hideDatePicker =
    timeConfig?.pickerType === 'fixed' ||
    timeConfig?.pickerType === 'global' ||
    !hasAnySeries;

  // Use `undefined` (not an empty fragment) when there are no filters, so the
  // ChartSwitcher's filters prop signature is consistent across time-mode
  // switches — otherwise the SDK may treat "Fragment with no children" as a
  // present-but-empty filters slot and remount the chart body on each flip.
  const filtersSlot = !hideDatePicker ? (
    <>
      <DatePicker
        mode="range"
        placeholder="Select range"
        isOpen={datePickerOpen}
        onOpenChange={(open: boolean) => {
          // Sync the draft toggles from committed every time the picker opens, so
          // an un-applied change from a previous open doesn't leak in.
          if (open) syncDraftFromCommitted();
          setDatePickerOpen(open);
        }}
        rangeValue={range}
        selectedPreset={preset}
        presets={presetOptions}
        onPresetSelect={handlePresetSelect}
        onRangeChange={handleRangeChange}
        // Compare toggle — only offered when the config enables comparison mode.
        showComparison={cfgComparisonMode}
        comparisonEnabled={draftComparisonOn}
        onComparisonToggle={draftActivateComparison}
        // Shift toggle — only offered when the config has shifts. Shift and
        // Compare are mutually exclusive (draftActivate* enforce it).
        showShift={cfgShifts.length > 0}
        shiftEnabled={draftShiftOn}
        onShiftToggle={draftActivateShift}
      />
      <div style={{ width: 120 }}>
        <SelectInput
          label=""
          value={basePeriodicity}
          isOpen={periodicityOpen}
          onClick={() => setPeriodicityOpen((v) => !v)}
        >
          {periodicityOpen && (
            <DropdownMenu>
              <ActionListItemGroup>
                {/* availablePeriodicities is pre-sorted coarse→fine. */}
                {availablePeriodicities.map((p) => (
                  <ActionListItem
                    key={p}
                    title={p}
                    selectionType="Single"
                    isSelected={basePeriodicity === p}
                    onClick={() => handlePeriodicityChange(p)}
                  />
                ))}
              </ActionListItemGroup>
            </DropdownMenu>
          )}
        </SelectInput>
      </div>
    </>
  ) : undefined;

  // Description surfaces in the Info tooltip below. Only rendered when the
  // user actually configured one for the active chart.
  const chartDescription = (config.description ?? '').trim();
  const actionsSlot = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-03)' }}>
      {chartDescription && !widgetElements.hideInfoIcon && (
        <Tooltip placement="Bottom" bodyText={chartDescription}>
          <IconButton
            icon={<Info size={16} />}
            aria-label="Chart description"
            size="16"
          />
        </Tooltip>
      )}
      {!widgetElements.hideSettingsIcon && (
        <div ref={settingsBtnRef} style={{ display: 'inline-flex' }}>
          <IconButton
            icon={<Settings size={16} />}
            aria-label="Chart settings"
            size="16"
            onClick={openSettingsDropdown}
          />
          {settingsOpen && settingsPos && createPortal(
            <div ref={settingsMenuRef} style={{ position: 'fixed', top: settingsPos.top, left: settingsPos.left, zIndex: 600 }}>
              <DropdownMenu>
                <ActionListItemGroup>
                  <ActionListItem contentType="SectionHeading" title="Time Control" />
                  <ActionListItem
                    title="Time drilldown"
                    selectionType="Multiple"
                    isSelected={timeDrillDown}
                    onClick={() => setTimeDrillDown((v) => !v)}
                  />
                  <ActionListItem contentType="Separator" />
                  <ActionListItem contentType="SectionHeading" title="Chart Control" />
                  <ActionListItem title="Legends"          selectionType="Multiple" isSelected={showLegend}      onClick={() => setShowLegend((v) => !v)} />
                  <ActionListItem title="Data Labels"      selectionType="Multiple" isSelected={showDataLabels}  onClick={() => setShowDataLabels((v) => !v)} />
                  <ActionListItem title="Clipping"         selectionType="Multiple" isSelected={clipping}        isDisabled={inexactMultiple} onClick={() => setClipping((v) => !v)} />
                  <ActionListItem title="Scroll"           selectionType="Multiple" isSelected={scrollable}      onClick={() => setScrollable((v) => !v)} />
                  <ActionListItem title="Inexact Multiple" selectionType="Multiple" isSelected={inexactMultiple} onClick={() => setInexactMultiple((v) => !v)} />
                </ActionListItemGroup>
              </DropdownMenu>
            </div>,
            document.body,
          )}
        </div>
      )}
      {!widgetElements.hideExportIcon && (
        <div ref={exportBtnRef} style={{ display: 'inline-flex' }}>
          <IconButton
            icon={<Menu size={16} />}
            aria-label="More actions"
            size="16"
            onClick={openExportDropdown}
          />
          {exportOpen && exportPos && createPortal(
            <div ref={exportMenuRef} style={{ position: 'fixed', top: exportPos.top, left: exportPos.left, zIndex: 600 }}>
              <DropdownMenu>
                <ActionListItemGroup>
                  <ActionListItem contentType="SectionHeading" title="Export" />
                  <ActionListItem title="PNG"  selectionType="Single" onClick={() => handleExport('PNG')} />
                  <ActionListItem title="JPEG" selectionType="Single" onClick={() => handleExport('JPEG')} />
                  <ActionListItem title="SVG"  selectionType="Single" onClick={() => handleExport('SVG')} />
                  <ActionListItem title="CSV"  selectionType="Single" onClick={() => handleExport('CSV')} />
                  <ActionListItem title="XLSX" selectionType="Single" onClick={() => handleExport('XLSX')} />
                </ActionListItemGroup>
              </DropdownMenu>
            </div>,
            document.body,
          )}
        </div>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // The DatePicker's Shift / Compare toggles are wired directly via its
  // showShift/showComparison + on*Toggle props (see filtersSlot) — no
  // ChartTimeProvider needed. Mode selection is driven by the resolved `data`
  // (chartMode), not by the toggle state.

  return (
    <div
      className={`cc-widget-shell${advancedSettings?.enabled ? ' cc-widget-shell--title-styled' : ''}`}
      style={widgetTitleStyle}
    >
      {/* Always render ChartSwitcher so the chart body renders consistently
          regardless of chart count. When there's only one item, the chevron
          + dropdown are suppressed via the cc-widget--single-chart class
          (CSS hides .fds-chart__title-icon + disables the title button). */}
      <ChartSwitcher
        breadcrumb={breadcrumbSlot}
        duration={timeConfig?.pickerType === 'fixed' ? durationSlot : undefined}
        filters={filtersSlot}
        actions={actionsSlot}
        className={[
          widgetElements.hideChartTitle ? 'cc-widget--hide-title' : '',
          items.length <= 1 ? 'cc-widget--single-chart' : '',
          // When every header surface is hidden (title + every icon + no
          // duration + no filters + no breadcrumb), drop the header so the
          // canvas can fill the freed space.
          (
            widgetElements.hideChartTitle
            && widgetElements.hideSettingsIcon
            && widgetElements.hideExportIcon
            && (widgetElements.hideInfoIcon || !chartDescription)
            && timeConfig?.pickerType !== 'fixed'
            && !filtersSlot
            && drillPath.length === 0
          ) ? 'cc-widget--all-header-hidden' : '',
        ].filter(Boolean).join(' ') || undefined}
        items={items}
      />
    </div>
  );
}
