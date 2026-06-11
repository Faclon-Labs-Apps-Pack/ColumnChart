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
import { Home, Settings, Download } from 'react-feather';
import {
  DataEntry,
  WidgetEvent,
  ColumnChartUIConfig,
  ChartConfig,
  SeriesPayload,
  WidgetAdvancedSettingsConfig,
  WidgetFontWeight,
  TimeConfig,
  Duration,
} from '../../iosense-sdk/types';
import { resolveDurationWindow } from '../../iosense-sdk/time';
import './ColumnChart.css';

interface ColumnChartProps {
  config?: ColumnChartUIConfig;
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
  if (days <= 180) return ['Daily', 'Weekly'];
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

// ── Per-chart data builder ────────────────────────────────────────────────────

type DashStyle = 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'LongDash' | 'ShortDash';

interface ChartDisplayData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedSeries: { name: string; data: any[]; color?: string; yAxis?: number }[];
  resolvedSeriesIds: string[];
  categories: string[];
  plotLines: { value: number; label?: string; color?: string; width?: number; dashStyle?: DashStyle }[];
  plotBands: { from: number; to: number; label?: string; color?: string }[];
  yAxisUnit: string | undefined;
  firstPayload: SeriesPayload | null;
  highchartsOptions: Record<string, unknown>;
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
  const yAxisUnit = config.style.yAxisUnit || firstPayload?.meta?.unit || undefined;
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
        dashStyle: (p.dashStyle ?? 'Solid') as DashStyle };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const plotBands = (chart.plotBands ?? [])
    .map((p, i) => {
      const from = resolveNumeric(`charts[${ci}].plotBands[${i}].from`, p.from);
      const to   = resolveNumeric(`charts[${ci}].plotBands[${i}].to`,   p.to);
      if (from === null || to === null || to <= from) return null;
      return { from, to, label: p.label || undefined, color: p.color || undefined };
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

  const hasRightAxis = resolvedSeries.some((s) => s.yAxis === 1);
  const hasStacks    = (chart.stacks ?? []).some((st) => st.seriesIds.length > 1);
  const hasAxes      = (chart.axes ?? []).length > 0;
  const needsSeriesOverride = hasRightAxis || hasStacks || hasAxes;

  const leftAxisName = (chart.axes ?? []).find((axis) => axis.yAxis === 0)?.name?.trim();
  const rightAxisName = (chart.axes ?? []).find((axis) => axis.yAxis === 1)?.name?.trim();
  const advancedSettings = config.style.advancedSettings;
  const highchartsOptions: Record<string, unknown> = {};

  if (needsSeriesOverride) {
    const yAxisBase = hasRightAxis || hasAxes
      ? [
          {
            title: { text: leftAxisName || yAxisUnit || '' },
            ...(hcPlotLines.length > 0 ? { plotLines: hcPlotLines } : {}),
            ...(hcPlotBands.length > 0 ? { plotBands: hcPlotBands } : {}),
          },
          { title: { text: rightAxisName || '' }, opposite: true },
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

  return { resolvedSeries, resolvedSeriesIds, categories, plotLines, plotBands, yAxisUnit, firstPayload, highchartsOptions };
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
  const chartRef = useRef<unknown>(null);
  // Guard: selecting a preset in the SDK DatePicker also fires onRangeChange;
  // this prevents that from clearing the preset / re-emitting (matches GTP).
  const presetSelectingRef = useRef(false);

  const [preset, setPreset] = useState(() => initialTimeFromConfig(timeConfig).presetId);
  const [presetLabel, setPresetLabel] = useState(() => initialTimeFromConfig(timeConfig).presetLabel);
  const [range, setRange] = useState<DateRange>(() => initialTimeFromConfig(timeConfig).range);

  // Periodicity options derive from the active duration (its configured
  // periodicities), like GlobalTimePicker — not from the range length.
  const selectedDuration =
    timeConfig?.allDurations?.find((d) => d.id === preset) ??
    (timeConfig?.pickerType === 'fixed' ? timeConfig.fixedDuration : undefined);
  const availablePeriodicities = durationPeriodicities(selectedDuration, range);
  const [basePeriodicity, setBasePeriodicity] = useState<Periodicity>(() => periodicityFromConfig(timeConfig));
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
  const [zoomable,        setZoomable]        = useState(true);
  const [scrollable,      setScrollable]      = useState(false);
  const [inexactMultiple, setInexactMultiple] = useState(false);
  const widgetElements = {
    ...(config.style.widgetElements ?? {
      hideWidgetElements: false,
      hideSettingsIcon: false,
      hideExportIcon: false,
      hideChartTitle: false,
    }),
    hideWidgetElements: Boolean(
      config.style.widgetElements?.hideWidgetElements ||
      config.style.widgetElements?.hideSettingsIcon ||
      config.style.widgetElements?.hideExportIcon ||
      config.style.widgetElements?.hideChartTitle,
    ),
  };
  const advancedSettings = config.style.advancedSettings;
  const widgetTitleStyle = advancedSettings?.enabled
    ? ({
        '--cc-widget-title-font-size': `${advancedSettings.titleFontSize}px`,
        '--cc-widget-title-color': advancedSettings.titleFontColor,
        '--cc-widget-title-weight': String(fontWeightToCss(advancedSettings.titleFontWeight)),
      } as CSSProperties)
    : undefined;

  // Debug: log the `data` prop the widget receives from the engine each time it changes.
  useEffect(() => {
    console.log('[ColumnChart] data prop:', data);
  }, [data]);

  useEffect(() => {
    setShowLegend(config.style.showLegend);
    setShowDataLabels(config.style.showDataLabels);
  }, [config.style.showLegend, config.style.showDataLabels]);

  // Re-sync the date picker (and refetch window) whenever the configured
  // default duration / periodicity changes, so selecting a default duration
  // in the time config is reflected in the widget's date picker.
  useEffect(() => {
    const init = initialTimeFromConfig(timeConfig);
    const periodicity = periodicityFromConfig(timeConfig);
    setRange(init.range);
    setPreset(init.presetId);
    setPresetLabel(init.presetLabel);
    setBasePeriodicity(periodicity);
    setDrillPath([]);
    onEvent({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(init.range.start.getTime()),
        endTime: String(init.range.end.getTime()),
        periodicity: periodicity.toLowerCase(),
      },
    });
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
  ]);

  useEffect(() => {
    if (!availablePeriodicities.includes(basePeriodicity)) {
      setBasePeriodicity(availablePeriodicities[0]);
    }
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

  const hasAnySeries = (config.charts ?? []).some((c) => c.series.length > 0);
  if (!hasAnySeries) {
    return (
      <div className="cc-widget cc-widget--empty">
        <p className="cc-widget__empty-text BodyMediumRegular">
          No series configured. Add a data source in the settings panel.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
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

  function emitTimeChange(startTime: number, endTime: number, periodicity: string) {
    onEvent({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(startTime),
        endTime:   String(endTime),
        periodicity,
      },
    });
  }

  function handleRangeChange(r: DateRange | null) {
    // A preset selection fires onRangeChange too — handlePresetSelect already
    // applied the window, so skip (don't clobber the preset label / re-emit).
    if (presetSelectingRef.current) {
      presetSelectingRef.current = false;
      return;
    }
    if (!r) return;
    setRange(r);
    setPreset('');          // manual range pick → no preset selected
    setPresetLabel('Custom');
    setDrillPath([]);
    emitTimeChange(r.start.getTime(), r.end.getTime(), basePeriodicity.toLowerCase());
  }

  // Preset list shown in the date picker = the durations configured in the
  // time tab (timeConfig.allDurations), nothing else. Falls back to the
  // picker's built-ins only when no durations are configured (e.g. dev harness).
  const durationPresets = (timeConfig?.allDurations ?? []).map((d) => ({
    label: d.label || d.id,
    value: d.id,
  }));

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

  const items = (config.charts ?? [])
    .filter((chart) => chart.series.length > 0)
    .map((chart, ci) => {
      const displayData = buildChartDisplayData(chart, ci, data, config);
      const { resolvedSeries, categories, plotLines, plotBands, yAxisUnit, firstPayload, highchartsOptions } = displayData;

      function handlePointClick(ctx: { category: string }) {
        if (!timeDrillDown || !firstPayload) return;
        if (effectiveIdx >= LEVEL_ORDER.length - 1) return;
        const slot = firstPayload.slots.find((s) => s.label === ctx.category);
        if (!slot) return;
        setDrillPath((prev) => [...prev, { label: ctx.category, startTime: slot.from, endTime: slot.to }]);
        emitTimeChange(slot.from, slot.to, nextFinerPeriodicity(effectivePeriodicity).toLowerCase());
      }

      const sharedChartProps = {
        categories,
        series: resolvedSeries,
        showLegend,
        showDataLabels,
        yAxisUnit,
        stacked: config.style.stacked,
        zoomable,
        scrollable,
        ...(plotLines.length > 0 ? { plotLines } : {}),
        ...(plotBands.length > 0 ? { plotBands } : {}),
        onChartReady: (instance: unknown) => { chartRef.current = instance; },
        onPointClick: timeDrillDown ? handlePointClick : undefined,
        highchartsOptions,
      };

      const tabLabel = chart.title || `Chart ${ci + 1}`;

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

  const durationSlot = `${effectivePeriodicity} · ${presetLabel}${
    drillPath.length > 0 ? ` › ${drillPath[drillPath.length - 1].label}` : ''
  }`;

  // Fixed and Global time pickers control the window externally, so the widget
  // hides its own date picker (the user can't change the range here).
  const hideDatePicker = timeConfig?.pickerType === 'fixed' || timeConfig?.pickerType === 'global';

  const filtersSlot = (
    <>
      {!hideDatePicker && (
        <DatePicker
          mode="range"
          placeholder="Select range"
          rangeValue={range}
          selectedPreset={preset}
          {...(durationPresets.length > 0 ? { presets: durationPresets } : {})}
          onPresetSelect={handlePresetSelect}
          onRangeChange={handleRangeChange}
        />
      )}
      {!hideDatePicker && (
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
      )}
    </>
  );

  const actionsSlot = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {!widgetElements.hideWidgetElements && !widgetElements.hideSettingsIcon && (
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
                  <ActionListItem title="Zoom"             selectionType="Multiple" isSelected={zoomable}        onClick={() => setZoomable((v) => !v)} />
                  <ActionListItem title="Scroll"           selectionType="Multiple" isSelected={scrollable}      onClick={() => setScrollable((v) => !v)} />
                  <ActionListItem title="Inexact Multiple" selectionType="Multiple" isSelected={inexactMultiple} onClick={() => setInexactMultiple((v) => !v)} />
                </ActionListItemGroup>
              </DropdownMenu>
            </div>,
            document.body,
          )}
        </div>
      )}
      {!widgetElements.hideWidgetElements && !widgetElements.hideExportIcon && (
        <div ref={exportBtnRef} style={{ display: 'inline-flex' }}>
          <IconButton
            icon={<Download size={16} />}
            aria-label="Export chart"
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

  return (
    <div
      className={`cc-widget-shell${advancedSettings?.enabled ? ' cc-widget-shell--title-styled' : ''}`}
      style={widgetTitleStyle}
    >
      <ChartSwitcher
        breadcrumb={breadcrumbSlot}
        {...(timeConfig?.pickerType === 'global' ? {} : { duration: durationSlot })}
        filters={filtersSlot}
        actions={actionsSlot}
        className={widgetElements.hideWidgetElements && widgetElements.hideChartTitle ? 'cc-widget--hide-title' : undefined}
        items={items}
      />
    </div>
  );
}
