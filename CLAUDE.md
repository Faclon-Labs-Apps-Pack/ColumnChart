# IOsense Widget — Architecture Rules

Read the skill files below **before touching any widget code**. They are the source of truth.

| Skill file | What it covers |
|---|---|
| `.claude/skills/Envelope.md` | Widget/configurator/mini-engine contract, envelope shape, DO/DON'T checklist |
| `.claude/skills/Bindable.md` | How `{{topic}}` bindings work, `buildDynamicBindingPathList` implementation |
| `.claude/skills/MiniEngine.md` | `resolve()` data pipeline, `resolveAndCompute` API, DataEntry contract |
| `.claude/skills/DevHarness.md` | `App.tsx` wiring, auth flow, console logs to expect |
| `.claude/skills/ConfigLayout.md` | **Configurator look & behavior contract** — panel shell, header/back button, tabs, section/accordion layout, side-panel + delete-confirm modals, spacing tokens, form control catalog, entity state machine, null-safety strategy. Mandatory for every configurator; portable to new widgets |
| `.claude/skills/EntitySettings.md` | **Entity Settings state machine** — the "Chart Settings"-style block: Empty/View/Edit modes, pending/draft buffers, single emit funnel, load/migration effects, full edge-case list. Use whenever a configurator manages a list of named top-level entities |

---

## Non-Negotiable Rules

1. **Widget never fetches data** — all data arrives through the `data: DataEntry[]` prop from the mini-engine
2. **Envelope shape**: `{ _id, type, general, uiConfig, dynamicBindingPathList }` — **no `apiConfig`**
3. **Configurator always calls `buildDynamicBindingPathList(uiConfig)`** before emitting via `onChange()`
4. **One resolveAndCompute call** covers all bindings — no per-field fetch loops
5. **All UI uses `@faclon-labs/design-sdk`** components and CSS tokens — no custom components, no hardcoded colors or spacing

---

## Starting a New Widget

1. Run `./init-widget.sh YourWidgetName` — renames all `WidgetTemplate` placeholders
2. Add widget-specific types to `src/iosense-sdk/types.ts`
3. Implement the configurator in `src/components/YourWidgetNameConfiguration/`
4. Implement the widget renderer in `src/components/YourWidgetName/`
5. Run `npm start` — dev harness shows live preview at `http://localhost:3000`
6. Authenticate once: visit `http://localhost:3000/?token=<SSO_TOKEN>`

---

## Configurator Overlay Pattern

Use this pattern whenever a configurator needs an "add / edit" modal (e.g. Add Data Source, Add Alert, Add Rule). No need to re-explain it — follow this recipe exactly.

### 1. Ref + position state

Attach a `ref` to the root configurator `<div>` and compute the modal position when the trigger is clicked:

```tsx
const configRef = useRef<HTMLDivElement>(null);
const [modalX, setModalX] = useState(0);
const [modalY, setModalY] = useState(0);

function openModal(e: React.MouseEvent) {
  e.stopPropagation();                              // prevent parent handlers (e.g. accordion)
  if (configRef.current) {
    const rect = configRef.current.getBoundingClientRect();
    setModalX(rect.right + 30);                     // 30 px gap to the right of config panel
    setModalY(rect.top);                            // top-aligned with config panel
  }
  setIsOpen(true);
}
```

Apply the ref to the configurator root:
```tsx
<div className="dp-config" ref={configRef}>
```

### 2. Modal JSX

```tsx
<Modal
  {...({ transparent: true } as any)}              // transparent backdrop (undocumented runtime prop)
  isOpen={isOpen}
  positionX={modalX}
  positionY={modalY}
  className="dp-<name>-modal"                      // scoped class for width override
  onClose={handleClose}
  header={<ModalHeader title="Add …" onClose={handleClose} />}
  footer={
    <ModalFooter
      primaryAction={<Button variant="Primary" label="Add …" onClick={handleSubmit} />}
    />
  }
>
  <ModalBody>
    <div className="dp-<name>-modal__body">
      {/* form fields stacked flex-column */}
    </div>
  </ModalBody>
</Modal>
```

### 3. CSS (width + body layout)

`Modal.size` only accepts Small/Medium/Large — override width via the scoped class:

```css
.dp-<name>-modal .fds-modal {
  width: 280px;                                     /* or whatever width is required */
}

.dp-<name>-modal__body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-04, 12px);
}
```

### 4. Imports

```tsx
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { Button } from '@faclon-labs/design-sdk/Button';
```

### Rules

- `transparent: true` is not in the `.d.ts` — always cast via `{...({ transparent: true } as any)}`.
- `positionX` / `positionY` are viewport-absolute px values — always derive from `getBoundingClientRect()`.
- `e.stopPropagation()` on every trigger that lives inside an accordion header or other click handler.
- Reset all form state in `handleClose` **and** at the end of `handleSubmit`.

---

## UNS Injection Pattern

Use this pattern in **every configurator** that has bindable fields. No need to re-explain it — follow this recipe exactly.

Uses `@faclon-labs/design-sdk/UNSTreePicker` (requires design-sdk **≥ 0.7.16**) — the lazy,
workspace-scoped picker. **`UNSPathInput` (static fully-materialized `tree`) is deprecated — do
not use it in new or migrated code.** Angular injects `unsWorkspaces`, `isLoadingWorkspaces`,
`loadUnsChildren`, and `searchUnsNodes` at runtime. The dev harness falls back to the
`useUNSTreePicker` hook. The configurator must support both paths.

### 1. Props interface additions

```tsx
// All-or-none: Angular injects all four (searchUnsNodes may be omitted to hide search)
unsWorkspaces?: UNSWorkspace[];
isLoadingWorkspaces?: boolean;
loadUnsChildren?: (wsId: string, parentId?: string) => Promise<UNSNode[]>;
searchUnsNodes?: (wsId: string, query: string, limit?: number) => Promise<UNSNode[]>;
```

### 2. Injection detection + hook wiring

Add inside the component, before `return`. The hook is always called (Rules of Hooks). Only
`unsWorkspaces` + `loadUnsChildren` gate injection — `isLoadingWorkspaces`/`searchUnsNodes` are
optional on both paths (workspace loading is eager/automatic on both — there's no `onOpen`-style
trigger to wire up, unlike the old `UNSPathInput` pattern).

```tsx
const hasInjectedUNS =
  props.unsWorkspaces !== undefined &&
  props.loadUnsChildren !== undefined;

const hookResult = useUNSTreePicker(hasInjectedUNS ? undefined : authentication);
const unsWorkspaces       = hasInjectedUNS ? props.unsWorkspaces!               : hookResult.workspaces;
const isLoadingWorkspaces = hasInjectedUNS ? (props.isLoadingWorkspaces ?? false) : hookResult.isLoadingWorkspaces;
const loadUnsChildren     = hasInjectedUNS ? props.loadUnsChildren!             : hookResult.loadChildren;
const searchUnsNodes      = hasInjectedUNS ? (props.searchUnsNodes ?? hookResult.searchNodes) : hookResult.searchNodes;
```

### 3. UNSTreePicker for every bindable field

Replace any raw `<input>` (or old `UNSPathInput`) on a bindable field with:

```tsx
<UNSTreePicker
  label="..."
  placeholder="Click to browse UNS or paste {{topic}} directly"
  value={myField}
  workspaces={unsWorkspaces}
  isLoadingWorkspaces={isLoadingWorkspaces}
  loadChildren={loadUnsChildren}
  searchNodes={searchUnsNodes}
  onChange={(v: string) => {
    setMyField(v);
    emit({ myField: v });
  }}
/>
```

**No `resolveUNSValue` step.** `onChange` emits the final `{{uns:wsId://path}}` topic directly —
save it straight to config.

### 3a. Dual-mode fields (static value OR a UNS binding) — `allowFreeValue`

Some fields (a plot-line's Value, a plot-band's Start/End) accept **either** a literal number
**or** a bound topic — never a raw `<input>` fallback and never a manual Static/UNS-Bind radio
toggle. Requires design-sdk **≥ 0.7.17**. Add `allowFreeValue` and update the placeholder:

```tsx
<UNSTreePicker
  label="Value"
  placeholder="Type a number or / to bind"
  value={myField}
  allowFreeValue
  workspaces={unsWorkspaces}
  isLoadingWorkspaces={isLoadingWorkspaces}
  loadChildren={loadUnsChildren}
  searchNodes={searchUnsNodes}
  onChange={(v: string) => setMyField(v)}
/>
```

Typing a leading `/` flips the field into the UNS picker; otherwise the typed text commits as a
plain string. `onChange`'s `meta.type` is `'selected'` (topic), `'value'` (free text), or
`'cleared'` — or just check `isTopic(value)` (also exported from
`@faclon-labs/design-sdk/UNSTreePicker`) at save time, same as the existing `VARIABLE_REGEX`
`{{...}}` check this repo already uses for bindable-field detection. **Never build a Static/UNS
toggle (RadioGroup + swapping between `TextInput`/`UNSTreePicker`) for this — `allowFreeValue`
replaced that need entirely.**

### 4. Imports

```tsx
import { useUNSTreePicker } from '../../iosense-sdk/useUNSTreePicker';
import { UNSTreePicker } from '@faclon-labs/design-sdk/UNSTreePicker';
import type { UNSWorkspace, UNSNode } from '@faclon-labs/design-sdk/UNSTreePicker';
```

### Rules

- `useUNSTreePicker` is always called unconditionally — pass `undefined` as auth when injection is active.
- Never pass `unsWorkspaces` / `loadUnsChildren` / `searchUnsNodes` down to the widget renderer — configurator-only.
- Every bindable field must use `UNSTreePicker`, not a raw `<input>` or the deprecated `UNSPathInput`.
- **z-index gotcha:** the picker's dropdown portals to `<body>` at `--global-z-index-popover` (500). If it opens inside a modal with a higher z-index, add `.fds-uns-tree-picker__popover` to that modal's popover z-index override — otherwise the dropdown renders behind the modal (empty-looking list). Same class also needs adding to any outside-click guard that watches for SDK popovers inside modals.
- **Deploy, don't just rebuild** — the host loads the deployed config bundle from S3, not your local build.
