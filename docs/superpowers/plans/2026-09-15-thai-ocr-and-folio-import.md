# Thai OCR + TCASFolio folio import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PDF importer read the file TCASFolio itself exports — correct Thai, and หน่วยงาน / วันและเวลา / ลิงก์ / ชั่วโมง / ผลรางวัล filled in instead of thrown away.

**Architecture:** A new pure module `pdfGlyphs.js` repairs the text at the *item* level (merge zero-advance combining marks, drop artifact spaces, decode the legacy Thai Private Use block) before `pdfText.js` ever builds rows. A new pure module `pdfFolio.js` reads the structured แฟ้ม format when it is detected; otherwise the existing free-form Canva path runs unchanged. The vault model gains two fields, `when` and `link`, which then flow through popup, autofill, site import and analysis.

**Tech Stack:** Chrome MV3, vanilla JS as classic (non-module) IIFE scripts sharing `globalThis`, no build step, no dependencies. `node --test` for every pure module. `pdf.js` 4.10.38 vendored.

**Spec:** [`docs/superpowers/specs/2026-09-15-thai-ocr-and-folio-import-design.md`](../specs/2026-09-15-thai-ocr-and-folio-import-design.md). Read it first — every threshold and table below is justified there with measurements.

## Global Constraints

- **No network access anywhere.** No `fetch`, no `XMLHttpRequest`, no remote fonts/scripts/images. A reviewer rejecting a task for any outbound request is correct.
- **Pure modules stay pure.** `model.js`, `pdfText.js`, `pdfGlyphs.js`, `pdfFolio.js`, `pdfActualText.js` contain no `chrome.*` and no DOM. They are loaded as classic scripts assigning to `globalThis` and `require()`d directly by tests.
- **No real portfolio text in fixtures.** The file this was measured against carries the user's national ID, address, phone and email. Every fixture is written by hand with invented names. `test/pdfText.test.js` already carries this warning — keep it.
- **Zero-advance threshold is `w < 0.1`,** and only when `w` is a finite number. Measured: artifact spaces top out at `0.0375`, the narrowest real space is `0.2760`, combining marks are exactly `0`.
- **A missing or non-finite `w` means "a normal item".** Existing fixtures (`test/pdfText.test.js:141`) pass items with no `w` at all; treating those as zero-advance merges a whole page into one item.
- **Never guess an unmapped PUA code point.** Leave the character in place and count it. A wrong-but-plausible tone mark is undetectable; a visible `` is not.
- **Item type strings, verbatim:** `รางวัล / เกียรติบัตร`, `โครงงาน / วิจัย`, `กิจกรรม`, `การอบรม`, `ผลงานสร้างสรรค์` — and `Model.LEVELS` values must be returned exactly, or autofill cannot find the option.
- **`EXPORT_VERSION` stays `1`.** `when` and `link` are additive; old vaults and old backup files must still load.
- **UI copy is Thai.** Match the tone already in `popup.html` and `import.html`.
- **Tests are CommonJS:** `require("../x.js")` then `const { test } = require("node:test")` and `require("node:assert/strict")`. Run everything with `npm test`.
- Node is v26.8.1; `node --test`, `crypto.randomUUID()` and `DecompressionStream` are all available without flags.

---

### Task 1: `pdfGlyphs.js` — repair the item stream

**Files:**
- Create: `pdfGlyphs.js`
- Create: `test/pdfGlyphs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `globalThis.PdfGlyphs` with
  `ZERO_ADVANCE: number` (0.1),
  `unpua(text: string): string`,
  `countPua(text: string): number`,
  `composeThai(text: string): string`,
  `normalizeItems(items: Item[]): Item[]` where `Item` is `{str: string, x: number, y: number, w?: number, h?: number}`.

- [ ] **Step 1: Write the failing tests**

Create `test/pdfGlyphs.test.js`:

```js
"use strict";

require("../pdfGlyphs.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const G = globalThis.PdfGlyphs;

// ── fixture สังเคราะห์ ────────────────────────────────────────────────
// จำลองอาการที่วัดได้จากไฟล์ที่ Chrome/Skia สร้าง (2026-09-15):
// เครื่องหมายเป็น item แยกที่กว้าง 0 พอดี ตามด้วยช่องว่างขยะที่กว้างเกือบ 0
// ห้ามใช้ข้อความพอร์ตจริงของผู้ใช้ในไฟล์นี้ — เป็นข้อมูลส่วนตัว

test("normalizeItems ต่อเครื่องหมายที่กว้าง 0 เข้ากับ item ก่อนหน้า", () => {
  const out = G.normalizeItems([
    { str: "ว", x: 74.21, y: 695, w: 5.17, h: 9.8 },
    { str: "ั", x: 79.3, y: 695, w: 0, h: 9.8 },
    { str: "ตกรรม", x: 79.38, y: 695, w: 30, h: 9.8 },
  ]);
  assert.deepEqual(out.map((i) => i.str), ["วั", "ตกรรม"]);
});

test("normalizeItems ทิ้งช่องว่างขยะที่กว้างเกือบศูนย์ แต่เก็บช่องว่างจริง", () => {
  const out = G.normalizeItems([
    { str: "ด", x: 140.15, y: 695, w: 6.5, h: 9.8 },
    { str: "้", x: 146.58, y: 695, w: 0, h: 9.8 },
    { str: " ", x: 146.66, y: 695, w: 0.0000042, h: 0 }, // ขยะจากการถอยตำแหน่ง
    { str: "าน", x: 146.66, y: 695, w: 11.46, h: 9.8 },
    { str: " ", x: 158.11, y: 695, w: 3.25, h: 0 }, // ช่องว่างจริง
    { str: "ค", x: 161.4, y: 695, w: 6.5, h: 9.8 },
  ]);
  assert.deepEqual(out.map((i) => i.str), ["ด้", "าน", " ", "ค"]);
});

test("normalizeItems ไม่ต่อข้ามบรรทัด", () => {
  const out = G.normalizeItems([
    { str: "ก", x: 10, y: 700, w: 5, h: 10 },
    { str: "ั", x: 15, y: 640, w: 0, h: 10 }, // คนละบรรทัด
  ]);
  assert.deepEqual(out.map((i) => i.str), ["ก", "ั"]);
});

test("normalizeItems เก็บเครื่องหมายที่เป็น item แรกของแถวไว้ ไม่ทิ้งเงียบ ๆ", () => {
  const out = G.normalizeItems([{ str: "ั", x: 10, y: 700, w: 0, h: 10 }]);
  assert.deepEqual(out.map((i) => i.str), ["ั"]);
});

test("normalizeItems ถือว่า item ที่ไม่มี w เป็น item ปกติ", () => {
  // fixture เดิมของ Canva ใน pdfText.test.js ไม่ใส่ w มาเลย
  // ถ้าตีความว่ากว้าง 0 ทั้งหน้าจะถูกยุบเป็นชิ้นเดียว
  const out = G.normalizeItems([
    { str: "ค่ายอยากเป็นวิศวฯ", x: 10, y: 700, h: 16 },
    { str: "รายละเอียดยาว ๆ", x: 10, y: 650, h: 14 },
  ]);
  assert.equal(out.length, 2);
});

test("unpua แปลงรหัส Private Use เป็นเครื่องหมายไทยตามที่วัดมา", () => {
  assert.equal(G.unpua("ประจำป"), "ประจำปี");
  assert.equal(G.unpua("แฟม"), "แฟ้ม");
  assert.equal(G.unpua("ปญหา"), "ปัญหา");
  assert.equal(G.unpua("เปน"), "เป็น");
  assert.equal(G.unpua("ที"), "ท่ี");
  assert.equal(G.unpua("ขึน"), "ขึ้น");
  assert.equal(G.unpua("ไซต"), "ไซต์");
});

test("unpua ปล่อยรหัสที่ไม่มีในตารางไว้ ไม่เดา", () => {
  assert.equal(G.unpua("กข"), "กข");
  assert.equal(G.countPua("กข"), 1);
  assert.equal(G.countPua("ปัญหา"), 0);
});

test("composeThai ประกอบ ํ + า เป็น ำ และไม่แตะ ำ ที่ถูกอยู่แล้ว", () => {
  assert.equal(G.composeThai("ประจําป"), "ประจำป");
  assert.equal(G.composeThai("สํานักงาน"), "สำนักงาน");
  assert.equal(G.composeThai("สำนักงาน"), "สำนักงาน");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pdfGlyphs.test.js`
Expected: FAIL — `Cannot find module '../pdfGlyphs.js'`

- [ ] **Step 3: Write the implementation**

Create `pdfGlyphs.js`:

```js
// ซ่อมข้อความชั้น "text item" ก่อนใครทั้งหมด — ตรรกะล้วน ห้ามมี chrome.* ห้ามมี DOM
// ที่นี่แก้อาการของไฟล์ที่ Chrome/Skia สร้าง (รวมถึงแฟ้มที่ TCASFolio ส่งออกเอง)
// ซึ่งต่างจากอาการของ Canva ที่ pdfText.js ดูแลอยู่แล้วโดยสิ้นเชิง
(function (root) {
  "use strict";

  // ความกว้างที่ถือว่า "ไม่กินที่" — วัดจากไฟล์จริง 2026-09-15:
  // เครื่องหมายกว้าง 0 พอดี · ช่องว่างขยะไม่เกิน 0.0375 · ช่องว่างจริงต่ำสุด 0.2760
  const ZERO_ADVANCE = 0.1;

  // บรรทัดเดียวกันถือว่าห่าง y ได้ไม่เกินเท่านี้ (เท่ากับ buildRows)
  const ROW_TOLERANCE = 2;

  // เขต Private Use ที่ฟอนต์ไทยรุ่นเก่าใช้เก็บ "รูปแปร" ของเครื่องหมาย
  // ตารางนี้ได้จากการวัดเทียบ pdftotext ไม่ใช่จากตำรา — ดูหลักฐานข้อ 3 ในสเปก
  // (ตำราผิดสองช่อง: บอกว่า F702 เป็น ้ ซึ่งจะทำให้ ปี กลายเป็น ป้)
  const PUA_FIRST = 0xf700;
  const PUA_LAST = 0xf71f;
  const PUA = new Map([
    // U+F700–U+F704 สระบนรูปแปร (วัดตรง: F702 = ี)
    [0xf700, "ั"], [0xf701, "ิ"], [0xf702, "ี"],
    [0xf703, "ึ"], [0xf704, "ื"],
    // U+F705–U+F709 วรรณยุกต์รูปแปรชิดซ้าย (วัดตรง: F706 = ้)
    [0xf705, "่"], [0xf706, "้"], [0xf707, "๊"],
    [0xf708, "๋"], [0xf709, "์"],
    // U+F70A–U+F70E วรรณยุกต์รูปแปรลดระดับ (วัดตรง: F70A F70B F70E)
    [0xf70a, "่"], [0xf70b, "้"], [0xf70c, "๊"],
    [0xf70d, "๋"], [0xf70e, "์"],
    // วัดตรงสองตัว ไม่เติมเพื่อนบ้าน เพราะยังไม่รู้โครงของช่วงนี้
    [0xf710, "ั"], [0xf712, "็"],
  ]);

  function isPua(code) {
    return code >= PUA_FIRST && code <= PUA_LAST;
  }

  function unpua(text) {
    let out = "";
    for (const ch of String(text || "")) {
      const code = ch.codePointAt(0);
      // ไม่มีในตาราง = ปล่อยไว้ให้คนเห็น ห้ามเดาเป็นวรรณยุกต์ที่ดูสมเหตุสมผล
      out += isPua(code) ? PUA.get(code) || ch : ch;
    }
    return out;
  }

  function countPua(text) {
    let n = 0;
    for (const ch of String(text || "")) {
      if (isPua(ch.codePointAt(0))) n += 1;
    }
    return n;
  }

  // ำ (U+0E33) ถูกวาดเป็น ํ (U+0E4D) + า (U+0E32) คนละ item
  // จึงประกอบตอนเป็น item ไม่ได้ ต้องเรียกหลังต่อเป็นแถวแล้วเท่านั้น
  function composeThai(text) {
    return String(text || "")
      .replace(/ํา/g, "ำ")
      .replace(/าํ/g, "ำ");
  }

  // ชิ้นที่ไม่กินที่ = เครื่องหมายที่ต้องเกาะตัวก่อนหน้า หรือขยะที่ต้องทิ้ง
  // เดินตามลำดับเดิมของ content stream เท่านั้น — ลำดับนั้นถูกอยู่แล้ว
  // การเรียงตาม x คือสิ่งที่ทำให้ "เกียรติ" กลายเป็น "เก ยรี"
  function normalizeItems(items) {
    const out = [];
    for (const item of items || []) {
      if (!item || typeof item.str !== "string") continue;
      const w = Number(item.w);
      // w ที่ไม่ใช่ตัวเลข = ตัวอ่านไม่ได้บอกความกว้างมา ห้ามเดาว่าไม่กินที่
      const zero = Number.isFinite(w) && w < ZERO_ADVANCE;
      if (zero) {
        const prev = out[out.length - 1];
        const sameRow = prev && Math.abs(Number(prev.y) - Number(item.y)) <= ROW_TOLERANCE;
        if (sameRow) {
          // ช่องว่าง/ค่าว่างที่ไม่กินที่คือขยะจากการถอยตำแหน่งของ Skia
          if (item.str.trim()) prev.str += item.str;
          continue;
        }
        if (!item.str.trim()) continue;
        // ไม่มีตัวก่อนหน้าให้เกาะ — เก็บไว้เป็นชิ้นของตัวเอง ห้ามทิ้งเงียบ ๆ
      }
      out.push({ ...item });
    }
    return out;
  }

  root.PdfGlyphs = {
    ZERO_ADVANCE,
    unpua,
    countPua,
    composeThai,
    normalizeItems,
  };
})(globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/pdfGlyphs.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm nothing else broke**

Run: `npm test`
Expected: PASS — every existing test still green.

- [ ] **Step 6: Commit**

```bash
git add pdfGlyphs.js test/pdfGlyphs.test.js
git commit -m "pdf import: repair Thai at the text-item layer

Chrome emits every Thai combining mark as a separate item of exactly zero
width, followed by a near-zero-width space artifact. A further 206 marks
arrive as legacy Thai Private Use code points. Merge the first, drop the
second, decode the third from a table measured against pdftotext.

Unmapped PUA code points are left visible and counted, never guessed."
```

---

### Task 2: Run the repair inside `pdfText.js`

**Files:**
- Modify: `pdfText.js` — `buildRows()` and `toDrafts()`
- Modify: `test/pdfText.test.js` — add one `require` to the header, append two tests

**Interfaces:**
- Consumes: `PdfGlyphs.normalizeItems`, `PdfGlyphs.unpua`, `PdfGlyphs.composeThai` from Task 1.
- Produces: `PdfText.buildRows` / `buildLines` / `toDrafts` unchanged in signature; their output is now PUA-decoded and ำ-composed.

**Note for the reviewer:** the spec says `test/pdfText.test.js` must not be edited. That means its **existing assertions** must not change. Adding a `require` line and appending new tests is expected — if any existing assertion needs adjusting, stop and escalate, because it means the Canva path regressed.

- [ ] **Step 1: Write the failing tests**

Add to the header of `test/pdfText.test.js`, immediately after `require("../model.js");`:

```js
require("../pdfGlyphs.js");
```

Append to the end of `test/pdfText.test.js`:

```js
test("buildRows ถอด PUA และประกอบ ำ หลังต่อแถวแล้ว", () => {
  // ประกอบ ำ ตอนเป็น item ไม่ได้ เพราะ ํ กับ า มาคนละ item
  const rows = P.buildRows([
    { str: "ประจ", x: 10, y: 700, w: 20, h: 10 },
    { str: "ํ", x: 30, y: 700, w: 0, h: 10 },
    { str: "า", x: 30, y: 700, w: 5, h: 10 },
    { str: "ป", x: 35, y: 700, w: 5, h: 10 },
    { str: "", x: 40, y: 700, w: 0, h: 10 },
  ]);
  assert.deepEqual(rows.map((r) => r.text), ["ประจำปี"]);
});

test("buildRows ไม่ยุบ item ที่ไม่มี w (fixture เดิมต้องไม่พัง)", () => {
  const rows = P.buildRows([
    { str: "ซ้าย", x: 10, y: 700 },
    { str: "ขวา", x: 90, y: 700 },
  ]);
  assert.deepEqual(rows.map((r) => r.text), ["ซ้ายขวา"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pdfText.test.js`
Expected: the first new test FAILS with `["ประจําป"] !== ["ประจำปี"]`. The second should already pass.

- [ ] **Step 3: Wire the repair into `buildRows`**

In `pdfText.js`, find the return of `buildRows` (the `.map(...)` that calls `joinParts`) and change the text expression so the glyph repair runs after the row is joined and **before** `dropTwins`, so twin detection compares correct text:

```js
    return rows
      .sort((a, b) => b.y - a.y)
      .map((r) => ({
        y: r.y,
        h: r.h || 0,
        // ถอด PUA + ประกอบ ำ ต้องทำหลัง join เพราะ ํ กับ า มาคนละ item
        // และต้องทำก่อน dropTwins เพื่อให้เทียบฝาแฝดบนข้อความที่ถูกแล้ว
        text: dropTwins(
          root.PdfGlyphs.composeThai(
            root.PdfGlyphs.unpua(joinParts(r.parts.sort((a, b) => a.x - b.x))),
          ),
        ),
      }))
      .filter((r) => r.text);
```

- [ ] **Step 4: Run the item repair at the top of `toDrafts`**

In `pdfText.js`, in `toDrafts`, wrap the item list with `normalizeItems` so it runs **before** `dropOverlapping` and `dropOrphanMarks` — those two must never see a bare zero-width Chrome mark:

```js
  function toDrafts(pages) {
    const prepared = (pages || []).map((p) => ({
      page: Number(p && p.page) || 0,
      lines: groupParagraphs(
        repairRows(
          buildRows(
            dropOrphanMarks(
              dropOverlapping(root.PdfGlyphs.normalizeItems((p && p.items) || [])),
            ),
          ),
        ),
      ),
    }));
```

- [ ] **Step 5: Compose ำ when paragraphs are joined too**

In `pdfText.js`, in `groupParagraphs`, the final map already runs `dropTwins`. Change it so composition happens across the paragraph join as well:

```js
    return paras.map((t) => dropTwins(root.PdfGlyphs.composeThai(t))).filter(Boolean);
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — the two new tests plus every existing `pdfText` test.

- [ ] **Step 7: Commit**

```bash
git add pdfText.js test/pdfText.test.js
git commit -m "pdf import: run the glyph repair before row building

normalizeItems runs ahead of dropOverlapping and dropOrphanMarks so
neither sees a bare zero-width Chrome mark; unpua and composeThai run
after the row is joined, because a mark and its base arrive as separate
items and cannot be composed before that."
```

---

### Task 3: `pdfFolio.js` — read the TCASFolio export

**Files:**
- Create: `pdfFolio.js`
- Create: `test/pdfFolio.test.js`

**Interfaces:**
- Consumes: `PdfText.stripMarks` (Task 2 leaves it unchanged), `Model.LEVELS`.
- Produces: `globalThis.PdfFolio` with
  `SECTION_TYPES: string[]` (index 0 = หมวด 4.1),
  `bareOf(text: string): string`,
  `matchLevel(text: string): string` (a `Model.LEVELS` value, or `""`),
  `sectionType(row: string): string | null` (`null` = not a heading, `""` = a heading outside หมวด 4, otherwise the type),
  `parseMetaRow(row: string): {level: string, when: string, hours: string, org: string} | null`,
  `looksLikeFolio(pages: Page[]): boolean`,
  `toDrafts(pages: Page[]): {drafts: Draft[], skipped: {page: number, why: string}[]}`
  where `Page` is `{page: number, rows: string[]}` and `Draft` is
  `{page, type, title, org, when, hours, level, result, link, detail}` — all strings except `page`.

- [ ] **Step 1: Write the failing tests**

Create `test/pdfFolio.test.js`:

```js
"use strict";

require("../model.js");
require("../pdfGlyphs.js");
require("../pdfText.js");
require("../pdfFolio.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const F = globalThis.PdfFolio;
const M = globalThis.Model;

// ── fixture สังเคราะห์ ────────────────────────────────────────────────
// เลียนโครงของแฟ้มที่ TCASFolio ส่งออก แต่เนื้อหาแต่งขึ้นทั้งหมด
// ห้ามใช้ข้อความพอร์ตจริงของผู้ใช้ในไฟล์นี้ — เป็นข้อมูลส่วนตัว

test("sectionType อ่านหมวด 4.x เป็นประเภทผลงาน", () => {
  assert.equal(F.sectionType("หมวด 4.1 · รางวัล / เกียรติบัตร"), "รางวัล / เกียรติบัตร");
  assert.equal(F.sectionType("หมวด 4.4 · การอบรม / การเรียนเพิ่มทักษะอื่นๆ"), "การอบรม");
  assert.equal(F.sectionType("หมวด 4.5 · ผลงานสร้างสรรค์"), "ผลงานสร้างสรรค์");
});

test("sectionType คืนค่าว่างสำหรับหมวดที่ไม่ใช่ผลงาน และ null ถ้าไม่ใช่หัวหมวด", () => {
  assert.equal(F.sectionType("หมวด 1 · ข้อมูลผู้สมัคร"), "");
  assert.equal(F.sectionType("หมวด 2 · เรียงความ / เหตุผลในการสมัคร"), "");
  assert.equal(F.sectionType("ผลการอบรม : Completed"), null);
});

test("sectionType ยังอ่านออกแม้เครื่องหมายหาย", () => {
  // ก่อนถอด PUA หัวหมวดมาแบบนี้ — ตัวตัดชิ้นต้องไม่ผูกกับวรรณยุกต์
  assert.equal(F.sectionType("หมวด 4.4 · การอบรม / การเรยนเพิ่มทักษะอ่นๆ"), "การอบรม");
});

test("matchLevel คืนค่าที่ตรงกับ Model.LEVELS เป๊ะ แม้ต้นทางเครื่องหมายหาย", () => {
  assert.equal(F.matchLevel("ระดับโรงเรยน/สถาบัน ไมมีคาใชจาย"), M.LEVELS[0]);
  assert.equal(F.matchLevel("ระดับชาติ ไม่มีค่าใช้จ่าย"), "ระดับชาติ");
  assert.equal(F.matchLevel("ระดับนานาชาติ มีค่าใช้จ่าย"), "ระดับนานาชาติ");
  assert.equal(F.matchLevel("ผลการอบรม : Completed"), "");
});

test("parseMetaRow แยกวันที่และหน่วยงานออกจากกันที่จุดคั่น", () => {
  const got = F.parseMetaRow(
    "ระดับชาติ ไม่มีค่าใช้จ่าย วันที่: มกราคม-เมษายน 2569 · สำนักวิจัยสมมติ (สวส.), สถาบันสมมติ",
  );
  assert.equal(got.level, "ระดับชาติ");
  assert.equal(got.when, "มกราคม-เมษายน 2569");
  assert.equal(got.hours, "");
  assert.equal(got.org, "สำนักวิจัยสมมติ (สวส.), สถาบันสมมติ");
});

test("parseMetaRow รับแถวที่มีแต่ระดับ", () => {
  const got = F.parseMetaRow("ระดับชาติ ไม่มีค่าใช้จ่าย");
  assert.deepEqual(got, { level: "ระดับชาติ", when: "", hours: "", org: "" });
});

test("parseMetaRow รับชั่วโมงที่ไม่มีวันที่", () => {
  const got = F.parseMetaRow("ระดับโรงเรียน/สถาบัน มีค่าใช้จ่าย (48 ชม.) · สถาบันสมมตินานาชาติ (สสน.)");
  assert.equal(got.when, "");
  assert.equal(got.hours, "48");
  assert.equal(got.org, "สถาบันสมมตินานาชาติ (สสน.)");
});

test("parseMetaRow รับช่วงเวลาที่ไม่มีหน่วยงาน", () => {
  const got = F.parseMetaRow("ระดับชาติ ไม่มีค่าใช้จ่าย ช่วงเวลา: 31 ส.ค. 2568 - ปัจจุบัน");
  assert.equal(got.when, "31 ส.ค. 2568 - ปัจจุบัน");
  assert.equal(got.org, "");
});

test("parseMetaRow รับวันที่ + ชั่วโมง + หน่วยงาน พร้อมกัน", () => {
  const got = F.parseMetaRow(
    "ระดับโรงเรียน/สถาบัน ไม่มีค่าใช้จ่าย วันที่: 20–22 และ 24 ต.ค. 2568 (120 ชม.) · คณะสมมติศาสตร์ มหาวิทยาลัยสมมติ",
  );
  assert.equal(got.when, "20–22 และ 24 ต.ค. 2568");
  assert.equal(got.hours, "120");
  assert.equal(got.org, "คณะสมมติศาสตร์ มหาวิทยาลัยสมมติ");
});

test("parseMetaRow คืน null ถ้าไม่ได้ขึ้นต้นด้วยระดับ", () => {
  assert.equal(F.parseMetaRow("ผลรางวัล / อันดับ : เหรียญทอง"), null);
});

const LONG = "รายละเอียดผลงานสมมติที่ยาวพอจะเป็นย่อหน้าจริง เขียนไว้เพื่อทดสอบตัวตัดชิ้นเท่านั้น";

test("toDrafts อ่านชิ้นงานครบทุกช่อง", () => {
  const out = F.toDrafts([
    {
      page: 5,
      rows: [
        "แฟ้มสะสมผลงาน · ประจำปี 2570",
        "หมวด 4.1 · รางวัล / เกียรติบัตร",
        "1 การแข่งขันสมมติแห่งชาติ 2569",
        "ระดับชาติ ไม่มีค่าใช้จ่าย วันที่: 24 พ.ค. 2569 · สมาคมสมมติ, มหาวิทยาลัยสมมติ",
        "ผลรางวัล / อันดับ : รองชนะเลิศลำดับที่ 2",
        LONG,
        "หน้า 5 / 10",
      ],
    },
  ]);
  assert.equal(out.drafts.length, 1);
  assert.deepEqual(out.drafts[0], {
    page: 5,
    type: "รางวัล / เกียรติบัตร",
    title: "การแข่งขันสมมติแห่งชาติ 2569",
    org: "สมาคมสมมติ, มหาวิทยาลัยสมมติ",
    when: "24 พ.ค. 2569",
    hours: "",
    level: "ระดับชาติ",
    result: "รองชนะเลิศลำดับที่ 2",
    link: "",
    detail: LONG,
  });
});

test("toDrafts เก็บลิงก์แสดงผลงานแยกจากรายละเอียด", () => {
  const out = F.toDrafts([
    {
      page: 10,
      rows: [
        "หมวด 4.5 · ผลงานสร้างสรรค์",
        "1 เว็บสมมติดอตคอม",
        "ระดับชาติ ไม่มีค่าใช้จ่าย ช่วงเวลา: 1 มี.ค. 2569 - ปัจจุบัน",
        "ผลตอบรับ / รางวัล : ผู้ใช้มากกว่า 100 คน",
        "ลิงก์แสดงผลงาน : https://example.invalid/",
        LONG,
      ],
    },
  ]);
  assert.equal(out.drafts[0].link, "https://example.invalid/");
  assert.equal(out.drafts[0].detail, LONG);
  assert.equal(out.drafts[0].org, "");
});

test("toDrafts ไม่ตัดหัวข้อที่ขึ้นต้นด้วยตัวเลขจริง", () => {
  const out = F.toDrafts([
    {
      page: 5,
      rows: [
        "หมวด 4.1 · รางวัล / เกียรติบัตร",
        "1 2026 การแข่งขันสมมติ",
        "ระดับชาติ ไม่มีค่าใช้จ่าย",
        LONG,
      ],
    },
  ]);
  assert.equal(out.drafts[0].title, "2026 การแข่งขันสมมติ");
});

test("toDrafts ต่อชิ้นที่คาบสองหน้าเป็นชิ้นเดียว", () => {
  const out = F.toDrafts([
    {
      page: 6,
      rows: [
        "หมวด 4.1 · รางวัล / เกียรติบัตร",
        "1 ค่ายสมมติ",
        "ระดับชาติ ไม่มีค่าใช้จ่าย",
        "บรรทัดแรกของรายละเอียด",
      ],
    },
    { page: 7, rows: ["แฟ้มสะสมผลงาน · ประจำปี 2570", "บรรทัดที่สองของรายละเอียด", "หน้า 7 / 10"] },
  ]);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].detail, "บรรทัดแรกของรายละเอียด\nบรรทัดที่สองของรายละเอียด");
});

test("toDrafts รีเซ็ตลำดับเมื่อขึ้นหมวดใหม่ และข้ามหมวดที่ไม่ใช่ผลงาน", () => {
  const out = F.toDrafts([
    {
      page: 4,
      rows: ["หมวด 2 · เรียงความ / เหตุผลในการสมัคร", "เนื้อเรียงความยาว ๆ ที่ต้องไม่กลายเป็นผลงาน"],
    },
    {
      page: 7,
      rows: [
        "หมวด 4.3 · กิจกรรม",
        "1 กิจกรรมสมมติหนึ่ง",
        "ระดับชาติ ไม่มีค่าใช้จ่าย",
        LONG,
        "หมวด 4.4 · การอบรม / การเรียนเพิ่มทักษะอื่นๆ",
        "1 อบรมสมมติหนึ่ง",
        "ระดับชาติ ไม่มีค่าใช้จ่าย",
        LONG,
      ],
    },
  ]);
  assert.equal(out.drafts.length, 2);
  assert.equal(out.drafts[0].type, "กิจกรรม");
  assert.equal(out.drafts[1].type, "การอบรม");
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].page, 4);
});

test("looksLikeFolio แยกแฟ้ม TCASFolio ออกจากเล่ม Canva", () => {
  assert.equal(looksFolio(["หมวด 4.1 · รางวัล / เกียรติบัตร"]), true);
  assert.equal(looksFolio(["ค่ายอยากเป็นวิศวฯ", "รายละเอียด"]), false);
  assert.equal(looksFolio(["หมวด 1 · ข้อมูลผู้สมัคร"]), false);
});

function looksFolio(rows) {
  return F.looksLikeFolio([{ page: 1, rows }]);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pdfFolio.test.js`
Expected: FAIL — `Cannot find module '../pdfFolio.js'`

- [ ] **Step 3: Write the implementation**

Create `pdfFolio.js`:

```js
// อ่าน "แฟ้มสะสมผลงาน" ที่ TCASFolio ส่งออกเอง — ตรรกะล้วน ห้ามมี chrome.* ห้ามมี DOM
// ต่างจาก pdfText.js ตรงที่ไฟล์นี้มีโครงชัดเจน จึงอ่านตรง ๆ ได้ ไม่ต้องเดา
//
// คำทุกคำเทียบแบบถอดเครื่องหมาย เพราะวรรณยุกต์บางตัวยังหายอยู่ (ดูสเปกข้อ 4)
// แล้วคืนค่าเป็นสตริงมาตรฐานเสมอ — โดยเฉพาะ level ที่ต้องตรงกับ Model.LEVELS
// ไม่งั้นตอนเติมฟอร์มจะหาตัวเลือกไม่เจอ
(function (root) {
  "use strict";

  // ลำดับตรงกับ Model.FOLIO_SECTIONS: หมวด 4.1 = index 0
  const SECTION_TYPES = [
    "รางวัล / เกียรติบัตร",
    "โครงงาน / วิจัย",
    "กิจกรรม",
    "การอบรม",
    "ผลงานสร้างสรรค์",
  ];

  const RESULT_LABELS = [
    "ผลรางวัล / อันดับ",
    "สถานะการเข้าร่วม",
    "ผลการอบรม",
    "ผลตอบรับ / รางวัล",
  ];
  const LINK_LABEL = "ลิงก์แสดงผลงาน";
  const WHEN_LABELS = ["วันที่", "ช่วงเวลา"];

  function bareOf(text) {
    return root.PdfText.stripMarks(text);
  }

  // แผนที่ตำแหน่ง: ดัชนีในข้อความที่ถอดเครื่องหมายแล้ว -> ดัชนีจริง
  // ต้องมี เพราะเราค้นคำบนข้อความที่ถอดแล้ว แต่ต้องตัดค่าจากข้อความจริง
  function bareIndex(text) {
    const src = String(text || "");
    const idx = [];
    let bare = "";
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      const stripped = root.PdfText.stripMarks(ch);
      if (!stripped) continue; // เครื่องหมายหรือช่องว่าง
      bare += stripped;
      idx.push(i);
    }
    return { bare, idx };
  }

  // หาป้าย "<label> :" แล้วคืนข้อความจริงที่อยู่หลังจากนั้น
  // atStart = true สำหรับป้ายที่ต้องอยู่ต้นแถว (ผลรางวัล/ลิงก์)
  function afterLabel(text, labels, atStart) {
    const { bare, idx } = bareIndex(text);
    for (const label of labels) {
      const key = `${bareOf(label)}:`;
      const at = bare.indexOf(key);
      if (at === -1) continue;
      if (atStart && at !== 0) continue;
      const end = at + key.length;
      const from = end < idx.length ? idx[end] : String(text).length;
      return String(text).slice(from).trim();
    }
    return null;
  }

  function matchLevel(text) {
    const bare = bareOf(text);
    // เรียงจากยาวไปสั้น กันกรณีระดับหนึ่งเป็นคำนำหน้าของอีกระดับ
    const levels = root.Model.LEVELS.slice().sort((a, b) => bareOf(b).length - bareOf(a).length);
    for (const level of levels) {
      if (bare.startsWith(bareOf(level))) return level;
    }
    return "";
  }

  // null = ไม่ใช่หัวหมวด · "" = หัวหมวดที่ไม่ใช่ผลงาน · string = ประเภทผลงาน
  function sectionType(row) {
    const m = bareOf(row).match(/^หมวด(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    if (m[1] !== "4" || !m[2]) return "";
    return SECTION_TYPES[Number(m[2]) - 1] || "";
  }

  function isFurniture(row) {
    const bare = bareOf(row);
    if (/^หนา\d+\/\d+$/.test(bare)) return true; // "หน้า 5 / 10"
    return bare.includes("แฟมสะสมผลงาน·ประจาป"); // หัวกระดาษทุกหน้า
  }

  function parseMetaRow(row) {
    const text = String(row || "").trim();
    const level = matchLevel(text);
    if (!level) return null;

    // ตัดที่ · ตัวแรกก่อน แล้วค่อยแกะวันที่/ชั่วโมงจากท่อนหน้า
    // ชื่อหน่วยงานมีวงเล็บได้ แต่ไม่มี · จึงตัดตรงนี้ปลอดภัยกว่าไล่หาวงเล็บ
    const dot = text.indexOf("·");
    const lead = dot === -1 ? text : text.slice(0, dot);
    const org = dot === -1 ? "" : text.slice(dot + 1).trim();

    let hours = "";
    const h = lead.match(/\((\d+(?:\.\d+)?)\s*ชม\.?\)/);
    if (h) hours = h[1];

    let when = afterLabel(lead, WHEN_LABELS, false) || "";
    if (when && h) when = when.replace(h[0], "");
    when = when.replace(/\s+/g, " ").trim();

    return { level, when, hours, org };
  }

  function looksLikeFolio(pages) {
    for (const entry of pages || []) {
      for (const row of (entry && entry.rows) || []) {
        if (sectionType(row)) return true;
      }
    }
    return false;
  }

  function toDrafts(pages) {
    const drafts = [];
    const skipped = [];
    let type = "";
    let inSection = false;
    let ordinal = 0;
    let current = null;

    const push = () => {
      if (current && current.title) drafts.push(current);
      current = null;
    };

    for (const entry of pages || []) {
      const page = Number(entry && entry.page) || 0;
      const rows = ((entry && entry.rows) || []).map((r) => String(r).trim()).filter(Boolean);
      const carried = !!current;
      let opened = false;

      for (const row of rows) {
        if (isFurniture(row)) continue;

        const head = sectionType(row);
        if (head !== null) {
          push();
          type = head;
          inSection = !!head;
          ordinal = 0;
          continue;
        }
        if (!inSection) continue;

        // ลำดับต้องนับต่อกันจริง ๆ ไม่งั้นบรรทัดรายละเอียดที่ขึ้นต้นด้วยเลข
        // จะกลายเป็นชิ้นใหม่ และหัวข้อที่ขึ้นต้นด้วยเลขจะถูกตัดหัวทิ้ง
        const started = row.match(/^(\d{1,2})\s+(.+)$/);
        if (started && Number(started[1]) === ordinal + 1) {
          push();
          ordinal += 1;
          opened = true;
          current = {
            page,
            type,
            title: started[2].trim(),
            org: "",
            when: "",
            hours: "",
            level: "",
            result: "",
            link: "",
            detail: "",
          };
          continue;
        }
        if (!current) continue;

        const meta = parseMetaRow(row);
        if (meta) {
          current.level = meta.level;
          current.when = meta.when;
          current.hours = meta.hours;
          current.org = meta.org;
          continue;
        }

        const result = afterLabel(row, RESULT_LABELS, true);
        if (result !== null) {
          current.result = result;
          continue;
        }

        const link = afterLabel(row, [LINK_LABEL], true);
        if (link !== null) {
          current.link = link;
          continue;
        }

        current.detail = current.detail ? `${current.detail}\n${row}` : row;
      }

      if (!opened && !carried) {
        skipped.push({ page, why: "ไม่มีผลงานในหน้านี้ (หน้าประวัติ เอกสาร หรือเรียงความ)" });
      }
    }
    push();

    return { drafts, skipped };
  }

  root.PdfFolio = {
    SECTION_TYPES,
    RESULT_LABELS,
    bareOf,
    matchLevel,
    sectionType,
    parseMetaRow,
    looksLikeFolio,
    toDrafts,
  };
})(globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/pdfFolio.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pdfFolio.js test/pdfFolio.test.js
git commit -m "pdf import: read the TCASFolio export format directly

หมวด 4.1-4.5 map onto Model.FOLIO_SECTIONS in order, so the type, level,
หน่วยงาน, วันที่/ช่วงเวลา, ชั่วโมง, ผลรางวัล and ลิงก์ can all be read off
the page instead of guessed. Every keyword is compared with marks
stripped and canonical strings are returned, so the parser survives the
tone marks that pdf.js still drops."
```

---

### Task 4: `pdfText.js` — guess หน่วยงาน and วันที่ in free-form books

**Files:**
- Modify: `pdfText.js` — add `guessOrg`, `guessWhen`, extend `toDrafts`, extend the export block
- Modify: `test/pdfText.test.js` — append tests

**Interfaces:**
- Consumes: nothing beyond `pdfText.js` itself.
- Produces: `PdfText.guessOrg(text: string): string`, `PdfText.guessWhen(text: string): string`.
  `PdfText.toDrafts` drafts now also carry `org: string` and `when: string`.

Drafts from a Canva book have no structure to read, so these guess. Wrong guesses are
acceptable — every value lands in the review screen the user edits before saving. What is
**not** acceptable is overwriting something that was read directly, so both only fill a
blank field.

- [ ] **Step 1: Write the failing tests**

Append to `test/pdfText.test.js`:

```js
test("guessWhen หาวันที่จากข้อความอิสระ", () => {
  assert.equal(P.guessWhen("จัดวันที่ 24 พ.ค. 2569 ที่โรงเรียนสมมติ"), "24 พ.ค. 2569");
  assert.equal(
    P.guessWhen("ค่ายจัดระหว่าง 28 มิ.ย. 2568 - 2 พ.ย. 2568 รวมสี่เดือน"),
    "28 มิ.ย. 2568 - 2 พ.ย. 2568",
  );
  assert.equal(P.guessWhen("แข่งเมื่อ มกราคม-เมษายน 2569"), "มกราคม-เมษายน 2569");
  assert.equal(P.guessWhen("จัดเมื่อ 01/06/2568 ตอนเช้า"), "01/06/2568");
  assert.equal(P.guessWhen("ปีการศึกษา 2569 ที่ผ่านมา"), "2569");
  assert.equal(P.guessWhen("ไม่มีวันที่เลยสักตัว"), "");
});

test("guessOrg หยิบวลีที่ขึ้นต้นด้วยคำที่เป็นหน่วยงาน", () => {
  assert.equal(
    P.guessOrg("เข้าร่วมกิจกรรมที่ มหาวิทยาลัยสมมติ\nรายละเอียดอื่น ๆ"),
    "มหาวิทยาลัยสมมติ",
  );
  assert.equal(P.guessOrg("จัดโดยสำนักงานสมมติแห่งชาติ · อื่น ๆ"), "สำนักงานสมมติแห่งชาติ");
  assert.equal(P.guessOrg("ไม่มีชื่อหน่วยงานในข้อความนี้"), "");
});

test("guessOrg เลือกคำที่มาก่อนในข้อความ ไม่ใช่คำที่มาก่อนในตาราง", () => {
  // มหาวิทยาลัย อยู่ก่อน โรงเรียน ในข้อความ จึงต้องได้ตัวนั้น
  assert.equal(
    P.guessOrg("ร่วมกับ มหาวิทยาลัยสมมติ\nและ โรงเรียนสมมติ"),
    "มหาวิทยาลัยสมมติ",
  );
});

test("toDrafts เดาหน่วยงานและวันที่ให้ร่างจากเล่มอิสระ", () => {
  const detail =
    "เข้าร่วมค่ายที่ มหาวิทยาลัยสมมติ เมื่อ 24 พ.ค. 2569 ได้เรียนรู้การทำงานเป็นทีมและการแก้ปัญหา " +
    "ซึ่งเป็นประสบการณ์ที่ทำให้เห็นภาพการเรียนจริงชัดเจนขึ้นมาก และช่วยให้ตัดสินใจเลือกสาขาได้";
  const out = P.toDrafts([
    {
      page: 1,
      items: [
        { str: "ค่ายสมมติ", x: 10, y: 700, w: 60, h: 16 },
        { str: detail, x: 10, y: 600, w: 400, h: 14 },
      ],
    },
  ]);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].org, "มหาวิทยาลัยสมมติ");
  assert.equal(out.drafts[0].when, "24 พ.ค. 2569");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pdfText.test.js`
Expected: FAIL — `P.guessWhen is not a function`

- [ ] **Step 3: Add the two guessers to `pdfText.js`**

Insert next to `guessType` / `guessLevel`:

```js
  // เดือนไทย เต็มก่อนย่อ เพราะ alternation ใช้ตัวที่ตรงก่อน
  const MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  const MONTH = MONTHS.map((m) => m.replace(/\./g, "\\.")).join("|");

  // เรียงจากเจาะจงที่สุดไปกว้างที่สุด — ตัวแรกที่เจอคือคำตอบ
  // ไม่ดักคำว่า "วันที่:" ตรงนี้ เพราะในเล่มอิสระมันกินข้อความท้ายบรรทัดไปด้วย
  // (แฟ้มที่มีป้ายกำกับจริงเป็นหน้าที่ของ pdfFolio.js)
  const WHEN_PATTERNS = [
    new RegExp(`\\d{1,2}\\s*(?:${MONTH})\\s*\\d{4}\\s*[-–]\\s*\\d{1,2}\\s*(?:${MONTH})\\s*\\d{4}`),
    new RegExp(`(?:${MONTH})\\s*[-–]\\s*(?:${MONTH})\\s*\\d{4}`),
    new RegExp(`\\d{1,2}\\s*(?:${MONTH})\\s*\\d{4}`),
    new RegExp(`(?:${MONTH})\\s*\\d{4}`),
    /\d{1,2}\/\d{1,2}\/\d{4}/,
    /(?:พ\.?ศ\.?|ค\.?ศ\.?)\s*\d{4}/,
    /(?:25|20)\d{2}/,
  ];

  function guessWhen(text) {
    const src = String(text || "");
    for (const re of WHEN_PATTERNS) {
      const hit = src.match(re);
      if (hit) return hit[0].replace(/\s+/g, " ").trim();
    }
    return "";
  }

  // คำที่ขึ้นต้นชื่อหน่วยงาน ยาวก่อนสั้น (สำนักงาน ต้องมาก่อน สำนัก)
  const ORG_HEADS = [
    "กองบัญชาการ", "มหาวิทยาลัย", "กระทรวง", "วิทยาลัย", "สำนักงาน", "โรงพยาบาล",
    "โรงเรียน", "สถาบัน", "องค์กร", "สมาคม", "มูลนิธิ", "บริษัท", "ศูนย์",
    "สำนัก", "คณะ", "กรม", "กอง",
  ];

  function guessOrg(text) {
    const src = String(text || "");
    let at = -1;
    let head = "";
    for (const word of ORG_HEADS) {
      const found = src.indexOf(word);
      if (found === -1) continue;
      // เอาคำที่มาก่อนในข้อความ ถ้าตำแหน่งเท่ากันเอาคำที่ยาวกว่า
      if (at === -1 || found < at || (found === at && word.length > head.length)) {
        at = found;
        head = word;
      }
    }
    if (at === -1) return "";
    const rest = src.slice(at);
    const stop = rest.search(/[\n·]|\s{2,}/);
    const out = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    return out.length > 80 ? out.slice(0, 80).trim() : out;
  }
```

- [ ] **Step 4: Fill the blanks in `toDrafts`**

In `toDrafts`, extend the drafts mapping. Only fill what is empty — a value read
directly must never be overwritten by a guess:

```js
      drafts: drafts.map((d) => {
        const hay = `${d.title}\n${d.detail}`;
        return {
          ...d,
          type: guessType(hay),
          level: guessLevel(hay),
          org: d.org || guessOrg(hay),
          when: d.when || guessWhen(hay),
        };
      }),
```

- [ ] **Step 5: Export them**

Add `guessOrg` and `guessWhen` to the `root.PdfText = { ... }` block, next to `guessType` and `guessLevel`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verify by hand**

Open a Canva portfolio book in the import tab. Expected: หน่วยงาน and วัน/ช่วงเวลา are
pre-filled where the text contains them, blank where it does not, and no draft that
previously had a correct title lost it.

- [ ] **Step 8: Commit**

```bash
git add pdfText.js test/pdfText.test.js
git commit -m "pdf import: guess หน่วยงาน and วันที่ in free-form books

Canva books have no structure to read, so these are shape-based guesses
that only ever fill a blank field. The user edits them in the review
screen before anything reaches the vault."
```

---

### Task 5: `model.js` — the `when` and `link` fields

**Files:**
- Modify: `model.js` — `makeItem`, `normalize`, `filterItems`
- Modify: `test/model.test.js` — append tests

**Interfaces:**
- Consumes: nothing.
- Produces: `Item` becomes `{id, type, title, org, when, level, result, hours, link, detail, tags, createdAt}`. **That key order matters** — `normalize()` compares with `JSON.stringify`, so the order in `makeItem` and `normalize` must match exactly or every read reports `changed: true` and rewrites storage forever.

- [ ] **Step 1: Write the failing tests**

Append to `test/model.test.js`:

```js
test("makeItem เก็บวันและเวลา กับลิงก์ เป็นช่องของตัวเอง", () => {
  const item = M.makeItem({
    type: "รางวัล / เกียรติบัตร",
    title: "การแข่งขันสมมติ",
    org: "สมาคมสมมติ",
    when: "24 พ.ค. 2569",
    link: "https://example.invalid/",
    level: "ระดับชาติ",
  });
  assert.equal(item.when, "24 พ.ค. 2569");
  assert.equal(item.link, "https://example.invalid/");
  assert.equal(item.org, "สมาคมสมมติ");
});

test("normalize เติมช่องใหม่ให้ของเก่าที่ยังไม่มี แล้วบอกว่าต้องเขียนกลับ", () => {
  const old = [
    {
      id: "a1",
      type: "กิจกรรม",
      title: "กิจกรรมสมมติ",
      org: "โรงเรียนสมมติ",
      level: "",
      result: "",
      hours: "",
      detail: "",
      tags: [],
      createdAt: 1,
    },
  ];
  const out = M.normalize(old);
  assert.equal(out.items[0].when, "");
  assert.equal(out.items[0].link, "");
  assert.equal(out.changed, true, "ของเก่าต้องถูกเขียนกลับหนึ่งครั้ง");
});

test("normalize ที่ผ่านแล้วต้องนิ่ง ไม่เขียนกลับซ้ำ", () => {
  const once = M.normalize([]).items;
  assert.equal(M.normalize(once).changed, false);
  const made = [M.makeItem({ type: "กิจกรรม", title: "ก" }, { id: "x", now: 1 })];
  assert.equal(M.normalize(made).changed, false, "ลำดับ key ของ makeItem ต้องตรงกับ normalize");
});

test("filterItems ค้นเจอจากวันและเวลา และจากลิงก์", () => {
  const items = M.normalize([
    M.makeItem({ type: "กิจกรรม", title: "ก", when: "24 พ.ค. 2569" }, { id: "a", now: 1 }),
    M.makeItem({ type: "กิจกรรม", title: "ข", link: "https://pranakorn.example/" }, { id: "b", now: 1 }),
  ]).items;
  assert.deepEqual(M.filterItems(items, { q: "2569" }).map((i) => i.id), ["a"]);
  assert.deepEqual(M.filterItems(items, { q: "pranakorn" }).map((i) => i.id), ["b"]);
});

test("parseImport ยังอ่านไฟล์ backup เก่าที่ไม่มีช่องใหม่ได้", () => {
  const text = JSON.stringify({
    app: "doodee-future",
    version: 1,
    items: [{ id: "old1", type: "กิจกรรม", title: "ของเก่า", org: "โรงเรียนสมมติ", detail: "" }],
  });
  const { items } = M.parseImport(text);
  assert.equal(items.length, 1);
  assert.equal(items[0].when, "");
  assert.equal(items[0].link, "");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/model.test.js`
Expected: FAIL — `item.when` is `undefined`.

- [ ] **Step 3: Add the fields to `makeItem`**

In `model.js`, inside `makeItem`, insert `when` after `org` and `link` after `hours`:

```js
      org: str(fields.org),
      when: str(fields.when),
      level: LEVELS.includes(str(fields.level)) ? str(fields.level) : "",
      result: str(fields.result),
      hours: str(fields.hours),
      link: str(fields.link),
      detail: str(fields.detail),
```

- [ ] **Step 4: Add the fields to `normalize` in the same order**

In `model.js`, inside `normalize`'s `.map(...)`:

```js
        org: str(entry.org),
        when: str(entry.when),
        // ระดับที่ไม่ตรงตัวเลือกของเว็บ ปล่อยว่างดีกว่าเก็บค่าที่เติมไม่ได้
        level: LEVELS.includes(str(entry.level)) ? str(entry.level) : "",
        result: str(entry.result),
        hours: str(entry.hours),
        link: str(entry.link),
        detail: str(entry.detail),
```

- [ ] **Step 5: Let search see the new fields**

In `model.js`, inside `filterItems`, extend the haystack:

```js
      const hay = [entry.title, entry.org, entry.when, entry.result, entry.link, entry.detail, entry.tags.join(" ")]
        .join(" ")
        .toLowerCase();
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. If `normalize ที่ผ่านแล้วต้องนิ่ง` fails, the key order in `makeItem` and `normalize` disagree — fix the order, do not touch the test.

- [ ] **Step 7: Commit**

```bash
git add model.js test/model.test.js
git commit -m "model: give วันและเวลา and ลิงก์ their own fields

Dates lived in three contradicting places: a combined หน่วยงาน / ปี box,
splitOrg() guessing at a ·, and siteImport prepending วันที่ to detail.
Additive, so old vaults and old backup files still load; EXPORT_VERSION
stays 1."
```

---

### Task 6: popup — separate boxes for หน่วยงาน, วันและเวลา and ลิงก์

**Files:**
- Modify: `popup.html:16-17` (the `org` label and input)
- Modify: `popup.js:62-73` (`readForm`), `popup.js:134` (the clear list), `popup.js:173-181` (`startEditing`)

**Interfaces:**
- Consumes: `Model.makeItem` accepting `when` and `link` (Task 5).
- Produces: nothing other modules read.

- [ ] **Step 1: Replace the combined field in `popup.html`**

Replace the two lines for the `org` field:

```html
    <label for="org">หน่วยงาน</label>
    <input id="org" type="text" placeholder="เช่น สำนักงานการวิจัยแห่งชาติ (วช.)" />

    <label for="when">วัน / ช่วงเวลา</label>
    <input id="when" type="text" placeholder="เช่น 24 พ.ค. 2569 หรือ 1 มี.ค. 2569 - ปัจจุบัน" />
```

Then, immediately after the `hours` field block, add:

```html
    <label for="link">ลิงก์ผลงาน</label>
    <input id="link" type="text" placeholder="เช่น https://example.com/" />
```

- [ ] **Step 2: Read the new fields in `popup.js`**

In `readForm`:

```js
function readForm() {
  return {
    type: el("type").value,
    title: el("title").value,
    org: el("org").value,
    when: el("when").value,
    level: el("level").value,
    result: el("result").value,
    hours: el("hours").value,
    link: el("link").value,
    tags: el("tags").value,
    detail: el("detail").value,
  };
}
```

- [ ] **Step 3: Clear the new fields when the form resets**

At `popup.js:134`:

```js
  for (const id of ["title", "org", "when", "result", "hours", "link", "tags", "detail"]) el(id).value = "";
```

- [ ] **Step 4: Fill the new fields when editing**

In `startEditing`, after the `org` line:

```js
  el("org").value = item.org;
  el("when").value = item.when || "";
  el("level").value = item.level || "";
  el("result").value = item.result || "";
  el("hours").value = item.hours || "";
  el("link").value = item.link || "";
```

- [ ] **Step 5: Verify by hand**

Load the unpacked extension, open the popup, add an item filling in หน่วยงาน, วัน/ช่วงเวลา and ลิงก์, save, then press edit on it.
Expected: all three come back populated, and the item list still renders.

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.js
git commit -m "popup: split หน่วยงาน / ปี into หน่วยงาน and วัน/ช่วงเวลา, add ลิงก์"
```

---

### Task 7: `content.js` — fill the site's date and link fields

**Files:**
- Modify: `content.js:279-295` (`FIELD_HINTS`), `content.js:388-398` (`buildPlan`), `content.js:501-504` (`KIND_TH`)

**Interfaces:**
- Consumes: `item.when` and `item.link` (Task 5).
- Produces: nothing other modules read.

- [ ] **Step 1: Teach `FIELD_HINTS` about links**

In `content.js`, add a `link` entry to `FIELD_HINTS`, after the `result` entry and before `hours`:

```js
    ["link", ["ลิงก์", "ลิงค์", "ลิ้งก์", "url", "เว็บไซต์", "link"]],
```

- [ ] **Step 2: Prefer the real field, keep the old fallback**

In `buildPlan`, replace the `values` block:

```js
    const parted = splitOrg(item.org);
    const values = {
      title: item.title,
      // ของเก่าที่บันทึกก่อนมีช่อง when ยังเก็บเป็น "หน่วยงาน · ปี" อยู่
      // จึงถอยไปใช้ splitOrg เฉพาะตอน when ว่างเท่านั้น
      org: item.when ? item.org : parted.org,
      detail: item.detail,
      year: item.when || parted.when,
      level: item.level || "",
      result: item.result || "",
      hours: item.hours || "",
      link: item.link || "",
    };
```

- [ ] **Step 3: Give the new kind a Thai label**

In `content.js`, extend `KIND_TH`:

```js
  const KIND_TH = {
    title: "ชื่อ", org: "หน่วยงาน", detail: "รายละเอียด", year: "ปี",
    level: "ระดับ", result: "ผลรางวัล", hours: "ชั่วโมง", link: "ลิงก์",
  };
```

- [ ] **Step 4: Verify by hand**

On `https://student.mytcas.com/`, open a work block's edit panel, then use the panel's fill button on an item that has both `when` and `link`.
Expected: หน่วยงาน and ช่วงเวลา land in separate fields, the link lands in the link field, and the confirmation note lists them by their Thai labels. Confirm an older item (org stored as `"ชื่อ · 2569"`, `when` empty) still splits correctly.

- [ ] **Step 5: Commit**

```bash
git add content.js
git commit -m "autofill: use the when and link fields, keep splitOrg for old entries"
```

---

### Task 8: `siteImport.js`, `analysis.js` and the contract doc

**Files:**
- Modify: `siteImport.js:52-58` (`withDate`), `siteImport.js:65-76` (`fromAchievement`), `siteImport.js:78-96` (`fromActivity`)
- Modify: `analysis.js:15-25` (`itemToText`)
- Modify: `docs/web-api-contract.md:71`, `docs/web-api-contract.md:194-195`
- Modify: `test/siteImport.test.js` — append a test

**Interfaces:**
- Consumes: the `when` field (Task 5).
- Produces: rows from the site now carry `when` instead of a `วันที่ …` line glued to the front of `detail`.

- [ ] **Step 1: Write the failing test**

Append to `test/siteImport.test.js`:

```js
test("วันที่จากเว็บลงช่อง when ไม่ใช่หัว detail", () => {
  const out = S.toItems({
    profile: {},
    achievements: [
      { id: "1", title: "รางวัลสมมติ", organization: "สมาคมสมมติ", description: "เนื้อหา", date_achieved: "2026-05-24" },
    ],
    activities: [
      {
        id: "2",
        activity_name: "กิจกรรมสมมติ",
        organization: "โรงเรียนสมมติ",
        description: "เนื้อหา",
        start_date: "2025-06-09",
        end_date: "2025-12-31",
      },
    ],
  });
  const award = out.find((i) => i.title === "รางวัลสมมติ");
  assert.equal(award.when, "2026/05/24");
  assert.equal(award.detail, "เนื้อหา", "detail ต้องไม่มีบรรทัดวันที่ปนแล้ว");

  const activity = out.find((i) => i.title === "กิจกรรมสมมติ");
  assert.equal(activity.when, "2025/06/09 - 2025/12/31");
  assert.equal(activity.detail, "เนื้อหา");
});
```

If `S.toItems` is not the exported name in `test/siteImport.test.js`, use whatever that file already uses — read its header first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/siteImport.test.js`
Expected: FAIL — `when` is `undefined` and `detail` starts with `วันที่ …`.

- [ ] **Step 3: Turn `withDate` into a `when` formatter**

In `siteImport.js`, replace `withDate` with:

```js
  // ส่วนขยายมีช่อง when แล้ว (2026-09-15) — เลิกเอาวันที่ไปแปะหัว detail
  function whenOf(from, to) {
    const one = (value) => (value ? String(value).slice(0, 10).replace(/-/g, "/") : "");
    const start = one(from);
    const end = one(to);
    return start && end && start !== end ? `${start} - ${end}` : start || end;
  }
```

- [ ] **Step 4: Use it in both row mappers**

In `fromAchievement`:

```js
  function fromAchievement(row) {
    return {
      id: `ach-${text(row.id) || text(row.title)}`,
      type: TYPE_BY_ACHIEVEMENT[text(row.achievement_type)] || "รางวัล / เกียรติบัตร",
      title: text(row.title),
      org: text(row.organization),
      when: whenOf(row.date_achieved, null),
      level: LEVEL_BY_CODE[text(row.achievement_level)] || "",
      result: "",
      hours: "",
      link: "",
      detail: text(row.description),
      tags: tagList(row.skills_gained),
      createdAt: epoch(row.created_at),
    };
  }
```

In `fromActivity`, replace the `detail` computation and add the two fields:

```js
  function fromActivity(row) {
    return {
      id: `act-${text(row.id) || text(row.activity_name)}`,
      type: TYPE_BY_ACTIVITY[text(row.activity_type)] || "กิจกรรม",
      title: text(row.activity_name),
      org: text(row.organization),
      when: whenOf(row.start_date, row.end_date),
      level: "",
      result: text(row.role),
      hours: row.hours_committed == null ? "" : String(row.hours_committed),
      link: "",
      detail: [text(row.description), text(row.impact_description)].filter(Boolean).join("\n"),
      tags: [],
      createdAt: epoch(row.created_at),
    };
  }
```

Any other `fromX` mapper in the file gets `when: ""` and `link: ""` added the same way, so every row shape matches the model.

- [ ] **Step 5: Let the analyser see the new fields**

In `analysis.js`, in `itemToText`:

```js
    const meta = [
      line("หน่วยงาน", item.org),
      line("ช่วงเวลา", item.when),
      line("ระดับ", item.level),
      line("ผลงาน", item.result),
      line("ชั่วโมง", item.hours),
      line("ลิงก์", item.link),
    ].filter(Boolean);
```

- [ ] **Step 6: Correct the contract doc**

In `docs/web-api-contract.md`, replace the note at line 71 that says there is no `startDate`/`endDate` field with:

```markdown
ช่อง `when` เก็บวันและเวลาเป็นข้อความตามที่เขียนในเล่ม (เช่น `24 พ.ค. 2569`,
`1 มี.ค. 2569 - ปัจจุบัน`) ไม่แปลงเป็นวันที่จริง เพราะต้นฉบับมีทั้งช่วงคร่าว ๆ
และคำว่า "ปัจจุบัน" — ฝั่งเว็บส่ง `date_achieved` หรือ `start_date`/`end_date` มาได้ตามเดิม
```

And at lines 194-195, replace the bullet about dates going into `detail` with:

```markdown
- `date_achieved` / `start_date`-`end_date` -> ช่อง `when` (ไม่แปะหัว `detail` แล้ว)
- `role` -> ช่องผลงาน · `hours_committed` -> ชั่วโมง (เป็น string) · `skills_gained` -> แท็ก
```

Also add `when` and `link` to the field table around line 106.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add siteImport.js analysis.js docs/web-api-contract.md test/siteImport.test.js
git commit -m "site import: put dates in the when field instead of detail

The analyser now sees ช่วงเวลา and ลิงก์ too."
```

---

### Task 9: `import.js` — wire the folio path and show the new fields

**Files:**
- Modify: `import.html` — add the three new script tags
- Modify: `import.js:125-136` (the drafts mapping), `import.js:220-260` (`draftCard`), `import.js:300-330` (`save`)

**Interfaces:**
- Consumes: `PdfGlyphs.normalizeItems/countPua` (Task 1), `PdfText.buildRows/toDrafts` (Task 2), `PdfFolio.looksLikeFolio/toDrafts` (Task 3), `Model.makeItem` with `when`/`link` (Task 5).
- Produces: nothing other modules read.

- [ ] **Step 1: Load the new modules**

In `import.html`, before `<script src="pdfText.js"></script>`:

```html
    <script src="pdfGlyphs.js"></script>
```

and after it:

```html
    <script src="pdfFolio.js"></script>
```

- [ ] **Step 2: Choose the parser after reading the pages**

In `import.js`, replace the block that builds `drafts` from `PdfText.toDrafts(pages)`:

```js
  // แฟ้มที่ TCASFolio ส่งออกมีโครงชัดเจน อ่านตรง ๆ ได้ทุกช่อง
  // เล่มที่ทำเอง(Canva ฯลฯ) ไม่มีโครง ต้องเดาเอาเหมือนเดิม
  const rowPages = pages.map((p) => ({
    page: p.page,
    rows: PdfText.buildRows(PdfGlyphs.normalizeItems(p.items)).map((r) => r.text),
  }));
  const isFolio = PdfFolio.looksLikeFolio(rowPages);
  const result = isFolio ? PdfFolio.toDrafts(rowPages) : PdfText.toDrafts(pages);

  drafts = result.drafts.map((d, i) => ({
    org: "",
    when: "",
    hours: "",
    result: "",
    link: "",
    ...d,
    id: `draft-${i}`,
    chosen: true,
    pickedImages: new Set(),
  }));

  // ตัวอักษรที่ถอดไม่ออกต้องบอกผู้ใช้ ไม่ใช่ปล่อยให้ไปเจอเองในคลัง
  puaLeft = rowPages.reduce(
    (n, p) => n + p.rows.reduce((m, row) => m + PdfGlyphs.countPua(row), 0),
    0,
  );

  renderReview(result.skipped, doc.numPages, isFolio);
  show("review");
```

Declare `let puaLeft = 0;` next to the other module-level `let` declarations.

- [ ] **Step 3: Report the format and any unreadable characters**

In `renderReview`, change the signature to `function renderReview(skipped, pageCount, isFolio)` and extend the lead line:

```js
  const shots = [...imagesByPage.values()].reduce((n, list) => n + list.length, 0);
  const kind = isFolio ? "แฟ้มจาก TCASFolio" : "เล่มพอร์ต";
  const warn = puaLeft ? ` · อ่านบางตัวอักษรไม่ออก ${puaLeft} ตัว ลองตรวจดูก่อนบันทึก` : "";
  el("reviewLead").textContent =
    `จาก${kind} ${pageCount} หน้า ได้ร่าง ${drafts.length} ชิ้น และรูป ${shots} ใบ · ` +
    `ติ๊กเลือกและแก้ให้ถูกก่อนบันทึก${warn}`;
```

- [ ] **Step 4: Show the new fields on the review card**

In `draftCard`, replace the `org` input block and the `grid.append(...)` call:

```js
  const org = document.createElement("input");
  org.type = "text";
  org.value = draft.org || "";
  org.placeholder = "เช่น สำนักงานการวิจัยแห่งชาติ (วช.)";
  org.addEventListener("input", () => {
    draft.org = org.value;
  });

  const when = document.createElement("input");
  when.type = "text";
  when.value = draft.when || "";
  when.placeholder = "เช่น 24 พ.ค. 2569";
  when.addEventListener("input", () => {
    draft.when = when.value;
  });

  const resultField = document.createElement("input");
  resultField.type = "text";
  resultField.value = draft.result || "";
  resultField.placeholder = "เช่น เหรียญทอง, เข้าร่วม";
  resultField.addEventListener("input", () => {
    draft.result = resultField.value;
  });

  const hours = document.createElement("input");
  hours.type = "text";
  hours.value = draft.hours || "";
  hours.placeholder = "เช่น 48";
  hours.addEventListener("input", () => {
    draft.hours = hours.value;
  });

  const link = document.createElement("input");
  link.type = "text";
  link.value = draft.link || "";
  link.placeholder = "เช่น https://example.com/";
  link.addEventListener("input", () => {
    draft.link = link.value;
  });
```

then:

```js
  grid.append(
    field("หัวข้อ", title, true),
    field("หมวด", type),
    field("ระดับ", level),
    field("หน่วยงาน", org, true),
    field("วัน / ช่วงเวลา", when),
    field("ชั่วโมง", hours),
    field("ผลรางวัล / สถานะ", resultField, true),
    field("ลิงก์ผลงาน", link, true),
    field("รายละเอียด", detail, true),
  );
```

- [ ] **Step 5: Save the new fields**

In `save`, extend the `Model.makeItem` call:

```js
    const made = chosen.map((d) =>
      Model.makeItem({
        type: d.type,
        title: d.title,
        org: d.org,
        when: d.when,
        level: d.level,
        result: d.result,
        hours: d.hours,
        link: d.link,
        detail: d.detail,
      }),
    );
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — nothing here is covered by `node --test`, so this only confirms no module was broken.

- [ ] **Step 7: Verify by hand against the real file**

Load the unpacked extension, open the PDF import tab, and choose
`~/Downloads/TU_<application-no>_<national-id>.pdf`.

Expected:
- the lead line says **แฟ้มจาก TCASFolio**
- **16 drafts**, with real titles (`I-NEW GEN AWARD 2026 …`, `SIIT Insight camp 2`, `Doodee Future`) and **not** `ผลการอบรม : Completed`
- หน่วยงาน, วัน/ช่วงเวลา, ผลรางวัล populated; `SIIT Insight camp 2` shows `48` ชั่วโมง and no date; `Doodee Future` shows a date and no หน่วยงาน; `Pranakorn Corporation Co., Ltd.` shows a ลิงก์
- Thai reads correctly: `ผลงานนวัตกรรม PDlite ด้านสุขภาพและการแพทย์ ได้รับการคัดเลือกจาก…`

Then open a Canva portfolio book and confirm it still produces the same drafts it did before this plan started.

**Do not put this file, or anything read out of it, into the repo.**

- [ ] **Step 8: Commit**

```bash
git add import.html import.js
git commit -m "pdf import: read TCASFolio exports and show the new fields

Picks the folio parser when หมวด 4.x headings are present and the
free-form parser otherwise. The review card gains หน่วยงาน, วัน/ช่วงเวลา,
ชั่วโมง, ผลรางวัล and ลิงก์ — until now it showed one combined org box the
parser never filled, and hardcoded result to an empty string."
```

---

### Task 10: `pdfActualText.js` — the last 2.5% (gated, optional)

**Do not start this task until Tasks 1-9 are merged and the hand check in Task 8 passes.** Everything below is worth doing only if Step 1 says it is. The spec's §4 explains why this is separable: after the PUA table, every keyword the parser matches on is already correct, so this only improves body text.

**Files:**
- Create: `pdfActualText.js`
- Create: `test/pdfActualText.test.js`
- Modify: `pdfGlyphs.js` (add `applyActualText`), `import.js`, `import.html`

**Interfaces:**
- Consumes: raw PDF bytes and `page.ref` from pdf.js.
- Produces: `globalThis.PdfActualText` with `spansFromPage(bytes: Uint8Array, ref: {num: number, gen: number}): Promise<string[]>`, and `PdfGlyphs.applyActualText(items, spans): Item[]`.

- [ ] **Step 1: Measure whether the two streams line up at all — GO / NO-GO**

Write a throwaway script in the scratchpad (not the repo) that, for every page of the reference file, counts:
- `beginMarkedContentProps` entries with `tag === "Span"` from `page.getTextContent({includeMarkedContent: true})`
- `/Span\s*<<\s*/ActualText\s*<([0-9A-Fa-f]+)>` matches in the inflated `/Contents` stream

Run it and compare the two counts per page.

**If they differ on any page, STOP.** Report the numbers, delete the script, and close this task as not-done — the system stays at 97.5%, which is a fine place to stop. Do not try to force an alignment heuristic; a mismatched substitution puts wrong words into a live university application.

Only if every page matches, continue.

- [ ] **Step 2: Write the failing tests**

Create `test/pdfActualText.test.js`:

```js
"use strict";

require("../pdfGlyphs.js");
require("../pdfActualText.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const A = globalThis.PdfActualText;
const G = globalThis.PdfGlyphs;

test("decodeHex อ่าน UTF-16BE พร้อม BOM", () => {
  assert.equal(A.decodeHex("FEFF0E1F0E49"), "ฟ้");
  assert.equal(A.decodeHex("0E1F0E49"), "ฟ้");
});

test("applyActualText แทนข้อความของกลุ่มที่อยู่ในช่วง Span", () => {
  const items = [
    { str: "แ", x: 0, y: 700, w: 4 },
    { type: "beginMarkedContentProps", tag: "Span" },
    { str: "ฟ", x: 4, y: 700, w: 5 },
    { str: "", x: 9, y: 700, w: 0 },
    { type: "endMarkedContent" },
    { str: "มสะสม", x: 9, y: 700, w: 20 },
  ];
  const out = G.applyActualText(items, ["ฟ้"]);
  assert.deepEqual(out.filter((i) => typeof i.str === "string").map((i) => i.str), ["แ", "ฟ้", "มสะสม"]);
});

test("applyActualText ทิ้งทั้งหน้าถ้าจำนวน Span ไม่ตรงกัน", () => {
  const items = [
    { str: "ก", x: 0, y: 700, w: 5 },
    { type: "beginMarkedContentProps", tag: "Span" },
    { str: "ข", x: 5, y: 700, w: 5 },
    { type: "endMarkedContent" },
  ];
  // มี Span หนึ่งช่วง แต่ได้ข้อความมาสองก้อน = จับคู่ไม่ได้ ห้ามเดา
  const out = G.applyActualText(items, ["ค", "ง"]);
  assert.deepEqual(out.filter((i) => typeof i.str === "string").map((i) => i.str), ["ก", "ข"]);
});

test("applyActualText ไม่มี span มาเลย = คืนของเดิม", () => {
  const items = [{ str: "ก", x: 0, y: 700, w: 5 }];
  assert.deepEqual(G.applyActualText(items, []), items);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/pdfActualText.test.js`
Expected: FAIL — `Cannot find module '../pdfActualText.js'`

- [ ] **Step 4: Write `pdfActualText.js`**

```js
// กู้ข้อความที่ Chrome ซ่อนไว้ใน /Span<</ActualText>> — ตรรกะล้วน ห้ามมี chrome.* ห้ามมี DOM
// pdf.js อ่านค่านี้เฉพาะจาก structure tree ไฟล์ของ Chrome ไม่ได้ใช้ทางนั้น
// จึงต้องเปิด content stream อ่านเอง
//
// ทุกเส้นทางที่ไม่แน่ใจ ให้คืน [] แล้วปล่อยให้ผลจาก pdfGlyphs ยืนไป
// ข้อความที่ผิดแย่กว่าวรรณยุกต์ที่หาย
(function (root) {
  "use strict";

  const SPAN = /\/Span\s*<<\s*\/ActualText\s*<([0-9A-Fa-f]+)>/g;

  function decodeHex(hex) {
    const clean = String(hex || "").replace(/[^0-9A-Fa-f]/g, "");
    let out = "";
    for (let i = 0; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (code === 0xfeff) continue; // BOM
      out += String.fromCharCode(code);
    }
    return out;
  }

  const bytesToLatin1 = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  };

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function spansFromPage(bytes, ref) {
    try {
      const raw = bytesToLatin1(bytes);
      const obj = new RegExp(`(?:^|[^0-9])${ref.num}\\s+${ref.gen}\\s+obj([\\s\\S]*?)endobj`).exec(raw);
      if (!obj) return [];
      const contents = /\/Contents\s+(\d+)\s+(\d+)\s+R/.exec(obj[1]);
      if (!contents) return []; // อาเรย์หลายสตรีม หรืออยู่ใน object stream — ไม่เดา
      const body = new RegExp(
        `(?:^|[^0-9])${contents[1]}\\s+${contents[2]}\\s+obj([\\s\\S]*?)endobj`,
      ).exec(raw);
      if (!body || !/\/FlateDecode/.test(body[1])) return [];
      const at = body[1].indexOf("stream");
      const end = body[1].lastIndexOf("endstream");
      if (at === -1 || end === -1) return [];
      const start = body[1][at + 6] === "\r" ? at + 8 : at + 7;
      const slice = body[1].slice(start, end);
      const packed = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i += 1) packed[i] = slice.charCodeAt(i) & 0xff;
      const text = bytesToLatin1(await inflate(packed));
      const out = [];
      SPAN.lastIndex = 0;
      let hit;
      while ((hit = SPAN.exec(text))) out.push(decodeHex(hit[1]));
      return out;
    } catch (error) {
      return []; // ไฟล์ใส่รหัส คลายไม่ออก อะไรก็ตาม — ถอยไปใช้ผลของ pdfGlyphs
    }
  }

  root.PdfActualText = { decodeHex, spansFromPage };
})(globalThis);
```

- [ ] **Step 5: Add `applyActualText` to `pdfGlyphs.js`**

```js
  // จับคู่ Span ที่ N จาก pdf.js กับข้อความที่ N จาก content stream
  // จำนวนไม่ตรง = จับคู่ไม่ได้ ทิ้งทั้งหน้า ห้ามเดาทีละคู่
  function applyActualText(items, spans) {
    const list = items || [];
    const texts = spans || [];
    if (!texts.length) return list;

    let seen = 0;
    for (const item of list) {
      if (item && item.type === "beginMarkedContentProps" && item.tag === "Span") seen += 1;
    }
    if (seen !== texts.length) return list;

    const out = [];
    let depth = 0;
    let index = -1;
    let group = null;
    for (const item of list) {
      if (item && item.type === "beginMarkedContentProps" && item.tag === "Span") {
        depth += 1;
        if (depth === 1) {
          index += 1;
          group = null;
        }
        continue;
      }
      if (item && item.type === "endMarkedContent") {
        if (depth > 0) depth -= 1;
        if (depth === 0) group = null;
        continue;
      }
      if (!item || typeof item.str !== "string") continue;
      if (depth > 0) {
        if (!group) {
          group = { ...item, str: texts[index] };
          out.push(group);
        }
        continue; // ชิ้นที่เหลือในช่วงถูกแทนด้วย ActualText ไปแล้ว
      }
      out.push({ ...item });
    }
    return out;
  }
```

Export it from `root.PdfGlyphs`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/pdfActualText.test.js test/pdfGlyphs.test.js`
Expected: PASS.

- [ ] **Step 7: Wire it into `import.js`**

Keep the file bytes from `file.arrayBuffer()` in a variable, request marked content, and apply the spans before normalising:

```js
      const page = await doc.getPage(n);
      const text = await page.getTextContent({ includeMarkedContent: true });
      const spans = await PdfActualText.spansFromPage(new Uint8Array(buffer), page.ref);
      const raw = (text.items || []).map((it) =>
        typeof it.str === "string"
          ? {
              str: it.str,
              x: it.transform ? it.transform[4] : 0,
              y: it.transform ? it.transform[5] : 0,
              w: Number(it.width) || 0,
              h: Number(it.height) || 0,
            }
          : it,
      );
      const items = PdfGlyphs.applyActualText(raw, spans).filter((i) => typeof i.str === "string");
```

Add `<script src="pdfActualText.js"></script>` to `import.html`.

- [ ] **Step 8: Verify by hand and measure**

Re-run the Task 8 hand check. Expected: the drafts read the same as before but with the remaining tone marks restored — `เป็นทีมอย่างเป็นระบบ` rather than `เป นทีมอย่างเป นระบบ`.

Compare against `pdftotext -layout` on the same file. Expected: combining marks at or near 100%, up from 86.9%.

- [ ] **Step 9: Commit**

```bash
git add pdfActualText.js pdfGlyphs.js import.js import.html test/pdfActualText.test.js
git commit -m "pdf import: recover the tone marks hidden in /ActualText

pdf.js reads ActualText only from the structure tree, which Chrome's
output does not use, so the content stream is read directly. Span counts
must match exactly or the whole page falls back to the PUA result —
wrong text is worse than a missing tone mark."
```

---

## Notes for whoever executes this

- **Tasks 1-5 are the spine.** Tasks 6-8 are independent of each other once Task 5 lands and can be done in any order. Task 4 only needs Task 2.
- **Task 10 may end at its first step.** Closing it as not-done is a real outcome, not a failure.
- The measured reference file lives at `~/Downloads/TU_<application-no>_<national-id>.pdf` and contains personal data. Use it to verify; never copy anything out of it into the repo.
