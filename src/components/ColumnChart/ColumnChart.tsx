import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColumnChart as ColumnChartDisplay } from '@faclon-labs/design-sdk/ColumnChart';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import { AreaChart } from '@faclon-labs/design-sdk/AreaChart';
import { ChartSwitcher } from '@faclon-labs/design-sdk/ChartSwitcher';
import { ChartActions, exportChart } from '@faclon-labs/design-sdk/Chart';
import type { ChartExportFormat } from '@faclon-labs/design-sdk/Chart';
import { DatePicker, getPresetDateRange } from '@faclon-labs/design-sdk/DatePicker';
import type { DateRange } from '@faclon-labs/design-sdk/DatePicker';
import { Breadcrumb, BreadcrumbItem } from '@faclon-labs/design-sdk/Breadcrumb';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem, ActionListItemGroup } from '@faclon-labs/design-sdk/DropdownMenu';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { Home, Settings } from 'react-feather';
import { DataEntry, WidgetEvent, ColumnChartUIConfig, ChartConfig, SeriesPayload } from '../../iosense-sdk/types';
import './ColumnChart.css';

interface ColumnChartProps {
  config: ColumnChartUIConfig;
  data: DataEntry[];
  onEvent: (event: WidgetEvent) => void;
}

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

function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry) return null;
  const v = entry.value;
  if (v !== null && typeof v === 'object' && (v as SeriesPayload).__type === 'series') {
    return v as SeriesPayload;
  }
  return null;
}

function getValue(key: string, config: unknown, data: DataEntry[]): string | number | null {
  const entry = data.find((d) => d.key === key);
  if (entry !== undefined) {
    const v = entry.value;
    if (v !== null && typeof v === 'object') return null;
    return v as string | number | null;
  }
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  return parts.reduce((acc: unknown, k) => (acc as Record<string, unknown>)?.[k], config) as string | number | null;
}

function nextFinerPeriodicity(p: Periodicity): Periodicity {
  const idx = LEVEL_ORDER.indexOf(p);
  return idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : p;
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
        yAxis: s.yAxis ?? 0,
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
      yAxis: f.yAxis ?? 0,
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
        ...(p.dashStyle ? { dashStyle: p.dashStyle as DashStyle } : {}) };
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

  const hasRightAxis = resolvedSeries.some((s) => s.yAxis === 1);
  const hasStacks    = (chart.stacks ?? []).some((st) => st.seriesIds.length > 1);
  const needsSeriesOverride = hasRightAxis || hasStacks;

  const highchartsOptions: Record<string, unknown> = needsSeriesOverride ? {
    ...(hasRightAxis ? {
      yAxis: [
        { title: { text: yAxisUnit ?? '' } },
        { title: { text: '' }, opposite: true },
      ],
    } : {}),
    ...(hasStacks ? {
      plotOptions: { column: { stacking: 'normal' } },
    } : {}),
    series: resolvedSeries.map((s, idx) => {
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
    }),
  } : {};

  return { resolvedSeries, resolvedSeriesIds, categories, plotLines, plotBands, yAxisUnit, firstPayload, highchartsOptions };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ColumnChart({ config, data, onEvent }: ColumnChartProps) {
  const chartRef = useRef<unknown>(null);

  const [preset, setPreset] = useState('previous_7_days');
  const [range, setRange] = useState<DateRange>(() => {
    const r = getPresetDateRange('previous_7_days');
    return r ?? { start: new Date(Date.now() - 7 * 86_400_000), end: new Date() };
  });

  const availablePeriodicities = getAvailablePeriodicities(range);
  const [basePeriodicity, setBasePeriodicity] = useState<Periodicity>('Daily');
  const [periodicityOpen, setPeriodicityOpen] = useState(false);
  const [drillPath, setDrillPath] = useState<DrillEntry[]>([]);

  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number } | null>(null);

  const [timeDrillDown,   setTimeDrillDown]   = useState(true);
  const [showLegend,      setShowLegend]      = useState(config.style.showLegend);
  const [showDataLabels,  setShowDataLabels]  = useState(config.style.showDataLabels);
  const [clipping,        setClipping]        = useState(false);
  const [zoomable,        setZoomable]        = useState(true);
  const [scrollable,      setScrollable]      = useState(false);
  const [inexactMultiple, setInexactMultiple] = useState(false);

  useEffect(() => {
    setShowLegend(config.style.showLegend);
    setShowDataLabels(config.style.showDataLabels);
  }, [config.style.showLegend, config.style.showDataLabels]);

  useEffect(() => {
    if (!availablePeriodicities.includes(basePeriodicity)) {
      setBasePeriodicity(availablePeriodicities[0]);
    }
  }, [range]);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (settingsBtnRef.current?.contains(target)) return;
      setSettingsOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [settingsOpen]);

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
    if (!r) return;
    setRange(r);
    setDrillPath([]);
    emitTimeChange(r.start.getTime(), r.end.getTime(), basePeriodicity.toLowerCase());
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

  const durationSlot = `${effectivePeriodicity} · ${preset.replace(/_/g, ' ')}${
    drillPath.length > 0 ? ` › ${drillPath[drillPath.length - 1].label}` : ''
  }`;

  const filtersSlot = (
    <>
      <DatePicker
        mode="range"
        placeholder="Select range"
        rangeValue={range}
        selectedPreset={preset}
        onPresetSelect={setPreset}
        onRangeChange={handleRangeChange}
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
  );

  const actionsSlot = (
    <ChartActions
      trailing={
        <div ref={settingsBtnRef} style={{ display: 'inline-flex' }}>
          <IconButton
            icon={<Settings size={16} />}
            aria-label="Chart settings"
            size="16"
            onClick={openSettingsDropdown}
          />
          {settingsOpen && settingsPos && createPortal(
            <div style={{ position: 'fixed', top: settingsPos.top, left: settingsPos.left, zIndex: 600 }}>
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
      }
    />
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ChartSwitcher
      titlePrefix="View:"
      breadcrumb={breadcrumbSlot}
      duration={durationSlot}
      filters={filtersSlot}
      actions={actionsSlot}
      items={items}
    />
  );
}
