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
added/updated counts. A replace-on-import would drop every entry the backup
file does not carry, making the backup feature itself a way to lose data.

**What this does and does not protect.** Entries *absent* from the backup
survive an import untouched — that is the guarantee. For an id present on
both sides the incoming backup wins unconditionally, so importing a stale
backup does revert edits made to those items since it was taken. That is
deliberate: the opposite rule (existing entry wins) would make it impossible
to restore an item you damaged, which is the main reason to keep backups.
There is no `updatedAt` in the guide's data model and no freshness
comparison, so the popup's `เพิ่ม X · อัปเดต Y` status line is the only
signal that Y existing entries were overwritten. Anyone adding a
restore-from-backup affordance later must not assume the model layer
resolves conflicts by recency — it does not.

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
and the panel's bleed back into the application form.

**Correction (Task 5 review).** An earlier draft of this decision claimed the
shadow root makes "the isolation total". That is only half true, and the wrong
half was the one this decision leaned on. Measured in Chromium 151:

- **Bleed *out* is total.** Page `button {}`, `select {}`, and `* {}` rules were
  all correctly blocked from reaching panel internals, and the panel's own rules
  never touched the page's elements.
- **Bleed *in* through the host is not blocked by `:host` alone.** Normal
  declarations in the outer tree beat normal declarations in `:host` — that is
  cascade *origin* order, not specificity, so `all: initial` cannot win it. A
  plain page rule `div { color: red; line-height: 3; margin: 12px }` with no
  `!important` at all recoloured the panel's text, tripled its line-height, and
  displaced the whole panel by 12px.

The fix is not more shadow DOM, it is two rules:
1. Layout properties that must survive (`position`, `top`, `right`, `margin`,
   `padding`, `z-index`, `display`) carry `!important` on `:host`.
2. Inherited typography (`font-family`, `font-size`, `line-height`, `color`) is
   declared on `.panel` — inside the shadow tree, where no page selector can
   reach — instead of only on `:host`.

Re-measured after the fix: a page stylesheet of
`* { color: red !important; margin: 12px !important; font-family: 'Comic Sans MS' !important }`
left the panel at `top: 88px`, `margin: 0`, `position: fixed`, its own colour, and
its own font. The guarantee now matches the claim.

The host element is appended to `document.documentElement`, not `body`, so a
transformed `body` cannot create a containing block that breaks
`position: fixed`.

## Decision 9 — the panel starts collapsed

`Storage.getPanelCollapsed()` returns `true` when the key has never been set,
and `content.js` initialises `collapsed = true` and calls `applyCollapsed()`
*synchronously*, before the host is appended, so the first paint is collapsed
too.

**Why:** the panel is `position: fixed; right: 0; z-index: 2147483647` with a
300px width and a 70vh cap. Measured with `document.elementFromPoint`, an
expanded panel returns *itself* for any page control inside that band — the
click never reaches the control, and nothing on screen explains why. On a
deadline-bound university application, a dead submit button is a serious
failure, and we cannot know from here which of TCASFolio's controls sit in that
band.

Collapsed, the host is 46×42 and the same measurement returns the page's own
button again. Defaulting to collapsed makes "the panel blocks something" a state
the student opts into and can immediately undo, rather than the state they are
dropped into. The stored preference always wins on later visits, so this costs a
returning user nothing.

The rejected alternatives: dragging (real work, and the position still has to
start somewhere), a lower `z-index` (loses to the site's own stacking and the
panel disappears under their header), and shrinking the panel (narrows the
collision without removing it).

To go back to expanded-by-default, change the one `return true` in
`storage.js`'s `getPanelCollapsed`.

## Decision 10 — the shadow root stays `mode: "open"`

**Why it was questioned:** an open root lets TCASFolio's own JavaScript read
`host.shadowRoot` and enumerate the panel — every rendered title, org, type, and
tag — plus recover the extension's id from the stylesheet href.

**Why it stays open anyway.** Item `detail` — the essay text, the part that
actually matters — is never in the DOM at all; it lives only in the copy
handler's closure, so it is not exposed either way. What is exposed is a list of
portfolio titles the student is in the middle of submitting *to that same site*.
And `mode: "closed"` is not a real boundary: a page that patches
`Element.prototype.attachShadow` before `document_idle` defeats it completely, so
it would buy the appearance of protection rather than protection.

Open also keeps the panel inspectable — every browser-side verification of this
project was done by reading `host.shadowRoot` from the page world.

This is a judgement call, recorded here so it is a decision rather than a
default.

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
