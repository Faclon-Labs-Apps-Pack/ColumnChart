import { useState, useEffect, useRef } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { ProductAccordionItem, PATrailingItem } from '@faclon-labs/design-sdk/ProductAccordion';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { TextInput } from '@faclon-labs/design-sdk/TextInput';
import { Button } from '@faclon-labs/design-sdk/Button';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { TimeTabConfiguration } from '@faclon-labs/design-sdk/TimeTabConfiguration';
import type { TimeTabUIConfig, TimeTabConfigurationProps } from '@faclon-labs/design-sdk/TimeTabConfiguration';
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem, ActionListItemGroup } from '@faclon-labs/design-sdk/DropdownMenu';
import { ColorInput } from '@faclon-labs/design-sdk/ColorPicker';
import { InputFieldHeader } from '@faclon-labs/design-sdk/InputFieldHeader';
import { Radio, RadioGroup } from '@faclon-labs/design-sdk/Radio';
import type { RadioGroupChangeMeta } from '@faclon-labs/design-sdk/Radio';
import { ListCard, ListCardLeadingItem, ListCardTrailingItem } from '@faclon-labs/design-sdk/ListCard';
import { Tag } from '@faclon-labs/design-sdk/Tag';
import { Badge } from '@faclon-labs/design-sdk/Badge';
import { Checkbox, CheckboxGroup } from '@faclon-labs/design-sdk/Checkbox';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { Edit2, Trash2, Plus, ArrowLeft, Lock, Unlock } from 'react-feather';
import {
  ColumnChartEnvelope,
  ColumnChartUIConfig,
  ChartConfig,
  ColumnChartSeriesConfig,
  FixedSeriesConfig,
  PlotLineConfig,
  PlotLinePeriodicity,
  PlotBandConfig,
  AxisConfig,
  StackConfig,
  WidgetSizeConfig,
  WidgetSizePreset,
  WidgetElementsConfig,
  WidgetAdvancedSettingsConfig,
  TimeConfig,
  Duration,
  BindingEntry,
} from '../../iosense-sdk/types';
import { useUNSTree } from '../../iosense-sdk/useUNSTree';
import type { UNSTree } from '../../iosense-sdk/useUNSTree';
import './ColumnChartConfiguration.css';

interface ColumnChartConfigurationProps {
  config: ColumnChartEnvelope | undefined;
  authentication?: string;
  onChange: (config: ColumnChartEnvelope) => void;
  onBack?: () => void;

  unsTree?: UNSTree;
  isLoadingTree?: boolean;
  onLoadWorkspaces?: () => void;
  resolveUNSValue?: (rawValue: string) => string;

  // Registered global time pickers, injected by the host (Lens). Passed
  // straight through to design-sdk's TimeTabConfiguration so the user can
  // link the widget's time to a Global Time Picker. Type is derived from the
  // component's own props since the SDK doesn't re-export GTPGlobalTimepicker.
  globalTimepickers?: TimeTabConfigurationProps['globalTimepickers'];
}

const VARIABLE_REGEX = /^\{\{(.+)\}\}$/;
const WIDGET_SIZE_PRESETS: Record<Exclude<WidgetSizePreset, 'Custom'>, { width: number; height: number }> = {
  Small: { width: 580, height: 400 },
  Medium: { width: 880, height: 400 },
  Large: { width: 1780, height: 440 },
};

const DEFAULT_ADVANCED_SETTINGS: WidgetAdvancedSettingsConfig = {
  enabled: false,
  // Chart Title defaults — match the reference Style tab image.
  titleFontSize: 20,
  titleFontColor: '#000000',
  titleFontWeight: 'Semi-Bold',
  // X axis defaults from the image.
  xAxisTextColor: '#494B7E',
  xAxisLineColor: '#888888',
  // Y axis defaults from the image.
  yAxisTextColor: '#494B7E',
  yAxisLineColor: '#888888',
  // Data Table defaults from the image.
  dataTableHeaderBgColor:   '#FFFFFF',
  dataTableHeaderTextColor: '#494B7E',
  dataTableHeaderTextSize:  14,
  dataTableHeaderTextWeight: 'Semi-Bold',
  dataTableBaseFontSize:    14,
  dataTableBaseFontWeight:  'Regular',
  dataTableBaseFontColor:   '#494B7E',
  // Others defaults from the image.
  gridLineColor: '#CCCCCC',
  legendTextColor: '#888888',
};

// Default card border / background values — mirror the image's Style tab.
const DEFAULT_CARD_STYLE = {
  backgroundColor: '#FFFFFF',
  borderColor:     '#FFFFFF',
  borderWidth:     1,
  borderRadius:    4,
};

// Older envelopes may have stored CSS custom-property strings (e.g.
// "var(--text-default-primary, #1a1a1a)") in color fields back when the
// configurator used tokens as defaults. The ColorInput expects a plain
// hex/rgb/named color — when fed a `var(...)` string it shows the raw text.
// Strip the wrapper and surface the hex fallback so existing widgets render
// cleanly without forcing the user to re-pick every color.
// Wrapper around SDK `ColorInput` that hides the leading `#` in the displayed
// hex string but normalizes the stored value to always include exactly one
// `#`. Accepts user input with or without `#` (e.g. `3136DD` or `#3136DD`),
// extra whitespace, and strips any garbage `##` prefixes. Hex characters are
// otherwise passed through verbatim — the underlying storage stays in the
// canonical `#RRGGBB` form Highcharts / CSS expect.
function HexInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const display = value.replace(/^#+/, '');
  return (
    <ColorInput
      value={display}
      onChange={(next) => {
        const stripped = next.replace(/^#+/, '');
        onChange(stripped ? `#${stripped}` : '');
      }}
    />
  );
}

function sanitizeColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('var(')) return trimmed;
  // var(--token, fallback) → fallback (anything after the last comma).
  const inner = trimmed.slice(4, trimmed.lastIndexOf(')'));
  const lastComma = inner.lastIndexOf(',');
  return (lastComma >= 0 ? inner.slice(lastComma + 1) : '').trim();
}

// Apply sanitizeColor to every color field on a WidgetAdvancedSettingsConfig.
function sanitizeAdvancedSettings(s: Partial<WidgetAdvancedSettingsConfig>): Partial<WidgetAdvancedSettingsConfig> {
  const cleaned: Partial<WidgetAdvancedSettingsConfig> = { ...s };
  const colorKeys: (keyof WidgetAdvancedSettingsConfig)[] = [
    'titleFontColor',
    'xAxisTextColor',
    'xAxisLineColor',
    'yAxisTextColor',
    'yAxisLineColor',
    'gridLineColor',
    'legendTextColor',
    'dataTableHeaderBgColor',
    'dataTableHeaderTextColor',
    'dataTableBaseFontColor',
  ];
  colorKeys.forEach((k) => {
    if (typeof cleaned[k] === 'string') {
      const fixed = sanitizeColor(cleaned[k]);
      if (fixed) (cleaned as Record<string, unknown>)[k] = fixed;
    }
  });
  return cleaned;
}

function getWidgetSizeDimensions(preset: WidgetSizePreset): { width: number; height: number } {
  if (preset === 'Custom') return WIDGET_SIZE_PRESETS.Medium;
  return WIDGET_SIZE_PRESETS[preset];
}


function buildDynamicBindingPathList(
  uiConfig: unknown,
  seriesKeys: string[],
): Array<BindingEntry> {
  const paths: Array<BindingEntry> = [];

  function walk(obj: unknown, currentPath: string): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
      const match = VARIABLE_REGEX.exec(obj.trim());
      if (match) {
        const topic = match[1];
        if (seriesKeys.includes(currentPath)) {
          paths.push({ key: currentPath, topic, type: 'series' });
        } else {
          paths.push({ key: currentPath, topic });
        }
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => walk(item, `${currentPath}[${index}]`));
      return;
    }
    if (typeof obj === 'object') {
      Object.entries(obj as Record<string, unknown>).forEach(([key, val]) => {
        walk(val, currentPath ? `${currentPath}.${key}` : key);
      });
    }
  }

  walk(uiConfig, '');
  return paths;
}

function mapTimeTabToTimeConfig(ttc: TimeTabUIConfig): TimeConfig {
  // New design uses `linkTimeWith` ('local' | 'fixed' | 'global'); fall back to
  // the deprecated `timeType` for back-compat.
  const picker = ((ttc.linkTimeWith ?? ttc.timeType ?? 'local') as 'local' | 'fixed' | 'global');

  // Fixed picker carries a single inline "set duration" (ttc.fixed.duration)
  // with string x/y. Convert to a Duration the engine/widget can resolve.
  const fd = ttc.fixed?.duration;
  const fixedDuration: Duration | undefined =
    picker === 'fixed' && fd
      ? {
          id: 'fixed',
          label: fd.name || 'Fixed',
          navigation: fd.navigation,
          x: Number(fd.x) || 0,
          xPeriod: fd.xPeriod,
          xEvent: fd.xEvent,
          y: Number(fd.y) || 0,
          yPeriod: fd.yPeriod,
          yEvent: fd.yEvent,
        }
      : undefined;

  // Cycle time redefines when each period "begins" so durations resolve to the
  // operational window, not the calendar one (hour:minute = day, dayOfWeek =
  // week, date = month, month NAME = year). The resolver reads these raw fields
  // directly (mirroring the GlobalTimePicker reference), so pass them through
  // unchanged. Fixed picker scopes cycleTime under `fixed`; local/global keep it
  // at the top level.
  const cycleTime = (picker === 'fixed' ? ttc.fixed?.cycleTime : ttc.cycleTime) as
    | TimeConfig['cycleTime']
    | undefined;

  // Shifts and comparisonMode live at the top level of TimeTabUIConfig (Local
  // picker). Pass them through so the widget's DatePicker can auto-show the
  // Shift / Compare toggles via SDK's ChartTimeProvider.
  const shifts = (ttc.shifts ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    startTime: s.startTime,
    endTime: s.endTime,
    enabled: true,
  }));

  return {
    timezone: ttc.timezone,
    // Engine still treats global like local (rolling) for data resolution,
    // but the real picker mode is preserved in `pickerType` for the widget UI.
    type: picker === 'global' ? 'local' : picker,
    pickerType: picker,
    cycleTime,
    startTime: null,
    endTime: null,
    fixedDuration,
    defaultDurationId: ttc.defaultDurationId,
    allDurations: (ttc.allDurations ?? []) as unknown as Duration[],
    // Fixed picker has its own single periodicity; otherwise use the tab default.
    defaultPeriodicity: (picker === 'fixed' && fd?.periodicity
      ? fd.periodicity.toLowerCase()
      : ttc.defaultPeriodicity) as TimeConfig['defaultPeriodicity'],
    shifts: shifts.length > 0 ? shifts : undefined,
    comparisonMode: ttc.comparisonMode,
  };
}

// Debug helper — surfaces exactly what TimeTab emits vs what we derive.
function logTimeConfig(ttc: TimeTabUIConfig, tc: TimeConfig) {
  // eslint-disable-next-line no-console
  console.log('[mapTimeTabToTimeConfig]', {
    ttc_linkTimeWith: (ttc as { linkTimeWith?: string }).linkTimeWith,
    ttc_cycleTime: ttc.cycleTime,
    ttc_fixed: (ttc as { fixed?: unknown }).fixed,
    ttc_defaultDurationId: ttc.defaultDurationId,
    ttc_allDurations: ttc.allDurations,
    derived: tc,
  });
}

function buildEnvelope(
  existing: ColumnChartEnvelope | undefined,
  uiConfig: ColumnChartUIConfig,
  timeConfig?: TimeConfig,
  timeTabConfig?: Record<string, unknown>,
): ColumnChartEnvelope {
  const seriesKeys = uiConfig.charts.flatMap((chart, ci) =>
    chart.series.map((_, si) => `charts[${ci}].series[${si}].unsPath`)
  );
  const envelope: ColumnChartEnvelope = {
    _id: existing?._id ?? `widget_${Date.now()}`,
    type: 'ColumnChart',
    general: { title: uiConfig.title },
    uiConfig,
    dynamicBindingPathList: buildDynamicBindingPathList(uiConfig, seriesKeys),
  };
  if (timeConfig) envelope.timeConfig = timeConfig;
  if (timeTabConfig) envelope.timeTabConfig = timeTabConfig;
  return envelope;
}

type ActiveTab = 'data' | 'time' | 'style';
type ModalSection = 'series' | 'fixed' | 'plotLine' | 'plotBand' | 'axis' | 'stack';

// Per-section copy for the unified delete-confirm modal that opens when the
// user clicks the trash icon on any row inside the configurator's accordions.
type DeleteKind = 'series' | 'fixed' | 'axis' | 'stack' | 'plotLine' | 'plotBand';
const DELETE_COPY: Record<DeleteKind, { title: string; body: string }> = {
  series:   { title: 'Delete Data Source',  body: 'Are you sure you want to delete this data source? This action is irreversible.' },
  fixed:    { title: 'Delete Fixed Series', body: 'Are you sure you want to delete this fixed series? This action is irreversible.' },
  axis:     { title: 'Delete Axis',         body: 'Are you sure you want to delete this axis? This action is irreversible.' },
  stack:    { title: 'Delete Stack',        body: 'Are you sure you want to delete this stack? This action is irreversible.' },
  plotLine: { title: 'Delete Plot Line',    body: 'Are you sure you want to delete this plot line? This action is irreversible.' },
  plotBand: { title: 'Delete Plot Band',    body: 'Are you sure you want to delete this plot band? This action is irreversible.' },
};

// Curated chart-friendly palette — better than raw Math.random() RGB which
// produces muddy / low-contrast colors. Used as the default seed when the
// user opens any Add modal so the Color field is never blank on open.
const DEFAULT_COLOR_PALETTE = [
  '#7B61FF', '#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77',
  '#4D96FF', '#FF8FB1', '#A66CFF', '#FFA94D', '#22C55E',
  '#06B6D4', '#F472B6', '#8B5CF6', '#F59E0B', '#10B981',
];
function pickRandomColor(): string {
  return DEFAULT_COLOR_PALETTE[Math.floor(Math.random() * DEFAULT_COLOR_PALETTE.length)];
}

// Ensures a default Left axis exists on the chart, and appends `newSourceId`
// to it. Called whenever a series / fixed-series is added so the user never
// has to create an axis manually before they see something on the chart.
// If a left axis (yAxis === 0) already exists, the new source joins it; if
// not, a brand-new "Left axis" entry is created. Idempotent w.r.t. ids
// already present in the axis's seriesIds.
function ensureLeftAxisWithSource(axes: AxisConfig[], newSourceId: string): AxisConfig[] {
  const leftIdx = axes.findIndex((a) => a.yAxis === 0);
  if (leftIdx >= 0) {
    const left = axes[leftIdx];
    if (left.seriesIds.includes(newSourceId)) return axes;
    return axes.map((a, i) => i === leftIdx ? { ...a, seriesIds: [...a.seriesIds, newSourceId] } : a);
  }
  const defaultLeft: AxisConfig = {
    _id: `axis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Left axis',
    yAxis: 0,
    seriesIds: [newSourceId],
  };
  return [...axes, defaultLeft];
}

// Removes `sourceId` from every axis's seriesIds — used when a data source
// is deleted so axes don't retain stale ids.
function removeSourceFromAxes(axes: AxisConfig[], sourceId: string): AxisConfig[] {
  return axes.map((a) => a.seriesIds.includes(sourceId)
    ? { ...a, seriesIds: a.seriesIds.filter((id) => id !== sourceId) }
    : a);
}

function makeDefaultChart(): ChartConfig {
  return makeEmptyChart();
}

// Empty buffer used by the chart-settings state machine (Empty + Edit-new modes).
// Includes `description` on top of the ChartConfig shape — coerced via a Partial
// because the upstream type doesn't ship a description field; the configurator
// keeps it on the chart object so each chart owns its own.
function makeEmptyChart(): ChartConfig {
  return {
    _id: `chart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    series: [],
    fixedSeries: [],
    axes: [],
    stacks: [],
    plotLines: [],
    plotBands: [],
  };
}

export function ColumnChartConfiguration(props: ColumnChartConfigurationProps) {
  const { config, authentication, onChange, onBack } = props;

  const hasInjectedUNS =
    props.unsTree !== undefined &&
    props.onLoadWorkspaces !== undefined &&
    props.resolveUNSValue !== undefined;

  const hookResult = useUNSTree(hasInjectedUNS ? undefined : authentication);
  const unsTree         = hasInjectedUNS ? props.unsTree!              : hookResult.unsTree;
  const isLoadingTree   = hasInjectedUNS ? (props.isLoadingTree ?? false) : hookResult.isLoadingTree;
  const loadWorkspaces  = hasInjectedUNS ? props.onLoadWorkspaces!     : hookResult.loadWorkspaces;
  const resolveUNSValue = hasInjectedUNS ? props.resolveUNSValue!      : hookResult.resolveUNSValue;

  useEffect(() => {
    if (authentication) loadWorkspaces();
  }, [authentication]);

  const [activeTab, setActiveTab] = useState<ActiveTab>('data');

  // ── Charts list + chart-settings state machine ───────────────────────────
  // charts = committed source of truth. Empty on first mount → "Empty" mode.
  // activeChartId points the form at one committed chart in View mode.
  // pendingChart / draft are scratch buffers — never emit until commitState().
  const initCharts = config?.uiConfig?.charts ?? [];
  const [chartsList,       setChartsList]       = useState<ChartConfig[]>(initCharts);
  const [selectedChartId,  setSelectedChartId]  = useState<string>(initCharts[0]?._id ?? '');
  const [chartPickerOpen,  setChartPickerOpen]  = useState(false);
  const [pendingChart,     setPendingChart]     = useState<ChartConfig>(() => makeEmptyChart());
  const [draft,            setDraft]            = useState<ChartConfig | null>(null);
  const [editMode,         setEditMode]         = useState<'none' | 'edit-existing' | 'edit-new'>('none');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Per-row delete confirm (data source, fixed series, axis, stack, plot
  // line, plot band). null when no confirm is pending.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: DeleteKind; chartId: string; id: string } | null>(null);

  // ── Expanded sections for the selected chart ──────────────────────────────
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // ── Widget-level state ────────────────────────────────────────────────────
  const [currentTimeConfig,    setCurrentTimeConfig]    = useState<TimeConfig | undefined>(config?.timeConfig);
  const [currentTimeTabConfig, setCurrentTimeTabConfig] = useState<Record<string, unknown> | undefined>(config?.timeTabConfig);
  const [wrapInCard,     setWrapInCard]     = useState(config?.uiConfig?.style?.card?.wrapInCard ?? true);
  const [cardBackgroundColor, setCardBackgroundColor] = useState(config?.uiConfig?.style?.card?.backgroundColor ?? DEFAULT_CARD_STYLE.backgroundColor);
  const [cardBorderColor,     setCardBorderColor]     = useState(config?.uiConfig?.style?.card?.borderColor     ?? DEFAULT_CARD_STYLE.borderColor);
  const [cardBorderWidth,     setCardBorderWidth]     = useState(String(config?.uiConfig?.style?.card?.borderWidth  ?? DEFAULT_CARD_STYLE.borderWidth));
  const [cardBorderRadius,    setCardBorderRadius]    = useState(String(config?.uiConfig?.style?.card?.borderRadius ?? DEFAULT_CARD_STYLE.borderRadius));
  const [stacked,        setStacked]        = useState(config?.uiConfig?.style?.stacked ?? false);
  const [showLegend,     setShowLegend]     = useState(config?.uiConfig?.style?.showLegend ?? true);
  const [showDataLabels, setShowDataLabels] = useState(config?.uiConfig?.style?.showDataLabels ?? false);
  const [yAxisUnit,      setYAxisUnit]      = useState(config?.uiConfig?.style?.yAxisUnit ?? '');
  const [widgetSizePickerOpen, setWidgetSizePickerOpen] = useState(false);
  const initialWidgetSize = config?.uiConfig?.style?.widgetSize ?? {
    preset: 'Medium' as const,
    ...getWidgetSizeDimensions('Medium'),
    locked: false,
  };
  const widgetAspectRatioRef = useRef(initialWidgetSize.width / Math.max(initialWidgetSize.height, 1));
  const [widgetSizePreset, setWidgetSizePreset] = useState<WidgetSizePreset>(initialWidgetSize.preset);
  const [widgetWidth,     setWidgetWidth]     = useState(String(initialWidgetSize.width));
  const [widgetHeight,    setWidgetHeight]    = useState(String(initialWidgetSize.height));
  const [widgetLocked,    setWidgetLocked]    = useState(Boolean(initialWidgetSize.locked));
  const [widgetElementsEnabled, setWidgetElementsEnabled] = useState(
    Boolean(
      config?.uiConfig?.style?.widgetElements?.hideWidgetElements ||
      config?.uiConfig?.style?.widgetElements?.hideSettingsIcon ||
      config?.uiConfig?.style?.widgetElements?.hideExportIcon ||
      config?.uiConfig?.style?.widgetElements?.hideChartTitle,
    ),
  );
  const [hideSettingsIcon, setHideSettingsIcon] = useState(config?.uiConfig?.style?.widgetElements?.hideSettingsIcon ?? false);
  const [hideExportIcon,   setHideExportIcon]   = useState(config?.uiConfig?.style?.widgetElements?.hideExportIcon ?? false);
  const [hideChartTitle,   setHideChartTitle]   = useState(config?.uiConfig?.style?.widgetElements?.hideChartTitle ?? false);
  const [hideInfoIcon,     setHideInfoIcon]     = useState(config?.uiConfig?.style?.widgetElements?.hideInfoIcon ?? false);
  const [advancedSettings, setAdvancedSettings] = useState<WidgetAdvancedSettingsConfig>({
    ...DEFAULT_ADVANCED_SETTINGS,
    ...sanitizeAdvancedSettings(config?.uiConfig?.style?.advancedSettings ?? {}),
  });
  const [advancedTitleWeightOpen, setAdvancedTitleWeightOpen] = useState(false);
  const [advancedHeaderWeightOpen, setAdvancedHeaderWeightOpen] = useState(false);
  const [advancedBaseWeightOpen,   setAdvancedBaseWeightOpen]   = useState(false);

  // ── Modal state ───────────────────────────────────────────────────────────
  const configRef = useRef<HTMLDivElement>(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalChartId, setModalChartId] = useState<string | null>(null);
  const [modalSection, setModalSection] = useState<ModalSection>('series');
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [modalX,       setModalX]       = useState(0);
  const [modalY,       setModalY]       = useState(0);
  const [formUnsPath,  setFormUnsPath]  = useState('');
  const [formLabel,    setFormLabel]    = useState('');
  const [formColor,    setFormColor]    = useState('');
  const [formUnit,      setFormUnit]      = useState('');
  const [formPrecision, setFormPrecision] = useState('');
  const [formValue,    setFormValue]    = useState('');
  const [formFrom,     setFormFrom]     = useState('');
  const [formTo,       setFormTo]       = useState('');
  const [formWidth,    setFormWidth]    = useState('');
  const [formDashStyle,               setFormDashStyle]               = useState('');
  const [formDashStylePickerOpen,     setFormDashStylePickerOpen]     = useState(false);
  const [formAxisName,                setFormAxisName]                = useState('');
  const [formAxisYAxis,               setFormAxisYAxis]               = useState<0 | 1>(0);
  const [formAxisSeriesIds,           setFormAxisSeriesIds]           = useState<string[]>([]);
  const [formAxisSeriesDropdownOpen,   setFormAxisSeriesDropdownOpen]   = useState(false);
  const [formStackName,               setFormStackName]               = useState('');
  const [formStackSeriesIds,          setFormStackSeriesIds]          = useState<string[]>([]);
  const [formStackSeriesDropdownOpen, setFormStackSeriesDropdownOpen] = useState(false);
  const [formPeriodicityType,         setFormPeriodicityType]         = useState<'independent' | 'dependent'>('independent');
  const [formPeriodicities,           setFormPeriodicities]           = useState<PlotLinePeriodicity[]>([]);
  const [formCurrentPeriodicity,      setFormCurrentPeriodicity]      = useState('');
  const [formPeriodicityDropdownOpen, setFormPeriodicityDropdownOpen] = useState(false);

  // Style tab accordion expanded state

  useEffect(() => {
    if (config) {
      const raw = config.uiConfig?.charts ?? [];
      // Migrate legacy widget-level title/description onto the first chart if
      // the first chart doesn't carry its own.
      let charts = raw;
      if (charts.length > 0) {
        const legacyTitle = config.uiConfig?.title;
        const legacyDesc  = config.uiConfig?.description;
        const patch: Partial<ChartConfig> = {};
        if (!charts[0].title && legacyTitle) patch.title = legacyTitle;
        if (charts[0].description === undefined && legacyDesc !== undefined) patch.description = legacyDesc;
        if (Object.keys(patch).length > 0) {
          charts = charts.map((c, i) => (i === 0 ? { ...c, ...patch } : c));
        }
      }
      setChartsList(charts);
      const persistedActive = config.uiConfig?.activeChartId;
      const nextActiveId =
        (persistedActive && charts.find((c) => c._id === persistedActive)) ? persistedActive : (charts[0]?._id ?? '');
      setSelectedChartId(nextActiveId);
      // Drop any in-flight edit/empty buffers so the form snaps to the loaded chart.
      setPendingChart(makeEmptyChart());
      setDraft(null);
      setEditMode('none');
      setDeleteConfirmOpen(false);
      setWrapInCard(config.uiConfig?.style?.card?.wrapInCard ?? true);
      setCardBackgroundColor(config.uiConfig?.style?.card?.backgroundColor ?? DEFAULT_CARD_STYLE.backgroundColor);
      setCardBorderColor(config.uiConfig?.style?.card?.borderColor ?? DEFAULT_CARD_STYLE.borderColor);
      setCardBorderWidth(String(config.uiConfig?.style?.card?.borderWidth  ?? DEFAULT_CARD_STYLE.borderWidth));
      setCardBorderRadius(String(config.uiConfig?.style?.card?.borderRadius ?? DEFAULT_CARD_STYLE.borderRadius));
      setStacked(config.uiConfig?.style?.stacked ?? false);
      setShowLegend(config.uiConfig?.style?.showLegend ?? true);
      setShowDataLabels(config.uiConfig?.style?.showDataLabels ?? false);
      setYAxisUnit(config.uiConfig?.style?.yAxisUnit ?? '');
      setWidgetSizePickerOpen(false);
      const nextWidgetSize = config.uiConfig?.style?.widgetSize ?? {
        preset: 'Medium' as const,
        ...getWidgetSizeDimensions('Medium'),
        locked: false,
      };
      setWidgetSizePreset(nextWidgetSize.preset);
      setWidgetWidth(String(nextWidgetSize.width));
      setWidgetHeight(String(nextWidgetSize.height));
      setWidgetLocked(Boolean(nextWidgetSize.locked));
      const nextWidgetElements = config.uiConfig?.style?.widgetElements ?? {
        hideWidgetElements: false,
        hideSettingsIcon: false,
        hideExportIcon: false,
        hideChartTitle: false,
      };
      setWidgetElementsEnabled(
        nextWidgetElements.hideWidgetElements ||
        nextWidgetElements.hideSettingsIcon ||
        nextWidgetElements.hideExportIcon ||
        nextWidgetElements.hideChartTitle,
      );
      setHideSettingsIcon(nextWidgetElements.hideSettingsIcon);
      setHideExportIcon(nextWidgetElements.hideExportIcon);
      setHideChartTitle(nextWidgetElements.hideChartTitle);
      setHideInfoIcon(nextWidgetElements.hideInfoIcon ?? false);
      setAdvancedSettings({
        ...DEFAULT_ADVANCED_SETTINGS,
        ...sanitizeAdvancedSettings(config.uiConfig?.style?.advancedSettings ?? {}),
      });
      setAdvancedTitleWeightOpen(false);
      setCurrentTimeConfig(config.timeConfig);
      setCurrentTimeTabConfig(config.timeTabConfig);
    }
  }, [config?._id]);

  // The above effect only re-patches when the widget _id changes. The host may
  // re-pass the same envelope (same _id) after an external save → reopen, with
  // an updated timeTabConfig that local state doesn't yet reflect. Re-sync the
  // time-tab state any time the prop reference for it changes; on echo from
  // our own emit (same object reference) React no-ops the setState.
  useEffect(() => {
    if (config?.timeTabConfig) setCurrentTimeTabConfig(config.timeTabConfig);
  }, [config?.timeTabConfig]);
  useEffect(() => {
    if (config?.timeConfig) setCurrentTimeConfig(config.timeConfig);
  }, [config?.timeConfig]);

  // ── Builders ──────────────────────────────────────────────────────────────

  function buildUiConfig(overrides: {
    charts?: ChartConfig[];
    activeChartId?: string;
    title?: string;
    description?: string;
    wrapInCard?: boolean;
    cardBackgroundColor?: string;
    cardBorderColor?: string;
    cardBorderWidth?: number;
    cardBorderRadius?: number;
    stacked?: boolean;
    showLegend?: boolean;
    showDataLabels?: boolean;
    yAxisUnit?: string;
    widgetSize?: WidgetSizeConfig;
    widgetElements?: WidgetElementsConfig;
    advancedSettings?: WidgetAdvancedSettingsConfig;
  }): ColumnChartUIConfig {
    const nextCharts = overrides.charts ?? chartsList;
    const nextActiveId = overrides.activeChartId ?? selectedChartId;
    const nextActiveChart = nextCharts.find((c) => c._id === nextActiveId) ?? nextCharts[0];
    return {
      title:       overrides.title       ?? (nextActiveChart?.title ?? ''),
      description: (overrides.description ?? nextActiveChart?.description) || undefined,
      charts:      nextCharts,
      activeChartId: nextActiveChart?._id,
      style: {
        card: {
          wrapInCard:      overrides.wrapInCard      ?? wrapInCard,
          bg:              '',
          backgroundColor: overrides.cardBackgroundColor ?? cardBackgroundColor,
          borderColor:     overrides.cardBorderColor     ?? cardBorderColor,
          borderWidth:     overrides.cardBorderWidth     ?? (Number(cardBorderWidth)  || DEFAULT_CARD_STYLE.borderWidth),
          borderRadius:    overrides.cardBorderRadius    ?? (Number(cardBorderRadius) || DEFAULT_CARD_STYLE.borderRadius),
        },
        stacked:        overrides.stacked        ?? stacked,
        showLegend:     overrides.showLegend     ?? showLegend,
        showDataLabels: overrides.showDataLabels ?? showDataLabels,
        yAxisUnit:      overrides.yAxisUnit      ?? yAxisUnit,
        widgetSize:     overrides.widgetSize     ?? {
          preset: widgetSizePreset,
          width: Number(widgetWidth) || getWidgetSizeDimensions(widgetSizePreset).width,
          height: Number(widgetHeight) || getWidgetSizeDimensions(widgetSizePreset).height,
          locked: widgetLocked,
        },
        widgetElements: overrides.widgetElements ?? {
          hideWidgetElements: hideSettingsIcon || hideExportIcon || hideChartTitle,
          hideSettingsIcon,
          hideExportIcon,
          hideChartTitle,
        },
        advancedSettings: overrides.advancedSettings ?? advancedSettings,
      },
    };
  }

  function parseWidgetDimension(raw: string, fallback: number) {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  }

  function emitWidgetSize(next: WidgetSizeConfig) {
    emit({ widgetSize: next });
  }

  function applyWidgetSizePreset(preset: WidgetSizePreset) {
    setWidgetSizePreset(preset);
    setWidgetSizePickerOpen(false);
    if (preset === 'Custom') {
      const width = parseWidgetDimension(widgetWidth, getWidgetSizeDimensions('Medium').width);
      const height = parseWidgetDimension(widgetHeight, getWidgetSizeDimensions('Medium').height);
      widgetAspectRatioRef.current = width / Math.max(height, 1);
      emitWidgetSize({ preset, width, height, locked: widgetLocked });
      return;
    }
    const dims = getWidgetSizeDimensions(preset);
    widgetAspectRatioRef.current = dims.width / Math.max(dims.height, 1);
    setWidgetWidth(String(dims.width));
    setWidgetHeight(String(dims.height));
    setWidgetLocked(false);
    emitWidgetSize({ preset, width: dims.width, height: dims.height, locked: false });
  }

  function applyWidgetWidth(nextValue: string) {
    const fallbackWidth = parseWidgetDimension(widgetWidth, getWidgetSizeDimensions(widgetSizePreset === 'Custom' ? 'Medium' : widgetSizePreset).width);
    const fallbackHeight = parseWidgetDimension(widgetHeight, getWidgetSizeDimensions(widgetSizePreset === 'Custom' ? 'Medium' : widgetSizePreset).height);
    if (!widgetLocked || widgetSizePreset !== 'Custom') {
      setWidgetWidth(nextValue);
      const width = parseWidgetDimension(nextValue, fallbackWidth);
      if (width > 0 && fallbackHeight > 0) {
        widgetAspectRatioRef.current = width / fallbackHeight;
      }
      emitWidgetSize({
        preset: widgetSizePreset,
        width,
        height: fallbackHeight,
        locked: widgetLocked,
      });
      return;
    }
    const nextWidth = parseWidgetDimension(nextValue, fallbackWidth);
    const ratio = widgetAspectRatioRef.current || (fallbackWidth / Math.max(fallbackHeight, 1));
    const nextHeight = Math.max(1, Math.round(nextWidth / ratio));
    setWidgetWidth(nextValue);
    setWidgetHeight(String(nextHeight));
    emitWidgetSize({
      preset: 'Custom',
      width: nextWidth,
      height: nextHeight,
      locked: true,
    });
  }

  function applyWidgetHeight(nextValue: string) {
    const fallbackWidth = parseWidgetDimension(widgetWidth, getWidgetSizeDimensions(widgetSizePreset === 'Custom' ? 'Medium' : widgetSizePreset).width);
    const fallbackHeight = parseWidgetDimension(widgetHeight, getWidgetSizeDimensions(widgetSizePreset === 'Custom' ? 'Medium' : widgetSizePreset).height);
    if (!widgetLocked || widgetSizePreset !== 'Custom') {
      setWidgetHeight(nextValue);
      const height = parseWidgetDimension(nextValue, fallbackHeight);
      if (fallbackWidth > 0 && height > 0) {
        widgetAspectRatioRef.current = fallbackWidth / height;
      }
      emitWidgetSize({
        preset: widgetSizePreset,
        width: fallbackWidth,
        height,
        locked: widgetLocked,
      });
      return;
    }
    const nextHeight = parseWidgetDimension(nextValue, fallbackHeight);
    const ratio = widgetAspectRatioRef.current || (fallbackWidth / Math.max(fallbackHeight, 1));
    const nextWidth = Math.max(1, Math.round(nextHeight * ratio));
    setWidgetHeight(nextValue);
    setWidgetWidth(String(nextWidth));
    emitWidgetSize({
      preset: 'Custom',
      width: nextWidth,
      height: nextHeight,
      locked: true,
    });
  }

  function updateWidgetElements(patch: Partial<WidgetElementsConfig>) {
    const next = {
      hideSettingsIcon,
      hideExportIcon,
      hideChartTitle,
      hideInfoIcon,
      ...patch,
    };
    const nextHideWidgetElements = next.hideSettingsIcon || next.hideExportIcon || next.hideChartTitle || next.hideInfoIcon;
    if ('hideSettingsIcon' in patch) setHideSettingsIcon(next.hideSettingsIcon);
    if ('hideExportIcon' in patch) setHideExportIcon(next.hideExportIcon);
    if ('hideChartTitle' in patch) setHideChartTitle(next.hideChartTitle);
    if ('hideInfoIcon' in patch) setHideInfoIcon(next.hideInfoIcon ?? false);
    setWidgetElementsEnabled(nextHideWidgetElements ?? false);
    emit({ widgetElements: {
      hideWidgetElements: nextHideWidgetElements ?? false,
      hideSettingsIcon: next.hideSettingsIcon,
      hideExportIcon: next.hideExportIcon,
      hideChartTitle: next.hideChartTitle,
      hideInfoIcon: next.hideInfoIcon,
    }});
  }

  function updateAdvancedSettings(patch: Partial<WidgetAdvancedSettingsConfig>) {
    const next = {
      ...advancedSettings,
      ...patch,
    };
    setAdvancedSettings(next);
    emit({ advancedSettings: next });
  }

  function emit(
    uiOverrides: Parameters<typeof buildUiConfig>[0] = {},
    timeOverride?: { timeConfig?: TimeConfig; timeTabConfig?: Record<string, unknown> },
  ) {
    const uiConfig = buildUiConfig(uiOverrides);
    const tc  = timeOverride?.timeConfig    ?? currentTimeConfig;
    const ttc = timeOverride?.timeTabConfig ?? currentTimeTabConfig;
    onChange(buildEnvelope(config, uiConfig, tc, ttc));
  }

  function updateChartInList(chartId: string, update: Partial<ChartConfig>) {
    const next = chartsList.map((c) => c._id === chartId ? { ...c, ...update } : c);
    setChartsList(next);
    emit({ charts: next });
  }

  // ── Section accordion helpers ─────────────────────────────────────────────

  function isSectionOpen(section: string) {
    return expandedSections[section] ?? false;
  }

  function toggleSection(section: string) {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  // ── Chart-settings state machine: derived modes ──────────────────────────

  const activeChart: ChartConfig | null =
    chartsList.find((c) => c._id === selectedChartId) ?? chartsList[0] ?? null;
  const isEditing = editMode !== 'none';
  const isEmpty   = chartsList.length === 0 && !isEditing;
  const isView    = chartsList.length > 0 && !isEditing;
  // The single chart the form reads/writes, by mode.
  const formChart: ChartConfig | null =
    isEmpty ? pendingChart : (isEditing ? draft : activeChart) ?? null;
  const titleError = isEditing && (draft?.title?.trim() ?? '') === '';
  const canAddEmpty  = pendingChart.title.trim() !== '';
  const canCommitDraft = (d: ChartConfig | null) => d !== null && d.title.trim() !== '';

  // The single emit funnel — only this writes upstream. Buffers don't emit.
  function commitState(nextCharts: ChartConfig[], opts?: { activeChartId?: string }) {
    const nextActiveId = opts?.activeChartId ?? selectedChartId;
    // Emit when there's something to render, OR when an envelope already existed
    // (so deleting the last chart still notifies the parent to clear).
    if (nextCharts.length > 0 || config) {
      emit({ charts: nextCharts, activeChartId: nextActiveId });
    }
  }

  // Route every field change to the right target by mode. View edits commit live.
  function patchActive(patch: Partial<ChartConfig>) {
    if (editMode !== 'none') {
      setDraft((d) => ({ ...(d ?? makeEmptyChart()), ...patch }));
      return;
    }
    if (chartsList.length === 0) {
      setPendingChart((p) => ({ ...p, ...patch }));
      return;
    }
    const next = chartsList.map((c) => (c._id === selectedChartId ? { ...c, ...patch } : c));
    setChartsList(next);
    commitState(next);
  }

  // Reset section expanded state when switching charts (View-mode dropdown).
  function selectChart(chartId: string) {
    setSelectedChartId(chartId);
    setChartPickerOpen(false);
    setExpandedSections({});
    commitState(chartsList, { activeChartId: chartId });
  }

  // Empty mode → promote pendingChart to the first committed chart.
  function handleEmptyAddChart() {
    if (!canAddEmpty) return;
    const committed: ChartConfig = { ...pendingChart, title: pendingChart.title.trim() };
    const next = [committed];
    setChartsList(next);
    setSelectedChartId(committed._id);
    setPendingChart(makeEmptyChart());
    commitState(next, { activeChartId: committed._id });
  }

  function startEditNew() {
    setDraft(makeEmptyChart());
    setEditMode('edit-new');
  }

  function startEditExisting() {
    if (!activeChart) return;
    // Edit a COPY of the active chart so Cancel discards cleanly.
    setDraft({ ...activeChart });
    setEditMode('edit-existing');
  }

  function saveDraft() {
    if (!canCommitDraft(draft)) return;
    const committed: ChartConfig = { ...draft!, title: draft!.title.trim() };
    const next = editMode === 'edit-existing'
      ? chartsList.map((c) => (c._id === committed._id ? committed : c))
      : [...chartsList, committed];
    setChartsList(next);
    setSelectedChartId(committed._id);
    setExpandedSections({});
    commitState(next, { activeChartId: committed._id });
    setDraft(null);
    setEditMode('none');
  }

  function cancelEdit() {
    setDraft(null);
    setEditMode('none');
  }

  function removeActiveChart() {
    if (!activeChart) return;
    const removedId = activeChart._id;
    const remaining = chartsList.filter((c) => c._id !== removedId);
    setDraft(null);
    setEditMode('none');
    setDeleteConfirmOpen(false);
    setExpandedSections({});
    if (remaining.length === 0) {
      setChartsList([]);
      setSelectedChartId('');
      setPendingChart(makeEmptyChart());
      commitState([], { activeChartId: '' });
      return;
    }
    const fallback = remaining[0];
    setChartsList(remaining);
    setSelectedChartId(fallback._id);
    commitState(remaining, { activeChartId: fallback._id });
  }

  // Confirm + execute deletion of the currently-pending row target. Routes
  // by `kind` so each section's array on the active chart is rebuilt without
  // the deleted entry. Series / fixed-series deletes also strip the deleted
  // id from any axis that references it via `removeSourceFromAxes`.
  function confirmDeleteTarget() {
    if (!deleteTarget) return;
    const chart = chartsList.find((c) => c._id === deleteTarget.chartId);
    if (!chart) { setDeleteTarget(null); return; }
    const id = deleteTarget.id;
    let update: Partial<ChartConfig> = {};
    switch (deleteTarget.kind) {
      case 'series':
        update = {
          series: chart.series.filter((x) => x._id !== id),
          axes:   removeSourceFromAxes(chart.axes ?? [], id),
        };
        break;
      case 'fixed':
        update = {
          fixedSeries: chart.fixedSeries.filter((x) => x._id !== id),
          axes:        removeSourceFromAxes(chart.axes ?? [], id),
        };
        break;
      case 'axis':
        update = { axes: (chart.axes ?? []).filter((x) => x._id !== id) };
        break;
      case 'stack':
        update = { stacks: chart.stacks.filter((x) => x._id !== id) };
        break;
      case 'plotLine':
        update = { plotLines: chart.plotLines.filter((x) => x._id !== id) };
        break;
      case 'plotBand':
        update = { plotBands: chart.plotBands.filter((x) => x._id !== id) };
        break;
    }
    updateChartInList(deleteTarget.chartId, update);
    setDeleteTarget(null);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  // Anchor side-panel modals next to the clicked accordion row. Mirrors the
  // DataPoint widget's side-panel logic:
  //   x = configurator-column right edge + 20px gutter
  //   y = clicked accordion header's top, clamped into the viewport so the
  //       fully-expanded modal fits with a 16px safe margin.
  // estHeight is the fully-expanded modal body height — used only for the
  // viewport-fit clamp. CSS reads --cc-anchor-y to derive max-height.
  function computeAnchorFromEvent(e: React.MouseEvent, estHeight = 500) {
    const margin = 16;
    const trigger = e.currentTarget as HTMLElement | null;
    const headerEl =
      (trigger?.closest('.fds-pa-item__header') as HTMLElement | null) ??
      (trigger?.closest('.fds-pa-item') as HTMLElement | null) ??
      trigger;
    const anchorRect = headerEl?.getBoundingClientRect();
    const panelEl =
      (configRef.current?.closest('.app__config') as HTMLElement | null) ??
      configRef.current;
    const panelRect = panelEl?.getBoundingClientRect();
    const x = (panelRect?.right ?? 0) + 20;
    const vh = window.innerHeight;
    let y = anchorRect?.top ?? margin;
    if (y + estHeight + margin > vh) {
      y = Math.max(margin, vh - estHeight - margin);
    }
    if (y < margin) y = margin;
    setModalX(x);
    setModalY(y);
    document.documentElement.style.setProperty('--cc-anchor-y', `${y}px`);
  }

  // Per-section expected fully-expanded heights. Used by computeAnchorFromEvent
  // only for the viewport-fit clamp (no hard size constraint applied below).
  const SECTION_EST_HEIGHT: Record<ModalSection, number> = {
    series:   480, // Label + Color + UNS + Unit/Precision row
    fixed:    420, // Label + Color + UNS
    axis:     360, // Name + side + series multi-select
    stack:    320, // Name + series multi-select
    plotLine: 620, // Label + value + color + width + dashStyle + periodicity block
    plotBand: 380, // Label + from/to + color
  };

  function openAddModal(chartId: string, section: ModalSection, e: React.MouseEvent) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT[section]);
    setModalChartId(chartId);
    setModalSection(section);
    setEditingId(null);
    setFormUnsPath(''); setFormLabel(''); setFormColor(pickRandomColor()); setFormUnit(''); setFormPrecision('');
    setFormAxisName(''); setFormAxisYAxis(0); setFormAxisSeriesIds([]); setFormAxisSeriesDropdownOpen(false);
    setFormStackName(''); setFormStackSeriesIds([]); setFormStackSeriesDropdownOpen(false);
    setFormValue(''); setFormFrom(''); setFormTo(''); setFormWidth('');
    setFormDashStyle(''); setFormDashStylePickerOpen(false);
    setFormPeriodicityType('independent'); setFormPeriodicities([]); setFormCurrentPeriodicity(''); setFormPeriodicityDropdownOpen(false);
    setModalOpen(true);
  }

  function openEditModal(
    chartId: string,
    section: ModalSection,
    e: React.MouseEvent,
    item: ColumnChartSeriesConfig | { _id: string; unsPath: string; label: string; color?: string; unit?: string },
  ) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT[section]);
    setModalChartId(chartId);
    setModalSection(section);
    setEditingId(item._id);
    setFormUnsPath(item.unsPath);
    setFormLabel(item.label);
    setFormColor(item.color ?? '');
    setFormUnit((item as ColumnChartSeriesConfig).unit ?? '');
    const p = (item as ColumnChartSeriesConfig).precision;
    setFormPrecision(p !== undefined ? String(p) : '');
    setModalOpen(true);
  }

  function openEditPlotLineModal(chartId: string, e: React.MouseEvent, item: PlotLineConfig) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT.plotLine);
    setModalChartId(chartId);
    setModalSection('plotLine');
    setEditingId(item._id);
    setFormValue(String(item.value));
    setFormLabel(item.label);
    setFormColor(item.color);
    setFormWidth(item.width !== undefined ? String(item.width) : '');
    setFormDashStyle(item.dashStyle ?? '');
    setFormDashStylePickerOpen(false);
    setFormPeriodicityType(item.periodicityType ?? 'independent');
    setFormPeriodicities(item.periodicities ?? []);
    setFormCurrentPeriodicity('');
    setFormPeriodicityDropdownOpen(false);
    setModalOpen(true);
  }

  function openEditPlotBandModal(chartId: string, e: React.MouseEvent, item: PlotBandConfig) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT.plotBand);
    setModalChartId(chartId);
    setModalSection('plotBand');
    setEditingId(item._id);
    setFormFrom(String(item.from));
    setFormTo(String(item.to));
    setFormLabel(item.label);
    setFormColor(item.color);
    setModalOpen(true);
  }

  function openAddAxisModal(chartId: string, e: React.MouseEvent) {
    openAddModal(chartId, 'axis', e);
  }

  function openEditAxisModal(chartId: string, e: React.MouseEvent, item: AxisConfig) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT.axis);
    setModalChartId(chartId);
    setModalSection('axis');
    setEditingId(item._id);
    setFormAxisName(item.name);
    setFormAxisYAxis(item.yAxis);
    setFormAxisSeriesIds([...item.seriesIds]);
    setFormAxisSeriesDropdownOpen(false);
    setModalOpen(true);
  }

  function openEditStackModal(chartId: string, e: React.MouseEvent, stack: StackConfig) {
    e.stopPropagation();
    computeAnchorFromEvent(e, SECTION_EST_HEIGHT.stack);
    setModalChartId(chartId);
    setModalSection('stack');
    setEditingId(stack._id);
    setFormStackName(stack.name);
    setFormStackSeriesIds([...stack.seriesIds]);
    setFormStackSeriesDropdownOpen(false);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setModalChartId(null);
    setEditingId(null);
    setFormUnsPath(''); setFormLabel(''); setFormColor(''); setFormUnit(''); setFormPrecision('');
    setFormAxisName(''); setFormAxisYAxis(0); setFormAxisSeriesIds([]); setFormAxisSeriesDropdownOpen(false);
    setFormStackName(''); setFormStackSeriesIds([]); setFormStackSeriesDropdownOpen(false);
    setFormValue(''); setFormFrom(''); setFormTo(''); setFormWidth('');
    setFormDashStyle(''); setFormDashStylePickerOpen(false);
    setFormPeriodicityType('independent'); setFormPeriodicities([]); setFormCurrentPeriodicity(''); setFormPeriodicityDropdownOpen(false);
  }

  function handleModalSubmit() {
    if (!modalChartId) { handleModalClose(); return; }
    const chart = chartsList.find((c) => c._id === modalChartId);
    if (!chart) { handleModalClose(); return; }

    let update: Partial<ChartConfig> = {};

    if (modalSection === 'series') {
      const entry: ColumnChartSeriesConfig = {
        _id: editingId ?? `series_${Date.now()}`,
        unsPath: formUnsPath,
        label: formLabel,
        color: formColor || undefined,
        unit: formUnit || undefined,
        precision: formPrecision !== '' ? Number(formPrecision) : undefined,
      };
      const isAdding = !editingId;
      update = {
        series: editingId
          ? chart.series.map((s) => s._id === editingId ? entry : s)
          : [...chart.series, entry],
        ...(isAdding ? { axes: ensureLeftAxisWithSource(chart.axes ?? [], entry._id) } : {}),
      };
    } else if (modalSection === 'plotLine') {
      const rawValue = formValue.trim();
      const entry: PlotLineConfig = {
        _id: editingId ?? `pl_${Date.now()}`,
        value: VARIABLE_REGEX.test(rawValue) ? rawValue : (parseFloat(rawValue) || 0),
        label: formLabel,
        color: formColor,
        ...(formWidth ? { width: parseFloat(formWidth) } : {}),
        ...(formDashStyle ? { dashStyle: formDashStyle as PlotLineConfig['dashStyle'] } : {}),
        periodicityType: formPeriodicityType,
        ...(formPeriodicityType === 'dependent' && formPeriodicities.length > 0 ? { periodicities: formPeriodicities } : {}),
      };
      update = {
        plotLines: editingId
          ? chart.plotLines.map((p) => p._id === editingId ? entry : p)
          : [...chart.plotLines, entry],
      };
    } else if (modalSection === 'plotBand') {
      const rawFrom = formFrom.trim();
      const rawTo   = formTo.trim();
      const entry: PlotBandConfig = {
        _id: editingId ?? `pb_${Date.now()}`,
        from: VARIABLE_REGEX.test(rawFrom) ? rawFrom : (parseFloat(rawFrom) || 0),
        to:   VARIABLE_REGEX.test(rawTo)   ? rawTo   : (parseFloat(rawTo)   || 0),
        label: formLabel,
        color: formColor,
      };
      update = {
        plotBands: editingId
          ? chart.plotBands.map((p) => p._id === editingId ? entry : p)
          : [...chart.plotBands, entry],
      };
    } else if (modalSection === 'stack') {
      const entry: StackConfig = {
        _id: editingId ?? `stack_${Date.now()}`,
        name: formStackName,
        seriesIds: formStackSeriesIds,
      };
      update = {
        stacks: editingId
          ? chart.stacks.map((s) => s._id === editingId ? entry : s)
          : [...chart.stacks, entry],
      };
    } else if (modalSection === 'axis') {
      const entry: AxisConfig = {
        _id: editingId ?? `axis_${Date.now()}`,
        name: formAxisName,
        yAxis: formAxisYAxis,
        seriesIds: formAxisSeriesIds,
      };
      const assignedSeries = new Set(formAxisSeriesIds);
      update = {
        axes: editingId
          ? (chart.axes ?? []).map((axis) => axis._id === editingId ? entry : axis)
          : [...(chart.axes ?? []), entry],
        series: chart.series.map((series) => assignedSeries.has(series._id)
          ? { ...series, yAxis: formAxisYAxis }
          : series),
        fixedSeries: chart.fixedSeries.map((series) => assignedSeries.has(series._id)
          ? { ...series, yAxis: formAxisYAxis }
          : series),
      };
    } else {
      const entry: ColumnChartSeriesConfig = {
        _id: editingId ?? `fixed_${Date.now()}`,
        unsPath: formUnsPath,
        label: formLabel,
        color: formColor || undefined,
      };
      const isAdding = !editingId;
      update = {
        fixedSeries: editingId
          ? chart.fixedSeries.map((s) => s._id === editingId ? entry : s)
          : [...chart.fixedSeries, entry],
        ...(isAdding ? { axes: ensureLeftAxisWithSource(chart.axes ?? [], entry._id) } : {}),
      };
    }

    updateChartInList(modalChartId, update);
    handleModalClose();
  }

  // ── Time ──────────────────────────────────────────────────────────────────

  function handleTimeChange(ttc: TimeTabUIConfig) {
    const tc     = mapTimeTabToTimeConfig(ttc);
    logTimeConfig(ttc, tc);
    const ttcRaw = ttc as unknown as Record<string, unknown>;
    setCurrentTimeConfig(tc);
    setCurrentTimeTabConfig(ttcRaw);
    emit({}, { timeConfig: tc, timeTabConfig: ttcRaw });
  }

  // ── Selected chart ────────────────────────────────────────────────────────
  // `selectedChart` is consumed by the downstream Data-tab sections (series,
  // axes, plot lines, …). Those sections render in ALL modes (Empty too) so
  // the user sees the structure of the configurator. In Empty mode there's no
  // real chart, so fall back to an empty placeholder — the accordion bodies
  // will render their "No … configured" hints and every action gets gated by
  // `sectionsDisabled` below.

  const EMPTY_SECTION_CHART: ChartConfig = {
    _id: '', title: '', series: [], fixedSeries: [], axes: [], stacks: [], plotLines: [], plotBands: [],
  };
  const selectedChart =
    chartsList.find((c) => c._id === selectedChartId) ?? chartsList[0] ?? EMPTY_SECTION_CHART;
  const selectedChartIndex = chartsList.findIndex((c) => c._id === selectedChartId);
  // Sections show in every mode, but the user can only mutate them in View
  // (Empty → no chart to attach to; Editing → finish chart settings first).
  const sectionsDisabled = isEmpty || isEditing;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cc-config" ref={configRef}>
      <div className="cc-config__header">
        <IconButton
          icon={<ArrowLeft size={20} />}
          size="20"
          aria-label="Back"
          onClick={onBack}
        />
        <span className="BodyLargeSemibold cc-config__header-title">Column Chart</span>
      </div>

      <Tabs
        variant="Bordered"
        size="Medium"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ActiveTab)}
        isFullWidthTabItem
      >
        <TabItem value="data"  label="Data"  />
        <TabItem value="time"  label="Time"  />
        <TabItem value="style" label="Style" />
      </Tabs>

      <div className="cc-config__tab-content">

        {/* ── Data Tab ── */}
        {activeTab === 'data' && (
          <>
            {/* ── Chart Settings (3-mode state machine) ─────────────────── */}
            <div className="cc-config__chart-settings">
              <div className="cc-config__chart-settings-head">
                <p className="BodySmallSemibold cc-config__chart-settings-heading">Chart Settings</p>
                <span className="cc-config__chart-settings-actions">
                  {/* Edit-existing → trash. Edit-new draft has nothing committed
                      yet, so hide trash there to avoid deleting the previously
                      active chart by mistake. Cancel discards the draft. */}
                  {isEditing && editMode === 'edit-existing' && (
                    <IconButton
                      icon={<Trash2 size={14} />}
                      size="16"
                      aria-label="Delete chart"
                      onClick={() => setDeleteConfirmOpen(true)}
                    />
                  )}
                  {isView && (
                    <>
                      <Tooltip placement="Bottom" bodyText="Add New Chart">
                        <IconButton
                          icon={<Plus size={14} />}
                          size="16"
                          aria-label="Add chart"
                          onClick={startEditNew}
                        />
                      </Tooltip>
                      <Tooltip placement="Bottom" bodyText="Edit Chart">
                        <IconButton
                          icon={<Edit2 size={14} />}
                          size="16"
                          aria-label="Edit chart"
                          onClick={startEditExisting}
                        />
                      </Tooltip>
                    </>
                  )}
                </span>
              </div>

              {/* Title: switcher in View (multi-chart), TextInput otherwise. */}
              {isView && chartsList.length > 1 ? (
                <SelectInput
                  label="Chart title"
                  placeholder="Select chart"
                  value={activeChart?.title || `Chart`}
                  isOpen={chartPickerOpen}
                  onClick={() => setChartPickerOpen((v) => !v)}
                >
                  {chartPickerOpen && (
                    <DropdownMenu>
                      <ActionListItemGroup>
                        {chartsList.map((chart, i) => (
                          <ActionListItem
                            key={chart._id}
                            title={chart.title || `Chart ${i + 1}`}
                            selectionType="Single"
                            isSelected={selectedChartId === chart._id}
                            onClick={() => selectChart(chart._id)}
                          />
                        ))}
                      </ActionListItemGroup>
                    </DropdownMenu>
                  )}
                </SelectInput>
              ) : (
                <TextInput
                  label="Chart title"
                  necessityIndicator="required"
                  isReadOnly={isView}
                  placeholder={isView ? '—' : 'Enter chart title'}
                  value={formChart?.title ?? ''}
                  validationState={titleError ? 'error' : 'none'}
                  errorText="Chart title is required"
                  onChange={({ value }) => patchActive({ title: value })}
                />
              )}

              <TextInput
                label="Description"
                isReadOnly={isView}
                placeholder={isView ? '—' : 'Enter description'}
                value={formChart?.description ?? ''}
                onChange={({ value }) => patchActive({ description: value })}
              />

              {isEmpty && canAddEmpty && (
                <div className="cc-config__chart-settings-footer">
                  <Button variant="Primary" label="Save" onClick={handleEmptyAddChart} />
                </div>
              )}
              {isEditing && (
                <div className="cc-config__chart-settings-footer">
                  <Button variant="Gray" label="Cancel" onClick={cancelEdit} />
                  <Button
                    variant="Primary"
                    label={editMode === 'edit-existing' ? 'Save changes' : 'Save'}
                    isDisabled={!canCommitDraft(draft)}
                    onClick={saveDraft}
                  />
                </div>
              )}
            </div>

            {/* Downstream sections render in every mode so the user always sees
                the configurator's structure; in Empty/Editing they're disabled
                via `sectionsDisabled` so the chart-settings action completes
                first. */}
            <>
                {/* Data Source */}
                <ProductAccordionItem
                  title="Data Source"
                  trailingIcon={selectedChart.series.length > 0
                    ? <PATrailingItem trailing="Counter">{selectedChart.series.length}</PATrailingItem>
                    : undefined}
                  isActive={selectedChart.series.length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('series')}
                  onToggle={() => toggleSection('series')}
                  headerAction={
                    <IconButton
                      isDisabled={sectionsDisabled}
                      icon={<Plus size={14} />}
                      size="16"
                      aria-label="Add series"
                      onClick={(e) => openAddModal(selectedChart._id, 'series', e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.series.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No data sources. Click + to add one.</p>
                    )}
                    {selectedChart.series.map((s, i) => (
                      <ListCard
                        key={s._id}
                        className="cc-config__row-card"
                        title={s.label || `Series ${i + 1}`}
                        subtitle={s.unsPath || undefined}
                        leadingItem={s.color ? <ListCardLeadingItem leading="Color" color={s.color} /> : undefined}
                        onClick={(e) => openEditModal(selectedChart._id, 'series', e, s)}
                        trailingItems={
                          <ListCardTrailingItem trailing="Icon" icon={
                            <IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'series', chartId: selectedChart._id, id: s._id }); }} />
                          } />
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Fixed Series */}
                <ProductAccordionItem
                  title="Fixed Series"
                  trailingIcon={selectedChart.fixedSeries.length > 0
                    ? <PATrailingItem trailing="Counter">{selectedChart.fixedSeries.length}</PATrailingItem>
                    : undefined}
                  isActive={selectedChart.fixedSeries.length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('fixed')}
                  onToggle={() => toggleSection('fixed')}
                  headerAction={
                    <IconButton
                      isDisabled={sectionsDisabled}
                      icon={<Plus size={14} />}
                      size="16"
                      aria-label="Add fixed series"
                      onClick={(e) => openAddModal(selectedChart._id, 'fixed', e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.fixedSeries.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No fixed series. Click + to add.</p>
                    )}
                    {selectedChart.fixedSeries.map((s, i) => (
                      <ListCard
                        key={s._id}
                        className="cc-config__row-card"
                        title={s.label || `Fixed ${i + 1}`}
                        subtitle={s.unsPath || undefined}
                        leadingItem={s.color ? <ListCardLeadingItem leading="Color" color={s.color} /> : undefined}
                        onClick={(e) => openEditModal(selectedChart._id, 'fixed', e, s)}
                        trailingItems={
                          <ListCardTrailingItem trailing="Icon" icon={
                            <IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'fixed', chartId: selectedChart._id, id: s._id }); }} />
                          } />
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Axis */}
                <ProductAccordionItem
                  title="Axis"
                  trailingIcon={(selectedChart.axes ?? []).length > 0
                    ? <PATrailingItem trailing="Counter">{(selectedChart.axes ?? []).length}</PATrailingItem>
                    : undefined}
                  isActive={(selectedChart.axes ?? []).length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('axis')}
                  onToggle={() => toggleSection('axis')}
                  headerAction={
                    <IconButton
                      isDisabled={sectionsDisabled}
                      icon={<Plus size={14} />}
                      size="16"
                      aria-label="Add axis"
                      onClick={(e) => openAddAxisModal(selectedChart._id, e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {(selectedChart.axes ?? []).length === 0 ? (
                      <p className="cc-config__empty-hint BodySmallRegular">No axes. Click + to add.</p>
                    ) : (
                      (selectedChart.axes ?? []).map((axis) => {
                        const axisSeries = [
                          ...selectedChart.series,
                          ...selectedChart.fixedSeries,
                        ].filter((item) => axis.seriesIds.includes(item._id));
                        const axisLabel = axis.yAxis === 0 ? 'Left Axis' : 'Right Axis';
                        return (
                          <ListCard
                            key={axis._id}
                            className="cc-config__row-card"
                            title={axis.name || 'Unnamed Axis'}
                            subtitle={`${axisLabel}${axisSeries.length > 0 ? ` • ${axisSeries.length} series` : ''}`}
                            onClick={(e) => openEditAxisModal(selectedChart._id, e, axis)}
                            trailingItems={
                              <ListCardTrailingItem
                                trailing="Icon"
                                icon={(
                                  <IconButton
                                    icon={<Trash2 size={13} />}
                                    size="16"
                                    aria-label="Delete"
                                    onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'axis', chartId: selectedChart._id, id: axis._id }); }}
                                  />
                                )}
                              />
                            }
                          />
                        );
                      })
                    )}
                  </div>
                </ProductAccordionItem>

                {/* Stack */}
                <ProductAccordionItem
                  title="Stack"
                  trailingIcon={selectedChart.stacks.length > 0
                    ? <PATrailingItem trailing="Counter">{selectedChart.stacks.length}</PATrailingItem>
                    : undefined}
                  isActive={selectedChart.stacks.length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('stack')}
                  onToggle={() => toggleSection('stack')}
                  headerAction={
                    <IconButton
                      isDisabled={sectionsDisabled}
                      icon={<Plus size={14} />}
                      size="16"
                      aria-label="Add stack"
                      onClick={(e) => openAddModal(selectedChart._id, 'stack', e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.stacks.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No stacks. Click + to add.</p>
                    )}
                    {selectedChart.stacks.map((stack) => (
                      <ListCard
                        key={stack._id}
                        className="cc-config__row-card"
                        title={stack.name || 'Unnamed Stack'}
                        subtitle={stack.seriesIds.length > 0 ? `${stack.seriesIds.length} series` : undefined}
                        onClick={(e) => openEditStackModal(selectedChart._id, e, stack)}
                        trailingItems={
                          <ListCardTrailingItem trailing="Icon" icon={
                            <IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'stack', chartId: selectedChart._id, id: stack._id }); }} />
                          } />
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Plot Lines */}
                <ProductAccordionItem
                  title="Plot Lines"
                  trailingIcon={selectedChart.plotLines.length > 0
                    ? <PATrailingItem trailing="Counter">{selectedChart.plotLines.length}</PATrailingItem>
                    : undefined}
                  isActive={selectedChart.plotLines.length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('plotLine')}
                  onToggle={() => toggleSection('plotLine')}
                  headerAction={
                    <IconButton isDisabled={sectionsDisabled} icon={<Plus size={14} />} size="16" aria-label="Add plot line"
                      onClick={(e) => openAddModal(selectedChart._id, 'plotLine', e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.plotLines.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No plot lines. Click + to add.</p>
                    )}
                    {selectedChart.plotLines.map((p, i) => (
                      <ListCard
                        key={p._id}
                        className="cc-config__row-card"
                        title={p.label || `Plot Line ${i + 1}`}
                        subtitle={String(p.value)}
                        leadingItem={p.color ? <ListCardLeadingItem leading="Color" color={p.color} /> : undefined}
                        onClick={(e) => openEditPlotLineModal(selectedChart._id, e, p)}
                        trailingItems={
                          <ListCardTrailingItem trailing="Icon" icon={
                            <IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'plotLine', chartId: selectedChart._id, id: p._id }); }} />
                          } />
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Plot Bands */}
                <ProductAccordionItem
                  title="Plot Bands"
                  trailingIcon={selectedChart.plotBands.length > 0
                    ? <PATrailingItem trailing="Counter">{selectedChart.plotBands.length}</PATrailingItem>
                    : undefined}
                  isActive={selectedChart.plotBands.length > 0}
                  isDisabled={sectionsDisabled}
                  isExpanded={isSectionOpen('plotBand')}
                  onToggle={() => toggleSection('plotBand')}
                  headerAction={
                    <IconButton isDisabled={sectionsDisabled} icon={<Plus size={14} />} size="16" aria-label="Add plot band"
                      onClick={(e) => openAddModal(selectedChart._id, 'plotBand', e)}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.plotBands.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No plot bands. Click + to add.</p>
                    )}
                    {selectedChart.plotBands.map((p, i) => (
                      <ListCard
                        key={p._id}
                        className="cc-config__row-card"
                        title={p.label || `Plot Band ${i + 1}`}
                        subtitle={`${p.from} – ${p.to}`}
                        leadingItem={p.color ? <ListCardLeadingItem leading="Color" color={p.color} /> : undefined}
                        onClick={(e) => openEditPlotBandModal(selectedChart._id, e, p)}
                        trailingItems={
                          <ListCardTrailingItem trailing="Icon" icon={
                            <IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'plotBand', chartId: selectedChart._id, id: p._id }); }} />
                          } />
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>
            </>
          </>
        )}

        {/* ── Time Tab ── */}
        {activeTab === 'time' && (
          <div className="cc-config__time-tab">
            <TimeTabConfiguration
              onChange={handleTimeChange}
              value={currentTimeTabConfig as Partial<TimeTabUIConfig> | undefined}
              globalTimepickers={props.globalTimepickers}
              charts={chartsList.map((c, i) => ({
                id: c._id,
                name: c.title || `Chart ${i + 1}`,
                sources: [
                  ...c.series.map((s, si) => ({
                    id: s._id,
                    name: s.label || `Series ${si + 1}`,
                  })),
                  ...c.fixedSeries.map((f, fi) => ({
                    id: f._id,
                    name: f.label || `Fixed ${fi + 1}`,
                  })),
                ],
              }))}
            />
          </div>
        )}

        {/* ── Style Tab ── */}
        {activeTab === 'style' && (
          <>
            {/* Card-border block. Widget size is fixed at 880×400 in the dev
                harness — no UI to change it. */}
            <div className="cc-config__style-block">
              <div className="cc-config__field-row">
                <span className="BodySmallSemibold cc-config__style-section-heading">Wrap in card</span>
                <Switch
                  accessibilityLabel="Wrap in card"
                  isChecked={wrapInCard}
                  onChange={({ isChecked }) => { setWrapInCard(isChecked); emit({ wrapInCard: isChecked }); }}
                />
              </div>

              {wrapInCard && (
                <>
                  <div>
                    <InputFieldHeader label="Background Color" />
                    <HexInput value={cardBackgroundColor} onChange={(v) => { setCardBackgroundColor(v); emit({ cardBackgroundColor: v }); }} />
                  </div>
                  <div>
                    <InputFieldHeader label="Border Color" />
                    <HexInput value={cardBorderColor} onChange={(v) => { setCardBorderColor(v); emit({ cardBorderColor: v }); }} />
                  </div>
                  <TextInput
                    label="Border Width"
                    type="number"
                    placeholder="1"
                    suffix="px"
                    value={cardBorderWidth}
                    onChange={({ value }) => { setCardBorderWidth(value); emit({ cardBorderWidth: Number(value) || DEFAULT_CARD_STYLE.borderWidth }); }}
                  />
                  <TextInput
                    label="Border Radius"
                    type="number"
                    placeholder="0"
                    suffix="px"
                    value={cardBorderRadius}
                    onChange={({ value }) => { setCardBorderRadius(value); emit({ cardBorderRadius: Number(value) || DEFAULT_CARD_STYLE.borderRadius }); }}
                  />
                </>
              )}
            </div>

            <div className="cc-config__style-divider" />

            <div className="cc-config__style-block cc-config__widget-elements-section">
              <p className="BodySmallSemibold cc-config__style-section-heading">Hide Widget Elements</p>
              <CheckboxGroup
                label=""
                orientation="Vertical"
                className="cc-config__widget-elements-group"
              >
                <Checkbox
                  size="Medium"
                  label="Info Icon"
                  isChecked={hideInfoIcon}
                  onChange={() => updateWidgetElements({ hideInfoIcon: !hideInfoIcon })}
                />
                <Checkbox
                  size="Medium"
                  label="Settings Icons"
                  isChecked={hideSettingsIcon}
                  onChange={() => updateWidgetElements({ hideSettingsIcon: !hideSettingsIcon })}
                />
                <Checkbox
                  size="Medium"
                  label="Export Icon"
                  isChecked={hideExportIcon}
                  onChange={() => updateWidgetElements({ hideExportIcon: !hideExportIcon })}
                />
                <Checkbox
                  size="Medium"
                  label="Chart Title"
                  isChecked={hideChartTitle}
                  onChange={() => updateWidgetElements({ hideChartTitle: !hideChartTitle })}
                />
                <Checkbox
                  size="Medium"
                  label="Legend"
                  isChecked={!showLegend}
                  onChange={() => { const next = !showLegend; setShowLegend(next); emit({ showLegend: next }); }}
                />
                <Checkbox
                  size="Medium"
                  label="Data Labels"
                  isChecked={!showDataLabels}
                  onChange={() => { const next = !showDataLabels; setShowDataLabels(next); emit({ showDataLabels: next }); }}
                />
              </CheckboxGroup>
            </div>

            <div className="cc-config__style-divider" />

            <div className="cc-config__style-block cc-config__advanced-section">
              <div className="cc-config__field-row">
                <span className="BodySmallSemibold cc-config__style-section-heading">Advanced Settings</span>
                <Switch
                  accessibilityLabel="Advanced Settings"
                  isChecked={advancedSettings.enabled}
                  onChange={({ isChecked }) => updateAdvancedSettings({ enabled: isChecked })}
                />
              </div>

              {advancedSettings.enabled && (
                <div className="cc-config__advanced-body">
                  <p className="LabelMediumDefault cc-config__advanced-heading">Chart Title</p>
                  <TextInput
                    label="Title Font Size"
                    type="number"
                    placeholder="20"
                    value={String(advancedSettings.titleFontSize)}
                    onChange={({ value }) => {
                      const parsed = Number(value);
                      updateAdvancedSettings({
                        titleFontSize: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : DEFAULT_ADVANCED_SETTINGS.titleFontSize,
                      });
                    }}
                  />
                  <div>
                    <InputFieldHeader label="Title Font Color" />
                    <HexInput
                      value={advancedSettings.titleFontColor}
                      onChange={(value) => updateAdvancedSettings({ titleFontColor: value })}
                    />
                  </div>
                  <SelectInput
                    label="Title Font Weight"
                    placeholder="Select weight"
                    value={advancedSettings.titleFontWeight}
                    isOpen={advancedTitleWeightOpen}
                    onClick={() => setAdvancedTitleWeightOpen((v) => !v)}
                  >
                    {advancedTitleWeightOpen && (
                      <DropdownMenu>
                        <ActionListItemGroup>
                          {(['Regular', 'Medium', 'Semi-Bold', 'Bold'] as const).map((weight) => (
                            <ActionListItem
                              key={weight}
                              title={weight}
                              selectionType="Single"
                              isSelected={advancedSettings.titleFontWeight === weight}
                              onClick={() => {
                                updateAdvancedSettings({ titleFontWeight: weight });
                                setAdvancedTitleWeightOpen(false);
                              }}
                            />
                          ))}
                        </ActionListItemGroup>
                      </DropdownMenu>
                    )}
                  </SelectInput>

                  <div className="cc-config__advanced-divider" />

                  <p className="LabelMediumDefault cc-config__advanced-heading">X Axis</p>
                  <div>
                    <InputFieldHeader label="Axis Text Color" />
                    <HexInput
                      value={advancedSettings.xAxisTextColor}
                      onChange={(value) => updateAdvancedSettings({ xAxisTextColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Axis Line Color" />
                    <HexInput
                      value={advancedSettings.xAxisLineColor}
                      onChange={(value) => updateAdvancedSettings({ xAxisLineColor: value })}
                    />
                  </div>

                  <div className="cc-config__advanced-divider" />

                  <p className="LabelMediumDefault cc-config__advanced-heading">Y Axis</p>
                  <div>
                    <InputFieldHeader label="Axis Text Color" />
                    <HexInput
                      value={advancedSettings.yAxisTextColor}
                      onChange={(value) => updateAdvancedSettings({ yAxisTextColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Axis Line Color" />
                    <HexInput
                      value={advancedSettings.yAxisLineColor}
                      onChange={(value) => updateAdvancedSettings({ yAxisLineColor: value })}
                    />
                  </div>

                  <div className="cc-config__advanced-divider" />

                  <p className="LabelMediumDefault cc-config__advanced-heading">Others</p>
                  <div>
                    <InputFieldHeader label="Grid Line Color" />
                    <HexInput
                      value={advancedSettings.gridLineColor}
                      onChange={(value) => updateAdvancedSettings({ gridLineColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Legend Text Color" />
                    <HexInput
                      value={advancedSettings.legendTextColor}
                      onChange={(value) => updateAdvancedSettings({ legendTextColor: value })}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── Delete-chart confirm modal ─────────────────────────────────── */}
      <Modal
        isOpen={deleteConfirmOpen}
        className="cc-delete-confirm-modal"
        onClose={() => setDeleteConfirmOpen(false)}
        header={
          <ModalHeader
            title="Delete Chart"
            leadingItem={<span className="cc-delete-confirm-modal__icon"><Trash2 size={16} /></span>}
            onClose={() => setDeleteConfirmOpen(false)}
          />
        }
        footer={
          <ModalFooter
            primaryAction={<Button variant="Primary" color="Negative" label="Delete" onClick={removeActiveChart} />}
            secondaryAction={<Button variant="Gray" label="Cancel" onClick={() => setDeleteConfirmOpen(false)} />}
          />
        }
      >
        <ModalBody>
          <p className="BodyMediumRegular cc-delete-confirm-modal__body">
            {`Are you sure you want to delete "${activeChart?.title || 'this chart'}" and all of its data sources, axes, plot lines, and plot bands? This action is irreversible.`}
          </p>
        </ModalBody>
      </Modal>

      {/* ── Row delete confirm modal (data source / fixed series / axis /
              stack / plot line / plot band) ───────────────────────────── */}
      <Modal
        isOpen={deleteTarget !== null}
        className="cc-delete-confirm-modal"
        onClose={() => setDeleteTarget(null)}
        header={
          <ModalHeader
            title={deleteTarget ? DELETE_COPY[deleteTarget.kind].title : ''}
            leadingItem={<span className="cc-delete-confirm-modal__icon"><Trash2 size={16} /></span>}
            onClose={() => setDeleteTarget(null)}
          />
        }
        footer={
          <ModalFooter
            primaryAction={<Button variant="Primary" color="Negative" label="Delete" onClick={confirmDeleteTarget} />}
            secondaryAction={<Button variant="Gray" label="Cancel" onClick={() => setDeleteTarget(null)} />}
          />
        }
      >
        <ModalBody>
          <p className="BodyMediumRegular cc-delete-confirm-modal__body">
            {deleteTarget ? DELETE_COPY[deleteTarget.kind].body : ''}
          </p>
        </ModalBody>
      </Modal>

      {/* ── Shared Add / Edit Modal ── */}
      <Modal
        {...({ transparent: true } as any)}
        isOpen={modalOpen}
        positionX={modalX}
        positionY={modalY}
        className="cc-series-modal"
        onClose={handleModalClose}
        header={
          <ModalHeader
            title={
              modalSection === 'plotLine'  ? (editingId ? 'Edit Plot Line'    : 'Add Plot Line')
            : modalSection === 'plotBand'  ? (editingId ? 'Edit Plot Band'    : 'Add Plot Band')
            : modalSection === 'axis'      ? (editingId ? 'Edit Axis'         : 'Add Axis')
            : modalSection === 'fixed'     ? (editingId ? 'Edit Fixed Series' : 'Add Fixed Series')
            : modalSection === 'stack'     ? (editingId ? 'Edit Stack'        : 'Add Stack')
            :                               (editingId ? 'Edit Data Source'   : 'Add Data Source')
            }
            onClose={handleModalClose}
          />
        }
        footer={
          <ModalFooter>
            <Button
              variant="Primary"
              label={
                editingId ? 'Save changes'
                : modalSection === 'series'   ? 'Add Data Source'
                : modalSection === 'fixed'    ? 'Add Fixed Series'
                : modalSection === 'plotBand' ? 'Add Plot Band'
                : modalSection === 'plotLine' ? 'Add Plot Line'
                : modalSection === 'axis'     ? 'Add Axis'
                : modalSection === 'stack'    ? 'Add Stack'
                : 'Add'
              }
              isFullWidth
              isDisabled={
                (modalSection === 'series' || modalSection === 'fixed')
                  ? !formLabel.trim() || !formUnsPath.trim() || !formColor.trim()
                  : modalSection === 'plotBand'
                  ? !formLabel.trim() || !formColor.trim() || !formFrom.trim() || !formTo.trim()
                  : modalSection === 'axis'
                  ? !formAxisName.trim() || formAxisSeriesIds.length === 0
                  : modalSection === 'stack'
                  ? !formStackName.trim() || formStackSeriesIds.length === 0
                  : false
              }
              onClick={handleModalSubmit}
            />
          </ModalFooter>
        }
      >
        <ModalBody>
          <div className="cc-series-modal__body">
            {(modalSection === 'series' || modalSection === 'fixed') && (
              <>
                <TextInput
                  label="Label"
                  necessityIndicator="required"
                  placeholder={modalSection === 'fixed' ? 'e.g. Target' : 'e.g. Power Consumption'}
                  value={formLabel}
                  onChange={({ value }) => setFormLabel(value)}
                />
                <div>
                  <InputFieldHeader label="Color" necessityIndicator="required" />
                  <HexInput value={formColor} onChange={(v) => setFormColor(v)} />
                </div>
                <UNSPathInput
                  label="UNS Path"
                  necessityIndicator="required"
                  placeholder="Type / to browse UNS or paste {{topic}}"
                  value={formUnsPath}
                  tree={unsTree}
                  isLoading={isLoadingTree}
                  onChange={(v: string) => setFormUnsPath(resolveUNSValue(v))}
                  onOpen={() => loadWorkspaces()}
                />
                {modalSection === 'series' && (
                  <div className="cc-series-modal__two-col">
                    <TextInput label="Unit" placeholder="e.g. kWh" value={formUnit} onChange={({ value }) => setFormUnit(value)} />
                    <TextInput label="Precision" type="number" placeholder="e.g. 2" value={formPrecision} onChange={({ value }) => setFormPrecision(value)} />
                  </div>
                )}
              </>
            )}
            {modalSection === 'plotLine' && (
              <>
                {/* 1. Identity */}
                <TextInput label="Label" necessityIndicator="required" isRequired placeholder="e.g. Target" value={formLabel} onChange={({ value }) => setFormLabel(value)} />
                {/* 2. Data */}
                <UNSPathInput label="Value" placeholder="Type a number or / to bind" value={formValue} tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormValue(resolveUNSValue(v))} onOpen={() => loadWorkspaces()} />
                {/* 3. Color */}
                <div>
                  <InputFieldHeader label="Color" necessityIndicator="required" />
                  <HexInput value={formColor} onChange={(v) => setFormColor(v)} />
                </div>
                {/* 4. Line style */}
                <div className="cc-series-modal__two-col">
                  <TextInput label="Width" type="number" placeholder="e.g. 2" value={formWidth} onChange={({ value }) => setFormWidth(value)} />
                  <SelectInput label="Dash style" placeholder="Solid" value={formDashStyle || 'Solid'} isOpen={formDashStylePickerOpen} onClick={() => setFormDashStylePickerOpen((v) => !v)}>
                    {formDashStylePickerOpen && (
                      <DropdownMenu>
                        <ActionListItemGroup>
                          {(['Solid', 'Dash', 'Dot', 'DashDot', 'LongDash', 'ShortDash'] as const).map((ds) => (
                            <ActionListItem key={ds} title={ds} selectionType="Single"
                              isSelected={formDashStyle === ds || (!formDashStyle && ds === 'Solid')}
                              onClick={() => { setFormDashStyle(ds); setFormDashStylePickerOpen(false); }}
                            />
                          ))}
                        </ActionListItemGroup>
                      </DropdownMenu>
                    )}
                  </SelectInput>
                </div>
                {/* 5. Periodicity behavior */}
                <RadioGroup
                  name="periodicity-type"
                  label="Periodicity"
                  value={formPeriodicityType}
                  orientation="Horizontal"
                  onChange={({ value }: RadioGroupChangeMeta) => {
                    setFormPeriodicityType(value as 'independent' | 'dependent');
                    if (value === 'independent') { setFormPeriodicities([]); setFormCurrentPeriodicity(''); setFormPeriodicityDropdownOpen(false); }
                  }}
                >
                  <Radio label="Independent" value="independent" />
                  <Radio label="Dependent"   value="dependent" />
                </RadioGroup>
                {formPeriodicityType === 'dependent' && (
                  <>
                    <div className="cc-periodicity-row">
                      <div className="cc-periodicity-row__select">
                        <SelectInput
                          label="Add periodicity"
                          placeholder="Select…"
                          value={formCurrentPeriodicity ? formCurrentPeriodicity.charAt(0).toUpperCase() + formCurrentPeriodicity.slice(1) : ''}
                          isOpen={formPeriodicityDropdownOpen}
                          onClick={() => setFormPeriodicityDropdownOpen((v) => !v)}
                        >
                          {formPeriodicityDropdownOpen && (
                            <DropdownMenu>
                              <ActionListItemGroup>
                                {(['hourly', 'daily', 'weekly', 'monthly'] as const)
                                  .filter((p) => !formPeriodicities.includes(p))
                                  .map((p) => (
                                    <ActionListItem
                                      key={p}
                                      title={p.charAt(0).toUpperCase() + p.slice(1)}
                                      selectionType="Single"
                                      isSelected={formCurrentPeriodicity === p}
                                      onClick={() => { setFormCurrentPeriodicity(p); setFormPeriodicityDropdownOpen(false); }}
                                    />
                                  ))}
                              </ActionListItemGroup>
                            </DropdownMenu>
                          )}
                        </SelectInput>
                      </div>
                      <Button
                        variant="Secondary"
                        label="Add"
                        isDisabled={!formCurrentPeriodicity}
                        onClick={() => {
                          if (formCurrentPeriodicity) {
                            setFormPeriodicities([...formPeriodicities, formCurrentPeriodicity as PlotLinePeriodicity]);
                            setFormCurrentPeriodicity('');
                          }
                        }}
                      />
                    </div>
                    {formPeriodicities.length > 0 && (
                      <div className="cc-periodicity-tags">
                        {formPeriodicities.map((p) => (
                          <Tag
                            key={p}
                            label={p.charAt(0).toUpperCase() + p.slice(1)}
                            onDismiss={() => setFormPeriodicities(formPeriodicities.filter((x) => x !== p))}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {modalSection === 'plotBand' && (
              <>
                <TextInput label="Name" necessityIndicator="required" isRequired placeholder="e.g. Overload Zone" value={formLabel} onChange={({ value }) => setFormLabel(value)} />
                <div>
                  <InputFieldHeader label="Color" necessityIndicator="required" />
                  <HexInput value={formColor} onChange={(v) => setFormColor(v)} />
                </div>
                <div className="cc-series-modal__two-col">
                  <UNSPathInput label="Start value" necessityIndicator="required" isRequired placeholder="Start value" value={formFrom} tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormFrom(resolveUNSValue(v))} onOpen={() => loadWorkspaces()} />
                  <UNSPathInput label="End value"   necessityIndicator="required" isRequired placeholder="End value"   value={formTo}   tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormTo(resolveUNSValue(v))}   onOpen={() => loadWorkspaces()} />
                </div>
              </>
            )}
            {modalSection === 'axis' && (() => {
              const modalChart = chartsList.find((c) => c._id === modalChartId);
              const axisItems = modalChart ? [
                ...modalChart.series.map((s, i) => ({ _id: s._id, label: s.label || `Series ${i + 1}` })),
                ...modalChart.fixedSeries.map((s, i) => ({ _id: s._id, label: s.label || `Fixed ${i + 1}` })),
              ] : [];
              return (
                <>
                  <TextInput
                    label="Name"
                    necessityIndicator="required"
                    isRequired
                    placeholder="e.g. Temperature"
                    value={formAxisName}
                    onChange={({ value }) => setFormAxisName(value)}
                  />
                  <RadioGroup
                    name="axis-side"
                    label="Axis side"
                    value={String(formAxisYAxis)}
                    orientation="Horizontal"
                    onChange={({ value }: RadioGroupChangeMeta) => {
                      setFormAxisYAxis(Number(value) as 0 | 1);
                    }}
                  >
                    <Radio label="Left Axis" value="0" />
                    <Radio label="Right Axis" value="1" />
                  </RadioGroup>
                  <SelectInput
                    label="Series"
                    necessityIndicator="required"
                    placeholder="Select series for this axis…"
                    tags={formAxisSeriesIds.map((id) => {
                      const item = axisItems.find((it) => it._id === id);
                      return {
                        label: item?.label ?? id,
                        onDismiss: () => setFormAxisSeriesIds(formAxisSeriesIds.filter((x) => x !== id)),
                      };
                    })}
                    isOpen={formAxisSeriesDropdownOpen}
                    onClick={() => setFormAxisSeriesDropdownOpen((v) => !v)}
                  >
                    {formAxisSeriesDropdownOpen && (
                      <DropdownMenu>
                        <ActionListItemGroup>
                          {axisItems.map((item) => (
                            <ActionListItem
                              key={item._id}
                              title={item.label}
                              selectionType="Multiple"
                              isSelected={formAxisSeriesIds.includes(item._id)}
                              onClick={() => {
                                const has = formAxisSeriesIds.includes(item._id);
                                setFormAxisSeriesIds(has
                                  ? formAxisSeriesIds.filter((x) => x !== item._id)
                                  : [...formAxisSeriesIds, item._id]
                                );
                              }}
                            />
                          ))}
                        </ActionListItemGroup>
                      </DropdownMenu>
                    )}
                  </SelectInput>
                </>
              );
            })()}
            {modalSection === 'stack' && (() => {
              const modalChart = chartsList.find((c) => c._id === modalChartId);
              const stackItems = modalChart ? [
                ...modalChart.series.map((s, i) => ({ _id: s._id, label: s.label || `Series ${i + 1}` })),
                ...modalChart.fixedSeries.map((s, i) => ({ _id: s._id, label: s.label || `Fixed ${i + 1}` })),
              ] : [];
              return (
                <>
                  <TextInput
                    label="Stack name"
                    necessityIndicator="required"
                    isRequired
                    placeholder="e.g. Group A"
                    value={formStackName}
                    onChange={({ value }) => setFormStackName(value)}
                  />
                  <SelectInput
                    label="Series"
                    necessityIndicator="required"
                    placeholder="Select series to stack…"
                    tags={formStackSeriesIds.map((id) => {
                      const item = stackItems.find((it) => it._id === id);
                      return {
                        label: item?.label ?? id,
                        onDismiss: () => setFormStackSeriesIds(formStackSeriesIds.filter((x) => x !== id)),
                      };
                    })}
                    isOpen={formStackSeriesDropdownOpen}
                    onClick={() => setFormStackSeriesDropdownOpen((v) => !v)}
                  >
                    {formStackSeriesDropdownOpen && (
                      <DropdownMenu>
                        <ActionListItemGroup>
                          {stackItems.map((item) => (
                            <ActionListItem
                              key={item._id}
                              title={item.label}
                              selectionType="Multiple"
                              isSelected={formStackSeriesIds.includes(item._id)}
                              onClick={() => {
                                const has = formStackSeriesIds.includes(item._id);
                                setFormStackSeriesIds(has
                                  ? formStackSeriesIds.filter((x) => x !== item._id)
                                  : [...formStackSeriesIds, item._id]
                                );
                              }}
                            />
                          ))}
                        </ActionListItemGroup>
                      </DropdownMenu>
                    )}
                  </SelectInput>
                </>
              );
            })()}
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}
