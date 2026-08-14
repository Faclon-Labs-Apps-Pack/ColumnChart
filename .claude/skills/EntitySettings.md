# Entity Settings State Machine (portable prompt)

This is the **complete recipe** for the "Chart Settings"-style block: the standalone
form section at the top of a configurator's Data tab that manages a list of named
top-level entities (charts, pages, alerts, screens, …). Reproduce it exactly.

**How to use:** paste this file into the new widget's context and say
"build the {Entity} Settings block following EntitySettings.md". Replace:
- `{Entity}` → the entity's display name (e.g. `Chart`, `Page`)
- `{entity}` → lowercase (e.g. `chart`)
- `{p}` → the widget's CSS prefix (e.g. `cc`, `dp`)

The block owns: create-first-entity flow, view/switch flow, edit/rename flow,
add-another flow, and delete flow — with buffered (non-emitting) drafts and a single
emit funnel. It sits ABOVE the accordion sections and gates them.

---

## 1. State (exact shapes)

```tsx
// Committed source of truth. ONLY this array ever reaches onChange.
const init{Entity}s = (config?.uiConfig?.{entity}s ?? []).map(normalize{Entity});
const [{entity}sList,      set{Entity}sList]      = useState<{Entity}Config[]>(init{Entity}s);
const [selected{Entity}Id, setSelected{Entity}Id] = useState<string>(init{Entity}s[0]?._id ?? '');
const [{entity}PickerOpen, set{Entity}PickerOpen] = useState(false);      // View-mode switcher dropdown

// Scratch buffers — NEVER emit until explicitly committed.
const [pending{Entity}, setPending{Entity}] = useState<{Entity}Config>(() => makeEmpty{Entity}()); // Empty mode
const [draft,           setDraft]           = useState<{Entity}Config | null>(null);              // Edit modes

const [editMode, setEditMode] = useState<'none' | 'edit-existing' | 'edit-new'>('none');
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);        // entity-level delete confirm

// Accordion sections below the block — reset on every entity switch/save/delete.
const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
```

Factory — ids must be collision-proof (two entities can be created in the same ms):

```tsx
function makeEmpty{Entity}(): {Entity}Config {
  return {
    _id: `{entity}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    /* …every child collection initialized to [] and every required child object
       back-filled (e.g. a default axis). NEVER undefined arrays. */
  };
}
```

## 2. Derived modes (compute, don't store)

```tsx
const active{Entity}: {Entity}Config | null =
  {entity}sList.find((c) => c._id === selected{Entity}Id) ?? {entity}sList[0] ?? null;

const isEditing = editMode !== 'none';
const isEmpty   = {entity}sList.length === 0 && !isEditing;   // brand-new widget, nothing committed
const isView    = {entity}sList.length > 0 && !isEditing;     // normal state

// THE selector: which object the form fields read & write, by mode.
const form{Entity}: {Entity}Config | null =
  isEmpty ? pending{Entity} : (isEditing ? draft : active{Entity}) ?? null;

// Validation
const titleError   = isEditing && (draft?.title?.trim() ?? '') === '';
const canAddEmpty  = pending{Entity}.title.trim() !== '';
const canCommitDraft = (d: {Entity}Config | null) => d !== null && d.title.trim() !== '';

// Gate for every accordion/section below the block.
const sectionsDisabled = isEmpty || isEditing;
```

## 3. The emit funnel + field router

```tsx
// The ONLY function that writes upstream from this block.
function commitState(next{Entity}s: {Entity}Config[], opts?: { active{Entity}Id?: string }) {
  const nextActiveId = opts?.active{Entity}Id ?? selected{Entity}Id;
  // EDGE CASE: emit when there's something to render, OR an envelope already
  // existed (so deleting the LAST entity still notifies the host to clear).
  // A brand-new blank configurator stays silent.
  if (next{Entity}s.length > 0 || config) {
    emit({ {entity}s: next{Entity}s, active{Entity}Id: nextActiveId });
  }
}

// Every Title/Description/field keystroke routes through this ONE function.
function patchActive(patch: Partial<{Entity}Config>) {
  if (editMode !== 'none') {                       // Edit → buffer only, no emit
    setDraft((d) => ({ ...(d ?? makeEmpty{Entity}()), ...patch }));
    return;
  }
  if ({entity}sList.length === 0) {                // Empty → buffer only, no emit
    setPending{Entity}((p) => ({ ...p, ...patch }));
    return;
  }
  // View → committed entity: update AND emit live on every keystroke.
  const next = {entity}sList.map((c) => (c._id === selected{Entity}Id ? { ...c, ...patch } : c));
  set{Entity}sList(next);
  commitState(next);
}
```

## 4. Transitions

```tsx
// View-mode dropdown switch. Resets accordion state; persists the new active id.
function select{Entity}(id: string) {
  setSelected{Entity}Id(id);
  set{Entity}PickerOpen(false);
  setExpandedSections({});
  commitState({entity}sList, { active{Entity}Id: id });
}

// Empty mode → promote the pending buffer to the first committed entity.
function handleEmptyAdd() {
  if (!canAddEmpty) return;                                       // guard: blank title
  const committed = { ...pending{Entity}, title: pending{Entity}.title.trim() };  // trim on commit
  set{Entity}sList([committed]);
  setSelected{Entity}Id(committed._id);
  setPending{Entity}(makeEmpty{Entity}());                        // fresh buffer for next time
  commitState([committed], { active{Entity}Id: committed._id });  // FIRST emit ever
}

function startEditNew() {
  setDraft(makeEmpty{Entity}());
  setEditMode('edit-new');
}

function startEditExisting() {
  if (!active{Entity}) return;
  setDraft({ ...active{Entity} });   // EDIT A COPY — Cancel must discard cleanly
  setEditMode('edit-existing');
}

function saveDraft() {
  if (!canCommitDraft(draft)) return;
  const committed = { ...draft!, title: draft!.title.trim() };    // trim on commit
  const next = editMode === 'edit-existing'
    ? {entity}sList.map((c) => (c._id === committed._id ? committed : c))  // replace in place
    : [...{entity}sList, committed];                                        // append
  set{Entity}sList(next);
  setSelected{Entity}Id(committed._id);      // saved entity becomes the selection
  setExpandedSections({});                   // accordions collapse on save
  commitState(next, { active{Entity}Id: committed._id });
  setDraft(null);
  setEditMode('none');
}

function cancelEdit() {
  setDraft(null);         // committed data untouched — draft was a copy
  setEditMode('none');
}

function removeActive{Entity}() {
  if (!active{Entity}) return;
  const remaining = {entity}sList.filter((c) => c._id !== active{Entity}._id);
  // Reset ALL transient state regardless of outcome:
  setDraft(null); setEditMode('none'); setDeleteConfirmOpen(false); setExpandedSections({});
  if (remaining.length === 0) {
    // EDGE CASE: last entity deleted → full reset back to Empty mode,
    // and STILL emit (config exists) so the host clears the widget.
    set{Entity}sList([]);
    setSelected{Entity}Id('');
    setPending{Entity}(makeEmpty{Entity}());
    commitState([], { active{Entity}Id: '' });
    return;
  }
  set{Entity}sList(remaining);
  setSelected{Entity}Id(remaining[0]._id);   // deterministic fallback: first remaining
  commitState(remaining, { active{Entity}Id: remaining[0]._id });
}
```

## 5. Load / re-init effect (edge cases live here)

Runs keyed on `[config?._id]` ONLY (identity change), never on every prop echo:

```tsx
useEffect(() => {
  if (!config) return;
  // 1. Normalize every entity (back-fill invariants, drop dangling ids).
  let list = (config.uiConfig?.{entity}s ?? []).map(normalize{Entity});

  // 2. LEGACY MIGRATION: older envelopes stored title/description at the
  //    widget level. If the first entity lacks its own, copy them down.
  if (list.length > 0) {
    const patch: Partial<{Entity}Config> = {};
    if (!list[0].title && config.uiConfig?.title) patch.title = config.uiConfig.title;
    if (list[0].description === undefined && config.uiConfig?.description !== undefined)
      patch.description = config.uiConfig.description;
    if (Object.keys(patch).length > 0)
      list = list.map((c, i) => (i === 0 ? { ...c, ...patch } : c));
  }
  set{Entity}sList(list);

  // 3. SELECTION REPAIR: persisted active id may not exist anymore.
  const persisted = config.uiConfig?.active{Entity}Id;
  setSelected{Entity}Id(
    (persisted && list.find((c) => c._id === persisted)) ? persisted : (list[0]?._id ?? '')
  );

  // 4. Drop EVERY in-flight buffer/modal so the form snaps to loaded data.
  setPending{Entity}(makeEmpty{Entity}());
  setDraft(null);
  setEditMode('none');
  setDeleteConfirmOpen(false);
  // …plus re-seed all other tab state with the same `?? default` fallbacks.
}, [config?._id]);
```

## 6. UI — the block itself

```tsx
<div className="{p}-config__{entity}-settings">
  {/* Head row: heading left, mode-driven icon actions right */}
  <div className="{p}-config__{entity}-settings-head">
    <p className="BodySmallSemibold {p}-config__{entity}-settings-heading">{Entity} Settings</p>
    <span className="{p}-config__{entity}-settings-actions">
      {/* Trash ONLY in edit-existing. NOT in edit-new (nothing committed yet —
          showing it would delete the previously active entity by mistake). */}
      {isEditing && editMode === 'edit-existing' && (
        <IconButton icon={<Trash2 size={14} />} size="16" aria-label="Delete {entity}"
          onClick={() => setDeleteConfirmOpen(true)} />
      )}
      {isView && (
        <>
          <Tooltip placement="Bottom" bodyText="Add New {Entity}">
            <IconButton icon={<Plus size={14} />} size="16" aria-label="Add {entity}" onClick={startEditNew} />
          </Tooltip>
          <Tooltip placement="Bottom" bodyText="Edit {Entity}">
            <IconButton icon={<Edit2 size={14} />} size="16" aria-label="Edit {entity}" onClick={startEditExisting} />
          </Tooltip>
        </>
      )}
      {/* Empty mode: NO icons at all. */}
    </span>
  </div>

  {/* Title field: switcher in View with >1 entities, TextInput otherwise */}
  {isView && {entity}sList.length > 1 ? (
    <SelectInput
      label="{Entity} title" placeholder="Select {entity}"
      value={active{Entity}?.title || `{Entity}`}
      isOpen={{entity}PickerOpen}
      onClick={() => set{Entity}PickerOpen((v) => !v)}
    >
      {{entity}PickerOpen && (
        <DropdownMenu>
          <ActionListItemGroup>
            {{entity}sList.map((c, i) => (
              <ActionListItem key={c._id}
                title={c.title || `{Entity} ${i + 1}`}          // positional fallback name
                selectionType="Single"
                isSelected={selected{Entity}Id === c._id}
                onClick={() => select{Entity}(c._id)} />
            ))}
          </ActionListItemGroup>
        </DropdownMenu>
      )}
    </SelectInput>
  ) : (
    <TextInput
      label="{Entity} title"
      necessityIndicator="required"
      isReadOnly={isView}                                        // View = read-only
      placeholder={isView ? '—' : 'Enter {entity} title'}        // em-dash placeholder when read-only
      value={form{Entity}?.title ?? ''}
      validationState={titleError ? 'error' : 'none'}
      errorText="{Entity} title is required"
      onChange={({ value }) => patchActive({ title: value })}
    />
  )}

  <TextInput
    label="Description"
    isReadOnly={isView}
    placeholder={isView ? '—' : 'Enter description'}
    value={form{Entity}?.description ?? ''}
    onChange={({ value }) => patchActive({ description: value })}
  />

  {/* Footer buttons, by mode */}
  {isEmpty && canAddEmpty && (          /* Save appears ONLY once title is non-blank */
    <div className="{p}-config__{entity}-settings-footer">
      <Button variant="Primary" label="Save" onClick={handleEmptyAdd} />
    </div>
  )}
  {isEditing && (
    <div className="{p}-config__{entity}-settings-footer">
      <Button variant="Gray" label="Cancel" onClick={cancelEdit} />
      <Button variant="Primary"
        label={editMode === 'edit-existing' ? 'Save changes' : 'Save'}
        isDisabled={!canCommitDraft(draft)}
        onClick={saveDraft} />
    </div>
  )}
</div>
```

CSS (token-driven; matches the rest of the configurator body grammar):

```css
.{p}-config__{entity}-settings {
  display: flex; flex-direction: column;
  gap: var(--spacing-04, 12px);
  padding: var(--spacing-04, 12px) var(--spacing-05, 16px);
  border-bottom: 1px solid var(--border-gray-subtle, #f0f0f0);
}
.{p}-config__{entity}-settings-heading { margin: 0; color: var(--text-gray-primary, #1a1a1a); }
.{p}-config__{entity}-settings-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-03, 8px);
}
.{p}-config__{entity}-settings-actions {
  display: inline-flex; align-items: center; gap: var(--spacing-02, 4px);
}
.{p}-config__{entity}-settings-footer {
  display: flex; align-items: center; justify-content: flex-end;
  gap: var(--spacing-03, 8px); margin-top: var(--spacing-02, 4px);
}
```

## 7. Delete confirm modal (entity-level)

Centered 360px modal (never a direct delete):

```tsx
<Modal isOpen={deleteConfirmOpen} className="{p}-delete-confirm-modal"
  onClose={() => setDeleteConfirmOpen(false)}
  header={<ModalHeader title="Delete {Entity}"
    leadingItem={<span className="{p}-delete-confirm-modal__icon"><Trash2 size={16} /></span>}
    onClose={() => setDeleteConfirmOpen(false)} />}
  footer={<ModalFooter
    primaryAction={<Button variant="Primary" color="Negative" label="Delete" onClick={removeActive{Entity}} />}
    secondaryAction={<Button variant="Gray" label="Cancel" onClick={() => setDeleteConfirmOpen(false)} />} />}
>
  <ModalBody>
    <p className="BodyMediumRegular {p}-delete-confirm-modal__body">
      {`Are you sure you want to delete "${active{Entity}?.title || 'this {entity}'}" and all of its
        <enumerate child collections here>? This action is irreversible.`}
    </p>
  </ModalBody>
</Modal>
```

(Icon-square + modal CSS: see ConfigLayout.md §8 — width 360px, tinted red
`--spacing-08` square using `--background-error-secondary` / `--text-error-default`.)

## 8. Gating the sections below

Accordions render in EVERY mode so the user always sees the configurator's structure,
but they're inert until this block resolves:

```tsx
// Frozen placeholder so section JSX never branches on null. All arrays [],
// required structural children back-filled.
const EMPTY_SECTION_{ENTITY}: {Entity}Config = { _id: '', title: '', /* …[] everywhere */ };

const selected{Entity} =
  {entity}sList.find((c) => c._id === selected{Entity}Id) ?? {entity}sList[0] ?? EMPTY_SECTION_{ENTITY};

// Pass to every ProductAccordionItem AND every header + IconButton:
//   isDisabled={sectionsDisabled}
```

While disabled, accordion bodies still show their "No X. Click + to add." hints.

## 9. Behavior matrix (quick reference)

| Mode | Title field | Description | Head icons | Footer | Sections | Emits? |
|---|---|---|---|---|---|---|
| Empty | editable, required | editable | none | `Save` (only when title non-blank) | visible, disabled | never (until Save) |
| View, 1 entity | read-only TextInput, placeholder `—` | read-only | `+` `✎` (tooltipped) | none | enabled | live on any committed-field change |
| View, >1 | SelectInput switcher | read-only | `+` `✎` | none | enabled | on switch (activeId) |
| Edit-existing | editable, error state when blank | editable | `🗑` only | `Cancel` + `Save changes` (disabled while invalid) | visible, disabled | only on Save / confirmed Delete |
| Edit-new | editable, error state when blank | editable | none | `Cancel` + `Save` (disabled while invalid) | visible, disabled | only on Save |

## 10. Edge cases — the complete list (verify each one when replicating)

1. **Blank title, Empty mode** → the Save button does not render at all (not merely
   disabled). It appears the moment the title has non-whitespace content.
2. **Blank title, Edit modes** → field shows `validationState="error"` +
   `errorText`; Save/`Save changes` is rendered but `isDisabled`.
3. **Whitespace-only titles** are invalid everywhere — all guards use `.trim()`,
   and the title is trimmed again at commit time so `"  A  "` persists as `"A"`.
4. **Cancel never mutates** — edit works on `{ ...active }` copies; cancel just
   drops the buffer. Verify: edit → change title → Cancel → original title intact.
5. **Trash hidden in `edit-new`** — a delete icon there would target the
   previously active committed entity, not the unsaved draft. Only `edit-existing`
   shows it, and it opens the confirm modal, never deletes directly.
6. **Delete last entity** → full reset to Empty mode (empty list, `selectedId ''`,
   fresh pending buffer, accordions collapsed) AND an emit still fires (because
   `config` exists) so the host clears the rendered widget.
7. **Delete non-last entity** → selection deterministically falls back to
   `remaining[0]`, emitted as the new `active{Entity}Id`.
8. **Brand-new configurator (config === undefined) never emits** until the first
   entity is saved — `commitState` skips when `list.length === 0 && !config`.
9. **First emit happens on Empty-mode Save** (`handleEmptyAdd`), producing the
   envelope with `_id: widget_${Date.now()}`.
10. **View-mode edits commit live** — every keystroke on a committed entity's
    field emits a full envelope. Buffered modes never do.
11. **Switching entities** resets `expandedSections` to `{}` and persists the new
    `active{Entity}Id` in the envelope (it IS persisted config, unlike tab state).
12. **Saving (either edit mode) selects the saved entity** and collapses all
    accordions — the user lands on the entity they just saved.
13. **Persisted `active{Entity}Id` may dangle** (entity deleted elsewhere) —
    on load, validate against the list; fall back to `list[0]?._id ?? ''`.
14. **Legacy envelope migration** — widget-level `title`/`description` copy down
    onto the first entity only if that entity lacks its own (never overwrite).
15. **Host re-passes a config with the same `_id`** → the re-init effect does NOT
    run (keyed on `config?._id`), so in-flight edits survive prop echoes from our
    own emits. Separate narrow effects re-sync sub-configs (e.g. timeTabConfig)
    whose reference changed.
16. **Host passes a DIFFERENT `_id`** → everything re-seeds and ALL buffers/modals
    are force-closed (`draft null`, `editMode none`, confirm closed, pending fresh).
17. **Id collisions** — entity ids include a random suffix
    (`${Date.now()}_${random36}`) because two entities can be created within the
    same millisecond (e.g. fast Add → Save → Add → Save).
18. **`makeEmpty{Entity}` back-fills structural invariants** (e.g. the default
    left axis) so no downstream section ever meets an undefined child.
19. **Normalize on load** — every entity from the envelope passes through
    `normalize{Entity}()` which repairs invariants and drops dangling child ids
    before touching state.
20. **Positional fallback names everywhere** — `c.title || `{Entity} ${i + 1}``
    in the switcher, delete-modal body uses `|| 'this {entity}'`. Never render blank.
21. **Sections in Empty mode read a frozen placeholder** entity so their JSX
    doesn't null-branch; every mutating affordance is disabled via
    `sectionsDisabled`, but hints/structure stay visible.
22. **`patchActive` in an impossible state** (edit mode with null draft) falls
    back to `makeEmpty{Entity}()` instead of crashing: `{ ...(d ?? makeEmpty{Entity}()), ...patch }`.
23. **Head icons are mode-exclusive** — Empty: none; View: `+` and `✎`;
    edit-existing: trash only; edit-new: none. Never two modes' icons at once.
24. **Tooltips** on View-mode `+`/`✎` (`placement="Bottom"`, bodyText
    "Add New {Entity}" / "Edit {Entity}"); no tooltip on the trash.
25. **Read-only placeholders** are `—` (em dash), not the editable placeholder text.

## 11. DON'T list

- Don't emit from `pending{Entity}` or `draft` — ever.
- Don't add a second path to `onChange` — all writes go through `commitState` → `emit`.
- Don't key the re-init effect on the whole `config` object (echo loops) — `config?._id` only.
- Don't allow delete without the confirm modal.
- Don't show the trash in `edit-new`.
- Don't keep accordion sections mounted-but-hidden in Empty/Edit — they stay visible
  and disabled.
- Don't persist `editMode`, buffers, picker-open, or expandedSections to the envelope.
- Don't use bare `Date.now()` for entity ids without a random suffix.
