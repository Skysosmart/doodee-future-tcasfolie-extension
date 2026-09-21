# สถานะการเข้าร่วม + English/Thai autofill separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every vault entry its own `สถานะการเข้าร่วม` field, then an English copy of its text, so one button fills a Thai folio and another fills an international-program (inter) folio.

**Architecture:** Two additive fields on the vault item — `status` (a string) and `en` (an object of six strings). Pure logic lands in `model.js`, which every other file already reads. `Model.inEnglish(item)` returns the item with its English text swapped in, so the existing fill engine (`buildPlan`) fills an inter folio without knowing English exists. The English draft comes from one new route on doodee-future.com, reached through the site tab like every other call.

**Tech Stack:** Chrome MV3, vanilla JS as classic (non-module) IIFE scripts sharing `globalThis`, no build step, no dependencies. `node --test` for pure modules. Website: Next.js 16 App Router, TypeScript, `bun test` for unit tests.

**Specs:** [`../specs/2026-09-15-participation-status-field-design.md`](../specs/2026-09-15-participation-status-field-design.md) (Tasks 1-4) and [`../specs/2026-09-15-inter-portfolio-design.md`](../specs/2026-09-15-inter-portfolio-design.md) (Tasks 5-9). Read both first.

## Global Constraints

- **Never commit without asking.** Every task ends by showing `git diff` and the test output, then waiting for the user to say commit. Never `git push`.
- **Never press `บันทึกแฟ้ม`** during a manual check on `student.mytcas.com`. It writes to a real university application. Cancel every plan and delete blocks you created.
- **No real portfolio data in fixtures.** Invented names only. The reference export carries the student's national ID, address, phone and email.
- **Pure modules stay pure.** `model.js`, `pdfFolio.js`, `pdfText.js`, `pdfGlyphs.js`, `siteImport.js`, `analysis.js` contain no `chrome.*` and no DOM. They are classic scripts assigning to `globalThis`, `require()`d directly by tests.
- **The extension makes no network requests of its own.** Calls to doodee-future.com go through `SiteCall.request` → `site.js` in the site's own tab, which rejects any path not starting with `/api/`.
- **`makeItem` and `normalize` must list keys in the same order.** The test `normalize ที่ผ่านแล้วต้องนิ่ง ไม่เขียนกลับซ้ำ` compares `JSON.stringify` of the whole array; a different key order makes every read write back.
- **`EXPORT_VERSION` stays `1`.** `status` and `en` are additive. Old vaults and old backup files must still load.
- **Item type and level strings are verbatim** `Model.TYPES` / `Model.LEVELS` values, or autofill cannot find the site's option.
- **UI copy is Thai**, matching the tone already in `popup.html` and `import.html`. English labels appear only inside the English block.
- **Tests are CommonJS:** `require("../x.js")`, then `const { test } = require("node:test")` and `require("node:assert/strict")`. Run everything with `npm test` (node v26.8.1).
- **Website tests** run with `bun test tests/<file>.test.ts` (bun 1.3.14). Lint with `npm run lint`. CI does not run tests.

---

### Task 1: `status` in the vault model

**Files:**
- Modify: `model.js` (label lists, `makeItem`, `normalize`, `filterItems`, exports)
- Test: `test/model.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `Model.STATUS_LABELS: string[]`, `Model.RESULT_LABELS: string[]`, and an item shape with `status: string` positioned directly after `result`.

- [ ] **Step 1: Write the failing tests**

Append to `test/model.test.js`:

```js
test("makeItem เก็บสถานะการเข้าร่วมแยกจากผลรางวัล", () => {
  const item = M.makeItem({
    type: "กิจกรรม",
    title: "ค่ายสมมติ",
    status: "ได้เข้าร่วมและส่งผลงาน",
  });
  assert.equal(item.status, "ได้เข้าร่วมและส่งผลงาน");
  assert.equal(item.result, "", "ผลรางวัลต้องไม่ถูกเติมแทน");
});

test("normalize เติม status ให้ของเก่า แล้วบอกว่าต้องเขียนกลับ", () => {
  const old = [
    {
      id: "a1",
      type: "กิจกรรม",
      title: "กิจกรรมสมมติ",
      org: "โรงเรียนสมมติ",
      when: "",
      level: "",
      result: "",
      hours: "",
      link: "",
      detail: "",
      tags: [],
      createdAt: 1,
    },
  ];
  const out = M.normalize(old);
  assert.equal(out.items[0].status, "");
  assert.equal(out.changed, true, "ของเก่าต้องถูกเขียนกลับหนึ่งครั้ง");
});

test("filterItems ค้นเจอจากสถานะการเข้าร่วม", () => {
  const items = M.normalize([
    M.makeItem({ type: "กิจกรรม", title: "ก", status: "ได้เข้าร่วมและส่งผลงาน" }, { id: "a", now: 1 }),
    M.makeItem({ type: "กิจกรรม", title: "ข", result: "เหรียญทอง" }, { id: "b", now: 1 }),
  ]).items;
  assert.deepEqual(M.filterItems(items, { q: "ส่งผลงาน" }).map((i) => i.id), ["a"]);
});

test("ป้ายกำกับของแฟ้มอยู่ที่ Model ที่เดียว", () => {
  assert.deepEqual(M.STATUS_LABELS, ["สถานะการเข้าร่วม"]);
  assert.deepEqual(M.RESULT_LABELS, ["ผลรางวัล / อันดับ", "ผลการอบรม", "ผลตอบรับ / รางวัล"]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | grep -E "^(ℹ (pass|fail)|not ok)"`
Expected: FAIL — `status` is `undefined` and `M.STATUS_LABELS` does not exist.

- [ ] **Step 3: Add the label lists**

In `model.js`, directly below the `LEVELS` array:

```js
  // ป้ายกำกับที่ TCASFolio ใช้ในแฟ้มและในฟอร์ม — เก็บไว้ที่เดียว
  // pdfFolio.js ใช้หาค่าจากไฟล์ · content.js ใช้เดาว่าช่องบนหน้าเว็บคือช่องอะไร
  // (content script โหลด model.js อยู่แล้ว ดู manifest.json)
  //
  // แต่ละหมวดมีป้ายของตัวเองป้ายเดียว: รางวัล→ผลรางวัล · กิจกรรม→สถานะการเข้าร่วม
  // อบรม→ผลการอบรม · ผลงานสร้างสรรค์→ผลตอบรับ (วัดจากแฟ้มจริง 2026-09-15)
  const STATUS_LABELS = ["สถานะการเข้าร่วม"];
  const RESULT_LABELS = ["ผลรางวัล / อันดับ", "ผลการอบรม", "ผลตอบรับ / รางวัล"];
```

- [ ] **Step 4: Add `status` to the item shape**

In `makeItem`, directly after the `result` line:

```js
      result: str(fields.result),
      status: str(fields.status),
```

In `normalize`, in the same position, so both key orders match:

```js
        result: str(entry.result),
        status: str(entry.status),
```

In `filterItems`, add `entry.status` to the haystack:

```js
      const hay = [entry.title, entry.org, entry.when, entry.result, entry.status, entry.link, entry.detail, entry.tags.join(" ")]
        .join(" ")
        .toLowerCase();
```

Add both lists to the `root.Model` export object, next to `LEVELS`:

```js
    STATUS_LABELS,
    RESULT_LABELS,
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS, with 4 more tests than before and `fail 0`.

- [ ] **Step 6: Show the diff and ask before committing**

```bash
git diff --stat && git diff model.js test/model.test.js
```

Suggested message (commit only once the user says so):

```
vault: keep สถานะการเข้าร่วม in its own field
```

---

### Task 2: `pdfFolio.js` reads the status into `status`

**Files:**
- Modify: `pdfFolio.js` (label sources, draft shape, `toDrafts`, exports)
- Test: `test/pdfFolio.test.js`

**Interfaces:**
- Consumes: `Model.STATUS_LABELS`, `Model.RESULT_LABELS` from Task 1.
- Produces: drafts shaped `{ page, type, title, org, when, hours, level, result, status, link, detail }`. `PdfFolio.RESULT_LABELS` is removed.

- [ ] **Step 1: Write the failing tests**

Append to `test/pdfFolio.test.js`:

```js
test("สถานะการเข้าร่วมลงช่อง status ไม่ใช่ช่องผลรางวัล", () => {
  const out = F.toDrafts([
    {
      page: 1,
      rows: [
        "หมวด 4.3 · กิจกรรม",
        "1 ค่ายอาสาสมมติ",
        "ระดับโรงเรียน/สถาบัน ไม่มีค่าใช้จ่าย · โรงเรียนสมมติ",
        "สถานะการเข้าร่วม : ได้เข้าร่วมและส่งผลงาน",
        "ช่วยสอนหนังสือเด็กเล็กและจัดกิจกรรมนันทนาการตลอดสามวัน",
      ],
    },
  ]);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].status, "ได้เข้าร่วมและส่งผลงาน");
  assert.equal(out.drafts[0].result, "");
  assert.equal(out.drafts[0].detail, "ช่วยสอนหนังสือเด็กเล็กและจัดกิจกรรมนันทนาการตลอดสามวัน");
});

test("ป้ายผลรางวัล ผลการอบรม ผลตอบรับ ยังลงช่อง result ตามเดิม", () => {
  const rows = (label, value) => [
    "หมวด 4.1 · รางวัล / เกียรติบัตร",
    "1 รายการสมมติ",
    "ระดับชาติ ไม่มีค่าใช้จ่าย · สมาคมสมมติ",
    `${label} : ${value}`,
  ];
  for (const [label, value] of [
    ["ผลรางวัล / อันดับ", "เหรียญทอง"],
    ["ผลการอบรม", "Completed"],
    ["ผลตอบรับ / รางวัล", "ผู้ใช้มากกว่า 100 คน"],
  ]) {
    const out = F.toDrafts([{ page: 1, rows: rows(label, value) }]);
    assert.equal(out.drafts[0].result, value, label);
    assert.equal(out.drafts[0].status, "", `${label} ต้องไม่ไปลงช่องสถานะ`);
  }
});

test("ป้ายสถานะที่วรรณยุกต์หายยังจับได้", () => {
  // ไฟล์จาก Chrome/Skia ทำวรรณยุกต์หล่น — เทียบแบบถอดเครื่องหมายจึงต้องยังตรง
  const out = F.toDrafts([
    {
      page: 1,
      rows: [
        "หมวด 4.3 · กิจกรรม",
        "1 กิจกรรมสมมติ",
        "ระดับชาติ ไม่มีค่าใช้จ่าย · โรงเรียนสมมติ",
        "สถานะการเขารวม : ไดเขารวมและสงผลงาน",
      ],
    },
  ]);
  assert.equal(out.drafts[0].status, "ไดเขารวมและสงผลงาน");
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/pdfFolio.test.js 2>&1 | grep -E "^(ℹ (pass|fail)|not ok)"`
Expected: FAIL — `status` is `undefined`, and the status row currently lands in `result`.

- [ ] **Step 3: Read the labels from `Model`**

In `pdfFolio.js`, replace the local `RESULT_LABELS` array (lines 19-24) with:

```js
  // ป้ายกำกับอยู่ที่ Model ที่เดียว — content.js ใช้ชุดเดียวกันหาช่องบนหน้าเว็บ
  const RESULT_LABELS = root.Model.RESULT_LABELS;
  const STATUS_LABELS = root.Model.STATUS_LABELS;
```

- [ ] **Step 4: Fill `status` while walking the rows**

In `toDrafts`, add `status: ""` to the new-item object, directly after `result: ""`:

```js
            result: "",
            status: "",
```

Then, directly **before** the existing `const result = afterLabel(row, RESULT_LABELS, true);` block, add:

```js
        const status = afterLabel(row, STATUS_LABELS, true);
        if (status !== null) {
          current.status = status;
          continue;
        }
```

Finally remove `RESULT_LABELS,` from the `root.PdfFolio` export object. Nothing reads it; the labels now live on `Model`.

- [ ] **Step 5: Run the whole suite and watch it pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`. If `matchLevel` tests break, check that `test/pdfFolio.test.js` still `require`s `../model.js` before `../pdfFolio.js`.

- [ ] **Step 6: Show the diff and ask before committing**

```bash
git diff pdfFolio.js test/pdfFolio.test.js
```

Suggested message:

```
pdf import: read สถานะการเข้าร่วม into its own field
```

---

### Task 3: status through the review page, popup, analysis and site import

**Files:**
- Modify: `import.js` (draft defaults, `draftCard`, `save`)
- Modify: `popup.html` (result label, new status box), `popup.js` (`readForm`, `resetForm`, `startEditing`, `itemCard`)
- Modify: `analysis.js` (`itemToText`), `siteImport.js` (both converters)
- Test: `test/analysis.test.js`, `test/siteImport.test.js`

**Interfaces:**
- Consumes: the `status` field from Task 1, drafts carrying `status` from Task 2.
- Produces: a vault entry whose status survives PDF import, hand editing, the analysis text, and the site's profile export.

- [ ] **Step 1: Write the failing tests**

Append to `test/analysis.test.js`:

```js
test("ข้อความที่ส่งไปวิเคราะห์มีสถานะการเข้าร่วม", () => {
  const text = Analysis.itemToText(item({ result: "", status: "ได้เข้าร่วมและส่งผลงาน" }));
  assert.match(text, /สถานะการเข้าร่วม: ได้เข้าร่วมและส่งผลงาน/);
});

test("ไม่มีสถานะก็ไม่ต้องมีบรรทัดเปล่า", () => {
  const text = Analysis.itemToText(item({ status: "" }));
  assert.doesNotMatch(text, /สถานะการเข้าร่วม/);
});
```

Append to `test/siteImport.test.js`:

```js
test("ไฟล์ส่งออกของเว็บไม่มีสถานะ — ช่อง status ต้องว่าง ไม่ใช่ undefined", () => {
  const out = SiteImport.convert(exportFile());
  for (const entry of out.items) assert.strictEqual(entry.status, "");
  // role ยังอยู่ช่องผลงานเหมือนเดิม ไม่ย้ายไป status
  assert.strictEqual(out.items[2].result, "หัวหน้าทีม");
});
```

Check the helper names first: `test/analysis.test.js` builds entries with a local `item()` helper, and `test/siteImport.test.js` uses `exportFile()`. Read both files before writing, and match the existing helpers rather than inventing new ones. `out.items[2]` is the extracurricular entry whose `role` is `หัวหน้าทีม` (see the existing test `ชั่วโมงเป็น string และ role ไปอยู่ช่องผลงาน`).

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | grep -E "^(ℹ (pass|fail)|not ok)"`
Expected: FAIL — no status line, and `status` is `undefined` on converted items.

- [ ] **Step 3: Carry status through analysis and site import**

`analysis.js`, in `itemToText`'s `meta` array, directly after the `ผลงาน` line:

```js
      line("ผลงาน", item.result),
      line("สถานะการเข้าร่วม", item.status),
```

`siteImport.js`, in `fromAchievement` and in `fromActivity`, directly after each `result:` line:

```js
      status: "",
```

- [ ] **Step 4: Add the status box to the PDF review page**

`import.js`, in the `drafts = result.drafts.map(...)` defaults, add `status: ""` next to `result: ""`:

```js
    result: "",
    status: "",
```

In `draftCard`, directly after the `resultField` block, add:

```js
  const status = document.createElement("input");
  status.type = "text";
  status.value = draft.status || "";
  status.placeholder = "เช่น ได้เข้าร่วมและส่งผลงาน";
  status.addEventListener("input", () => {
    draft.status = status.value;
  });
```

In the same function's `field(...)` list, replace the single result row with:

```js
    field("ผลรางวัล / ผลตอบรับ", resultField, true),
    field("สถานะการเข้าร่วม", status, true),
```

In `save()`, add `status` next to `result` in the object passed to `Model.makeItem`:

```js
        result: d.result,
        status: d.status,
```

- [ ] **Step 5: Add the status box to the popup**

`popup.html`: change the result label and placeholder, and add the status box right after it:

```html
    <label for="result">ผลรางวัล / ผลตอบรับ</label>
    <input id="result" type="text" placeholder="เช่น เหรียญทอง, อันดับที่ 3, Completed" />

    <label for="status">สถานะการเข้าร่วม</label>
    <input id="status" type="text" placeholder="เช่น ได้เข้าร่วมและส่งผลงาน" />
```

`popup.js`:

```js
// readForm — หลังบรรทัด result
    status: el("status").value,
```

```js
// resetForm — เพิ่ม "status" ลงในลิสต์ที่ล้างค่า
  for (const id of ["title", "org", "when", "result", "status", "hours", "link", "tags", "detail"]) el(id).value = "";
```

```js
// startEditing — หลังบรรทัด result
  el("status").value = item.status || "";
```

```js
// itemCard — ให้สถานะโผล่บนการ์ดด้วย
  const extras = [item.level, item.result, item.status].filter(Boolean).join(" · ");
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`.

- [ ] **Step 7: Check the two pages by hand**

Load the unpacked extension at `chrome://extensions`. In the popup, type a status, save, reopen the entry: the value is still there and shows on the card. Open `import.html`, import any PDF you own, and confirm the review card shows `สถานะการเข้าร่วม` as its own box.

- [ ] **Step 8: Show the diff and ask before committing**

```bash
git diff import.js popup.html popup.js analysis.js siteImport.js test/
```

Suggested message:

```
status: show สถานะการเข้าร่วม in the popup, the PDF review and the analysis text
```

---

### Task 4: autofill fills `สถานะการเข้าร่วม` on TCASFolio

**Files:**
- Modify: `content.js` (`FIELD_HINTS`, `buildPlan` values, `KIND_TH`, `card` pills)

**Interfaces:**
- Consumes: `Model.STATUS_LABELS` (Task 1), `item.status` (Task 1).
- Produces: a `status` fill kind, so `buildPlan` writes the status into the site's status box and stops writing the details text there.

**Why this matters:** `guessKind` scans `FIELD_HINTS` in order and falls back to `detail` for any unmatched contenteditable box. None of the current result words appear in `สถานะการเข้าร่วม`, `ผลการอบรม` or `ผลตอบรับ / รางวัล`, and on the edit panel that box sits before `รายละเอียด`. Today the plan therefore writes the whole details text into the status box and then skips the real `รายละเอียด`, because each kind is filled once.

- [ ] **Step 1: Add the status kind and the missing result words**

In `content.js`, in `FIELD_HINTS`, insert the status entry **before** the `detail` entry (order decides which kind wins) and extend the result words:

```js
    ["status", [...Model.STATUS_LABELS, "participation"]],
```

```js
    ["result", ["ผลรางวัล", "อันดับ", "ผลการแข่งขัน", "รางวัลที่ได้", "ผลการอบรม", "ผลตอบรับ",
                "result", "award", "rank", "placement"]],
```

Do **not** add a bare `"สถานะ"`. The site also shows verification state, and a hint that loose would aim the fill at the wrong box.

- [ ] **Step 2: Give the plan a value and a Thai name for it**

In `buildPlan`'s `values` object, after `result`:

```js
      result: item.result || "",
      status: item.status || "",
```

In `KIND_TH`:

```js
    level: "ระดับ", result: "ผลรางวัล", status: "สถานะการเข้าร่วม", hours: "ชั่วโมง", link: "ลิงก์",
```

In `card`, add a pill after the result pill:

```js
      [item.result, ""],
      [item.status, ""],
```

- [ ] **Step 3: Confirm the suite still passes**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`. `content.js` has no unit tests — it needs the DOM — so this only proves nothing else broke.

- [ ] **Step 4: Verify on the real site by hand**

There is no automated cover for this, so it must be seen once. In a browser profile signed in to `student.mytcas.com`, open a folio, expand the panel, and use an invented vault entry that has both a `result` and a `status`.

1. On a **กิจกรรม** entry press `＋ ลงพอร์ต`. The plan must list `สถานะการเข้าร่วม` with the status text, and `รายละเอียด` with the details text — not the details text in the status box.
2. Press `ยกเลิก`, then delete the block the button created, using the site's own trash button.
3. Repeat on a **การอบรม** and a **ผลงานสร้างสรรค์** entry: the result text must land in `ผลการอบรม` / `ผลตอบรับ / รางวัล`.
4. Repeat on a **รางวัล** entry: behaviour must be unchanged.

**Never press `บันทึกแฟ้ม`.**

- [ ] **Step 5: Show the diff and ask before committing**

```bash
git diff content.js
```

Suggested message:

```
autofill: fill สถานะการเข้าร่วม instead of dropping details text into it
```

---

### Task 5: the English copy in the vault model

**Files:**
- Modify: `model.js` (`EN_FIELDS`, `normalizeEn`, `hasEnglish`, `inEnglish`, `isEmptyEn`, `makeItem`, `normalize`, `filterItems`, `mergeImport`, `mergeFolioItems`, exports)
- Test: `test/model.test.js`

**Interfaces:**
- Consumes: the item shape from Task 1.
- Produces:
  `Model.EN_FIELDS: string[]` = `["title", "org", "when", "result", "status", "detail"]`,
  `Model.normalizeEn(value: unknown): {title,org,when,result,status,detail}` (all strings),
  `Model.hasEnglish(item): boolean`,
  `Model.inEnglish(item): Item` (the six fields replaced, no Thai fallback),
  `filterItems(items, { inter: true })`,
  and an item shape with `en` positioned directly before `createdAt`.

- [ ] **Step 1: Write the failing tests**

Append to `test/model.test.js`:

```js
test("normalizeEn คืนหกช่องเสมอ และทิ้งคีย์แปลกปลอม", () => {
  const en = M.normalizeEn({ title: " Science Camp ", nope: "x", detail: 5 });
  assert.deepEqual(Object.keys(en), ["title", "org", "when", "result", "status", "detail"]);
  assert.equal(en.title, "Science Camp");
  assert.equal(en.detail, "", "ค่าที่ไม่ใช่สตริงต้องกลายเป็นว่าง");
  assert.deepEqual(M.normalizeEn(null), {
    title: "", org: "", when: "", result: "", status: "", detail: "",
  });
});

test("normalize เติม en ให้ของเก่า แล้วยังนิ่งเมื่อผ่านรอบสอง", () => {
  const old = [{ id: "a1", type: "กิจกรรม", title: "ของเก่า", detail: "" }];
  const once = M.normalize(old);
  assert.deepEqual(Object.keys(once.items[0].en), M.EN_FIELDS);
  assert.equal(once.changed, true);
  assert.equal(M.normalize(once.items).changed, false, "ลำดับ key ของ makeItem/normalize ต้องตรงกัน");
});

test("hasEnglish ดูที่หัวข้ออังกฤษ", () => {
  const blank = M.makeItem({ type: "กิจกรรม", title: "ก" });
  assert.equal(M.hasEnglish(blank), false);
  const done = M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "A" } });
  assert.equal(M.hasEnglish(done), true);
});

test("inEnglish สลับหกช่อง และไม่ถอยไปใช้ภาษาไทย", () => {
  const item = M.makeItem({
    type: "กิจกรรม",
    title: "ค่ายสมมติ",
    org: "โรงเรียนสมมติ",
    when: "24 พ.ค. 2569",
    result: "",
    status: "ได้เข้าร่วมและส่งผลงาน",
    detail: "รายละเอียดภาษาไทย",
    level: "ระดับชาติ",
    hours: "48",
    en: {
      title: "Imaginary Camp",
      org: "Imaginary School",
      when: "24 May 2026",
      status: "Participated and submitted work",
      detail: "",
    },
  });
  const out = M.inEnglish(item);
  assert.equal(out.title, "Imaginary Camp");
  assert.equal(out.when, "24 May 2026");
  assert.equal(out.status, "Participated and submitted work");
  assert.equal(out.detail, "", "ช่องที่ยังไม่ได้แปลต้องว่าง ห้ามคืนข้อความไทย");
  assert.equal(out.level, "ระดับชาติ", "ระดับใช้ค่าไทยของเว็บเหมือนเดิม");
  assert.equal(out.hours, "48");
});

test("filterItems กรองเฉพาะชิ้นที่มีฉบับอังกฤษ และค้นจากข้อความอังกฤษได้", () => {
  const items = M.normalize([
    M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "Robotics Club" } }, { id: "a", now: 1 }),
    M.makeItem({ type: "กิจกรรม", title: "ข" }, { id: "b", now: 1 }),
  ]).items;
  assert.deepEqual(M.filterItems(items, { inter: true }).map((i) => i.id), ["a"]);
  assert.deepEqual(M.filterItems(items, { q: "robotics" }).map((i) => i.id), ["a"]);
});

test("นำเข้าไฟล์ที่ไม่มีฉบับอังกฤษ ต้องไม่ลบฉบับอังกฤษที่มีอยู่", () => {
  const mine = M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "Mine" } }, { id: "x", now: 1 });
  const incoming = M.makeItem({ type: "กิจกรรม", title: "ก แก้แล้ว" }, { id: "x", now: 1 });
  const out = M.mergeImport([mine], [incoming]);
  assert.equal(out.items[0].title, "ก แก้แล้ว");
  assert.equal(out.items[0].en.title, "Mine", "ซิงก์จากเว็บทับฉบับอังกฤษไม่ได้");

  const newer = M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "Newer" } }, { id: "x", now: 1 });
  assert.equal(M.mergeImport([mine], [newer]).items[0].en.title, "Newer", "ไฟล์ที่มีอังกฤษมาต้องทับได้");
});

test("นำเข้าอัตโนมัติจากแฟ้มต้องไม่ลบฉบับอังกฤษ", () => {
  const mine = M.makeItem({ type: "รางวัล / เกียรติบัตร", title: "เหรียญทอง", en: { title: "Gold medal" } });
  const out = M.mergeFolioItems([mine], M.folioToItems({ awards: [{ title: "เหรียญทอง", description: "แก้แล้ว" }] }));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].detail, "แก้แล้ว");
  assert.equal(out.items[0].en.title, "Gold medal");
});

test("ส่งออกแล้วนำเข้ากลับ ฉบับอังกฤษต้องครบ", () => {
  const items = [M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "A", detail: "B" } }, { id: "x", now: 1 })];
  const { items: back } = M.parseImport(JSON.stringify(M.toExport(items, 1)));
  assert.equal(back[0].en.title, "A");
  assert.equal(back[0].en.detail, "B");
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | grep -E "^(ℹ (pass|fail)|not ok)"`
Expected: FAIL — `M.normalizeEn is not a function`.

- [ ] **Step 3: Add the English helpers**

In `model.js`, below `normalizeTags`/`formatTags`:

```js
  // ฉบับภาษาอังกฤษของผลงานชิ้นเดียวกัน — ใช้ตอนลงแฟ้มหลักสูตรอินเตอร์
  // ระดับ/หมวด/ชั่วโมง/ลิงก์/แท็ก/รูป ใช้ร่วมกัน ไม่ต้องแปล
  // (ตัวเลือก "ระดับ" ของ TCASFolio เป็นภาษาไทยทุกแฟ้ม แปลแล้วจะหาตัวเลือกไม่เจอ)
  const EN_FIELDS = ["title", "org", "when", "result", "status", "detail"];

  function normalizeEn(value) {
    const src = value && typeof value === "object" ? value : {};
    const out = {};
    for (const key of EN_FIELDS) out[key] = str(src[key]);
    return out;
  }

  function isEmptyEn(en) {
    return EN_FIELDS.every((key) => !str(en && en[key]));
  }

  function hasEnglish(item) {
    return !!(item && item.en && str(item.en.title));
  }

  // ห้ามถอยไปใช้ภาษาไทยเมื่อช่องอังกฤษว่าง — ข้อความไทยที่หลุดลงแฟ้มอินเตอร์
  // คือสิ่งที่ฟีเจอร์นี้มีไว้กัน ปล่อยว่างแล้วคนกรอกเห็นเองดีกว่า
  function inEnglish(item) {
    const en = normalizeEn(item && item.en);
    const out = { ...item };
    for (const key of EN_FIELDS) out[key] = en[key];
    return out;
  }
```

- [ ] **Step 4: Put `en` on the item and use it in the readers**

In `makeItem`, directly before `createdAt`:

```js
      tags: normalizeTags(fields.tags),
      en: normalizeEn(fields.en),
```

In `normalize`, in the same position:

```js
        tags: normalizeTags(entry.tags),
        en: normalizeEn(entry.en),
```

In `filterItems`, accept the new criterion and search the English text. Replace the opening of the returned filter with:

```js
    const interOnly = !!(criteria && criteria.inter);
    return items.filter((entry) => {
      if (type && entry.type !== type) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (interOnly && !hasEnglish(entry)) return false;
      if (!words.length) return true;
      const en = normalizeEn(entry.en);
      const hay = [entry.title, entry.org, entry.when, entry.result, entry.status, entry.link, entry.detail,
                   entry.tags.join(" "), ...EN_FIELDS.map((key) => en[key])]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
```

- [ ] **Step 5: Stop empty English from erasing a saved copy**

In `mergeImport`, inside the loop, after the duplicate-id handling and before the count, keep the current English when the incoming entry has none:

```js
      const current = items.find((entry) => entry.id === item.id);
      // ของที่ดึงจากเว็บ/แฟ้ม/PDF ไม่เคยมีฉบับอังกฤษมาด้วย ถ้าปล่อยให้ทับ
      // ฉบับอังกฤษจะหายทุกครั้งที่ซิงก์ — ว่างแปลว่า "ไม่รู้" ไม่ใช่ "ลบ"
      const next = current && isEmptyEn(item.en) ? { ...item, en: current.en } : item;

      if (current) updated += 1;
      else added += 1;
      items = upsert(items, next);
```

In `mergeFolioItems`, extend the matched branch:

```js
      const item = match
        ? {
            ...entry.item,
            id: match.id,
            createdAt: match.createdAt,
            tags: match.tags,
            en: isEmptyEn(entry.item.en) ? match.en : entry.item.en,
          }
        : entry.item;
```

Add the new names to the `root.Model` export object:

```js
    EN_FIELDS,
    normalizeEn,
    isEmptyEn,
    hasEnglish,
    inEnglish,
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`.

- [ ] **Step 7: Show the diff and ask before committing**

```bash
git diff model.js test/model.test.js
```

Suggested message:

```
vault: carry an English copy of each entry
```

---

### Task 6: the English block and the translate button in the popup

**Files:**
- Modify: `popup.html` (English block, `sitecall.js` script tag), `popup.css` (block styling, `EN` badge), `popup.js` (read/write, translate call)

**Interfaces:**
- Consumes: `Model.EN_FIELDS`, `Model.normalizeEn`, `Model.hasEnglish` (Task 5); `SiteCall.request`, `SiteCall.explain`, `SiteCall.looksLikeHtml` (existing `sitecall.js`).
- Produces: a saved `en` object on the entry; the route contract used by Task 8 — `POST /api/extension/translate` with `{title, org, when, result, status, detail}` answering `{ en: {...} }`.

- [ ] **Step 1: Add the block to `popup.html`**

Directly after the `detail` textarea and before the image label:

```html
    <details id="enBox" class="enbox">
      <summary>ฉบับภาษาอังกฤษ (Inter)</summary>
      <button id="translateBtn" type="button" class="ghost wide-inline">แปลเป็นอังกฤษ</button>
      <p id="enMsg" class="hint" role="status"></p>

      <label for="enTitle">Title</label>
      <input id="enTitle" type="text" />

      <label for="enOrg">Organization</label>
      <input id="enOrg" type="text" />

      <label for="enWhen">Date / period</label>
      <input id="enWhen" type="text" />

      <label for="enResult">Result</label>
      <input id="enResult" type="text" />

      <label for="enStatus">Participation status</label>
      <input id="enStatus" type="text" />

      <label for="enDetail">Details</label>
      <textarea id="enDetail"></textarea>
    </details>
```

At the bottom, add `sitecall.js` before `popup.js` (the same order `analyse.html` uses):

```html
    <script src="model.js"></script>
    <script src="storage.js"></script>
    <script src="sitecall.js"></script>
    <script src="popup.js"></script>
```

- [ ] **Step 2: Style it in `popup.css`**

Append:

```css
.enbox {
  margin-top: 12px;
  padding: 8px 10px 2px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(91, 140, 255, 0.05);
}

.enbox summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--dim);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.enbox .wide-inline { width: 100%; margin-top: 8px; }

.en-badge {
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 0 6px;
  margin-left: 6px;
}
```

- [ ] **Step 3: Read and write the six boxes in `popup.js`**

Near the top, after `editingId`:

```js
// ช่องฉบับอังกฤษ — คีย์ตรงกับ Model.EN_FIELDS
const EN_INPUTS = {
  title: "enTitle",
  org: "enOrg",
  when: "enWhen",
  result: "enResult",
  status: "enStatus",
  detail: "enDetail",
};

function readEn() {
  const out = {};
  for (const [key, id] of Object.entries(EN_INPUTS)) out[key] = el(id).value;
  return out;
}

function writeEn(en) {
  const clean = Model.normalizeEn(en);
  for (const [key, id] of Object.entries(EN_INPUTS)) el(id).value = clean[key];
}
```

In `readForm`, add as the last field:

```js
    en: readEn(),
```

In `resetForm`, after clearing the Thai boxes:

```js
  writeEn({});
  el("enBox").open = false;
  el("enMsg").textContent = "";
  el("translateBtn").textContent = "แปลเป็นอังกฤษ";
```

In `startEditing`, after `el("detail").value = item.detail;`:

```js
  writeEn(item.en);
  // เปิดกล่องให้เองเมื่อชิ้นนี้มีฉบับอังกฤษแล้ว จะได้เห็นว่ามีอยู่
  el("enBox").open = Model.hasEnglish(item);
  el("enMsg").textContent = "";
```

In `itemCard`, after the title text is set:

```js
  if (Model.hasEnglish(item)) {
    const badge = document.createElement("span");
    badge.className = "en-badge";
    badge.textContent = "EN";
    title.appendChild(badge);
  }
```

- [ ] **Step 4: Wire the translate button**

Append to `popup.js`, above the `fillTypeOptions()` call at the bottom:

```js
// แปลเป็นอังกฤษ — ขอ "ร่าง" จาก doodee-future.com แล้วให้ผู้ใช้ตรวจแก้เอง
// ไม่บันทึกให้อัตโนมัติ: ข้อความนี้กำลังจะไปอยู่ในใบสมัครจริง
const TRANSLATE_PATH = "/api/extension/translate";
let translating = false;
let translateToken = 0;
let translateArmed = false;
let translateArmTimer = null;

function disarmTranslate() {
  translateArmed = false;
  clearTimeout(translateArmTimer);
  el("translateBtn").textContent = "แปลเป็นอังกฤษ";
}

el("translateBtn").addEventListener("click", async () => {
  if (translating) return;
  const fields = readForm();
  if (!fields.title.trim()) {
    el("enMsg").textContent = "ใส่ชื่อผลงาน (ภาษาไทย) ก่อนถึงจะแปลได้";
    el("title").focus();
    return;
  }

  // มีฉบับอังกฤษอยู่แล้ว ต้องถามก่อนทับ — จังหวะเดียวกับปุ่มลบ
  if (!translateArmed && !Model.isEmptyEn(readEn())) {
    translateArmed = true;
    el("translateBtn").textContent = "แทนที่ฉบับอังกฤษเดิม?";
    translateArmTimer = setTimeout(disarmTranslate, 3000);
    return;
  }
  disarmTranslate();

  // ผู้ใช้อาจกดไปแก้ชิ้นอื่นระหว่างรอ — ผลที่มาช้าห้ามลงช่องของชิ้นใหม่
  const token = (translateToken += 1);
  const editingWhenSent = editingId;
  translating = true;
  el("translateBtn").disabled = true;
  el("enMsg").textContent = "กำลังแปล… (ใช้เวลาราว 10-30 วินาที)";

  try {
    const res = await SiteCall.request(TRANSLATE_PATH, {
      method: "POST",
      body: {
        title: fields.title,
        org: fields.org,
        when: fields.when,
        result: fields.result,
        status: fields.status,
        detail: fields.detail,
      },
    });

    if (token !== translateToken || editingId !== editingWhenSent) return; // ไปชิ้นอื่นแล้ว ทิ้งผลนี้
    if (!res.ok) {
      let why = SiteCall.explain(res.status);
      if (res.status === 400 && /too_long/.test(res.text || "")) {
        why = "ข้อความยาวเกินไปสำหรับการแปล — ย่อรายละเอียดลงแล้วลองใหม่";
      }
      if (res.status === 502) why = "ระบบแปลตอบกลับมาไม่ครบ ลองกดอีกครั้ง";
      throw new Error(why);
    }
    if (SiteCall.looksLikeHtml(res.text)) {
      throw new Error("เว็บส่ง HTML กลับมาแทน JSON — น่าจะเด้งไปหน้าล็อกอิน");
    }

    const data = JSON.parse(res.text);
    writeEn(data && data.en);
    el("enBox").open = true;
    el("enMsg").textContent = "ได้ร่างแล้ว — ตรวจแก้ แล้วกด บันทึก/อัปเดต";
  } catch (error) {
    if (token === translateToken) el("enMsg").textContent = `แปลไม่สำเร็จ: ${error.message}`;
  } finally {
    if (token === translateToken) {
      translating = false;
      el("translateBtn").disabled = false;
    }
  }
});
```

- [ ] **Step 5: Confirm the suite still passes**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`. `popup.js` has no unit tests — it needs the DOM.

- [ ] **Step 6: Check the popup by hand**

Reload the unpacked extension. On an invented entry: open `ฉบับภาษาอังกฤษ (Inter)`, type English text by hand, save, reopen — the values persist, the block opens by itself and an `EN` badge shows on the card. Press `แปลเป็นอังกฤษ` with English already filled: the button asks `แทนที่ฉบับอังกฤษเดิม?` first. Until Task 8 is deployed, pressing it through shows `เว็บยังไม่มี endpoint นี้`, which is the expected 404 message.

- [ ] **Step 7: Show the diff and ask before committing**

```bash
git diff popup.html popup.css popup.js
```

Suggested message:

```
popup: edit and request an English draft for an entry
```

---

### Task 7: `＋ Inter` and the Inter filter in the panel

**Files:**
- Modify: `content.js` (`card`, `renderTypeBar`, `renderList`, filter state), `content.css` (`fill-inter`, `EN` pill)

**Interfaces:**
- Consumes: `Model.hasEnglish`, `Model.inEnglish`, `filterItems(..., { inter })` (Task 5); `createBlockThenPlan(item, btn)` and `buildPlan(item)` (existing).
- Produces: no new exports; this is the last consumer.

- [ ] **Step 1: Add the Inter button to the card**

In `content.js`, in `card`, directly after the `newBtn` block that appends `＋ ลงพอร์ต`:

```js
    const interBtn = document.createElement("button");
    interBtn.type = "button";
    interBtn.className = "fill fill-inter";
    interBtn.textContent = "＋ Inter";
    interBtn.title = "ลงพอร์ตด้วยฉบับภาษาอังกฤษ (หลักสูตรอินเตอร์)";
    interBtn.addEventListener("click", () => {
      if (!Model.hasEnglish(item)) {
        showNote("ยังไม่มีฉบับภาษาอังกฤษ — กดไอคอนส่วนขยาย › แก้ไข › แปลเป็นอังกฤษ ก่อน");
        return;
      }
      createBlockThenPlan(Model.inEnglish(item), interBtn);
    });
    fillRow.append(interBtn);
```

In the same function, in the `moreRow`, directly after the existing `allBtn` append:

```js
    const allInterBtn = document.createElement("button");
    allInterBtn.type = "button";
    allInterBtn.className = "fill fill-all";
    allInterBtn.textContent = "เติมทั้งฟอร์ม · Inter";
    allInterBtn.title = "ใช้กับบล็อกที่มีอยู่แล้วและเลือกไว้ — เติมฉบับภาษาอังกฤษ";
    allInterBtn.addEventListener("click", () => {
      if (!Model.hasEnglish(item)) {
        showNote("ยังไม่มีฉบับภาษาอังกฤษ — กดไอคอนส่วนขยาย › แก้ไข › แปลเป็นอังกฤษ ก่อน");
        return;
      }
      const plan = buildPlan(Model.inEnglish(item));
      if (!plan.length) {
        showNote("ไม่เจอช่องที่เติมได้บนหน้านี้ — เปิดฟอร์มเพิ่มผลงานก่อน แล้วค่อยกด");
        return;
      }
      showPlan(plan);
    });
    moreRow.append(allInterBtn);
```

Add an `EN` pill in the `pills` array, after the level pill:

```js
      [Model.hasEnglish(item) ? "EN" : "", "is-en"],
```

- [ ] **Step 2: Add the Inter chip to the type bar**

Near the other filter state at the top of the panel code (`activeType`, `activeTag`, `query`), add:

```js
  let interOnly = false;
```

In `renderTypeBar`, append the chip between the type chips and `tagToggle`:

```js
  function renderTypeBar() {
    const interChip = document.createElement("button");
    interChip.type = "button";
    interChip.className = "chip" + (interOnly ? " is-active" : "");
    interChip.setAttribute("aria-pressed", String(interOnly));
    interChip.textContent = "Inter";
    interChip.title = "เฉพาะผลงานที่มีฉบับภาษาอังกฤษ";
    interChip.addEventListener("click", () => {
      interOnly = !interOnly;
      renderTypeBar();
      renderList();
    });

    typeBar.replaceChildren(
      ...["", ...Model.TYPES].map((type) => {
        // …เดิมทั้งบล็อก ไม่ต้องแก้…
      }),
      interChip,
      tagToggle,
    );
  }
```

Keep the existing `.map(...)` body exactly as it is; only the two extra arguments are new.

In `renderList`, pass the criterion through:

```js
    const shown = Model.filterItems(items, { type: activeType, tag: activeTag, q: query, inter: interOnly });
```

- [ ] **Step 3: Style the button and the pill in `content.css`**

Append:

```css
.fill-inter {
  border-color: var(--blue);
  color: var(--blue);
  font-weight: 600;
}

.fill-inter:hover {
  background: var(--blue-soft);
}

.tag.is-en {
  border-color: var(--blue);
  background: var(--blue-soft);
  color: var(--blue);
  letter-spacing: 0.04em;
}
```

If `--blue-soft` or `--blue` are not defined in `content.css`'s `:root`, reuse whatever names the file already uses for the panel's blue (check the top of the file) rather than adding new colours.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS with `fail 0`.

- [ ] **Step 5: Verify on the real site by hand**

In the browser profile signed in to `student.mytcas.com`, on an invented entry that has an English copy:

1. The card shows an `EN` pill, and the `Inter` chip filters the list down to entries that have English.
2. `＋ Inter` on a กิจกรรม entry creates the block and the plan lists **English** text, with the English status in `สถานะการเข้าร่วม`.
3. On an entry **without** English, `＋ Inter` explains what to do instead of filling anything.
4. `ยกเลิก`, then delete every block the buttons created.

**Never press `บันทึกแฟ้ม`.**

- [ ] **Step 6: Show the diff and ask before committing**

```bash
git diff content.js content.css
```

Suggested message:

```
panel: add ＋ Inter to fill a folio with the English copy
```

---

### Task 8: the translate route on doodee-future.com

**Files:**
- Create: `/home/zaru/Documents/GitHub/doodee-future/doodee-future/lib/domain/portfolio-translate.ts`
- Create: `/home/zaru/Documents/GitHub/doodee-future/doodee-future/app/api/extension/translate/route.ts`
- Test: `/home/zaru/Documents/GitHub/doodee-future/doodee-future/tests/portfolio-translate.test.ts`

This task is in the **website** repo, not the extension. Work there and commit there separately.

**Interfaces:**
- Consumes: `invokeAiChat({ prompt, systemPrompt, maxTokens, temperature, timeoutMs })` from `@/lib/ai/chat` (returns `{ provider, content }`); `extractJson(raw)` from `@/lib/domain/portfolio-analysis`; `auth()` from `@/auth`.
- Produces: `POST /api/extension/translate` answering `{ en: { title, org, when, result, status, detail } }`, which Task 6 calls.

- [ ] **Step 1: Write the failing tests**

Create `tests/portfolio-translate.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_LIMITS,
  TRANSLATE_FIELDS,
  buildTranslatePrompt,
  parseTranslation,
} from "@/lib/domain/portfolio-translate";

// ข้อมูลสมมติทั้งหมด ห้ามใช้ข้อความจากพอร์ตจริง
const source = {
  title: "ค่ายอาสาสมมติ",
  org: "โรงเรียนสมมติ",
  when: "24 พ.ค. 2569",
  result: "",
  status: "ได้เข้าร่วมและส่งผลงาน",
  detail: "ช่วยสอนหนังสือเด็กเล็กเป็นเวลาสามวัน",
};

test("หกช่อง ตามลำดับที่ส่วนขยายส่งมา", () => {
  assert.deepEqual([...TRANSLATE_FIELDS], ["title", "org", "when", "result", "status", "detail"]);
  assert.equal(FIELD_LIMITS.detail, 4000);
  assert.equal(FIELD_LIMITS.title, 300);
});

test("prompt มีเฉพาะช่องที่มีค่า", () => {
  const prompt = buildTranslatePrompt(source);
  assert.match(prompt, /ค่ายอาสาสมมติ/);
  assert.match(prompt, /ได้เข้าร่วมและส่งผลงาน/);
  assert.doesNotMatch(prompt, /^result:/m, "ช่องว่างไม่ต้องใส่ในพรอมต์");
});

test("parseTranslation อ่าน JSON ที่ห่อด้วย code fence ได้", () => {
  const raw = '```json\n{"title":"Imaginary Camp","org":"Imaginary School","when":"24 May 2026",' +
    '"result":"","status":"Participated and submitted work","detail":"Taught young children for three days."}\n```';
  const out = parseTranslation(raw, source);
  assert.equal(out?.title, "Imaginary Camp");
  assert.equal(out?.status, "Participated and submitted work");
});

test("ช่องที่ต้นทางว่าง ต้องกลับมาว่างเสมอ", () => {
  const raw = '{"title":"A","org":"B","when":"C","result":"INVENTED","status":"D","detail":"E"}';
  const out = parseTranslation(raw, source);
  assert.equal(out?.result, "", "โมเดลแต่งค่าให้ช่องที่ไม่มีข้อมูลไม่ได้");
});

test("คีย์แปลกปลอมและค่าที่ไม่ใช่สตริงถูกตัด", () => {
  const raw = '{"title":"A","org":5,"when":null,"result":"","status":"D","detail":"E","extra":"x"}';
  const out = parseTranslation(raw, source);
  assert.deepEqual(Object.keys(out ?? {}), [...TRANSLATE_FIELDS]);
  assert.equal(out?.org, "");
  assert.equal(out?.when, "");
});

test("ไม่มี JSON หรือไม่มีหัวข้อ ต้องได้ null", () => {
  assert.equal(parseTranslation("ขอโทษครับ แปลไม่ได้", source), null);
  assert.equal(parseTranslation('{"title":"","org":"B"}', source), null);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /home/zaru/Documents/GitHub/doodee-future/doodee-future && bun test tests/portfolio-translate.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the pure module**

Create `lib/domain/portfolio-translate.ts`:

```ts
import { extractJson } from "@/lib/domain/portfolio-analysis";

export const TRANSLATE_FIELDS = ["title", "org", "when", "result", "status", "detail"] as const;

export type TranslateField = (typeof TRANSLATE_FIELDS)[number];
export type TranslateFields = Record<TranslateField, string>;

export const FIELD_LIMITS: Record<TranslateField, number> = {
  title: 300,
  org: 300,
  when: 300,
  result: 300,
  status: 300,
  detail: 4000,
};

const FIELD_LABELS: Record<TranslateField, string> = {
  title: "Title (ชื่อผลงาน)",
  org: "Organization (หน่วยงาน)",
  when: "Date or period (วันและเวลา)",
  result: "Result, prize or rank (ผลรางวัล / ผลการอบรม / ผลตอบรับ)",
  status: "Participation status (สถานะการเข้าร่วม)",
  detail: "Details (รายละเอียด)",
};

export const TRANSLATE_SYSTEM_PROMPT = [
  "You translate one entry of a Thai student's portfolio into English for an international-programme university application.",
  "Keep proper nouns, acronyms and brand names. Use an organisation's established English name when it has one",
  '(e.g. "สำนักงานการวิจัยแห่งชาติ (วช.)" is "National Research Council of Thailand (NRCT)").',
  "Convert Thai dates to English with Gregorian years (Buddhist Era minus 543):",
  '"24 พ.ค. 2569" is "24 May 2026". Translate "ปัจจุบัน" as "Present".',
  "Write formal, plain English. Add nothing that is not in the source, and never invent achievements.",
  "Text that is already English stays exactly as it is.",
  'Reply with strict JSON only, with exactly these keys: "title", "org", "when", "result", "status", "detail".',
  "A field that is empty in the source must be an empty string in your reply.",
].join(" ");

export function buildTranslatePrompt(fields: TranslateFields): string {
  const lines = TRANSLATE_FIELDS.filter((key) => (fields[key] ?? "").trim()).map(
    (key) => `${FIELD_LABELS[key]}:\n${fields[key].trim()}`,
  );
  return [
    "Translate this portfolio entry into English.",
    "",
    lines.join("\n\n"),
    "",
    'Reply with JSON only: {"title":"…","org":"…","when":"…","result":"…","status":"…","detail":"…"}',
  ].join("\n");
}

// โมเดลชอบแถมคีย์ เติมค่าให้ช่องที่ไม่มีข้อมูล หรือห่อ JSON ด้วย code fence
// ตัดทุกอย่างที่ไม่ได้ขอ แล้วบังคับให้ช่องที่ต้นทางว่างกลับไปว่าง
export function parseTranslation(raw: string, fields: TranslateFields): TranslateFields | null {
  const parsed = extractJson(raw ?? "");
  if (!parsed || typeof parsed !== "object") return null;

  const out = {} as TranslateFields;
  for (const key of TRANSLATE_FIELDS) {
    const value = (parsed as Record<string, unknown>)[key];
    const text = typeof value === "string" ? value.trim() : "";
    out[key] = (fields[key] ?? "").trim() ? text : "";
  }
  return out.title ? out : null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `bun test tests/portfolio-translate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the route**

Create `app/api/extension/translate/route.ts`:

```ts
// app/api/extension/translate/route.ts
//
// ร่างคำแปลอังกฤษให้ผลงานหนึ่งชิ้นของส่วนขยาย TCASFolio (Doodee future)
// เรียกจาก content script ในแท็บนี้เอง คุกกี้เซสชันจึงติดไปด้วย (SameSite=Lax)
//
// ต้องล็อกอิน — ต่างจาก /api/portfolio/analyse เพราะทุกครั้งที่ยิงคือการใช้โมเดล
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { invokeAiChat } from "@/lib/ai/chat";
import {
  FIELD_LIMITS,
  TRANSLATE_FIELDS,
  TRANSLATE_SYSTEM_PROMPT,
  buildTranslatePrompt,
  parseTranslation,
  type TranslateFields,
} from "@/lib/domain/portfolio-translate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const source = body as Record<string, unknown>;
  const fields = {} as TranslateFields;
  for (const key of TRANSLATE_FIELDS) {
    const value = source?.[key] ?? "";
    if (typeof value !== "string") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    // ตัดให้สั้นเองไม่ได้ — คำแปลที่หายไปครึ่งหนึ่งดูเหมือนแปลครบ
    if (value.length > FIELD_LIMITS[key]) {
      return NextResponse.json({ error: "too_long", field: key }, { status: 400 });
    }
    fields[key] = value;
  }
  if (!fields.title.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const { content } = await invokeAiChat({
      prompt: buildTranslatePrompt(fields),
      systemPrompt: TRANSLATE_SYSTEM_PROMPT,
      maxTokens: 2000,
      temperature: 0.2,
      timeoutMs: 45000,
    });

    const en = parseTranslation(content, fields);
    if (!en) {
      console.error("extension translate: unusable model output", content.slice(0, 200));
      return NextResponse.json({ error: "bad_model_output" }, { status: 502 });
    }
    return NextResponse.json({ en }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "timeout" }, { status: 408 });
    }
    console.error("extension translate error:", err);
    return NextResponse.json({ error: "translate_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Lint and type-check**

Run: `npm run lint`
Expected: no new errors for the two new files. (The repo's `tsconfig` has `strict: false`; do not turn it on here.)

- [ ] **Step 7: Try it against a dev server**

Run `npm run dev`, sign in at `http://localhost:3000`, and from the browser console **on that origin**:

```js
await (await fetch("/api/extension/translate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "ค่ายอาสาสมมติ", org: "โรงเรียนสมมติ", when: "24 พ.ค. 2569",
    result: "", status: "ได้เข้าร่วมและส่งผลงาน", detail: "ช่วยสอนหนังสือเด็กเล็กเป็นเวลาสามวัน",
  }),
})).json()
```

Expected: `{ en: { title: "…", …, when: "24 May 2026", status: "…" } }`. Signed out, the same call gives `401`.

- [ ] **Step 8: Show the diff and ask before committing**

```bash
cd /home/zaru/Documents/GitHub/doodee-future/doodee-future && git status --short && git diff
```

Suggested message:

```
feat(api): translate one portfolio entry for the TCASFolio extension
```

Deploying is the site's normal release, and is **not** part of this task.

---

### Task 9: documentation

**Files:**
- Modify: `README.md`, `docs/web-api-contract.md`, `docs/วิธีใช้.html` (extension repo)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Update `README.md`**

In the button table (`## ทำอะไรได้บ้าง`), add two rows next to `＋ ลงพอร์ต`:

```markdown
| `＋ Inter` | ลงพอร์ตด้วยฉบับภาษาอังกฤษ สำหรับแฟ้มหลักสูตรอินเตอร์ (ต้องมีฉบับอังกฤษก่อน) |
| `แปลเป็นอังกฤษ` | ขอร่างคำแปลอังกฤษของผลงานชิ้นนั้นจาก doodee-future.com แล้วตรวจแก้เองก่อนบันทึก |
```

In the `## ข้อมูลไปไหนบ้าง` table, add one row:

```markdown
| `แปลเป็นอังกฤษ` | **ออก** | **ข้อความหกช่องของผลงานชิ้นนั้น** ไปที่ `doodee-future.com/api/extension/translate` (ต่อไปที่ Typhoon/DeepSeek) — รูปไม่ถูกส่ง |
```

In the popup field list under `## วิธีใช้`, add `สถานะการเข้าร่วม` to the fields, and note that the result box is now `ผลรางวัล / ผลตอบรับ`.

- [ ] **Step 2: Update `docs/web-api-contract.md`**

Add `status` and `en` to the item shape example:

```jsonc
      "result": "ชนะเลิศ",
      "status": "",                           // สถานะการเข้าร่วม (ใช้กับหมวดกิจกรรม)
      "en": {                                  // ฉบับภาษาอังกฤษ (ไม่ส่งมาก็ได้)
        "title": "MakeX Challenger champion",
        "org": "OBEC with MakeX Thailand",
        "when": "28 Jun 2025 - 2 Nov 2025",
        "result": "Champion",
        "status": "",
        "detail": "Designed and programmed the robot…"
      },
```

State the rule the extension relies on: **an entry sent without `en`, or with every `en` field empty, never erases an English copy already in the vault.** In the conversion table, both `status` and `en` are empty for the site's own tables.

Add a section for the new endpoint, describing `POST /api/extension/translate`, the six request fields, the `{ en: {...} }` answer, and the status codes from Task 8 (401, 400 `too_long`, 502, 408).

- [ ] **Step 3: Update `docs/วิธีใช้.html`**

Add a short section (Thai, matching the file's existing tone) covering: type the entry once in Thai, press `แปลเป็นอังกฤษ` and check the draft, then use `＋ Inter` on the inter folio. Say plainly that the translation is a draft and that nothing is saved until the user presses save.

- [ ] **Step 4: Show the diff and ask before committing**

```bash
git diff README.md docs/
```

Suggested message:

```
docs: สถานะการเข้าร่วม field and the Inter English copy
```

---

## Deferred on purpose (not a task here)

**Mapping `status` for `⇩ นำเข้าอัตโนมัติ`.** `Model.folioToItems` does not fill `status`, because
nobody has measured which key TCASFolio uses for it when it saves a folio. Guessing `entry.status` is
unsafe: the site also tracks a verification state, and that value would land in the student's status box.

Measuring it needs the student signed in to `student.mytcas.com` in a test browser profile, then reading
the JSON the folio page **loads** (`interceptor.js` already sees every API response, so nothing has to be
saved). The procedure is in the status-field spec, section 6. Until then, `README.md` should say that
auto-import does not bring the status back.

## Final verification before calling this done

- [ ] `npm test` in the extension repo: every test passes, `fail 0`.
- [ ] `bun test tests/portfolio-translate.test.ts` in the website repo: passes.
- [ ] `npm run lint` in the website repo: no new errors.
- [ ] The by-hand checks in Tasks 4, 6 and 7 have actually been run, with no folio saved.
- [ ] `git status` in both repos shows only the intended files, and nothing was committed or pushed without the user asking.
