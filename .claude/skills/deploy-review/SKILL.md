---
name: deploy-review
description: >
  Production-readiness gate for IOsense widgets. Run before every deploy.
  Builds the production bundle, spawns a reviewer agent against 5 architecture
  categories, dispatches the builder to fix critical issues, then loops until
  clean. Developers never manually verify the architecture checklist — this
  skill owns it. Trigger: /deploy-review
---

# Deploy-Review Skill

## Trigger

`/deploy-review` — run this before uploading dist-bundle/ to S3/CDN.

---

## Boot (every invocation)

1. Read all 4 source-of-truth files:
   - `.claude/skills/Bindable.md`
   - `.claude/skills/Envelope.md`
   - `.claude/skills/MiniEngine.md`
   - `.claude/skills/DevHarness.md`
2. Read `webpack.config.js`
4. Note current UTC timestamp — used in Deploy Log entries

---

## Main Loop

```
iteration = 0
MAX_ITERATIONS = 3

LOOP:
  iteration++
  if iteration > MAX_ITERATIONS:
    → BLOCKED: "Still failing after 3 fix attempts. Manual review required."
    → Append to TRACKER Deploy Log and stop.

  STEP 1 — BUILD GATE
    Run: npm run build:bundle
    Capture stdout + stderr.
    If exit code ≠ 0:
      → Surface build errors verbatim to user
      → Append to TRACKER: "build failed — stop"
      → STOP (build errors must be fixed manually first; do not attempt AI fix)
    If exit code = 0:
      → Continue to STEP 2

  STEP 2 — REVIEWER AGENT
    Spawn Agent(subagent_type="Explore") with the prompt below.
    Receive JSON report: { passed: string[], issues: Issue[] }

  STEP 2.5 — ORCHESTRATOR SPOT-CHECK (always run before evaluating reviewer output)
    Personally verify these checks by reading the source files directly:
    - C2.4: Open the widget .tsx file. Confirm the props interface has `| undefined` on config AND
            the first line of the component body contains `if (!config`. If either is missing → add
            to critical issues regardless of what reviewer said.
    - C3.3: Open both index.ts files. Confirm mount(), update(), unmount() all have bodies (not just
            `{}`). If any is an empty stub → add to critical issues.
    - C5.3: Open the configurator .tsx file. Confirm the useEffect syncing from props has a null
            guard on config before accessing config.uiConfig. If missing → add to critical issues.
    - C1.6: Open the configurator .tsx file. Search for `onChange({` and `timeTabConfig`. If
            `timeTabConfig` is emitted in the envelope payload but `timeConfig:` is absent from the
            same payload → add to critical issues regardless of what reviewer said.
    Merge spot-check findings into the reviewer's issue list before proceeding.

  STEP 3 — EVALUATE
    critical = issues where severity === "critical"
    warnings = issues where severity === "warning"

    If critical.length === 0:
      → Surface passed list + warning list to user
      → Append to TRACKER Deploy Log: "DEPLOY APPROVED — N checks passed"
      → STOP — deploy can proceed

    If critical.length > 0:
      → Surface critical issues to user (file, line, issue, fix_hint)
      → Append to TRACKER Deploy Log: "N critical issues — dispatching builder"

  STEP 4 — BUILDER FIX
    Spawn Agent(subagent_type="builder") with the fix prompt below.
    Builder fixes all critical issues from the report.
    Append to TRACKER Deploy Log: "builder fixed: <list of files changed>"

  → Go back to LOOP top (rebuild + re-review)
```

---

## Reviewer Agent Prompt

```
You are a production-readiness reviewer for an IOsense widget bundle.

## Source-of-truth files (already read by orchestrator — key rules summarised below)

ARCHITECTURE RULES:
1. Widget never fetches data — all data arrives via `data: DataEntry[]` prop.
2. Envelope shape: { _id, type, general, uiConfig, dynamicBindingPathList } — no apiConfig.
3. Configurator always calls buildDynamicBindingPathList(uiConfig) before emitting.
4. One resolveAndCompute call covers all bindings — no per-field fetch loops.
5. All UI uses @faclon-labs/design-sdk — no raw HTML inputs for things SDK covers.

## Your task

Read EVERY file listed below, then check every item in the 5-category checklist.

FILES TO READ:
- src/components/Gauge/Gauge.tsx
- src/components/Gauge/index.ts
- src/components/GaugeConfiguration/GaugeConfiguration.tsx
- src/components/GaugeConfiguration/index.ts
- src/iosense-sdk/types.ts
- src/iosense-sdk/mini-engine.ts
- src/iosense-sdk/api.ts
- src/App.tsx
- webpack.config.js

## Checklist

### Category 1 — Envelope Compliance
- C1.1: dynamicBindingPathList is always present in buildEnvelope() output (even [])
- C1.2: No apiConfig field emitted anywhere in the envelope
- C1.3: dynamicBindingPathList[n].topic has NO {{ }} braces (stripped by scanner)
- C1.3b: dynamicBindingPathList[n].topic matches format `uns:wsId://path` — never a workspace display name (e.g. "WorkspaceName/node/:last" is invalid; mini-engine's UNS_TOPIC_RE guard will filter it out)
- C1.4: Array keys use bracket notation: plotLines[0].value NOT plotLines.0.value
- C1.5: uiConfig stores bindable fields WITH {{ }} intact (e.g. "{{uns:wsId://...}}")
- C1.6: If a time window is configured, envelope emits `timeConfig` (TimeConfig shape) NOT `timeTabConfig` as the engine-facing key. `timeTabConfig` may co-exist for UI re-hydration but `timeConfig` must be present whenever time data is needed by the mini-engine.

### Category 2 — Widget Purity
- C2.1: No fetch(), axios, XMLHttpRequest calls inside Gauge.tsx
- C2.2: No import of mini-engine.ts or api.ts inside Gauge.tsx
- C2.3: All bindable values read via getValue(key, config, data) — not config.field directly
- C2.4: config prop is typed as GaugeUIConfig | undefined and guarded before access
- C2.5: Skeleton shown when hasLiveBinding && data.length === 0
- C2.6: User interactions use onEvent() — no inline data fetching

### Category 3 — Self-Registration
- C3.1: window.ReactWidgets['Gauge'] = { mount, update, unmount } in Gauge/index.ts
- C3.2: window.ReactWidgets['GaugeConfiguration'] = { mount, update, unmount } in GaugeConfiguration/index.ts
- C3.3: mount, update, unmount are all fully implemented (not empty stubs)
- C3.4: createRoot used (React 18) — NOT ReactDOM.render
- C3.5: container.setAttribute('data-zone-ignore', '') called in mount

### Category 4 — Build Compliance
- C4.1: React, ReactDOM listed as externals in webpack.config.js production mode
- C4.2: No localStorage reads inside Gauge.tsx or GaugeConfiguration.tsx (only allowed in App.tsx)
- C4.3: No hardcoded bearer tokens, passwords, or API keys in any src/ file
- C4.4: src/App.tsx is NOT imported by widget or configurator (dev harness only)

### Category 5 — Configurator Compliance
- C5.1: buildDynamicBindingPathList(uiConfig) called inside buildEnvelope()
- C5.2: All bindable TextInput fields have placeholder showing {{topic}} example
- C5.3: config (GaugeEnvelope | undefined) guarded — no crash when config.uiConfig is undefined
- C5.4: onChange always called with complete envelope: { _id, type, general, uiConfig, dynamicBindingPathList }

## Output format

Return ONLY a JSON object, no prose:

{
  "passed": ["C1.1", "C1.2", ...],
  "issues": [
    {
      "id": "C2.1",
      "category": 2,
      "file": "src/components/Gauge/Gauge.tsx",
      "line": 42,
      "severity": "critical",
      "issue": "fetch() call found inside widget component",
      "fix_hint": "Remove fetch(). Widget must never fetch data. Use getValue(key, config, data) to read resolved values from the data prop."
    }
  ]
}

severity rules:
- "critical" = will break in production (widget crashes, data never loads, Lens cannot mount)
- "warning" = bad practice or future risk but won't immediately break production
```

---

## Builder Fix Prompt

```
You are the IOsense widget builder. Fix the exact production issues listed below.
Do not refactor anything else. Do not add features. Only fix the listed issues.

## Source-of-truth rules (read these files first before fixing):
- Bindable.md
- Envelope.md
- MiniEngine.md
- DevHarness.md

## Issues to fix (from production review):

<INJECT: JSON array of critical Issue objects from reviewer report>

## Fix instructions per category

Category 1 (Envelope):
- If C1.2: search for apiConfig anywhere in GaugeConfiguration.tsx, remove it
- If C1.3: check buildDynamicBindingPathList — ensure match[1] is used (strips braces), not obj.trim()
- If C1.4: check walk() path concatenation — arrays must use [n] not .n
- If C1.6: In the configurator's TimeTabConfiguration onChange handler, add `timeConfig: buildTimeConfig(value)` to the onChange payload alongside `timeTabConfig: value`. Add a `buildTimeConfig(ttc)` helper that maps TimeTabUIConfig → TimeConfig: timezone→timezone, timeType→type (default 'local'), defaultDurationId→defaultDurationId, allDurations→allDurations (map GTPPreset to Duration, defaulting xPeriod to 'hour'), defaultPeriodicity→defaultPeriodicity, startTime/endTime→null. Return undefined if ttc is empty.

Category 2 (Widget Purity):
- If C2.1: remove fetch/axios call from Gauge.tsx; if it was fetching data, read it from the data prop via getValue() instead
- If C2.2: remove mini-engine/api imports from widget; these only belong in App.tsx
- If C2.3: replace config.field with getValue('field', config, data)
- If C2.4: update GaugeProps to `config: GaugeUIConfig | undefined`; add `if (!config || !isConfigured(config)) return <NoConfigScreen />;`
- If C2.5: add `const BINDING_RE = /^\{\{.+\}\}$/; const hasLiveBinding = ...; if (hasLiveBinding && data.length === 0) return <SkeletonScreen />;`

Category 3 (Self-Registration):
- If C3.3: implement missing mount/update/unmount functions in index.ts following this pattern:
  ```
  function mount(containerId, props) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.setAttribute('data-zone-ignore', '');
    const root = createRoot(container);
    roots.set(containerId, root);
    root.render(React.createElement(Gauge, props));
  }
  function update(containerId, props) {
    roots.get(containerId)?.render(React.createElement(Gauge, props));
  }
  function unmount(containerId) {
    roots.get(containerId)?.unmount();
    roots.delete(containerId);
  }
  ```
- If C3.4: replace ReactDOM.render with createRoot from 'react-dom/client'
- If C3.5: add container.setAttribute('data-zone-ignore', '') in mount

Category 4 (Build):
- If C4.2: move localStorage reads from widget/configurator into App.tsx only
- If C4.3: replace hardcoded secrets with environment variable references or remove

Category 5 (Configurator):
- If C5.1: ensure buildEnvelope() calls buildDynamicBindingPathList(uiConfig) and includes result in returned object
- If C5.3: change `if (config)` to `const ui = config?.uiConfig; if (!ui) return;` in useEffect sync

After fixing, return: DONE:<comma-separated list of issue IDs fixed> — <one-line summary per fix>
```

---

## TRACKER.md Deploy Log Format

Append to TRACKER.md after each run:

```markdown
## Deploy Log
- <UTC> — build:bundle succeeded
- <UTC> — reviewer: N passed, M critical, K warnings
- <UTC> — builder dispatched: [C2.1, C3.3, C5.3]
- <UTC> — builder done: Gauge.tsx:42 (fetch removed), index.ts:15 (unmount implemented), GaugeConfiguration.tsx:134 (uiConfig guard added)
- <UTC> — re-review: all critical resolved — DEPLOY APPROVED ✓
```

---

## Ownership

- Reads: all 4 source-of-truth files (read-only)
- Reads: (no TRACKER.md — removed)
- Runs: `npm run build:bundle`
- Spawns: Reviewer (Explore subagent) + Builder (builder subagent)
- Does NOT: modify src/ directly (builder does that)
- Does NOT: upload to S3/CDN (that step follows approval)

---

## Exit conditions

| Condition | Action |
|-----------|--------|
| Build fails | STOP — surface errors, do not attempt AI fix |
| 0 critical issues | DEPLOY APPROVED — surface passed + warnings |
| Critical issues, iteration ≤ 3 | Dispatch builder, loop |
| Critical issues, iteration > 3 | BLOCKED — surface full report, manual review required |
