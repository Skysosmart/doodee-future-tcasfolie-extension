# Doodee future — Design (Phases 1+2)

**Base spec:** [`doodee-future-guide.md`](../../../doodee-future-guide.md) is the
authoritative product spec: goal, hard rules, data model, phasing, selector
technique, test checklist. This document records only the decisions that
**differ from or add to** the guide, so the two are read together.

## Hard rules inherited from the guide (unchanged, non-negotiable)

1. **No auto-fill of the real form in phase 1.** Copy-to-clipboard only; the
   user pastes. This is a live university application.
2. **Data never leaves the machine.** `chrome.storage.local` only. No `fetch`,
   no `XMLHttpRequest`, no remote fonts, scripts, or images anywhere in the
   codebase.
3. **Never write to verified data.** Anything TCASFolio marks Verify is
   read-only to this extension. Phases 1+2 write nothing to the page at all.

## Decision 1 — split `storage.js` into `model.js` + `storage.js`

The guide specifies one shared `storage.js`. We split it:

- `model.js` — pure functions, zero `chrome.*` references. Holds every
  decision that can be wrong: id migration, upsert, delete, tag parsing,
  filtering, import merging.
- `storage.js` — thin `chrome.storage.local` adapter. Delegates all logic to
  `model.js`.

**Why:** `model.js` is directly testable under `node --test`. Without the
split there is no way to test this extension except by clicking through it.

## Decision 2 — identity and migration

The guide's data model already specifies `id` and `createdAt`, but the
shipped `popup.js` writes neither. Existing stored items therefore lack both.

`Model.normalize()` runs on **every read**: items missing `id` receive a
`crypto.randomUUID()`, items missing `createdAt` receive `0`, non-objects are
dropped, and missing string fields become `""`. It reports `changed`, and
`storage.js` writes back once when true. Migration is silent and lossless.

All mutations key off `id`, never array index. This fixes a real bug in the
shipped `popup.js`: the delete handler closes over the render-time `index`
and splices that position out of a freshly re-read array.

## Decision 3 — import merges, never replaces

The guide asks for JSON export/import to guard against storage loss
("กัน storage หาย"). Import therefore **upserts by `id`** and reports
added/updated counts. A replace-on-import would let a stale backup silently
destroy newer entries, making the backup feature itself a way to lose data.

`parseImport` accepts both the wrapper object we export and a bare array, so
a hand-edited backup still restores.

## Decision 4 — no `MutationObserver` in the content script

The guide prescribes a `MutationObserver` to wait for page elements. The
panel is `position: fixed` and anchored to `document.documentElement`; it has
no dependency on the React app's DOM, so there is nothing to wait for.
`run_at: document_idle` plus an existence guard on the host element id is
sufficient, and removes the double-injection failure mode structurally rather
than defending against it.

If a future phase anchors UI to a specific form field, the observer returns
then — that is where the guide's advice applies.

## Decision 5 — panel lives in a Shadow DOM

`content.css` moves out of `content_scripts.css` and into
`web_accessible_resources`, linked into the shadow root via
`chrome.runtime.getURL`. The shadow content stays `hidden` until the
stylesheet's `load` event fires, so there is no flash of unstyled content.

**Why:** TCASFolio is a production React app that ships global CSS resets.
Without a shadow root its `button {}` and `* {}` rules bleed into the panel
and the panel's bleed back into the application form. Shadow DOM makes the
isolation total instead of a specificity arms race that must be re-fought
after every one of their deploys.

The host element is appended to `document.documentElement`, not `body`, so a
transformed `body` cannot create a containing block that breaks
`position: fixed`.

## Decision 6 — drop `host_permissions`

The guide's target manifest lists both `host_permissions:
["https://student.mytcas.com/*"]` and a matching `content_scripts.matches`.
Declaring `content_scripts.matches` alone grants everything the panel needs,
so the `host_permissions` line widens nothing and grants nothing. Removed.

Final permission surface: `permissions: ["storage"]` plus one content script
matched to `https://student.mytcas.com/*`.

## Decision 7 — live sync between popup and panel

Both surfaces subscribe to `chrome.storage.onChanged` and re-render on
changes to the `folioItems` key, so editing in the popup updates an already
open panel. Panel collapsed state persists under a separate `panelCollapsed`
key so it can never corrupt the item array.

## Decision 8 — popup font

Popup switches to `Mali` (installed system-wide, the user's default) ahead of
`Noto Sans Thai` in the stack. Both are present on this machine; this is a
style preference, not a rendering fix. No webfont is bundled or fetched —
rule 2 forbids remote fonts, and the stack degrades to `system-ui`.

## Scope boundary

Phase 3 from the guide — the "already submitted, editing regenerates the PDF
link" warning banner and the 5-second draft autosave — is **out of scope**.
Both need selectors read off the live page.

## Testing

`node --test test/` covers `model.js`. The guide's manual checklist covers
the rest and is reproduced as the final task of the implementation plan.
`test/`, `package.json`, `docs/`, and `.git/` are excluded when packaging.
