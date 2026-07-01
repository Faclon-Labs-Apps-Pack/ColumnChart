import { BindingEntry, DataEntry } from './types';

const STAGING_BASE = 'https://appserver.iosense.io/api';
const GRAPH = 'iosense_test_uns';

export async function validateSSOToken(ssoToken: string): Promise<string> {
  const res = await fetch(`${STAGING_BASE}/account/validateSSO`, {
    method: 'GET',
    headers: { token: ssoToken },
  });
  const json = await res.json();
  if (!json.success || !json.token) throw new Error('SSO validation failed');
  return json.token;
}

// Optional extensions to the resolveAndCompute payload. Per the engine contract
// (widget architecture §3 "Comparison & Shift"), comparison and shift are
// mutually exclusive (comparison wins) and BOTH ride on the SAME request — no
// second fetch, no client-side bucketing. The caller (mini-engine) enforces the
// exclusivity; here we just forward whatever was set.
export interface ResolveOptions {
  timeFrame?: string;
  // comparisonMode === true → primary window + this comparison window, one call.
  comparisonStartTime?: number;
  comparisonEndTime?: number;
  // shifts present (and comparison off) → sent VERBATIM so the backend returns
  // shift-bucketed values.
  shifts?: unknown[];
}

export interface ResolveResult {
  // Each item carries its own comparison window inline as `comparisonSlots`
  // (present when comparisonStart/EndTime were sent) — no parallel array.
  data: DataEntry[];
  // Full raw response — kept so callers can map any shift/comparison shape the
  // backend uses without a second round-trip.
  raw: unknown;
}

export async function resolveAndCompute(
  authentication: string,
  config: Array<BindingEntry>,
  startTime: number,
  endTime: number,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const body: Record<string, unknown> = { graph: GRAPH, config, startTime, endTime };
  if (opts.timeFrame) body.timeFrame = opts.timeFrame;
  if (opts.comparisonStartTime != null) body.comparisonStartTime = opts.comparisonStartTime;
  if (opts.comparisonEndTime != null) body.comparisonEndTime = opts.comparisonEndTime;
  if (opts.shifts && opts.shifts.length) body.shifts = opts.shifts;

  const res = await fetch(`${STAGING_BASE}/account/uns/resolveAndCompute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authentication}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  // Pass the API items through AS-IS — no reshaping. This mirrors what the
  // production Lens Data Engine hands the widget (series fields at the top
  // level of each item, scalars as { key, value }). The widget's
  // getSeriesData()/getValue() read this raw shape directly.
  const data = (json?.data ?? []) as DataEntry[];
  // Comparison values ride back PER-ITEM as `comparisonSlots` (same shape as
  // `slots`) — kept inline on each item. The widget extracts them from `data`
  // via getComparisonSeriesData(); no parallel comparisonData array is built.
  return { data, raw: json };
}

export async function fetchUNSNodes(
  authentication: string,
  graph: string,
  label?: string,
  limit = 100,
  expandPostfix = false,
): Promise<Array<{ id: string; type: string; name?: string; path: string | null; parentId: string | null }>> {
  const params = new URLSearchParams({ graph, limit: String(limit) });
  if (label) params.set('label', label);
  if (expandPostfix) params.set('expandPostfix', 'true');
  const res = await fetch(`${STAGING_BASE}/account/uns/nodes?${params}`, {
    headers: { Authorization: `Bearer ${authentication}` },
  });
  const json = await res.json();
  return (json?.data?.data ?? []) as Array<{
    id: string; type: string; name?: string; path: string | null; parentId: string | null;
  }>;
}
