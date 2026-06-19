import { ColumnChartEnvelope, ColumnChartUIConfig, DataEntry, SeriesPayload } from './types';
import { resolveAndCompute } from './api';
import { resolveDurationWindow } from './time';

// Maps widget periodicity values → timeFrame string expected by resolveAndCompute
const PERIODICITY_TIME_FRAME: Record<string, string> = {
  hourly:  'hour',
  daily:   'day',
  weekly:  'week',
  monthly: 'month',
};

interface MiniEngineCtx {
  authentication: string;
  override?: { startTime: number; endTime: number; periodicity?: string };
}

export async function resolve(
  envelope: ColumnChartEnvelope,
  ctx: MiniEngineCtx,
): Promise<{ config: ColumnChartUIConfig; data: DataEntry[] }> {
  const { startTime, endTime } = computeWindow(envelope, ctx.override);
  const bindings = envelope.dynamicBindingPathList ?? [];

  if (bindings.length === 0) return { config: envelope.uiConfig, data: [] };

  const UNS_TOPIC_RE = /^uns:[^/]+:\/\//;
  const validBindings = bindings.filter(({ topic }) => {
    if (!UNS_TOPIC_RE.test(topic)) {
      console.error(
        `[MiniEngine] Invalid topic format: "${topic}". ` +
        `Expected "uns:wsId://path". ` +
        `Check that Angular's resolveUNSValue returns {{uns:wsId://path}} ` +
        `and that this.meta is keyed by workspace NAME.`
      );
      return false;
    }
    return true;
  });

  if (validBindings.length === 0 && bindings.length > 0) {
    return { config: envelope.uiConfig, data: [] };
  }

  try {
    // Periodicity precedence: explicit override (user picked a periodicity in
    // the date picker → TIME_CHANGE event → host puts it in ctx.override) wins
    // over the envelope default. The fallback matters for the very first
    // resolve: the widget initializes its dropdown to
    // timeConfig.defaultPeriodicity but does NOT emit TIME_CHANGE on mount —
    // without this fallback, the initial request goes with no timeFrame and
    // the server hands back its own default (hourly), making the dropdown
    // disagree with the bars on screen.
    const periodicity = ctx.override?.periodicity
      ?? envelope.timeConfig?.defaultPeriodicity;
    const timeFrame = periodicity
      ? PERIODICITY_TIME_FRAME[periodicity.toLowerCase()]
      : undefined;

    const items = await resolveAndCompute(
      ctx.authentication,
      validBindings.map((binding) =>
        'type' in binding && binding.type === 'series'
          ? { key: binding.key, topic: binding.topic, type: 'series' as const }
          : { key: binding.key, topic: binding.topic }
      ),
      startTime,
      endTime,
      timeFrame,
    );
    // Pass resolveAndCompute items through AS-IS (raw shape) — same as the
    // production Lens Data Engine. No reshaping/wrapping here.
    return { config: envelope.uiConfig, data: items };
  } catch {
    return { config: envelope.uiConfig, data: [] };
  }
}

export function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry) return null;
  // Raw API item: series fields live at the top level of the entry.
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

function computeWindow(
  envelope: ColumnChartEnvelope,
  override?: { startTime: number; endTime: number },
): { startTime: number; endTime: number } {
  if (override) return override;
  const { timeConfig } = envelope;
  if (!timeConfig) return { startTime: Date.now() - 86_400_000, endTime: Date.now() };
  const now = Date.now();
  // Fixed picker: resolve its single "set duration" (x/xEvent/xPeriod + y…).
  if (timeConfig.pickerType === 'fixed' && timeConfig.fixedDuration) {
    return resolveDurationWindow(timeConfig.fixedDuration, now, timeConfig.cycleTime);
  }
  // Legacy absolute fixed window.
  if (timeConfig.type === 'fixed' && timeConfig.startTime && timeConfig.endTime) {
    return { startTime: timeConfig.startTime, endTime: timeConfig.endTime };
  }
  const dur = timeConfig.allDurations?.find((d) => d.id === timeConfig.defaultDurationId);
  if (dur) return resolveDurationWindow(dur, now, timeConfig.cycleTime);
  return { startTime: now - 86_400_000, endTime: now };
}
