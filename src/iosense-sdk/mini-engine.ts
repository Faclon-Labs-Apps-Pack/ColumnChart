import { WidgetTemplateEnvelope, WidgetTemplateUIConfig, DataEntry, Duration } from './types';
import { resolveAndCompute } from './api';

interface MiniEngineCtx {
  authentication: string;
  override?: { startTime: number; endTime: number };
}

export async function resolve(
  envelope: WidgetTemplateEnvelope,
  ctx: MiniEngineCtx,
): Promise<{ config: WidgetTemplateUIConfig; data: DataEntry[] }> {
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
    const items = await resolveAndCompute(
      ctx.authentication,
      validBindings.map(({ key, topic }) => ({ key, topic })),
      startTime,
      endTime,
    );
    const data: DataEntry[] = items.map((item) => ({ key: item.key, value: item.value }));
    return { config: envelope.uiConfig, data };
  } catch {
    return { config: envelope.uiConfig, data: [] };
  }
}

function computeWindow(
  envelope: WidgetTemplateEnvelope,
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
