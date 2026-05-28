import { ColumnChartEnvelope, ColumnChartUIConfig, DataEntry, SeriesPayload, Duration } from './types';
import { resolveAndCompute } from './api';

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
    const timeFrame = ctx.override?.periodicity
      ? PERIODICITY_TIME_FRAME[ctx.override.periodicity.toLowerCase()]
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
    const data: DataEntry[] = items.map((item) => ({ key: item.key, value: item.value }));
    return { config: envelope.uiConfig, data };
  } catch {
    return { config: envelope.uiConfig, data: [] };
  }
}

export function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry) return null;
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
  if (timeConfig.type === 'fixed' && timeConfig.startTime && timeConfig.endTime) {
    return { startTime: timeConfig.startTime, endTime: timeConfig.endTime };
  }
  const now = Date.now();
  const dur = timeConfig.allDurations?.find((d) => d.id === timeConfig.defaultDurationId);
  if (dur) return { startTime: computePresetStart(dur, now), endTime: now };
  return { startTime: now - 86_400_000, endTime: now };
}

function computePresetStart(dur: Duration, now: number): number {
  const x = dur.x ?? 1;
  const periodMs: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  return now - x * (periodMs[dur.xPeriod] ?? 86_400_000);
}
