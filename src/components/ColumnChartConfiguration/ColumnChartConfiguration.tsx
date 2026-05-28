import { useState, useEffect, useRef } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { ProductAccordionItem } from '@faclon-labs/design-sdk/ProductAccordion';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { TextInput } from '@faclon-labs/design-sdk/TextInput';
import { Button } from '@faclon-labs/design-sdk/Button';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { TimeTabConfiguration } from '@faclon-labs/design-sdk/TimeTabConfiguration';
import type { TimeTabUIConfig } from '@faclon-labs/design-sdk/TimeTabConfiguration';
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem, ActionListItemGroup } from '@faclon-labs/design-sdk/DropdownMenu';
import { Radio, RadioGroup } from '@faclon-labs/design-sdk/Radio';
import type { RadioGroupChangeMeta } from '@faclon-labs/design-sdk/Radio';
import { ListCard, ListCardLeadingItem, ListCardTrailingItem } from '@faclon-labs/design-sdk/ListCard';
import { Edit2, Trash2, Plus } from 'react-feather';
import {
  ColumnChartEnvelope,
  ColumnChartUIConfig,
  ChartConfig,
  ColumnChartSeriesConfig,
  FixedSeriesConfig,
  PlotLineConfig,
  PlotBandConfig,
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

  unsTree?: UNSTree;
  isLoadingTree?: boolean;
  onLoadWorkspaces?: () => void;
  resolveUNSValue?: (rawValue: string) => string;
}

const VARIABLE_REGEX = /^\{\{(.+)\}\}$/;

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
  return {
    timezone: ttc.timezone,
    type: ttc.timeType === 'global' ? 'local' : (ttc.timeType ?? 'local'),
    startTime: null,
    endTime: null,
    defaultDurationId: ttc.defaultDurationId,
    allDurations: (ttc.allDurations ?? []) as unknown as Duration[],
    defaultPeriodicity: ttc.defaultPeriodicity,
  };
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
type ModalSection = 'series' | 'fixed' | 'plotLine' | 'plotBand';

export function ColumnChartConfiguration(props: ColumnChartConfigurationProps) {
  const { config, authentication, onChange } = props;

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
  const [chartsList,       setChartsList]       = useState<ChartConfig[]>(config?.uiConfig.charts ?? []);
  const [selectedChartId,  setSelectedChartId]  = useState<string | null>(config?.uiConfig.charts?.[0]?._id ?? null);
  const [chartPickerOpen,  setChartPickerOpen]  = useState(false);

  // ── Expanded sections for the selected chart ──────────────────────────────
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // ── Per-chart axis / stack dropdown state ─────────────────────────────────
  const [axisPickerOpen,       setAxisPickerOpen]       = useState(false);
  const [selectedAxisKey,      setSelectedAxisKey]       = useState<string | null>(null);
  const [openStackDropdownId,  setOpenStackDropdownId]   = useState<string | null>(null);

  // ── Widget-level state ────────────────────────────────────────────────────
  const [currentTimeConfig,    setCurrentTimeConfig]    = useState<TimeConfig | undefined>(config?.timeConfig);
  const [currentTimeTabConfig, setCurrentTimeTabConfig] = useState<Record<string, unknown> | undefined>(config?.timeTabConfig);
  const [title,          setTitle]          = useState(config?.uiConfig.title ?? '');
  const [description,    setDescription]    = useState(config?.uiConfig.description ?? '');
  const [titleTouched,   setTitleTouched]   = useState(false);
  const [wrapInCard,     setWrapInCard]     = useState(config?.uiConfig.style.card.wrapInCard ?? true);
  const [stacked,        setStacked]        = useState(config?.uiConfig.style.stacked ?? false);
  const [showLegend,     setShowLegend]     = useState(config?.uiConfig.style.showLegend ?? true);
  const [showDataLabels, setShowDataLabels] = useState(config?.uiConfig.style.showDataLabels ?? false);
  const [yAxisUnit,      setYAxisUnit]      = useState(config?.uiConfig.style.yAxisUnit ?? '');

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
  const [formUnit,     setFormUnit]     = useState('');
  const [formValue,    setFormValue]    = useState('');
  const [formFrom,     setFormFrom]     = useState('');
  const [formTo,       setFormTo]       = useState('');
  const [formWidth,    setFormWidth]    = useState('');
  const [formDashStyle,           setFormDashStyle]           = useState('');
  const [formDashStylePickerOpen, setFormDashStylePickerOpen] = useState(false);

  // Style tab accordion expanded state
  const [styleGeneralExpanded, setStyleGeneralExpanded] = useState(false);
  const [styleChartExpanded,   setStyleChartExpanded]   = useState(false);

  useEffect(() => {
    if (config) {
      const charts = config.uiConfig.charts ?? [];
      setChartsList(charts);
      setSelectedChartId(charts[0]?._id ?? null);
      setTitle(config.uiConfig.title ?? '');
      setDescription(config.uiConfig.description ?? '');
      setTitleTouched(false);
      setWrapInCard(config.uiConfig.style.card.wrapInCard);
      setStacked(config.uiConfig.style.stacked);
      setShowLegend(config.uiConfig.style.showLegend);
      setShowDataLabels(config.uiConfig.style.showDataLabels);
      setYAxisUnit(config.uiConfig.style.yAxisUnit ?? '');
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
      },
    };
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
    setAxisPickerOpen(false);
    setSelectedAxisKey(null);
    setOpenStackDropdownId(null);
  }

  // ── Chart CRUD ────────────────────────────────────────────────────────────

  function handleAddChart() {
    const id = `chart_${Date.now()}`;
    const newChart: ChartConfig = {
      _id: id,
      title: '',
      series: [],
      fixedSeries: [],
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
    const next = chartsList.filter((c) => c._id !== chartId);
    setChartsList(next);
    if (selectedChartId === chartId) {
      const fallback = next[next.length - 1]?._id ?? null;
      setSelectedChartId(fallback);
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
    setFormUnsPath(''); setFormLabel(''); setFormColor(''); setFormUnit('');
    setFormValue(''); setFormFrom(''); setFormTo(''); setFormWidth('');
    setFormDashStyle(''); setFormDashStylePickerOpen(false);
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

  function handleModalClose() {
    setModalOpen(false);
    setModalChartId(null);
    setEditingId(null);
    setFormUnsPath(''); setFormLabel(''); setFormColor(''); setFormUnit('');
    setFormValue(''); setFormFrom(''); setFormTo(''); setFormWidth('');
    setFormDashStyle(''); setFormDashStylePickerOpen(false);
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
                label="Title"
                necessityIndicator="required"
                placeholder="e.g. Energy Dashboard"
                value={title}
                validationState={titleTouched && title.trim() === '' ? 'error' : 'none'}
                errorText="Title is required"
                onChange={({ value }) => { setTitle(value); emit({ title: value }); }}
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
                        ? selectedChart.title || `Chart ${selectedChartIndex + 1}`
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
            {selectedChart && (
              <>
                {/* Chart title */}
                <div className="cc-config__chart-title-field">
                  <TextInput
                    label="Chart title"
                    placeholder="e.g. Energy Consumption"
                    value={selectedChart.title}
                    onChange={({ value }) => updateChartInList(selectedChart._id, { title: value })}
                  />
                </div>

                {/* Series */}
                <ProductAccordionItem
                  title="Series"
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
                      <p className="cc-config__empty-hint BodySmallRegular">No series. Click + to add a data source.</p>
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
                  isExpanded={isSectionOpen('axis')}
                  onToggle={() => toggleSection('axis')}
                >
                  <div className="cc-config__section">
                    {selectedChart.series.length === 0 && selectedChart.fixedSeries.length === 0 ? (
                      <p className="cc-config__empty-hint BodySmallRegular">Add series first to assign axes.</p>
                    ) : (() => {
                      const allItems = [
                        ...selectedChart.series.map((s, i) => ({ key: `series-${s._id}`, label: s.label || `Series ${i + 1}`, section: 'series' as const, _id: s._id, yAxis: s.yAxis ?? 0 })),
                        ...selectedChart.fixedSeries.map((s, i) => ({ key: `fixed-${s._id}`, label: s.label || `Fixed ${i + 1}`, section: 'fixed' as const, _id: s._id, yAxis: s.yAxis ?? 0 })),
                      ];
                      const selected = allItems.find((it) => it.key === selectedAxisKey);
                      return (
                        <>
                          <SelectInput
                            label="Select series"
                            placeholder="Choose a series…"
                            value={selected?.label ?? ''}
                            isOpen={axisPickerOpen}
                            onClick={() => setAxisPickerOpen((v) => !v)}
                          >
                            {axisPickerOpen && (
                              <DropdownMenu>
                                <ActionListItemGroup>
                                  {allItems.map((it) => (
                                    <ActionListItem
                                      key={it.key}
                                      title={it.label}
                                      selectionType="Single"
                                      isSelected={selectedAxisKey === it.key}
                                      onClick={() => { setSelectedAxisKey(it.key); setAxisPickerOpen(false); }}
                                    />
                                  ))}
                                </ActionListItemGroup>
                              </DropdownMenu>
                            )}
                          </SelectInput>
                          {selected && (
                            <RadioGroup
                              name="axis-assignment"
                              label="Axis"
                              value={String(selected.yAxis)}
                              orientation="Horizontal"
                              onChange={({ value }: RadioGroupChangeMeta) => {
                                const yAxis = Number(value) as 0 | 1;
                                if (selected.section === 'series') {
                                  updateChartInList(selectedChart._id, {
                                    series: selectedChart.series.map((s) => s._id === selected._id ? { ...s, yAxis } : s),
                                  });
                                } else {
                                  updateChartInList(selectedChart._id, {
                                    fixedSeries: selectedChart.fixedSeries.map((s) => s._id === selected._id ? { ...s, yAxis } : s),
                                  });
                                }
                              }}
                            >
                              <Radio label="Left Axis"  value="0" />
                              <Radio label="Right Axis" value="1" />
                            </RadioGroup>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </ProductAccordionItem>

                {/* Stack */}
                <ProductAccordionItem
                  title="Stack"
                  isExpanded={isSectionOpen('stack')}
                  onToggle={() => toggleSection('stack')}
                  headerAction={
                    <IconButton
                      icon={<Plus size={14} />}
                      size="16"
                      aria-label="Add stack"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateChartInList(selectedChart._id, {
                          stacks: [...selectedChart.stacks, { _id: `stack_${Date.now()}`, name: '', seriesIds: [] }],
                        });
                      }}
                    />
                  }
                >
                  <div className="cc-config__section">
                    {selectedChart.stacks.length === 0 && (
                      <p className="cc-config__empty-hint BodySmallRegular">No stacks. Click + to add.</p>
                    )}
                    {selectedChart.stacks.map((stack) => {
                      const stackItems = [
                        ...selectedChart.series.map((s, i) => ({ _id: s._id, label: s.label || `Series ${i + 1}` })),
                        ...selectedChart.fixedSeries.map((s, i) => ({ _id: s._id, label: s.label || `Fixed ${i + 1}` })),
                      ];
                      const isDropdownOpen = openStackDropdownId === stack._id;
                      const selectedTags = stack.seriesIds
                        .map((id) => stackItems.find((it) => it._id === id))
                        .filter(Boolean)
                        .map((it) => ({
                          label: it!.label,
                          onDismiss: () => updateChartInList(selectedChart._id, {
                            stacks: selectedChart.stacks.map((st) =>
                              st._id === stack._id
                                ? { ...st, seriesIds: st.seriesIds.filter((id) => id !== it!._id) }
                                : st
                            ),
                          }),
                        }));

                      return (
                        <div key={stack._id} className="cc-config__stack-item">
                          <div className="cc-config__stack-header">
                            <TextInput
                              label="Stack name"
                              placeholder="e.g. Group A"
                              value={stack.name}
                              onChange={({ value }) => updateChartInList(selectedChart._id, {
                                stacks: selectedChart.stacks.map((st) => st._id === stack._id ? { ...st, name: value } : st),
                              })}
                            />
                            <IconButton
                              icon={<Trash2 size={13} />}
                              size="16"
                              aria-label="Delete stack"
                              onClick={() => updateChartInList(selectedChart._id, {
                                stacks: selectedChart.stacks.filter((st) => st._id !== stack._id),
                              })}
                            />
                          </div>
                          <SelectInput
                            label="Series"
                            placeholder="Select series to stack…"
                            tags={selectedTags}
                            isOpen={isDropdownOpen}
                            onClick={() => setOpenStackDropdownId(isDropdownOpen ? null : stack._id)}
                          >
                            {isDropdownOpen && (
                              <DropdownMenu>
                                <ActionListItemGroup>
                                  {stackItems.map((item) => (
                                    <ActionListItem
                                      key={item._id}
                                      title={item.label}
                                      selectionType="Multiple"
                                      isSelected={stack.seriesIds.includes(item._id)}
                                      onClick={() => {
                                        const has = stack.seriesIds.includes(item._id);
                                        updateChartInList(selectedChart._id, {
                                          stacks: selectedChart.stacks.map((st) =>
                                            st._id === stack._id
                                              ? { ...st, seriesIds: has ? st.seriesIds.filter((id) => id !== item._id) : [...st.seriesIds, item._id] }
                                              : st
                                          ),
                                        });
                                      }}
                                    />
                                  ))}
                                </ActionListItemGroup>
                              </DropdownMenu>
                            )}
                          </SelectInput>
                        </div>
                      );
                    })}
                  </div>
                </ProductAccordionItem>

                {/* Plot Lines */}
                <ProductAccordionItem
                  title="Plot Lines"
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
            )}
          </>
        )}

        {/* ── Time Tab ── */}
        {activeTab === 'time' && (
          <div className="cc-config__time-tab">
            <TimeTabConfiguration
              onChange={handleTimeChange}
              value={currentTimeTabConfig as Partial<TimeTabUIConfig> | undefined}
            />
          </div>
        )}

        {/* ── Style Tab ── */}
        {activeTab === 'style' && (
          <>
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
          </>
        )}

      </div>

      {/* ── Bottom footer: Add Chart (Data tab only) ── */}
      {activeTab === 'data' && (
        <div className="cc-config__footer">
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
            : modalSection === 'fixed'     ? (editingId ? 'Edit Fixed Series' : 'Add Fixed Series')
            :                               (editingId ? 'Edit Series'        : 'Add Series')
            }
            onClose={handleModalClose}
          />
        }
        footer={
          <ModalFooter
            primaryAction={
              <Button variant="Primary" label={editingId ? 'Save' : 'Add'} onClick={handleModalSubmit} />
            }
          />
        }
      >
        <ModalBody>
          <div className="cc-series-modal__body">
            {(modalSection === 'series' || modalSection === 'fixed') && (
              <>
                <UNSPathInput
                  label="Data source"
                  placeholder="Type / to browse UNS or paste {{topic}}"
                  value={formUnsPath}
                  tree={unsTree}
                  isLoading={isLoadingTree}
                  onChange={(v: string) => setFormUnsPath(resolveUNSValue(v))}
                  onOpen={() => loadWorkspaces()}
                />
                <TextInput
                  label="Label"
                  placeholder={modalSection === 'fixed' ? 'e.g. Target' : 'e.g. Power Consumption'}
                  value={formLabel}
                  onChange={({ value }) => setFormLabel(value)}
                />
                {modalSection === 'series' && (
                  <TextInput label="Unit" placeholder="e.g. kWh" value={formUnit} onChange={({ value }) => setFormUnit(value)} />
                )}
                <TextInput label="Color" placeholder="e.g. #4A90E2" value={formColor} onChange={({ value }) => setFormColor(value)} />
              </>
            )}
            {modalSection === 'plotLine' && (
              <>
                <UNSPathInput label="Value" placeholder="Type a number or / to bind" value={formValue} tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormValue(resolveUNSValue(v))} onOpen={() => loadWorkspaces()} />
                <TextInput label="Label" placeholder="e.g. Target" value={formLabel} onChange={({ value }) => setFormLabel(value)} />
                <TextInput label="Color" placeholder="e.g. #ef4444" value={formColor} onChange={({ value }) => setFormColor(value)} />
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
              </>
            )}
            {modalSection === 'plotBand' && (
              <>
                <UNSPathInput label="From" placeholder="Type a number or / to bind" value={formFrom} tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormFrom(resolveUNSValue(v))} onOpen={() => loadWorkspaces()} />
                <UNSPathInput label="To"   placeholder="Type a number or / to bind" value={formTo}   tree={unsTree} isLoading={isLoadingTree} onChange={(v: string) => setFormTo(resolveUNSValue(v))}   onOpen={() => loadWorkspaces()} />
                <TextInput label="Label" placeholder="e.g. Overload Zone" value={formLabel} onChange={({ value }) => setFormLabel(value)} />
                <TextInput label="Color" placeholder="e.g. rgba(239,68,68,0.15)" value={formColor} onChange={({ value }) => setFormColor(value)} />
              </>
            )}
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}
