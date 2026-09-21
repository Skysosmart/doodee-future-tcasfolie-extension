# สถานะการเข้าร่วม — its own vault field

**Status:** design, awaiting review · 2026-09-15
**Branch:** `docs/thai-ocr-folio-spec`, as a follow-up to `c382433`. Lands **before** the Inter portfolio work
([`2026-09-15-inter-portfolio-design.md`](2026-09-15-inter-portfolio-design.md)), which adds `status` to the English copy.

## Problem

The folio importer reads `สถานะการเข้าร่วม :`, but nothing after it treats the value as a status.

1. **It's stored as a prize.** `pdfFolio.js` puts it in `result`, the same field as `ผลรางวัล / อันดับ`.
   The popup labels that box `ผลรางวัล / อันดับ`, so the status looks lost.
2. **Autofill can't find the site's box, and fills it with the wrong text.** None of the `result` words in
   `FIELD_HINTS` (`content.js:291`) occur in `สถานะการเข้าร่วม`. An unmatched contenteditable falls back to
   `detail`. On the edit panel that box sits before `รายละเอียด`, so the plan writes the **details
   text into the status box** and then skips the real `รายละเอียด` (one fill per kind). The boxes labelled
   `ผลการอบรม` and `ผลตอบรับ / รางวัล` hit the same fallback.

## Evidence — the reference TCASFolio export (labels only)

| หมวด | result-type label on each entry |
|---|---|
| 4.1 รางวัล / เกียรติบัตร | `ผลรางวัล / อันดับ` (5 of 6) |
| 4.3 กิจกรรม | `สถานะการเข้าร่วม` (3 of 3) — **free text**, three different values |
| 4.4 การอบรม | `ผลการอบรม` (5 of 5), all `Completed` |
| 4.5 ผลงานสร้างสรรค์ | `ผลตอบรับ / รางวัล` (2 of 2) |

No entry has two of these labels. The file has no 4.2 โครงงาน section, so that label is unknown.

## Decision

A new string field **`status`** holds `สถานะการเข้าร่วม` only.
`ผลรางวัล / อันดับ`, `ผลการอบรม` and `ผลตอบรับ / รางวัล` stay in `result`.
Moving `ผลการอบรม` to `status` later means moving one string between the two label lists below; nothing else changes.

## 1. Vault model (`model.js`)

- `status: ""` directly after `result`, in **both** `makeItem` and `normalize`. The key order must stay
  identical, or the stability test fails and every read writes back.
- Existing vaults read as `changed: true` once and get `status` written back. `EXPORT_VERSION` stays `1`,
  and backups without `status` still import.
- One label source for both readers. `content.js` runs with `model.js` loaded on `student.mytcas.com`:
  ```js
  STATUS_LABELS = ["สถานะการเข้าร่วม"]
  RESULT_LABELS = ["ผลรางวัล / อันดับ", "ผลการอบรม", "ผลตอบรับ / รางวัล"]
  ```
- `filterItems`: search also matches `status`.
- `folioToItems` (`⇩ นำเข้าอัตโนมัติ`): **no `status` mapping until the site's key is measured** (see §5).
  Guessing `entry.status` is unsafe. The site verifies entries, so a key named `status` may well hold
  the verification state, and that would land in the student's status box.
- **No migration.** Values already in `result` stay there. Moving them by category would misfile
  doodee-future's `role`, which `siteImport.js` maps to `result` for activities (`หัวหน้าทีม`).

## 2. PDF import

- `pdfFolio.js`: `STATUS_LABELS` → `status`, `RESULT_LABELS` → `result`, both read from `Model`.
  `PdfFolio.RESULT_LABELS` goes away (tests read `Model`). Matching stays mark-stripped, so a row
  like `สถานะการเขารวม :` with dropped marks still maps.
- `pdfText.js` (free-form books): no status guessing.
- `import.js` review card: new box **`สถานะการเข้าร่วม`** (placeholder `เช่น ได้เข้าร่วมและส่งผลงาน`) after
  the result box. The result box is relabelled `ผลรางวัล / ผลตอบรับ` (placeholder `เช่น เหรียญทอง, Completed`).
  Drafts default `status: ""`, and `save()` passes it through.

## 3. Popup (`popup.html`, `popup.js`)

- New box `สถานะการเข้าร่วม` (`id="status"`) after the result box, same placeholder as the review card.
- Result label `ผลรางวัล / ผลตอบรับ`, placeholder `เช่น เหรียญทอง, อันดับที่ 3, Completed`
  (`เข้าร่วม` moves to the status box).
- `readForm`, `resetForm`, `startEditing` handle `status`. List card meta shows `level · result · status`.

## 4. Autofill (`content.js`)

- `FIELD_HINTS` gains `["status", [...Model.STATUS_LABELS, "participation"]]`, placed **before** `detail`.
- The `result` hints gain `ผลการอบรม` and `ผลตอบรับ`, fixing the same fallback for training and creative blocks.
- `values.status = item.status || ""`, and `KIND_TH.status = "สถานะการเข้าร่วม"`, so the plan preview names the box.
- Card pills: `status` after `result`.
- `buildPlan`, the scoring, undo: unchanged. A new kind is just one more thing to fill.

## 5. Other consumers

- `analysis.js`: `line("สถานะการเข้าร่วม", item.status)` after `ผลงาน`.
- `siteImport.js`: `status: ""` on both converters (`role` stays in `result`).
- `docs/web-api-contract.md`: `status` in the item shape. In the mapping table it is empty for both
  site tables, since the site has no such column. The site's `/api/extension/portfolio` needs no change,
  because unknown or missing keys are normalized.
- `README.md` popup field list: add สถานะการเข้าร่วม.

## 6. Measuring the site's key (for `⇩ นำเข้าอัตโนมัติ`)

Read-only, never saving:

1. Launch an isolated Chromium test profile with the extension loaded
   (technique: `chrome-extension-cdp-testing` memory). The student logs in to `student.mytcas.com` there.
2. Open a folio that has a filled กิจกรรม entry. Capture the JSON the page **loads** for
   `/folios/tcasfolios/<id>` through CDP `Network.getResponseBody`. Record the key names only.
3. Add the mapping to `folioToItems`, with a test that uses invented values.

**Never press `บันทึกแฟ้ม`.** If the measurement can't be done (no login in a test profile),
auto-import ships without `status`, and the README says so.

## 7. Testing

**`node --test`** (invented values only)
- `makeItem` / `normalize` carry `status`; the stability test still passes; an old item gets `status: ""`
  and `changed: true`; `parseImport` reads an old backup.
- `filterItems` finds an item by its status text.
- `pdfFolio.toDrafts`: `สถานะการเข้าร่วม :` → `status` with `result` empty. `ผลรางวัล / อันดับ :`,
  `ผลการอบรม :` and `ผลตอบรับ / รางวัล :` → `result` with `status` empty. A mark-stripped status label still maps.
- `Analysis.itemToText` prints the status line only when there is one.
- `SiteImport.convert` emits `status: ""`, and `role` still lands in `result`.

**By hand**, in the test profile on a real folio (cancel every plan, delete empty blocks, never `บันทึกแฟ้ม`)
- กิจกรรม block: the plan shows status → `สถานะการเข้าร่วม`, details → `รายละเอียด`, nothing in the wrong box.
- การอบรม and ผลงานสร้างสรรค์ blocks: result → `ผลการอบรม` / `ผลตอบรับ / รางวัล`.
- รางวัล block: unchanged behaviour.

## Out of scope

Moving existing `result` values · a status label for 4.2 โครงงาน (no sample) · guessing status in free-form books.
