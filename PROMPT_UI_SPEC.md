# UI Regeneration Prompt (Glassmorphism Admin Panel)

Use this prompt whenever you need to recreate or extend the current UI system for this project. Paste it into your AI tool as-is (update only the module-specific sections if needed).

---

## 🔁 Prompt

You are an expert front-end architect. Rebuild / extend a modern glassmorphism admin UI for a hotel/child search tool with the following strict requirements:

### 1. Design Objectives

- Style: Modern glassmorphism + subtle neon gradient accents.
- Modes: Dark (default) + Light theme via `html[data-theme]` attributes.
- Consistency: Centralized CSS Custom Properties (tokens) for color, spacing, radii, typography, shadows, transitions.
- Performance: Pure CSS + lightweight vanilla JS (no frameworks) except CDN libs already in use.
- Accessibility: Keyboard navigation, focus rings, skip link, aria roles for tabs and dynamic regions, high contrast text on glass surfaces.
- Responsiveness: Works from 360px mobile to large desktop.

### 2. Deliverables

1. `app.css`: Design system (tokens, resets, utilities, components, animations, dark+light theme overrides).
2. `ui.js`: Shared behaviors (theme toggle with localStorage, tab system, modal manager, toast system, ripple effect, clock updater, progress helper, drag & drop helpers, focus trap for modals).
3. Example HTML pages (login + search page) using only the published classes & IDs below.
4. No inline styles except for very tiny one-off layout adjustments (prefer classes).

### 3. Core Tokens (must exist)

Colors / gradients (samples):

```
--primary-gradient: linear-gradient(135deg,#667eea 0%,#764ba2 100%);
--secondary-gradient: linear-gradient(135deg,#f093fb 0%,#f5576c 100%);
--accent-gradient: linear-gradient(135deg,#21d4fd 0%,#b721ff 100%);
--success-gradient: linear-gradient(135deg,#0ba360 0%,#3cba92 100%);
--danger-gradient: linear-gradient(135deg,#ff0844 0%,#ffb199 100%);
--background-base (dark), --background-alt, --surface-glass, --surface-glass-strong;
--text-primary, --text-secondary, --text-tertiary;
--focus-ring, --shadow-glass, --shadow-elevate;
```

Spacing: `--spacing-xs, -sm, -md, -lg, -xl`
Radii: `--radius-xs, -sm, -md, -lg, -xl, -round`
Typography: sizes xs→xl, `--font-sans`, `--font-mono`
Transitions: `--transition-fast`, `--transition-smooth`, `--transition-bounce`
Misc: `--backdrop-blur`, `--gradient-text`, `--gradient-brand`, `--z-*` stack.

### 4. Utility Classes (non-exhaustive must-haves)

Layout: `.flex, .col, .center, .wrap, .gap-xs|sm|md|lg, .stack-sm|md|lg, .container`
Visibility: `.hidden, .visually-hidden`
Text: `.gradient-text, .text-secondary, .text-tertiary, .text-accent`
Spacing helpers: `.mt-*, .mb-*, .pt-*, .pb-*`
State: `.selected-row`, `.animate-fade-in`, `.badge`

### 5. Components (structure + class names)

1. Cards: `.glass-card.gradient` optional overlay shine.
2. Buttons: `.btn` + variants `.btn-primary, .btn-outline, .btn-accent, .btn-danger, .btn-success, .btn-modern, .btn-pill, .btn-small, .btn-large`.
3. Tabs:

```
<div class="tabs" data-tabs role="tablist">
  <button role="tab" data-target="panel-upload" aria-selected="true">Upload</button>
  <button role="tab" data-target="panel-results" aria-selected="false">Kết quả</button>
</div>
<section id="panel-upload" class="tab-panel active" role="tabpanel"></section>
<section id="panel-results" class="tab-panel" role="tabpanel"></section>
```

4. Table wrapper: `.table-wrapper` with sticky head, streaming rows.
5. Progress bar: `.progress > .progress-bar` dynamic width.
6. Toasts: `.toast-container` holds `.toast` (types: `.success`, `.error`).
7. Modal: `.modal-overlay` + `.modal` + `.modal-header` + `.modal-actions`.
8. Badges: `.badge` base + gradient variants.
9. Drag & Drop zone: `.drop-zone` plus state `.drag-over`, `.has-file`.
10. Spinner: `.loading-inline` or `.loading-spinner`.

### 6. JavaScript Behavior Specs

`Theme` object: `.toggle()`, persists to `localStorage('theme')`.
`initTabs()`: binds click & keyboard (Left/Right arrows) sets `aria-selected`, toggles `.active` on panels.
`Modal.open(html, { closeOnEsc=true })`: inject overlay, focus trap, ESC & outside click to close.
`Toasts.show({ title, message, type, timeout })`.
`enableRipples()` add ripple span inside `.btn` on pointer down.
`initClock()` update `.clock` every second.
`updateProgress(percent, text?)` update progress bar + label.
`initDragDrop(selector?)` generic highlight + file capture hook.
Keyboard shortcuts: Alt+D (theme), Alt+S (focus filter), Alt+A (open-all links in selected row).

### 7. Search Page ID Contracts (must NOT rename)

```
#fileInput #searchButton #pauseResumeButton #spinner
#progressContainer #progressBar #progressText
#resultsSection #resultsTable #resultsBody
#filterInput #resultsCount #pagePrev #pageNext #pageInfo #pageSizeSelect
#downloadCSVButton #clearResultsButton #resumeSessionButton
#orderSortIcon #noSortIcon #pctSortIcon #statusSortIcon #nameSortIcon #linksSortIcon
```

### 8. Enhanced File Input (Vietnamese)

Replace plain file input with:

```
<div id="fileDropZone" class="drop-zone">
  <input id="fileInput" type="file" accept=".xlsx,.xls" hidden>
  (icon + text "Kéo & Thả hoặc Chọn Tệp" + button "Chọn tệp..." + badge for file name + error area)
</div>
```

Interactions: drag highlight, validation (.xlsx/.xls, size limit), right-click to clear.

### 9. Accessibility

- All interactive elements reachable & visible with `:focus-visible` ring.
- Tabs: proper roles + `aria-selected` + `tabindex` management.
- Results section uses `aria-live="polite"` for streaming updates.
- Modal uses `role="dialog"` + focus trap.

### 10. Performance / Code Style

- No external CSS frameworks.
- Avoid duplicate token definitions.
- Keep selectors shallow (max 3 levels deep typical).
- Prefer composable utilities over one-off inline styles.

### 11. Optional Enhancements (If asked later)

- CSV/XLSX export button styling.
- Toast queue limit.
- Undo after clearing results.
- Worker offloading for link scoring.

### 12. Output Format

When regenerating, produce: `app.css`, `ui.js`, example `hotelSearchX.html` page, and explain where to integrate business logic JS.

---

## ✅ Acceptance Checklist (Use on Review)

- [ ] Separate CSS tokens + components are present.
- [ ] Dark/Light switch works & persists.
- [ ] Tabs keyboard accessible.
- [ ] Progress bar updates with demo call.
- [ ] Toast and Modal APIs functional.
- [ ] File drop zone styled + valid + removable.
- [ ] All required IDs preserved.
- [ ] No console errors on load.

---

## 📝 Notes

Keep this spec under version control. Update tokens or component API changes here first before refactoring code to maintain a single source of truth.
