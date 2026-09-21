# Inter portfolio — English copy of each entry

**Status:** design, awaiting review · 2026-09-15
**Touches:** this extension + `doodee-future` (one new API route)
**Depends on:** [`2026-09-15-participation-status-field-design.md`](2026-09-15-participation-status-field-design.md).
The vault must have `status` before this adds an English copy of it.

## Goal

International programs (e.g. SIIT) want the portfolio in English. Today the vault holds one
Thai text per entry, so filling an inter folio means retyping everything in English by hand.

After this change each entry can carry an **English copy** next to its Thai text. The popup can
ask doodee-future.com for an English **draft** of one entry, the student edits it, and the
panel on TCASFolio gets a second button that fills the English copy instead of the Thai one.

## Decisions already made

| Question | Decision |
|---|---|
| What is "inter" | The same works, with an English copy. Not a separate set of entries. |
| How the panel picks a language | Separate buttons: `＋ Inter` beside `＋ ลงพอร์ต`. No global mode. |
| Where English comes from | Auto-translated **draft** from doodee-future.com, then edited by hand. |
| Where the translate button lives | Per entry, in the popup edit form. No bulk translate. |

## Out of scope

Bulk translation · auto-detecting whether the open folio is inter · English variants of the
per-field buttons (`ชื่อ` `หน่วยงาน` `รายละเอียด`) · two-way sync · translating the analysis text.

---

## 1. Vault model (`model.js`)

Each item gains one field, always present after `normalize`:

```js
en: { title: "", org: "", when: "", result: "", status: "", detail: "" }
```

- **Translated:** `title`, `org`, `when`, `result` (ผลรางวัล / ผลการอบรม / ผลตอบรับ) and `status`
  (สถานะการเข้าร่วม). Both `result` and `status` are free text on TCASFolio: the reference export has three
  different statuses and a range of prizes, so there are no fixed options to break.
- **Shared, not copied:** `type`, `level`, `hours`, `link`, `tags`, images. TCASFolio's category
  buttons and ระดับ options are the same Thai values on every folio, so an English `level` would
  never match an option.
- **Key order:** `en` goes immediately before `createdAt`, in both `makeItem` and `normalize`.
  They must stay identical, or the "normalized data is stable" test starts failing and every read
  writes back.
- **Migration:** existing vaults read as `changed: true` once and get `en` written back. `EXPORT_VERSION`
  stays `1`, and files without `en` still import.

New exports on `Model`:

| Name | Behaviour |
|---|---|
| `EN_FIELDS` | `["title", "org", "when", "result", "status", "detail"]` |
| `normalizeEn(value)` | Object with exactly `EN_FIELDS`, each `str()`-trimmed. Non-object → all `""`. Unknown keys dropped. |
| `hasEnglish(item)` | `true` when `item.en.title` is non-empty. |
| `inEnglish(item)` | Copy of `item` with the six `EN_FIELDS` replaced by `item.en`'s values. **No Thai fallback:** an empty English field stays empty, because Thai text inside an English folio is exactly the bug this feature prevents. |

Changes to existing functions:

- `filterItems(items, { inter: true })` keeps only `hasEnglish` items. Search (`q`) also
  matches the English fields.
- **`mergeImport` and `mergeFolioItems` keep the existing `en` when the incoming one is empty.**
  Incoming items from `ดึงจากเว็บ`, the site's profile export, a PDF import, `⇩ นำเข้าอัตโนมัติ`
  and older backup files never carry English. Without this rule, every re-sync by id (or by
  หมวด+หัวข้อ) would silently wipe English copies. A non-empty incoming `en` (a newer backup)
  still replaces.

`analysis.js`, `siteImport.js`, `pdfText.js`, `pdfFolio.js`: no change. They produce items
without `en`, and `normalize` fills it in.

## 2. Popup (`popup.html`, `popup.js`)

A collapsible block after `รายละเอียด`, before the images:

```
▸ ฉบับภาษาอังกฤษ (Inter)          [EN] when the entry has one
   [ แปลเป็นอังกฤษ ]   status line
   Title / Organization / Date / Result / Participation status / Details
   (enTitle enOrg enWhen enResult enStatus enDetail)
```

- Open by default when editing an item that `hasEnglish`. Closed otherwise.
- `readForm()` returns `en` from the six boxes; `resetForm()` clears them; `startEditing()` fills them.
- **`แปลเป็นอังกฤษ`:**
  - Disabled while `title` is empty or a request is running.
  - Sends the **current form values** (unsaved edits included), not the stored item.
  - If any English box has text: first click turns the label into `แทนที่ฉบับอังกฤษเดิม?` for
    3 s. The second click proceeds, the same two-step pattern as `ลบ`.
  - On success, fills all six boxes (a field left empty in Thai comes back empty) and shows
    `ได้ร่างแล้ว — ตรวจแก้ แล้วกด บันทึก/อัปเดต`. **Nothing is saved automatically.**
  - A result that arrives after the student switched to another entry, or cancelled, is dropped.
    It's guarded by a token captured at click time, the same way `startEditing` guards images.
  - If the popup closes mid-request, the draft is lost and nothing was written. Acceptable; the
    student presses the button again.
- Calls go through `SiteCall.request` (add `<script src="sitecall.js">` to `popup.html`).
  Errors use `SiteCall.explain(status)`. HTML bodies (`looksLikeHtml`) mean "not logged in",
  `400 too_long` → `ข้อความยาวเกินไปสำหรับการแปล (<field>)`.
- Vault list cards show an `EN` badge for `hasEnglish` items.

## 3. Panel on TCASFolio (`content.js`)

- **Card:** `＋ Inter` (`fill fill-inter`) directly after `＋ ลงพอร์ต`.
  - `hasEnglish(item)` → `createBlockThenPlan(Model.inEnglish(item), btn)`. The flow is unchanged:
    create block, plan preview, confirm, undo. `type` is untouched, so the right `＋ เพิ่ม…` button is found.
    The `status` kind added by the status-field change fills `สถานะการเข้าร่วม` with the English status.
  - Otherwise → `showNote("ยังไม่มีฉบับภาษาอังกฤษ — กดไอคอนส่วนขยาย › แก้ไข › แปลเป็นอังกฤษ ก่อน")`.
- **`⋯` row:** `เติมทั้งฟอร์ม · Inter` next to `เติมทั้งฟอร์ม`, running `buildPlan(Model.inEnglish(item))`.
- **Type bar:** an `Inter` chip, independent of the category chips, toggling `interOnly`.
  It's passed to `filterItems` as `inter`.
- **Card meta:** `EN` pill for `hasEnglish` items.
- `buildPlan`, `attachImages`, undo: **no change.** Images are shared across both languages.

## 4. Translate route (`doodee-future`)

`POST /api/extension/translate`, called from the site tab by `site.js` like every other extension call.

**Files**
- `lib/domain/portfolio-translate.ts`: pure `buildTranslatePrompt(fields)` and
  `parseTranslation(raw, fields)`, unit-tested.
- `app/api/extension/translate/route.ts`: thin handler. `dynamic = "force-dynamic"`, `maxDuration = 60`.

**Request / response**

```jsonc
// request
{ "title": "…", "org": "…", "when": "…", "result": "…", "status": "…", "detail": "…" }
// 200
{ "en": { "title": "…", "org": "…", "when": "…", "result": "…", "status": "…", "detail": "…" } }
```

| Case | Status |
|---|---|
| no session (`auth()`) | `401 { error: "unauthorized" }`: unlike `/api/portfolio/analyse`, this spends model tokens per call |
| a field isn't a string, or `title` is empty | `400 { error: "bad_request" }` |
| `detail` > 4000 chars, or another field > 300 | `400 { error: "too_long", field }`. **Rejected, not truncated:** a silently shortened translation looks complete. |
| model output isn't parseable JSON, or `parseTranslation` returns `null` (e.g. empty `title`) | `502 { error: "bad_model_output" }` |
| `AbortError` | `408` |
| anything else | `500` |

**Model call:** one `invokeAiChat({ prompt, systemPrompt, maxTokens: 2000, temperature: 0.2, timeoutMs: 45000 })`
(Typhoon, falling back to DeepSeek, as everywhere else). The system prompt instructs:

- Translate a Thai student portfolio entry into formal English suited to an international-program application.
- Keep proper nouns, acronyms and brand names. Use an organization's established English name
  when there is one (`สำนักงานการวิจัยแห่งชาติ (วช.)` → `National Research Council of Thailand (NRCT)`).
- Convert Thai dates to English with Gregorian years (BE − 543): `24 พ.ค. 2569` → `24 May 2026`,
  `ปัจจุบัน` → `Present`.
- `status` is a participation status (e.g. `ได้เข้าร่วมและส่งผลงาน` → `Participated and submitted work`).
  `result` is a prize, rank or outcome. Text already in English (e.g. `Completed`) is kept as is.
- Add nothing that isn't in the source. A field that is empty in the source stays `""`.
- Reply with strict JSON having exactly the keys `title org when result status detail`.

**`parseTranslation`:** extract the JSON object (reuse `extractJson` from
`lib/domain/portfolio-analysis.ts`). Keep only the six keys, turn non-strings into `""`, and
force `""` wherever the source field was empty. Return `null` when there is no object or
`title` came back empty.

## 5. Docs

- `README.md`: add `＋ Inter` and `แปลเป็นอังกฤษ` to the button table, and a row in the
  **ข้อมูลไปไหนบ้าง** table: `แปลเป็นอังกฤษ` | **ออก** | the six text fields of that one entry to
  `doodee-future.com/api/extension/translate` (passed on to Typhoon/DeepSeek) · no images.
- `docs/web-api-contract.md`: the `en` field in the item shape, plus a section for the translate endpoint.
- `docs/วิธีใช้.html`: one short section on filling an inter folio.

## 6. Rollout

The extension half works without the route: `แปลเป็นอังกฤษ` shows the existing 404 text
(`เว็บยังไม่มี endpoint นี้`), and hand-typed English still fills. Implementation does **not**
deploy the website; the route ships in the site's normal release.

## 7. Known limits

- `⇩ นำเข้าอัตโนมัติ` from an inter folio, or a PDF import of an English book, puts the English text
  into the **Thai** fields, as new entries (the หมวด+หัวข้อ match fails).
- The draft is machine translation. The review step is the safeguard, which is why nothing auto-saves.
- No rate limit on the route beyond requiring a login (the site's other extension routes have none either).

## 8. Testing

**Extension, `node --test` (`test/model.test.js`)**
- `makeItem` / `normalize` produce `en` with all six keys. The stability test still passes (key order).
- An old item without `en` gets it and reports `changed: true`. Junk in `en` (non-object,
  numbers, extra keys) is cleaned.
- `hasEnglish`; `inEnglish` swaps all six fields (including `status`) and does **not** fall back to Thai for empty ones.
- `filterItems` with `inter: true`; `q` matches English text.
- `mergeImport`: incoming empty `en` keeps the existing one; non-empty replaces it.
- `mergeFolioItems`: keeps the existing `en`.
- `toExport` → `parseImport` round-trips `en`; a file without `en` still imports.

**Website**
- Unit tests for `parseTranslation` (extra keys dropped, non-strings → `""`, empty source → `""`,
  garbage → `null`) and `buildTranslatePrompt` (includes every non-empty field, no empty labels).
- Type-check and lint the new files.

**By hand** (isolated test profile, invented entries only)
- Popup: type English by hand, save, reopen. Values persist and the `EN` badge shows.
  `แปลเป็นอังกฤษ` against the deployed route (or a local dev server) fills a draft, including the status.
  The replace-confirm and the dropped-result guard both behave as specified.
- Panel on a SIIT folio: `＋ Inter` on a กิจกรรม entry creates the right block, and the plan shows the
  English values with the status in `สถานะการเข้าร่วม`. Cancel, then delete the empty block.
  **Never press `บันทึกแฟ้ม`.**
- `ดึงจากเว็บ` after adding English: the English survives.
