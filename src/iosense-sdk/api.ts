import { BindingEntry, DataEntry } from './types';

const STAGING_BASE = 'https://stagingsv.iosense.io/api';
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

export async function resolveAndCompute(
  authentication: string,
  config: Array<BindingEntry>,
  startTime: number,
  endTime: number,
  timeFrame?: string,
): Promise<DataEntry[]> {
  const body: Record<string, unknown> = { graph: GRAPH, config, startTime, endTime };
  if (timeFrame) body.timeFrame = timeFrame;
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
  return (json?.data ?? []) as DataEntry[];
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
