# บันทึกการสร้าง Doodee future — เฟส 1 + 2

บันทึกจากตอนสร้างจริง: ทุกครั้งที่ review เจอปัญหา ตัดสินใจยังไง และวัดผลด้วยอะไร
ตัวสเปกที่สรุปแล้วอยู่ที่ `specs/2026-08-18-doodee-future-design.md`

# SDD ledger — plan: docs/superpowers/plans/2026-08-18-doodee-future-phases-1-2.md

Spec: docs/superpowers/specs/2026-08-18-doodee-future-design.md (read; product spec doodee-future-guide.md also read)
Branch: feat/phases-1-2 (branched from master; NOT a separate worktree — see ruling below)

## Pre-flight conflict scan

### Cross-task rows (every pair sharing a file or interface)
| Pair | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | `globalThis.Model.normalize` → `storage.js` | OK — defined in T1 |
| T1 → T3 | `Model.TYPES/makeItem/upsert/remove/formatTags` → `popup.js` | OK — all exported in T1 |
| T1 → T4 | `Model.toExport/parseImport/mergeImport` → `popup.js` | OK — all exported in T1 |
| T1 → T5 | `Model.TYPES/filterItems/allTags` → `content.js` | OK — all exported in T1 |
| T2 → T3 | `Storage.getItems/setItems/onItemsChanged` → `popup.js` | OK |
| T2 → T5 | `Storage.getPanelCollapsed/setPanelCollapsed` → `content.js` | OK |
| T2 → T5 | manifest declares `content.js`/`content.css` → files created in T5 | **CONFLICT — see Ruling 2** |
| T3 → T4 | `popup.html` ids `exportBtn`/`importBtn`/`importFile`; `el()`/`showStatus()`/`render()` | OK — T3 ships the ids so T4 touches only popup.js |
| T3 → T5 | `popup.css` vs `content.css` | OK — separate files; shadow root isolates |
| T5 → T2 | `web_accessible_resources: content.css` | folded into Ruling 2 |
| T6 → all | verification only | OK |

### Per-task self-consistency rows
| Task | Tests vs code / files created vs later touched | Finding |
|---|---|---|
| T1 | 13 `test()` blocks; every `M.*` they call is in the export list; `test/model.test.js` requires `../model.js`; no `"type"` in package.json so CJS `require` is correct | OK |
| T2 | `storage.js` delegates all logic to `Model`; no assertions to write (thin by design, stated) | OK |
| T3 | `popup.html` loads model→storage→popup in order; `popup.js` refs only ids present in the new html | OK |
| T4 | appends to `popup.js`; reuses `el`/`showStatus`/`render` whose signatures T3 fixes | OK |
| T5 | `content.js` refs only `Model`/`Storage` names the manifest loads ahead of it | OK |
| T6 | grep-based no-network check; manifest is the only legitimate URL holder | OK |

## Rulings

Ruling 1: Work on branch `feat/phases-1-2` in the primary directory rather than a
  separate git worktree. Why: Tasks 3-6 require the user to load this folder
  unpacked in Chrome by path; a worktree would move that path, forcing them to
  re-point Chrome and then re-point it back after merge. Cost if wrong: the work
  is on a branch rather than an isolated checkout — recoverable with normal git.

Ruling 2: Move the `content_scripts` + `web_accessible_resources` manifest change
  out of Task 2 and into Task 5 Step 1, alongside the files it names. Why: Chrome
  refuses to load an extension whose manifest declares a content-script file that
  does not exist, so Task 2's manifest edit would break the hands-on verification
  in Task 3 Step 5 and Task 4 Step 3. Confirmed the original manifest has neither
  `host_permissions` nor `content_scripts`, so nothing is being removed — only
  added, later. Cost if wrong: none functional; task boundaries shift only.

Ruling 3: Implementers run on Sonnet rather than the cheapest tier, despite the
  plan carrying complete code (which the skill says warrants the cheapest tier).
  Why: every file is dense with Thai UI copy and Thai comments, and a
  transcription slip there is silent — it ships as mojibake in a real university
  application tool. Cost if wrong: modestly higher token spend per task.

## Progress

Ruling 4: `package.json` test script becomes `node --test test/*.test.js`, not the
  plan's `node --test test/`. Why: on this machine's Node v26.7.0 a bare directory
  argument is resolved as a module path and fails with "Cannot find module .../test";
  the glob form runs the same 13 tests green and is explicit about scope (bare
  `node --test` also works but would discover test files anywhere in the repo).
  Verified all four invocations myself before ruling. Cost if wrong: none — the
  suite and its assertions are untouched, only how it is invoked.
  Credit: raised by the Task 1 implementer as DONE_WITH_CONCERNS; it was my plan's defect.
Task 1: fix round 1/5 (1 addressed, 0 open — package.json test script glob; commits d39f2f7..3d74466)
Task 1: controller check — model.js and test/model.test.js verified byte-identical to the brief; all 35 distinct Thai strings present.

Ruling 5: Task 1 Important finding (plan-mandated) — `mergeImport` lets an incoming
  backup overwrite an existing entry with the same id, so a stale backup reverts
  edits made since. RULED: the CODE STANDS; the SPEC's claim was wrong and is
  corrected. Backup-wins is the right semantic for a restore path — existing-wins
  would make it impossible to restore an item you damaged, the main reason to keep
  backups. The reviewer correctly caught that spec Decision 3 claimed protection
  for "newer entries" that the function never provided; Decision 3 now states the
  real guarantee (absent entries survive) and the real hazard (same-id entries are
  overwritten, `อัปเดต Y` is the only signal). No later task assumes recency-based
  conflict resolution, so this is not load-bearing.
  Cost if wrong: a user who imports an old backup over newer edits loses those
  edits, warned only by the after-the-fact count. SURFACE THIS TO THE USER.
Task 1: minor (deferred): normalize() admits array entries — `typeof [] === "object"`
  passes the model.js:66 filter, yielding a phantom all-empty item from hand-edited
  import JSON. One-line guard `!Array.isArray(entry)` + a test. Triage at final review.
Task 1: minor (deferred): makeItem and normalize's per-entry mapper duplicate the
  same 7-key coercion; an 8th field would need both updated in lockstep.
Task 1: complete (commits c21e7c4..3d74466, review clean after Ruling 5; 2 minors deferred)

Ruling 6: Commit author identity was inconsistent — controller commits used
  `zaru <grimkrimmer@gmail.com>` (env email, my error: I did not check git config first)
  while subagent commits picked up the global `Skysosmart
  <165190534+Skysosmart@users.noreply.github.com>`. Pinned repo-local config to
  Skysosmart so all further commits match. Did NOT rewrite the 4 mismatched commits
  now: it would change every SHA, invalidating the BASE/HEAD values this ledger and
  the review packages reference. Offer the rewrite at finish time instead.
  Affected: 324ee3d, dbe7e76, c21e7c4, fd063ef. Cost if wrong: cosmetic; local-only
  repo with no remote, nothing pushed.
  Also note: commits are missing the Co-Authored-By/Claude-Session trailers required
  by the session config. Fold into the same optional rewrite at finish.

Task 2: minor (deferred): concurrent cold-start migration from popup + content script
  could issue two idempotent writes and one extra onChanged. Harmless; triage at final.
Task 2: minor (deferred): no try/catch or chrome.runtime.lastError handling around
  chrome.storage.local calls. Defensible for a deliberately-thin file.
Task 2: ⚠️ resolved by controller — reviewer could not verify from its diff whether
  onItemsChanged's no-unsubscribe design is safe once content.js exists. Checked the
  plan: Task 5's content.js calls Storage.onItemsChanged(refresh) exactly once, at the
  bottom of a single IIFE guarded by `if (document.getElementById(HOST_ID)) return`.
  Content scripts re-run only on full page loads, which create a fresh JS context and
  tear down the old listeners; SPA pushState navigation does not re-run them. One
  listener per context. NOT a gap. Re-verify concretely at the Task 5 review.
Task 2: complete (commits fd063ef..86776b4, review clean, Approved; 2 minors deferred)

Ruling 7: Task 3 review returned 3 Important findings, all plan-mandated (the brief's
  code contained them verbatim). RULED: all three are real and cheaply fixable — FIX
  ALL THREE, and amend the plan + briefs 3 and 4 so the brief stays the source of truth.
  (a) Unguarded read-modify-write race across save/delete. Exposure is narrower than the
      reviewer assumed — Task 5's panel is READ-ONLY for items, and Chrome allows only one
      extension popup at a time — so the live path is a rapid double-click in one popup.
      Still worth fixing: a serialised write queue is ~15 lines and also gives finding (c)
      a single place to live. Fixed via `mutate(change, okMessage)`.
  (b) Editing an item deleted from another context silently resurrects it under its old id
      with a fresh createdAt. Reachability today is thin (nothing else writes items), but
      the guard is 4 lines in render() and this is exactly what bites when a future task
      adds a write path to the panel. Fixed.
  (c) No error handling around storage I/O — a failed write is a silent no-op. This is the
      one that actually matters: the user clicks บันทึก against an application deadline and
      gets no signal. Fixed inside `mutate`, and the form is now NOT cleared on a failed
      write so their typing survives.
  Also folded Task 4's import through the same queue for consistency.
  Cost if wrong: ~30 added lines in popup.js and a deviation from the originally-approved
  plan text; behaviour is strictly more defensive, nothing removed.

Ruling 8: Task 3 review ⚠️ — whether navigator.clipboard.writeText needs a `clipboardWrite`
  permission in manifest.json (Task 5's file). RULED: no permission added. In an extension
  popup, writeText succeeds under the user activation a click provides; `clipboardWrite` is
  needed for execCommand-style copies from non-activated contexts. In Task 5's content
  script the call runs against the host page's permissions policy, which could refuse — the
  code already try/catches and shows "คัดลอกไม่สำเร็จ", and Task 5's manual checklist tests
  copy explicitly against the live site. Adding the permission would widen the install
  warning for no gain. Cost if wrong: copy fails on TCASFolio and the manual test catches it.
Task 3: minor (deferred): armTimer for a delete button destroyed mid-arm by a re-render is
  never cleared; the 3s timeout fires against a detached node. Harmless.
Task 3: minor (deferred): armed-state "แน่ใจ?" text change has no aria-live announcement.
Task 3: minor (deferred): save/delete render twice (explicit render() + onItemsChanged).
Task 3: fix round 1/5 (3 addressed, 1 NEW Important — delete handler ignores mutate's
  return, so a failed delete still resetForm()s and discards in-progress edits; commits
  8ccfccb..ebc6c34). Regression introduced by MY Ruling-7 patch: making mutate swallow
  errors and return false removed the throw that used to short-circuit the handler.
Ruling 9: fix by gating only resetForm() on success (`if (ok && editingId === item.id)`)
  while still calling render() unconditionally — an early return would leave the delete
  button stuck showing "แน่ใจ?" because armTimer was already cleared. Cost if wrong: a
  failed delete re-renders a card that was never removed, which is the correct display.
Task 3: minor (deferred): re-review out-of-scope — a save sitting in writeQueue while
  another context deletes the same item still resurrects it (narrower window than the
  sequential case finding 2 closed). Unreachable today: nothing but the popup writes items,
  and Chrome allows one popup at a time. Revisit if the panel ever gains a write path.
Task 3: fix round 2/5 (1 addressed, 0 open; commits ebc6c34..b7008d3). Re-reviewer died
  mid-response to a server error and was resumed rather than re-dispatched; it emitted the
  report it had already reached.
Task 3: complete (commits 86776b4..b7008d3, review clean after 2 fix rounds; 4 minors deferred)

## Task 5 — content script panel
- Implemented: `9f81c20` "feat: add read-only shadow-dom panel on TCASFolio" (parent `0f59927`)
- Files: `content.js` (new), `content.css` (new), `manifest.json` (replaced)
- Report: `task-5-report.md` — DONE_WITH_CONCERNS, the concern being only that hands-on browser verification (brief Step 5) is impossible in this environment. Step 5 left unchecked in the brief, annotated.
- Orchestrator's own verification, independent of the report:
  - All three files byte-identical to the brief's fenced blocks (programmatic diff, not eye-proofing) — Thai strings intact.
  - `grep -n 'onItemsChanged' content.js` → single hit, line 170, top level of the outer IIFE. **This settles the ⚠️ deferred from the Task 2 review**: no-unsubscribe is safe because registration happens exactly once per JS context.
  - Page-write scan: the only `.value =` hits (lines 61, 66) are on the extension's own `<option>` elements inside the shadow root. Contact with page DOM is limited to `document.getElementById(HOST_ID)` (re-injection guard) and `document.documentElement.appendChild(host)` (mount). Read-only guarantee holds by static inspection.
  - No `innerHTML` / `outerHTML` anywhere in `content.js`.
- Review gate: dispatched.
- Ruling 10 (my plan's defect, same class as Ruling 4): Task 6 Step 2's grep was written with unquoted `--include=*.js`, which zsh expands against the cwd — the command dies with "no matches found" before grep runs. Quoted the patterns and added `--exclude-dir=.superpowers` (the SDD workspace holds review diffs full of matching lines). Patched in `task-6-brief.md`; plan doc to follow.
- Task 6 Step 2 executed early by the orchestrator, clean: the only hits repo-wide are `manifest.json:13` and `:21`, both `"matches": ["https://student.mytcas.com/*"]` — permission scopes, not network calls. No `fetch`/XHR/WebSocket/sendBeacon anywhere.

## Browser verification (orchestrator, real Chromium 151 + CDP)
Closed most of the "cannot verify without a browser" gap. Isolated profile in the
session scratchpad, driven over `--remote-debugging-port=9222` from a dependency-free
node script (node 26's global `WebSocket`). Nothing here touched the live
`student.mytcas.com` and nothing was installed into the user's own Chromium profile.

Extension loaded unpacked, id `nmonlkmabglpafkgfaiicnfiphofcjij`,
`install_warnings: None`, `disable_reasons: []` — Chrome accepts the Task 5 manifest.

Popup (real extension, real `chrome.storage.local`):
- All five type strings render intact; heading/button Thai copy correct; Mali font resolves.
- Saved a 405-char multi-paragraph mixed Thai/English entry → stored byte-identical, tags split to `["วิศวะ","คอม","robotics"]`, id assigned, form cleared, status `บันทึกแล้ว`.
- Copy: clipboard === stored `detail` (405 chars), label `คัดลอกแล้ว ✓` → reverts to `คัดลอกรายละเอียด` after ~2s.
- Export wrote `doodee-future-2026-08-20.json` (2 items, `app`/`version`/`exportedAt` wrapper), status `ส่งออก 2 รายการแล้ว`.
- `chrome.storage.local.clear()` → UI empties → import restored both items with ids, tags, `createdAt`, and detail lengths intact; status `นำเข้าแล้ว: เพิ่ม 2 · อัปเดต 0`; file input reset. **Guide checklist item 4 done for real.**
- Full browser restart → items still present. **Checklist item 1 done.**

Panel: verified against a throwaway harness copy of the extension in the scratchpad
(identical files; only `matches` repointed at a local `http://localhost:8765` mock page).
The repo copy was not modified.
- Injects exactly **once** — `hostCount` 1 across five consecutive reloads. **Checklist item 3 done.**
- Style isolation holds both ways: panel computes Mali / `rgb(233,234,238)` while the mock page is Georgia / `rgb(187,0,0)`.
- The mock form's field values were untouched after injection — read-only guarantee confirmed behaviourally, not just by inspection.
- Type filter, tag chips, `ทั้งหมด` reset, and the `ไม่มีรายการที่ตรงตัวกรอง` empty state all behave; header count tracks `shown/total`.
- Panel copy button: clipboard === item detail.
- Collapse: width 301 → 46, arrow `▾` → `▸`, and the collapsed state survived all five reloads.

**Finding (confirmed, not speculative) — the panel intercepts clicks.**
`document.elementFromPoint` over a page control at the right edge returns
`#doodee-future-panel`: expanded, it swallows input across a 301×442 strip at
`right: 0; top: 88px` with `z-index: 2147483647`. On the live application form any
control under that strip becomes unclickable, with no visual hint as to why.
Collapsing frees the click (verified). Mitigation to decide with the user —
recommend defaulting `panelCollapsed` to true on first run.

**Minor, for the record:** the shadow root is `open`, so page JS on mytcas.com could
read the panel's DOM — titles, orgs, types, tags. Item `detail` is *not* exposed: it
lives in the copy handler's closure and is never written into the shadow DOM.

## Task 5 review + fix round 1 — `e43c88b`
Reviewer returned 1 Critical, 5 Important, 10 Minor. It ran its own headless Chromium
against a retargeted scratchpad copy, so its measurements are independent of mine.
It independently reproduced C1, which I had already measured — two separate harnesses,
same conclusion.

Ruling 11 — **fixed, each re-measured in the browser after the change:**
- **C1** panel swallows clicks (Critical). Both harnesses measured `elementFromPoint`
  over a right-edge control returning the host. Fixed by defaulting to collapsed and
  calling `applyCollapsed()` synchronously before first paint. Re-measured on a profile
  with no `panelCollapsed` key: host 46×42, `elementFromPoint` → `rightBtn`,
  `railClickable: true`. Recorded as design Decision 9, with the rejected alternatives.
- **I2** `element.hidden` no-op. Verified myself first: `.tagbar` and `.panel` stayed
  `display: flex`; only `.body` hid, and only because it has no author `display` rule.
  Fixed with `[hidden] { display: none !important }` in the shadow sheet. Re-measured:
  zero-tag vault now renders `tagbarComputedDisplay: none`, height 0.
- **I1** `:host { all: initial }` does not stop page CSS. Verified myself: a page rule
  `div { color/line-height/margin/font-family }` with **no `!important`** recoloured the
  panel, tripled line-height, and displaced the host to `top: 100`. Fixed with
  `!important` on the layout props and by moving inherited typography to `.panel`.
  Re-measured against a *stronger* attack than either of us first used —
  `* { … !important }` — and the panel held `top: 88`, `margin: 0`, own colour, own font.
- **I3** `writeText("")` resolves, so a detail-less entry reported success while wiping
  the clipboard. Re-measured: clipboard preserved, label `ไม่มีรายละเอียดให้คัดลอก`,
  real copies unaffected. Same guard applied to `popup.js`, where the pattern originated.
- **I4** no error handling on the panel's storage paths. Added a `.note` element and
  guarded both the toggle and the init IIFE; init failure now force-expands and explains
  itself rather than leaving a blank box over the form. Note verified to render.
- Minors taken because they were cheap: `type="button"` on all three button kinds,
  per-button copy reset timer, `aria-expanded` / `aria-pressed`, `overscroll-behavior:
  contain` so panel scrolling does not chain into the application form.

Ruling 12 — **I5 (open shadow root) closed as WONTFIX, recorded as Decision 10.**
`detail` is never in the DOM, the exposed titles are being submitted to that same site
anyway, and `mode: "closed"` is defeated by patching `attachShadow` before
`document_idle` — it would buy the appearance of protection. Made a decision rather than
leaving it a default.

Ruling 13 — **deliberately deferred minors** (not defects worth the churn now):
`writeText` with no timeout (M2, only reproducible without focus); blank card for a
junk-normalised entry (M3); the `top: 88px` magic number (M4); `allTags` computed twice
per refresh (M5); `panelCollapsed` not syncing across two open tabs (M8); `activeType`
not reset when a type empties (M10).

`npm test` still 13/13 after all edits.

## Final whole-branch review + fix round 2 — `509a5f1`
Reviewer: 0 Critical, 7 Important, 11 Minor. All four non-negotiables confirmed PASS
(no network, read-only toward the page, no innerHTML, minimal permissions).

Ruling 14 — **fixed, each re-measured in Chromium 151:**
- **I1 — my own regression from `e43c88b`.** I put `.note` inside `.body`, which is
  `display: none` while collapsed, so the toggle's failure message was invisible in
  exactly the case it exists for. Moved into `.panel`; re-measured collapsed: 313×34,
  `display: block`. Added `clearNote()` so a stale note cannot outlive its cause.
- **I2** popup `render()` had no try/catch — a failed read drew `ยังไม่มีข้อมูล` at a
  student with a full vault. Now shows the error and says not to retype.
- **I3** export had no error handling on the backup path.
- **I4** duplicate ids inside one import file collapsed into one entry. Copy-pasting a
  block is how people clone by hand, so "add a copy" returned "lose the original".
  Duplicates get a fresh id and are counted in the status. Two tests added → 15/15.
- **I5** `getItems()` migrated from both contexts at once, so each could win a different
  id for the same legacy row. Panel now reads `{ migrate: false }`; popup migrates alone
  behind its write queue.
- **I6** panel clicks bubbled into the site's own document handlers. Shielded for
  bubble-phase listeners (measured: zero events reach them; page's own clicks unaffected).
  **Capture-phase listeners on `document` cannot be stopped** — capture runs root-down and
  reaches `document` before our host exists in the path. The reviewer's proposed one-liner
  would not have fixed that either. Comment states the limit rather than implying coverage.
- **I7** collapsing shrank the blocked area but never removed it. Collapsed stub now moves
  to `top: 50%`, away from the top-right corner where account menus and logout live.
  Re-measured: stub 46×42 at the vertical middle, top-right page button clickable again.
  The guide now says plainly that this reduces overlap rather than eliminating it.
- **M2** editing an item whose `type` is not in `Model.TYPES` blanked the type on save and
  dropped it out of every filter. A temporary option preserves it; verified round-trip and
  that the option is cleaned up afterwards.
- **M5/M11** `[hidden]` rule added to `popup.css` too; the stray uncommitted plan doc is
  committed.
- **M10** `use_dynamic_url: true` on the web-accessible resource, so the page cannot
  fingerprint a fixed extension id. Verified the shadow stylesheet still loads: dynamic
  UUID href, 21 rules parsed, panel styled.

Ruling 15 — **deferred, with reasons:** M3 (`normalize` drops unknown keys — changing it
risks a spurious migration write for a hypothetical future field), M6 (`!important` list
does not cover `transform`/`visibility`/`opacity`; a determined page can still hide the
panel, but a page that hostile can do worse than that), M7 (`onItemsChanged` now inside
the guarded init, but a dead panel after an extension update still owns the page until
reload), M8, plus the earlier Ruling 13 list.

End-to-end smoke test after all edits: foreign type survives edit+save, duplicate-id
import keeps both entries with distinct ids and an honest status line, empty-file import
refused with `ไฟล์นี้ไม่มีผลงานอยู่เลย` in the error style. `npm test` 15/15.

## Phase 3 final review (2026-08-22) — two parallel reviewers, range `4b3baeb..0bffc9f`

**Vault side** (`popup.js`/`storage.js`/`model.js`): 0 Critical, 6 Important.
Ruling 16 — fixed in `950296b`: I1 (text-only edit could wipe an entry's images after one
failed image read → images written only when touched), I2 (`pendingImages` assigned before
the stale-edit guard → A's images saved under B), I3 (image-write failure left the form in
"add new" mode → retry duplicated the entry), I5 (`get(null)` every render → `imgIndex`
key), I4 (export omits images — now documented). I6 (caps) deferred: per-file 2 MiB stays,
no total cap; `unlimitedStorage` is the real backstop.

**Page side** (`content.js`/`inject.js`): 3 Critical, 5 Important — all three Criticals
reproduced in the reviewer's own headless harnesses AND then on the live folio.
Ruling 17 — fixed in `695e285` + follow-ups:
- C1 re-find after React rebuild fell back to "first field with this label on the page" →
  overwrote an older entry's detail (same shape as `628a036`). Now bounded to the plan's
  anchor or the outer `.block` of the title just written, matched by kind.
- C2 scope scoring counted only *empty* titles → a container spanning target+essay (or
  target+another block's empty detail) won. Any container with >1 title of any state is
  rejected; the essay field (`free__body--rich`) is excluded from every plan.
- C3 `blockFor` prefix fallback could pick the wrong SOP block even with one candidate.
  Exact title only; ambiguity = "not found", because uploads are irreversible.
- I2 attach serialised; I3 confirm cannot double-fire and a plan whose anchor is gone is
  rejected; I4 `←` search scoped to a panel containing level/result fields; I1 attach
  target named before the first upload.
- `inject.js` line-by-line: no defects (malformed data → caught reply; double-load guarded;
  page pre-defining the global = denial only).

Ruling 18 — the one bug neither review saw but live testing did (`blur` commit): TCASFolio
commits contenteditable on blur and rebuilds the block; writing title then clicking detail
made the blur fire *during* the detail write (execCommand returned false, node detached).
Reproduced from main world via `seq-probe` — not realm-specific. Fixed by blurring after
each contenteditable write. Measured: 2/2 fields land; no collateral.

Deferred (Ruling 19): I5 "first slot.click may open the real file dialog within the 5 s
activation window" — unverified, and if it happens the dialog is simply cancelled; M-list
items (cached rejected `ensureInjected`, `postMessage("*")`, first image-input-wins) noted.

Ruling 20 — "พ่วงหน่วยงานไว้บรรทัดแรก" misfired on the live folio (2026-08-23). The rule
prepended `org + "\n\n"` whenever `org` was not among the fields *being written*; on
TCASFolio's edit panel the org field exists but was already filled, so it was not in the
pool → every re-fill of a detail got a header line glued on, and TCASFolio draws each `\n`
as an empty paragraph → 4–5 blank lines per block (11/10 pages). Fixed: the test is now
"does an org field exist in the chosen scope at all" (`presentKinds`, filled or not), the
separator is a single `\n`, verification accepts the body landing even if the site drops the
header, and contenteditable writes type paragraphs with Enter (`insertParagraph`) instead of
raw `\n` in one `insertText` (one block lost its paragraph breaks that way). Page was repaired
by hand; the engine change is **not yet exercised live** — the running extension cannot be
reloaded without restarting Chromium, which would discard the unsaved folio.

Open (image counts): after edit cycles the DOM showed block 1 with 6 frames (one old cert
from no current vault set) and block 2 with 3; deleting + re-uploading held only until the
next edit. The site's nodes carry no React fiber, so state is unreadable from the DOM; the
ground truth is save → reload. Do not "fix" image counts from DOM reads again.

Ruling 21 — "＋ ลงพอร์ต" (2026-08-23). The #1 usability trap, confirmed by the owner using it:
the panel could only fill a block that already existed and was selected, so the user had to know
to press the site's own "＋ เพิ่ม…" first and click the block. The card now carries a button that
does both: maps `item.type` → the site's add button (รางวัล/โครงงาน/กิจกรรม/การอบรม/ผลงาน),
clicks it, waits for a *new* empty title (compared against the pre-click block set, ≤4.8 s),
scrolls, selects the block, then runs the existing buildPlan → showPlan path. Confirm is still
manual — this writes into a live application. Cancel leaves an empty block; the note says so
rather than auto-deleting (deleting the wrong block is worse than a stray empty one).
Verified live on the Mahidol folio: 11 → 12 blocks, plan offered 5 fields, cancel + delete
returned it to 11. All five type→button mappings resolve on the real page. 16/16 tests.

Save-failure post-mortem (same day): TCASFolio PUTs the whole folio, images inlined, to
`tcas65.as.r.appspot.com`. A 29 MB 6000×4000 photo made the body 38 MB → Google Frontend
returned **413**, whose error page carries no CORS header, so the browser reported a CORS
failure and the app showed "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ". Lesson for the extension: resize
before attaching (not yet implemented) and never trust that error string. Also measured: the
site's "ลบรูป" deletes the *selected slot*, not the image you clicked — repeated delete+reattach
cycles silently accumulate images in state, which is what inflated the payload.

Ruling 22 — attach now resizes and picks the layout (2026-08-23), so a folio can be built
without touching the site's own controls at all. `shrinkForUpload()` runs before every
hand-off: it decodes the vault copy, and if the file exceeds 1.2 MB or 1800 px on the long
edge it redraws through `OffscreenCanvas` → JPEG q0.85, stepping quality down to 0.6 then
scale by 0.8 until it fits (≤6 rounds), falling back to the original on any failure. The vault
keeps the full-resolution file; only the upload is shrunk. `setLayoutForCount()` then sets the
block's layout select ("เต็มกว้าง 4:3" for one image, otherwise "N รูป", capped at 6) via the
existing `writeField` SELECT path, which only matches an option by exact text.

Measured on the two photos that actually caused trouble: `IMG_7101.JPG` 6000×4000 / 29,122 KB
→ 1800×1200 / 536 KB (−98%, 715 ms, one round) and `DAY4-70.jpeg` 3500×2334 / 1,659 KB →
1800×1200 / 272 KB (−84%, 133 ms). A 38 MB folio payload becomes roughly 8 MB, well under the
413 threshold. Integration on a live folio is **not yet exercised** — the TCASFolio session
needs a ThaID re-login after each browser restart, and reloading the unpacked extension
requires restarting Chromium. Test it on the next real block.

Ruling 23 — panel restyled to blend into TCASFolio (2026-08-24). The dark card floated on the
site's pale-blue page and read as a foreign object; the owner asked for something that looks
like part of the system. Tokens are measured from the live page, not guessed: body `#E9F4FF`,
ink `#191E23`, deep blue `#1A477F`, and the site's own webfonts `tt` (body) / `kvl` (headings)
— `@font-face` is document-scoped, so the shadow root can name them directly, with a Thai
fallback stack in case the site renames them. Layout changes that came out of watching the
panel get used: a search box (the vault is 56 entries and there was no way to find one),
category pills replacing a 30-plus tag row (tags moved behind a `แท็ก ▾` disclosure), meta
rendered as the site's own pill shapes, and the card reduced to the two buttons used every
time — `＋ ลงพอร์ต` and `แนบรูป (N)` — with the per-field buttons, `เติมทั้งฟอร์ม` and copy
folded into `⋯`. `filterItems` grew a `q` criterion (all words must match across title, org,
result, detail, tags); 17 tests. Fill and attach engines untouched.

Verified on the live site: 56 cards render, "camp" narrows to 8, `⋯` reveals the four
secondary buttons, panel width 360 and `elementFromPoint` at the page centre still returns the
page (the C1 overlay check), title font resolves to `kvl`.

Ruling 24 — PDF import shipped as a separate subsystem (2026-08-24). The owner asked for the
extension to read an unstructured PDF portfolio and turn it into vault entries, and asked
explicitly that it be **added, not woven into** what already works. So `content.js`,
`content.css`, `storage.js`, `model.js` and `inject.js` are untouched; the new pieces are
`pdfText.js`, `pdfImage.js`, `import.html/.css/.js`, vendored `pdf.js`, and exactly one button
in `popup.html`. The importer carries its own image-shrinking code rather than reusing the
copy in `content.js` — duplication accepted so the working system stays at zero risk.

Design and every measurement live in `docs/superpowers/specs/2026-08-24-pdf-import-design.md`.
Three findings worth repeating here:

- Canva embeds each Thai line twice, one copy with its tone marks stripped, and **draws them
  on top of each other**. Page 8 of the real book has 82 word pairs overlapping by >50%.
  Filtering by box overlap beats every string heuristic tried before it.
- `variantScore` needs the ำ / ํา terms. Mark counts alone tie between the two copies, and the
  crippled one then wins.
- pdf.js does not report how large an image is drawn; the transform matrix has to be walked
  (save/restore/transform) or the background filter silently never fires.

Known and accepted: images are over-collected (114 from a 10-page book) because Canva slices
one picture into several XObjects. Nothing is saved without an explicit click, so this is
clutter, not data loss. Next thing to try is grouping fingerprints by hamming distance.

Ruling 25 — export/import now carry the images (2026-08-25). The vault was lost twice in one
session because the test profile lived under `/tmp` and `/tmp` was cleared. Both times the
JSON backup restored the text and nothing else, so every certificate had to be re-attached by
hand from the source folders. A backup that cannot restore what was lost is not a backup.

`toExport(items, now, images)` takes an optional image map and drops anything whose entry is
not being exported; `parseImport` returns `{ items, images }` and only accepts
`data:image/...;base64,` payloads — a hand-edited backup must not be able to smuggle a
`javascript:` or scripted-SVG URL into an `img src`. Files written before this change still
import: no `images` key simply yields `{}`.

Two details that matter on restore. `mergeImport` hands a fresh id to entries whose ids
collide inside the file, so the images are re-keyed by matching title + createdAt, which do
not change. And an entry that already has images is left alone — restoring a backup must never
overwrite pictures the owner attached since.

Verified against the real 11.2 MB backup: 82 entries, 46 images, every image group resolving
to an entry that exists. 61 tests.

Ruling 26 — สำรอง/กู้คืน ต้องอยู่ในแท็บ ไม่ใช่ใน popup (2026-08-25). เจ้าของกู้ backup เข้าโปรไฟล์จริง
แล้วบอกว่าเสร็จแล้ว ตรวจ LevelDB ของโปรไฟล์: 24 KB มีแค่คีย์ `imgIndex` กับ `panelCollapsed`
ไม่มี `folioItems` สักตัว แปลว่า handler ไม่เคยทำงานเลย ไม่ใช่ทำงานแล้วล้ม

เหตุ: ปุ่ม `นำเข้า JSON` เรียก `importFile.click()` ซึ่งเปิด file dialog ของระบบ popup ของ
ส่วนขยายปิดตัวเองทันทีที่เสียโฟกัส หน้าถูกทำลายก่อน `change` จะยิง ไฟล์ที่เลือกจึงหายเงียบ ๆ
ไม่มี error ให้เห็น — เหตุผลเดียวกับที่หน้านำเข้า PDF ย้ายไปเป็นแท็บตั้งแต่ Ruling 24 แต่ตอนนั้น
แก้เฉพาะที่ PDF ปุ่ม JSON ยังค้างอยู่ในรูปแบบเดิม

`backup.html` จึงรวมสามอย่างไว้ที่เดียว: บอกว่าคลังมีอะไรอยู่จริงตอนนี้ (อ่านจาก storage +
`getBytesInUse` ไม่ใช่ค่าประมาณ) · ส่งออก · กู้คืนพร้อมแถบความคืบหน้า และรายงานผลด้วยการ
**อ่านกลับจากคลังจริง** ไม่ใช่รายงานจากตัวแปรในหน้า — บทเรียนทั้งหมดของครั้งนี้คือรายงานว่า
"สำเร็จ" โดยไม่ตรวจของจริง

ทดสอบจริงด้วย CDP ในโปรไฟล์เปล่า ไฟล์สำรอง 11.1 MB: 0 -> 82 ผลงาน 46 รูป (12 MB บนดิสก์)
รันซ้ำอีกสองรอบได้ เพิ่ม 0 · อัปเดต 82 · ข้ามรูป 46 ใบ จำนวนไม่บวม

Ruling 27 — ดึงจากเว็บ doodee-future.com (2026-08-25). เจ้าของกำลังทำ OCR บนเว็บตัวเอง
และอยากให้ผลออกมาเข้าคลังตรง ๆ ไม่ต้องดาวน์โหลดไฟล์มานำเข้า เลือกทางที่เว็บเปิด endpoint
ให้ส่วนขยายดึง (`GET /api/extension/portfolio`) รูปมาเป็น base64 ในก้อนเดียวกัน

สัญญาคือ **รูปแบบเดียวกับไฟล์สำรองเป๊ะ ๆ** ใช้ `Model.parseImport` ตัวเดิมที่มีเทสต์คุมอยู่แล้ว
ไม่เขียนตัวอ่านใหม่ ผลพลอยได้คือเว็บจะให้ดาวน์โหลดไฟล์แทนก็ยังนำเข้าได้ ทางเดิมไม่เสีย

สามอย่างที่ตั้งใจทำ

- **URL ฝังตายในโค้ด** ไม่ให้แก้จากหน้าเว็บ เพราะมีช่องโทเคน ถ้าปล่อยให้ตั้ง URL เองได้
  วันหนึ่งโทเคนจะถูกส่งไปโฮสต์อื่น `host_permissions` ก็มีโดเมนเดียว
- **รองรับทั้งคุกกี้และโทเคน** คำขอจาก `chrome-extension://` นับเป็น cross-site คุกกี้
  `SameSite=Lax` (ค่าเริ่มต้นของ NextAuth) จะไม่ถูกส่งมา — 401 จึงไม่ขึ้นเลขดิบ
  แต่บอกตรง ๆ ว่าให้ไปใช้โทเคน
- **นับรูปดิบก่อนกรอง** `parseImport` ตัดรูปที่ไม่ใช่ `data:image/...;base64` ทิ้งเงียบ ๆ
  (กัน `javascript:` กับ SVG ที่ฝังสคริปต์) ถ้าเว็บส่งลิงก์รูปมา ผู้ใช้จะเชื่อว่าได้ครบ
  จึงเทียบจำนวนก่อน/หลังกรอง แล้วขึ้นเตือนว่าตัดไปกี่ใบและเพราะอะไร

ทดสอบด้วย CDP ครบทุกทาง: ยิงของจริงไป doodee-future.com (ยังไม่มี endpoint) ได้ข้อความ
ที่ทำต่อได้จริง ไม่ใช่ "404" · 401 -> ชี้ไปที่โทเคน · เด้งหน้าล็อกอิน (HTML 200) -> จับได้
· รูปเป็นลิงก์ -> เตือน 2 ใบ · ของครบ 11.1 MB -> 82 ผลงาน 46 รูปเข้าคลังจริง

ยังไม่ทำ: `PUT` กลับขึ้นเว็บ ซิงก์สองทางต้องตอบก่อนว่าใครชนะเมื่อแก้ทั้งสองฝั่ง

Ruling 28 — อ่านโค้ดเว็บจริงแล้วสเปกที่เขียนไว้ผิดสองเรื่อง (2026-08-25). เจ้าของ clone
`Pranakorn-Group/doodee-future` มาให้ดู (Next.js + Prisma + NextAuth + tesseract)
สิ่งที่เจอทำให้ต้องแก้ทั้งสเปกและกลไก

**หนึ่ง: คำศัพท์ผิด** สเปกรอบแรกเขียน `"type": "award"` กับ `"level": "national"` แบบเดา
ของจริงคือ `type` ต้องเป็นภาษาไทยห้าค่าที่ตรงกับปุ่มของ TCASFolio เป๊ะ ๆ
(`ADD_BUTTON_BY_TYPE` ใน content.js) และ `level` สี่ค่าที่ `normalize` ตรวจ — ค่าที่ไม่ตรง
ถูกล้างเป็นว่างเงียบ ๆ ทั้ง `startDate`/`endDate` ที่เขียนไว้ก็ไม่มีอยู่จริง และ `hours` เป็น
string ไม่ใช่ number ถ้าไม่ได้อ่านโค้ดสองฝั่งเทียบกัน เว็บจะสร้าง endpoint ที่ตอบมาแล้ว
เติมฟอร์มไม่ได้สักช่อง

**สอง: คุกกี้ไปไม่ถึง** เว็บใช้ NextAuth แบบ JWT คุกกี้เป็น `SameSite=Lax` คำขอจาก
`chrome-extension://` นับเป็น cross-site คุกกี้จะไม่ถูกส่งเลย ยิงตรงได้ 401 ตลอด
ส่วน `/api/v1` ที่เว็บมีอยู่ใช้ API key ของแอดมิน (`api_keys.owner_email`) นักเรียนออกเองไม่ได้
ทางที่เหลือคือให้ content script ในแท็บ doodee-future.com ยิงแทน — same-origin คุกกี้ทำงานปกติ
ผู้ใช้แค่ล็อกอินค้างไว้ ไม่ต้องคัดลอกโทเคนอะไรเลย ไม่มีแท็บเปิดอยู่ก็เปิดให้เองแล้วปิดคืน

ตารางในเว็บที่ตรงกับคลังอยู่แล้ว: `user_achievements` (มี `data_source = 'ai_extracted'`
คือผลจาก OCR) และ `user_extracurricular` เขียน route ตัวอย่างที่แมปครบไว้ให้ที่
`docs/web-route-example.ts` วางลงรีโปเว็บที่ `app/api/extension/portfolio/route.ts` แล้ว
(ยังไม่ commit ให้ ไม่ใช่รีโปนี้)

ทดสอบกับเว็บจริงผ่าน CDP: ไม่มีแท็บเปิด -> เปิดให้เอง -> ฝัง content script -> ยิง
`/api/extension/portfolio` -> 404 (ยังไม่ deploy) -> ข้อความที่ทำต่อได้ -> ปิดแท็บคืน
แล้วชี้ path ไปที่ `/api/blog/posts` ที่เปิดสาธารณะเพื่อพิสูจน์ทาง 200: body มาถึงตัวอ่านจริง
ตอบ "ไม่พบรายการผลงานในไฟล์นี้" ถูกต้อง
