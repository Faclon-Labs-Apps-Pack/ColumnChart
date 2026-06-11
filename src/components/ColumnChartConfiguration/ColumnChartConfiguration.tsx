import { useState, useEffect, useRef } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { ProductAccordionItem } from '@faclon-labs/design-sdk/ProductAccordion';
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
  enabled: true,
  titleFontSize: 20,
  titleFontColor: 'var(--text-default-primary, #1a1a1a)',
  titleFontWeight: 'Semi-Bold',
  xAxisTextColor: 'var(--text-default-primary, #1a1a1a)',
  xAxisLineColor: '#333333',
  yAxisTextColor: 'var(--text-default-primary, #1a1a1a)',
  yAxisLineColor: '#333333',
  gridLineColor: '#CCCCCC',
  legendTextColor: 'var(--text-default-primary, #1a1a1a)',
};

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

function makeDefaultChart(): ChartConfig {
  return {
    _id: `chart_${Date.now()}`,
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

  // ── Charts list + which one is selected in the dropdown ──────────────────
  const initCharts = config?.uiConfig?.charts?.length ? config.uiConfig.charts : [makeDefaultChart()];
  const [chartsList,       setChartsList]       = useState<ChartConfig[]>(initCharts);
  const [selectedChartId,  setSelectedChartId]  = useState<string | null>(initCharts[0]._id);
  const [chartPickerOpen,  setChartPickerOpen]  = useState(false);

  // ── Expanded sections for the selected chart ──────────────────────────────
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // ── Widget-level state ────────────────────────────────────────────────────
  const [currentTimeConfig,    setCurrentTimeConfig]    = useState<TimeConfig | undefined>(config?.timeConfig);
  const [currentTimeTabConfig, setCurrentTimeTabConfig] = useState<Record<string, unknown> | undefined>(config?.timeTabConfig);
  const [title,          setTitle]          = useState(config?.uiConfig?.title ?? '');
  const [description,    setDescription]    = useState(config?.uiConfig?.description ?? '');
  const [titleTouched,   setTitleTouched]   = useState(false);
  const [wrapInCard,     setWrapInCard]     = useState(config?.uiConfig?.style?.card?.wrapInCard ?? true);
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
  const [advancedSettings, setAdvancedSettings] = useState<WidgetAdvancedSettingsConfig>({
    ...DEFAULT_ADVANCED_SETTINGS,
    ...(config?.uiConfig?.style?.advancedSettings ?? {}),
  });
  const [advancedTitleWeightOpen, setAdvancedTitleWeightOpen] = useState(false);

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
  const [styleGeneralExpanded, setStyleGeneralExpanded] = useState(false);
  const [styleChartExpanded,   setStyleChartExpanded]   = useState(false);

  const [showChartValidation, setShowChartValidation] = useState(false);
  const [addChartError,       setAddChartError]       = useState('');

  useEffect(() => {
    if (config) {
      const raw = config.uiConfig?.charts ?? [];
      let charts = raw.length > 0 ? raw : [makeDefaultChart()];
      // Migrate legacy widget-level title onto the first chart if it has none.
      const firstTitle = charts[0]?.title || config.uiConfig?.title || '';
      if (charts[0] && !charts[0].title && firstTitle) {
        charts = charts.map((c, i) => (i === 0 ? { ...c, title: firstTitle } : c));
      }
      setChartsList(charts);
      setSelectedChartId(charts[0]._id);
      setTitle(charts[0]?.title ?? '');
      setDescription(config.uiConfig?.description ?? '');
      setTitleTouched(false);
      setWrapInCard(config.uiConfig?.style?.card?.wrapInCard ?? true);
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
      setAdvancedSettings({
        ...DEFAULT_ADVANCED_SETTINGS,
        ...(config.uiConfig?.style?.advancedSettings ?? {}),
      });
      setAdvancedTitleWeightOpen(false);
      setCurrentTimeConfig(config.timeConfig);
      setCurrentTimeTabConfig(config.timeTabConfig);
    }
  }, [config?._id]);

  // ── Builders ──────────────────────────────────────────────────────────────

  function buildUiConfig(overrides: {
    charts?: ChartConfig[];
    title?: string;
    description?: string;
    wrapInCard?: boolean;
    stacked?: boolean;
    showLegend?: boolean;
    showDataLabels?: boolean;
    yAxisUnit?: string;
    widgetSize?: WidgetSizeConfig;
    widgetElements?: WidgetElementsConfig;
    advancedSettings?: WidgetAdvancedSettingsConfig;
  }): ColumnChartUIConfig {
    return {
      title:       overrides.title       ?? title,
      description: (overrides.description ?? description) || undefined,
      charts:      overrides.charts      ?? chartsList,
      style: {
        card: { wrapInCard: overrides.wrapInCard ?? wrapInCard, bg: '' },
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
      hideWidgetElements: widgetElementsEnabled,
      hideSettingsIcon,
      hideExportIcon,
      hideChartTitle,
      ...patch,
    };
    const nextHideWidgetElements =
      next.hideWidgetElements ||
      next.hideSettingsIcon ||
      next.hideExportIcon ||
      next.hideChartTitle;
    if ('hideSettingsIcon' in patch) setHideSettingsIcon(next.hideSettingsIcon);
    if ('hideExportIcon' in patch) setHideExportIcon(next.hideExportIcon);
    if ('hideChartTitle' in patch) setHideChartTitle(next.hideChartTitle);
    setWidgetElementsEnabled(nextHideWidgetElements);
    emit({ widgetElements: {
      hideWidgetElements: nextHideWidgetElements,
      hideSettingsIcon: next.hideSettingsIcon,
      hideExportIcon: next.hideExportIcon,
      hideChartTitle: next.hideChartTitle,
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

  // Reset section expanded state when switching charts
  function selectChart(chartId: string) {
    setSelectedChartId(chartId);
    setChartPickerOpen(false);
    setExpandedSections({});
    const chart = chartsList.find((c) => c._id === chartId);
    setTitle(chart?.title ?? '');
  }

  // ── Chart CRUD ────────────────────────────────────────────────────────────

  function handleAddChart() {
    if (!title.trim()) {
      setShowChartValidation(true);
      setTitleTouched(true);
      setAddChartError('Chart title is required before adding a new chart.');
      return;
    }
    if (selectedChart && selectedChart.series.length === 0) {
      setShowChartValidation(true);
      setAddChartError('At least one series is required before adding a new chart.');
      return;
    }
    setShowChartValidation(false);
    setAddChartError('');
    const id = `chart_${Date.now()}`;
    const newChart: ChartConfig = {
      _id: id,
      title: '',
      series: [],
      fixedSeries: [],
      axes: [],
      stacks: [],
      plotLines: [],
      plotBands: [],
    };
    const next = [...chartsList, newChart];
    setChartsList(next);
    selectChart(id);
    emit({ charts: next });
  }

  function handleDeleteChart(chartId: string) {
    let next = chartsList.filter((c) => c._id !== chartId);
    if (next.length === 0) next = [makeDefaultChart()];
    setChartsList(next);
    if (selectedChartId === chartId) {
      setSelectedChartId(next[next.length - 1]._id);
      setExpandedSections({});
    }
    emit({ charts: next });
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function openAddModal(chartId: string, section: ModalSection, e: React.MouseEvent) {
    e.stopPropagation();
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setModalChartId(chartId);
    setModalSection(section);
    setEditingId(null);
    setFormUnsPath(''); setFormLabel(''); setFormColor(''); setFormUnit(''); setFormPrecision('');
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
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
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
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
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
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
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
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
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
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
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
      update = {
        series: editingId
          ? chart.series.map((s) => s._id === editingId ? entry : s)
          : [...chart.series, entry],
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
      update = {
        fixedSeries: editingId
          ? chart.fixedSeries.map((s) => s._id === editingId ? entry : s)
          : [...chart.fixedSeries, entry],
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

  const selectedChart = chartsList.find((c) => c._id === selectedChartId) ?? null;
  const selectedChartIndex = chartsList.findIndex((c) => c._id === selectedChartId);

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
            {/* Widget-level settings */}
            <div className="cc-config__chart-settings">
              <p className="LabelMediumDefault cc-config__chart-settings-heading">Chart Settings</p>
              <TextInput
                label="Chart title"
                necessityIndicator="required"
                placeholder="e.g. Energy Dashboard"
                value={title}
                validationState={(titleTouched && title.trim() === '') || (showChartValidation && !title.trim()) ? 'error' : 'none'}
                errorText="Chart title is required"
                onChange={({ value }) => {
                  setTitle(value);
                  const nextCharts = chartsList.map((c) =>
                    c._id === selectedChartId ? { ...c, title: value } : c,
                  );
                  setChartsList(nextCharts);
                  emit({ title: value, charts: nextCharts });
                  if (showChartValidation) { setShowChartValidation(false); setAddChartError(''); }
                }}
                onBlur={() => setTitleTouched(true)}
              />
              <TextInput
                label="Description"
                placeholder="e.g. Monthly energy usage across zones"
                value={description}
                onChange={({ value }) => { setDescription(value); emit({ description: value }); }}
              />
            </div>

            {/* Chart selector dropdown */}
            {chartsList.length > 0 && (
              <div className="cc-config__chart-selector">
                <div className="cc-config__chart-selector-input">
                  <SelectInput
                    label="Configure chart"
                    placeholder="Select a chart…"
                    value={
                      selectedChart
                        ? title || `Chart ${selectedChartIndex + 1}`
                        : ''
                    }
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
                </div>
                {selectedChart && (
                  <IconButton
                    icon={<Trash2 size={13} />}
                    size="16"
                    aria-label="Delete chart"
                    onClick={() => handleDeleteChart(selectedChart._id)}
                  />
                )}
              </div>
            )}

            {/* Sections for the selected chart */}
            <>
                {/* Data Source */}
                <ProductAccordionItem
                  title="Data Source"
                  trailingIcon={selectedChart.series.length > 0
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String(selectedChart.series.length)} />
                    : undefined}
                  isExpanded={isSectionOpen('series')}
                  onToggle={() => toggleSection('series')}
                  headerAction={
                    <IconButton
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
                        title={s.label || `Series ${i + 1}`}
                        subtitle={s.unit || undefined}
                        leadingItem={s.color ? <ListCardLeadingItem leading="Color" color={s.color} /> : undefined}
                        trailingItems={
                          <>
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Edit2 size={13} />} size="16" aria-label="Edit" onClick={(e) => openEditModal(selectedChart._id, 'series', e, s)} />} />
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={() => updateChartInList(selectedChart._id, { series: selectedChart.series.filter((x) => x._id !== s._id) })} />} />
                          </>
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Fixed Series */}
                <ProductAccordionItem
                  title="Fixed Series"
                  trailingIcon={selectedChart.fixedSeries.length > 0
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String(selectedChart.fixedSeries.length)} />
                    : undefined}
                  isExpanded={isSectionOpen('fixed')}
                  onToggle={() => toggleSection('fixed')}
                  headerAction={
                    <IconButton
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
                        title={s.label || `Fixed ${i + 1}`}
                        leadingItem={s.color ? <ListCardLeadingItem leading="Color" color={s.color} /> : undefined}
                        trailingItems={
                          <>
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Edit2 size={13} />} size="16" aria-label="Edit" onClick={(e) => openEditModal(selectedChart._id, 'fixed', e, s)} />} />
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={() => updateChartInList(selectedChart._id, { fixedSeries: selectedChart.fixedSeries.filter((x) => x._id !== s._id) })} />} />
                          </>
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Axis */}
                <ProductAccordionItem
                  title="Axis"
                  trailingIcon={(selectedChart.axes ?? []).length > 0
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String((selectedChart.axes ?? []).length)} />
                    : undefined}
                  isExpanded={isSectionOpen('axis')}
                  onToggle={() => toggleSection('axis')}
                  headerAction={
                    <IconButton
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
                            title={axis.name || 'Unnamed Axis'}
                            subtitle={`${axisLabel}${axisSeries.length > 0 ? ` • ${axisSeries.length} series` : ''}`}
                            trailingItems={
                              <>
                                <ListCardTrailingItem
                                  trailing="Icon"
                                  icon={(
                                    <IconButton
                                      icon={<Edit2 size={13} />}
                                      size="16"
                                      aria-label="Edit"
                                      onClick={(e) => openEditAxisModal(selectedChart._id, e, axis)}
                                    />
                                  )}
                                />
                                <ListCardTrailingItem
                                  trailing="Icon"
                                  icon={(
                                    <IconButton
                                      icon={<Trash2 size={13} />}
                                      size="16"
                                      aria-label="Delete"
                                      onClick={() => updateChartInList(selectedChart._id, { axes: (selectedChart.axes ?? []).filter((item) => item._id !== axis._id) })}
                                    />
                                  )}
                                />
                              </>
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
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String(selectedChart.stacks.length)} />
                    : undefined}
                  isExpanded={isSectionOpen('stack')}
                  onToggle={() => toggleSection('stack')}
                  headerAction={
                    <IconButton
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
                        title={stack.name || 'Unnamed Stack'}
                        subtitle={stack.seriesIds.length > 0 ? `${stack.seriesIds.length} series` : undefined}
                        trailingItems={
                          <>
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Edit2 size={13} />} size="16" aria-label="Edit" onClick={(e) => openEditStackModal(selectedChart._id, e, stack)} />} />
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={() => updateChartInList(selectedChart._id, { stacks: selectedChart.stacks.filter((st) => st._id !== stack._id) })} />} />
                          </>
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Plot Lines */}
                <ProductAccordionItem
                  title="Plot Lines"
                  trailingIcon={selectedChart.plotLines.length > 0
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String(selectedChart.plotLines.length)} />
                    : undefined}
                  isExpanded={isSectionOpen('plotLine')}
                  onToggle={() => toggleSection('plotLine')}
                  headerAction={
                    <IconButton icon={<Plus size={14} />} size="16" aria-label="Add plot line"
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
                        title={p.label || `Plot Line ${i + 1}`}
                        subtitle={String(p.value)}
                        leadingItem={p.color ? <ListCardLeadingItem leading="Color" color={p.color} /> : undefined}
                        trailingItems={
                          <>
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Edit2 size={13} />} size="16" aria-label="Edit" onClick={(e) => openEditPlotLineModal(selectedChart._id, e, p)} />} />
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={() => updateChartInList(selectedChart._id, { plotLines: selectedChart.plotLines.filter((x) => x._id !== p._id) })} />} />
                          </>
                        }
                      />
                    ))}
                  </div>
                </ProductAccordionItem>

                {/* Plot Bands */}
                <ProductAccordionItem
                  title="Plot Bands"
                  trailingIcon={selectedChart.plotBands.length > 0
                    ? <Badge color="Neutral" emphasis="Subtle" size="Small" label={String(selectedChart.plotBands.length)} />
                    : undefined}
                  isExpanded={isSectionOpen('plotBand')}
                  onToggle={() => toggleSection('plotBand')}
                  headerAction={
                    <IconButton icon={<Plus size={14} />} size="16" aria-label="Add plot band"
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
                        title={p.label || `Plot Band ${i + 1}`}
                        subtitle={`${p.from} – ${p.to}`}
                        leadingItem={p.color ? <ListCardLeadingItem leading="Color" color={p.color} /> : undefined}
                        trailingItems={
                          <>
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Edit2 size={13} />} size="16" aria-label="Edit" onClick={(e) => openEditPlotBandModal(selectedChart._id, e, p)} />} />
                            <ListCardTrailingItem trailing="Icon" icon={<IconButton icon={<Trash2 size={13} />} size="16" aria-label="Delete" onClick={() => updateChartInList(selectedChart._id, { plotBands: selectedChart.plotBands.filter((x) => x._id !== p._id) })} />} />
                          </>
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
            />
          </div>
        )}

        {/* ── Style Tab ── */}
        {activeTab === 'style' && (
          <>
            <div className="cc-config__style-top">
              <SelectInput
                label="Widget Size"
                placeholder="Select size…"
                value={
                  widgetSizePreset === 'Custom'
                    ? 'Custom'
                    : widgetSizePreset === 'Medium'
                    ? `Medium ${getWidgetSizeDimensions('Medium').width}x${getWidgetSizeDimensions('Medium').height}`
                    : widgetSizePreset
                }
                isOpen={widgetSizePickerOpen}
                onClick={() => setWidgetSizePickerOpen((v) => !v)}
              >
                {widgetSizePickerOpen && (
                  <DropdownMenu>
                    <ActionListItemGroup>
                      {(['Small', 'Medium', 'Large', 'Custom'] as const).map((preset) => {
                        const dims = preset === 'Medium' ? getWidgetSizeDimensions(preset) : null;
                        return (
                          <ActionListItem
                            key={preset}
                            title={preset === 'Medium' ? `${preset} ${dims.width}x${dims.height}` : preset}
                            selectionType="Single"
                            isSelected={widgetSizePreset === preset}
                            onClick={() => applyWidgetSizePreset(preset)}
                          />
                        );
                      })}
                    </ActionListItemGroup>
                  </DropdownMenu>
                )}
              </SelectInput>
              {widgetSizePreset === 'Custom' && (
                <div className="cc-style__widget-size-row">
                  <TextInput
                    label=""
                    accessibilityLabel="Widget width"
                    prefix="W"
                    type="number"
                    placeholder="580"
                    value={widgetWidth}
                    onChange={({ value }) => applyWidgetWidth(value)}
                  />
                  <TextInput
                    label=""
                    accessibilityLabel="Widget height"
                    prefix="H"
                    type="number"
                    placeholder="400"
                    value={widgetHeight}
                    onChange={({ value }) => applyWidgetHeight(value)}
                  />
                  <IconButton
                    icon={widgetLocked ? <Lock size={14} /> : <Unlock size={14} />}
                    size="16"
                    aria-label={widgetLocked ? 'Unlock widget size' : 'Lock widget size'}
                    onClick={() => {
                      const nextLocked = !widgetLocked;
                      const currentWidth = parseWidgetDimension(widgetWidth, getWidgetSizeDimensions('Medium').width);
                      const currentHeight = parseWidgetDimension(widgetHeight, getWidgetSizeDimensions('Medium').height);
                      widgetAspectRatioRef.current = currentWidth / Math.max(currentHeight, 1);
                      setWidgetLocked(nextLocked);
                      emitWidgetSize({
                        preset: 'Custom',
                        width: currentWidth,
                        height: currentHeight,
                        locked: nextLocked,
                      });
                    }}
                  />
                </div>
              )}
            </div>

            <ProductAccordionItem
              title="General"
              isExpanded={styleGeneralExpanded}
              onToggle={() => setStyleGeneralExpanded((v) => !v)}
            >
              <div className="cc-config__section">
                <div className="cc-config__field-row">
                  <span className="LabelSmallDefault cc-config__field-label">Wrap in card</span>
                  <Switch
                    accessibilityLabel="Wrap in card"
                    isChecked={wrapInCard}
                    onChange={({ isChecked }) => { setWrapInCard(isChecked); emit({ wrapInCard: isChecked }); }}
                  />
                </div>
              </div>
            </ProductAccordionItem>

            <ProductAccordionItem
              title="Chart"
              isExpanded={styleChartExpanded}
              onToggle={() => setStyleChartExpanded((v) => !v)}
            >
              <div className="cc-config__section">
                <TextInput
                  label="Y-axis unit"
                  placeholder="e.g. kWh, °C, kg"
                  value={yAxisUnit}
                  onChange={({ value }) => { setYAxisUnit(value); emit({ yAxisUnit: value }); }}
                />
                <div className="cc-config__field-row">
                  <span className="LabelSmallDefault cc-config__field-label">Stacked columns</span>
                  <Switch accessibilityLabel="Stacked columns" isChecked={stacked} onChange={({ isChecked }) => { setStacked(isChecked); emit({ stacked: isChecked }); }} />
                </div>
                <div className="cc-config__field-row">
                  <span className="LabelSmallDefault cc-config__field-label">Show legend</span>
                  <Switch accessibilityLabel="Show legend" isChecked={showLegend} onChange={({ isChecked }) => { setShowLegend(isChecked); emit({ showLegend: isChecked }); }} />
                </div>
                <div className="cc-config__field-row">
                  <span className="LabelSmallDefault cc-config__field-label">Show data labels</span>
                  <Switch accessibilityLabel="Show data labels" isChecked={showDataLabels} onChange={({ isChecked }) => { setShowDataLabels(isChecked); emit({ showDataLabels: isChecked }); }} />
                </div>
              </div>
            </ProductAccordionItem>

            <div className="cc-config__widget-elements-section">
              <div className="cc-config__field-row">
                <span className="SmallSemibold cc-config__field-label">Hide Widget elements</span>
              </div>
              <CheckboxGroup
                label=""
                orientation="Vertical"
                className="cc-config__widget-elements-group"
              >
                <Checkbox
                  label="Settings Icons"
                  isChecked={hideSettingsIcon}
                  onChange={() => updateWidgetElements({ hideSettingsIcon: !hideSettingsIcon })}
                />
                <Checkbox
                  label="Export Icon"
                  isChecked={hideExportIcon}
                  onChange={() => updateWidgetElements({ hideExportIcon: !hideExportIcon })}
                />
                <Checkbox
                  label="Chart Title"
                  isChecked={hideChartTitle}
                  onChange={() => updateWidgetElements({ hideChartTitle: !hideChartTitle })}
                />
              </CheckboxGroup>
            </div>

            <div className="cc-config__advanced-section">
              <div className="cc-config__field-row">
                <span className="SmallSemibold cc-config__field-label cc-config__field-label--bold">Advanced Settings</span>
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
                    <ColorInput
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
                    <ColorInput
                      value={advancedSettings.xAxisTextColor}
                      onChange={(value) => updateAdvancedSettings({ xAxisTextColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Axis Line Color" />
                    <ColorInput
                      value={advancedSettings.xAxisLineColor}
                      onChange={(value) => updateAdvancedSettings({ xAxisLineColor: value })}
                    />
                  </div>

                  <div className="cc-config__advanced-divider" />

                  <p className="LabelMediumDefault cc-config__advanced-heading">Y Axis</p>
                  <div>
                    <InputFieldHeader label="Axis Text Color" />
                    <ColorInput
                      value={advancedSettings.yAxisTextColor}
                      onChange={(value) => updateAdvancedSettings({ yAxisTextColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Axis Line Color" />
                    <ColorInput
                      value={advancedSettings.yAxisLineColor}
                      onChange={(value) => updateAdvancedSettings({ yAxisLineColor: value })}
                    />
                  </div>

                  <div className="cc-config__advanced-divider" />

                  <p className="LabelMediumDefault cc-config__advanced-heading">Others</p>
                  <div>
                    <InputFieldHeader label="Grid Line Color" />
                    <ColorInput
                      value={advancedSettings.gridLineColor}
                      onChange={(value) => updateAdvancedSettings({ gridLineColor: value })}
                    />
                  </div>
                  <div>
                    <InputFieldHeader label="Legend Text Color" />
                    <ColorInput
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

      {/* ── Bottom footer: Add Chart (Data tab only) ── */}
      {activeTab === 'data' && (
        <div className="cc-config__footer">
          {addChartError && (
            <p className="cc-config__add-chart-error BodySmallRegular">{addChartError}</p>
          )}
          <Button variant="Primary" label="Add Chart" onClick={handleAddChart} />
        </div>
      )}

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
                editingId ? 'Save'
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
                <UNSPathInput
                  label="UNS Path"
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
                <div>
                  <InputFieldHeader label="Color" necessityIndicator="required" />
                  <ColorInput value={formColor} onChange={(v) => setFormColor(v)} />
                </div>
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
                  <ColorInput value={formColor} onChange={(v) => setFormColor(v)} />
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
                  <ColorInput value={formColor} onChange={(v) => setFormColor(v)} />
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
