import { Duration, CycleTime } from './types';

// Duration → [startTime, endTime] resolution. This is a faithful port of the
// canonical GlobalTimePicker implementation (computePresetWindow /
// getPeriodAsPerCycle / cycleBoundary), so the column-chart widget resolves
// time exactly like the platform's time picker.
//
// Three preset shapes:
//   1. calendarType (today/yesterday/current_week/…) — snapped to cycle
//      boundaries; the "current_*" / today presets END at NOW.
//   2. navigation custom presets — base = cycle boundary of the period
//      containing now, THEN offset by ±x/±y periods (Previous/Next).
//   3. plain rolling presets — now − x·period.
//
// Cycle boundaries: hour:minute = day start; dayOfWeek (def. 0=Sun) = week
// start; date (def. 1) = month start; month NAME = year start.

const PERIOD_MS: Record<string, number> = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
};

// Calendar defaults (midnight, Sunday, 1st, January) — the reference to diff
// against when deciding whether a widget's ACTUAL cycle time changes the
// resolved window at all. Deliberately NOT `undefined`: `getPeriodAsPerCycle`
// (case 2, below) short-circuits to "now" whenever `cycleTime` is missing,
// which is not a calendar boundary at all — comparing against that would look
// divergent for virtually every boundary-based duration regardless of
// whether cycle time actually matters, over-firing the cycle-time correction
// everywhere instead of only where it's needed.
export const CALENDAR_DEFAULT_CYCLE_TIME: CycleTime = {
  hour: '00', minute: '00', dayOfWeek: 0, date: '1',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Cycle month = year boundary. The time-tab form stores it as a 1-based numeric
// string ('4' = April, default '1' = January); the legacy GTP config stores it
// as a month NAME ('April'). Normalize both to a 0-based month index so
// `new Date(year, idx, …)` starts the year on the configured month.
function cycleMonthIndex(month: string | undefined): number {
  if (month == null || month === '') return 0;
  const n = Number(month);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n - 1;   // '4' → April (idx 3)
  const byName = MONTH_NAMES.indexOf(month);
  return byName >= 0 ? byName : 0;
}

function addPeriodToDate(d: Date, n: number, period: string): Date {
  const r = new Date(d);
  switch (period) {
    case 'minute': r.setTime(r.getTime() + n * 60_000); break;
    case 'hour':   r.setTime(r.getTime() + n * 3_600_000); break;
    case 'day':    r.setDate(r.getDate() + n); break;
    case 'week':   r.setDate(r.getDate() + n * 7); break;
    case 'month':  r.setMonth(r.getMonth() + n); break;
    case 'year':   r.setFullYear(r.getFullYear() + n); break;
  }
  return r;
}

// Most-recent cycle boundary for `period` + `event`, anchored at `now`.
// 'End' returns the start of the NEXT period (exclusive boundary).
function getPeriodAsPerCycle(period: string, event: string, cycleTime: CycleTime | undefined, now: Date): Date {
  if (event === 'Now' || !cycleTime) return new Date(now);

  const ch = Number(cycleTime.hour   || 0);
  const cm = Number(cycleTime.minute || 0);
  let base: Date;

  switch (period) {
    case 'day': {
      base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'day');
      break;
    }
    case 'week': {
      const dow     = now.getDay();
      const selDay  = cycleTime.dayOfWeek ?? 0;
      const wkStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
      base = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + selDay, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'week');
      break;
    }
    case 'month': {
      const selDate = Number(cycleTime.date || 1);
      base = new Date(now.getFullYear(), now.getMonth(), selDate, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'month');
      break;
    }
    case 'year': {
      const selMonth = cycleMonthIndex(cycleTime.month);
      const selDate  = Number(cycleTime.date || 1);
      base = new Date(now.getFullYear(), selMonth, selDate, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'year');
      break;
    }
    default:
      base = new Date(now);
  }

  if (event === 'End') base = addPeriodToDate(base, 1, period);
  return base;
}

// Most-recent cycle boundary (<= now) for a calendar period, honoring cycleTime.
// Falls back to calendar defaults (midnight / week-start Sunday / 1st) when no
// cycleTime is configured.
function cycleBoundary(period: 'day' | 'week' | 'month' | 'year', cycleTime: CycleTime | undefined, now: Date): Date {
  const ch = Number(cycleTime?.hour   || 0);
  const cm = Number(cycleTime?.minute || 0);
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();

  switch (period) {
    case 'day': {
      let base = new Date(y, mo, d, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'day');
      return base;
    }
    case 'week': {
      const selDay  = cycleTime?.dayOfWeek ?? 0;
      const wkStart = new Date(y, mo, d - now.getDay(), 0, 0, 0, 0);
      let base = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + selDay, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'week');
      return base;
    }
    case 'month': {
      const selDate = Number(cycleTime?.date || 1);
      let base = new Date(y, mo, selDate, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'month');
      return base;
    }
    case 'year': {
      const selMonth = cycleMonthIndex(cycleTime?.month);
      const selDate  = Number(cycleTime?.date || 1);
      let base = new Date(y, selMonth, selDate, ch, cm, 0, 0);
      if (now < base) base = addPeriodToDate(base, -1, 'year');
      return base;
    }
  }
}

function resolveWindowInner(
  dur: Duration,
  now: number,
  cycleTime?: CycleTime,
): { startTime: number; endTime: number } {
  const nowD = new Date(now);
  const ms = now;

  // 1. Built-in calendar presets — anchored to cycle-time boundaries.
  if (dur.calendarType) {
    const dayStart   = cycleBoundary('day',   cycleTime, nowD).getTime();
    const weekStart  = cycleBoundary('week',  cycleTime, nowD).getTime();
    const monthStart = cycleBoundary('month', cycleTime, nowD).getTime();
    const yearStart  = cycleBoundary('year',  cycleTime, nowD).getTime();
    const prev = (anchor: number, period: 'day' | 'week' | 'month' | 'year') =>
      addPeriodToDate(new Date(anchor), -1, period).getTime();
    switch (dur.calendarType) {
      case 'today':          return { startTime: dayStart,                  endTime: ms };
      case 'yesterday':      return { startTime: prev(dayStart, 'day'),     endTime: dayStart };
      case 'current_week':   return { startTime: weekStart,                 endTime: ms };
      case 'previous_week':  return { startTime: prev(weekStart, 'week'),   endTime: weekStart };
      case 'current_month':  return { startTime: monthStart,                endTime: ms };
      case 'previous_month': return { startTime: prev(monthStart, 'month'), endTime: monthStart };
      case 'current_year':   return { startTime: yearStart,                 endTime: ms };
      case 'previous_year':  return { startTime: prev(yearStart, 'year'),   endTime: yearStart };
    }
  }

  // 2. Custom presets — navigation + cycle-time boundaries. Takes this branch
  // whenever the duration expresses itself via boundary events (xEvent/yEvent
  // = 'Start'/'End'), not only when `navigation` (a Previous/Next direction)
  // is set. This matters for the Fixed time picker's "Set Duration" form
  // (GTPFixedDuration): it has no `calendarType` field at all — a "current
  // period" duration like Financial Year is necessarily expressed as
  // xEvent='Start' with x=0, not via a Previous/Next direction — but
  // `navigation` is a required string on that shape and the SDK leaves it ''
  // when there's no direction to pick. Gating on `dur.navigation` alone made
  // that empty string fall through to the rolling branch below, which
  // ignores cycleTime entirely — exactly why Fixed-picker widgets kept
  // resolving Jan…now instead of the configured Apr…now.
  const hasBoundaryEvent = (e?: string) => e === 'Start' || e === 'End';
  if (dur.navigation || hasBoundaryEvent(dur.xEvent) || hasBoundaryEvent(dur.yEvent)) {
    const xPeriod = dur.xPeriod ?? 'day';
    const yPeriod = dur.yPeriod ?? 'day';
    const xEvent  = dur.xEvent  ?? 'Start';
    const yEvent  = dur.yEvent  ?? 'End';
    const x = dur.x ?? 1;
    const y = dur.y ?? 1;

    const xBase = getPeriodAsPerCycle(xPeriod, xEvent, cycleTime, nowD);
    const yBase = getPeriodAsPerCycle(yPeriod, yEvent, cycleTime, nowD);

    const dir = dur.navigation === 'Previous' ? -1 : 1;
    return {
      startTime: addPeriodToDate(xBase, dir * x, xPeriod).getTime(),
      endTime:   addPeriodToDate(yBase, dir * y, yPeriod).getTime(),
    };
  }

  // 3. Rolling presets (Last 7 Days, Last 30 Days, …).
  return {
    startTime: ms - (dur.x ?? 1) * (PERIOD_MS[dur.xPeriod ?? 'day'] ?? 86_400_000),
    endTime: ms,
  };
}

export function resolveDurationWindow(
  dur: Duration,
  now: number,
  cycleTime?: CycleTime,
): { startTime: number; endTime: number } {
  const r = resolveWindowInner(dur, now, cycleTime);
  // eslint-disable-next-line no-console
  console.log('[resolveDurationWindow]', {
    dur: { id: dur.id, label: dur.label, calendarType: dur.calendarType, navigation: dur.navigation,
           x: dur.x, xPeriod: dur.xPeriod, xEvent: dur.xEvent, y: dur.y, yPeriod: dur.yPeriod, yEvent: dur.yEvent },
    cycleTime,
    start: new Date(r.startTime).toString(),
    end: new Date(r.endTime).toString(),
  });
  return r;
}
