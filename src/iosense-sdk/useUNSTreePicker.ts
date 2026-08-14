import { useCallback, useEffect, useState } from 'react';
import { fetchUNSNodes } from './api';
import type { UNSNode, UNSWorkspace } from '@faclon-labs/design-sdk/UNSTreePicker';

// Dev-harness fallback for UNSTreePicker's lazy contract. In the host
// (IOSense) these four values are injected as props by QuickConfigShell —
// this hook only runs when nothing was injected (see ColumnChartConfiguration's
// hasInjectedUNS gate). Module-level singleton cache so workspaces/nodes are
// fetched once even when several widgets mount at once.

export interface UseUNSTreePickerResult {
  workspaces: UNSWorkspace[];
  isLoadingWorkspaces: boolean;
  loadChildren: (wsId: string, parentId?: string) => Promise<UNSNode[]>;
  searchNodes: (wsId: string, query: string, limit?: number) => Promise<UNSNode[]>;
}

interface WsCache {
  top: UNSNode[];
  childrenByParent: Map<string, UNSNode[]>;
  leaves: UNSNode[];
}

const _cache: { workspaces: UNSWorkspace[] | null; byWs: Map<string, Promise<WsCache>> } =
  { workspaces: null, byWs: new Map() };
let _workspacesPromise: Promise<UNSWorkspace[]> | null = null;

// A single `uns:<wsId>` Operational fetch returns a flat list of a workspace's
// Tags + their virtual-property variants (`<path>:last`, `:avg`, …). Reshape
// to the picker's lazy model: a Tag WITH variants → a FOLDER whose `:suffix`
// variants are leaves; a Tag WITHOUT any → a selectable leaf.
async function fetchWsCache(auth: string, wsId: string): Promise<WsCache> {
  const nodes = await fetchUNSNodes(auth, `uns:${wsId}`, 'Operational', 100, true);
  const tags: Array<{ id: string; name: string; path: string }> = [];
  const vprops: Array<{ id: string; name: string; path: string }> = [];
  for (const n of nodes) {
    if (!n.name) continue;
    const path = n.path ?? n.name;
    (n.type === 'virtualProperty' ? vprops : tags).push({ id: n.id, name: n.name, path });
  }
  const top: UNSNode[] = [];
  const childrenByParent = new Map<string, UNSNode[]>();
  const leaves: UNSNode[] = [];
  for (const tag of tags) {
    const matching = vprops.filter((vp) => vp.path.startsWith(`${tag.path}:`));
    if (matching.length > 0) {
      top.push({ id: tag.id, unsId: wsId, type: 'Folder', name: tag.name, path: tag.path, hasChildren: true, childCount: matching.length });
      const kids = matching.map((vp) => {
        const suffix = vp.path.substring(vp.path.lastIndexOf(':')); // ":last"
        return { id: vp.id, unsId: wsId, type: 'Tag', name: `${tag.name}${suffix}`, path: vp.path, hasChildren: false };
      });
      childrenByParent.set(tag.id, kids);
      leaves.push(...kids);
    } else {
      const leaf: UNSNode = { id: tag.id, unsId: wsId, type: 'Tag', name: tag.name, path: tag.path, hasChildren: false };
      top.push(leaf);
      leaves.push(leaf);
    }
  }
  return { top, childrenByParent, leaves };
}

function wsCache(auth: string, wsId: string) {
  let p = _cache.byWs.get(wsId);
  if (!p) {
    p = fetchWsCache(auth, wsId).catch((e) => { _cache.byWs.delete(wsId); throw e; });
    _cache.byWs.set(wsId, p);
  }
  return p;
}

export function useUNSTreePicker(authentication?: string): UseUNSTreePickerResult {
  const [workspaces, setWorkspaces] = useState<UNSWorkspace[]>(() => _cache.workspaces ?? []);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);

  useEffect(() => {
    if (!authentication || _cache.workspaces) return;
    let alive = true;
    setIsLoadingWorkspaces(true);
    if (!_workspacesPromise) {
      _workspacesPromise = fetchUNSNodes(authentication, 'uns:_workspaces').then((nodes) => {
        const ws: UNSWorkspace[] = [];
        for (const n of nodes) if (n.type === 'Workspace' && n.name) ws.push({ id: n.id, name: n.name });
        _cache.workspaces = ws;
        return ws;
      }).catch((e) => { _workspacesPromise = null; console.error('[UNS] workspace fetch failed:', e); return []; });
    }
    _workspacesPromise.then((ws) => { if (alive) { setWorkspaces(ws); setIsLoadingWorkspaces(false); } });
    return () => { alive = false; };
  }, [authentication]);

  const loadChildren = useCallback(async (wsId: string, parentId?: string) => {
    if (!authentication) return [];
    const cache = await wsCache(authentication, wsId);
    return parentId ? cache.childrenByParent.get(parentId) ?? [] : cache.top;
  }, [authentication]);

  const searchNodes = useCallback(async (wsId: string, query: string, limit = 50) => {
    if (!authentication) return [];
    const cache = await wsCache(authentication, wsId);
    const q = query.trim().toLowerCase();
    return q ? cache.leaves.filter((n) => n.name.toLowerCase().includes(q)).slice(0, limit) : [];
  }, [authentication]);

  return { workspaces, isLoadingWorkspaces, loadChildren, searchNodes };
}
