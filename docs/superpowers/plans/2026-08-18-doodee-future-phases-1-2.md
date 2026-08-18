# Doodee future — Phases 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the half-built Doodee future popup into a complete local portfolio vault (add/edit/tag/copy/delete/export/import) plus a read-only floating panel on TCASFolio that serves that vault while the user fills in the real application.

**Architecture:** Pure logic lives in `model.js` (no `chrome.*`, tested under `node --test`). `storage.js` is a thin `chrome.storage.local` adapter over it. Two independent UIs consume both: `popup.js` (the editor) and `content.js` (a read-only Shadow DOM panel injected on `student.mytcas.com`). Both re-render off `chrome.storage.onChanged`, so they stay in sync.

**Tech Stack:** Chrome MV3, vanilla JS as classic (non-module) scripts sharing `globalThis`, no build step, no dependencies. `node --test` for the model.

**Spec:** [`docs/superpowers/specs/2026-08-18-doodee-future-design.md`](../specs/2026-08-18-doodee-future-design.md), which layers on the product spec [`doodee-future-guide.md`](../../../doodee-future-guide.md). Read both.

## Global Constraints

- **No network access anywhere.** No `fetch`, no `XMLHttpRequest`, no remote fonts/scripts/images. Data is personal (ID numbers, grades, verified scores) and stays on the machine. A reviewer rejecting a task for any outbound request is correct.
- **Never write to the TCASFolio page.** Phases 1+2 read the DOM only to append one host element. No form filling, no touching verified fields.
- **Permissions stay minimal:** `permissions: ["storage"]` and one content script matched to `https://student.mytcas.com/*`. No `host_permissions`, no `tabs`, no `downloads`.
- **All item mutations key off `id`, never array index.**
- **Never assign untrusted text via `innerHTML`.** Use `textContent` / `replaceChildren` throughout.
- **UI copy is Thai.** Match the tone already in `popup.html`.
- **Font stack, everywhere:** `"Mali", "Noto Sans Thai", system-ui, sans-serif`. Both fonts are installed locally; nothing is bundled or fetched.
- **Item type strings, verbatim** (they must match data already in storage): `รางวัล / เกียรติบัตร`, `โครงงาน / วิจัย`, `กิจกรรม`, `การอบรม`, `ผลงานสร้างสรรค์`.
- **Storage keys:** `folioItems` (array), `panelCollapsed` (boolean).
- Node is v26.7.0; `node --test` and global `crypto.randomUUID()` are available without flags.

---

### Task 1: `model.js` — pure logic and its tests

**Files:**
- Create: `model.js`
- Create: `test/model.test.js`
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `globalThis.Model` with `TYPES: string[]`, `EXPORT_VERSION: number`, `newId(): string`, `normalizeTags(value: string|string[]|undefined): string[]`, `formatTags(tags: string[]): string`, `makeItem(fields: {type,title,org,detail,tags}, options?: {id?: string, now?: number}): Item`, `normalize(raw: unknown): {items: Item[], changed: boolean}`, `upsert(items: Item[], item: Item): Item[]`, `remove(items: Item[], id: string): Item[]`, `filterItems(items: Item[], criteria?: {type?: string, tag?: string}): Item[]`, `allTags(items: Item[]): string[]`, `toExport(items: Item[], now?: number): object`, `parseImport(text: string): Item[]` (throws `Error` with a Thai message), `mergeImport(current: Item[], incoming: Item[]): {items: Item[], added: number, updated: number}`.
- `Item` is `{id: string, type: string, title: string, org: string, detail: string, tags: string[], createdAt: number}` — that key order matters, see Step 3.

- [ ] **Step 1: Write the failing tests**

Create `test/model.test.js`:

```js
"use strict";

require("../model.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const M = globalThis.Model;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("normalize assigns ids to legacy items and reports changed", () => {
  // ชิ้นนี้คือรูปแบบที่ popup.js เดิมเขียนลง storage — ไม่มี id ไม่มี createdAt
  const legacy = [
    { type: "กิจกรรม", title: "ค่ายวิทย์", org: "สพฐ. 2568", detail: "รายละเอียด" },
  ];
  const { items, changed } = M.normalize(legacy);

  assert.equal(changed, true);
  assert.equal(items.length, 1);
  assert.match(items[0].id, UUID);
  assert.equal(items[0].title, "ค่ายวิทย์");
  assert.equal(items[0].createdAt, 0);
  assert.deepEqual(items[0].tags, []);
});

test("normalize is idempotent once items carry ids", () => {
  const first = M.normalize([{ type: "กิจกรรม", title: "ก" }]).items;
  const second = M.normalize(first);

  assert.equal(second.changed, false, "a second read must not rewrite storage");
  assert.deepEqual(second.items, first);
});

test("normalize drops junk entries and fills missing fields", () => {
  const { items } = M.normalize([null, "x", 5, { title: "ok" }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "ok");
  assert.equal(items[0].org, "");
  assert.equal(items[0].detail, "");
});

test("normalize survives a missing or non-array stored value", () => {
  assert.deepEqual(M.normalize(undefined).items, []);
  assert.deepEqual(M.normalize(null).items, []);
  assert.deepEqual(M.normalize({ nope: true }).items, []);
});

test("tags are trimmed, de-duplicated, and parseable from a comma string", () => {
  assert.deepEqual(M.normalizeTags(" วิศวะ , คอม ,, วิศวะ "), ["วิศวะ", "คอม"]);
  assert.deepEqual(M.normalizeTags(["a", "a", " b "]), ["a", "b"]);
  assert.deepEqual(M.normalizeTags(undefined), []);
  assert.equal(M.formatTags([" a ", "b", "a"]), "a, b");
});

test("upsert appends new items and replaces by id without mutating input", () => {
  const a = M.makeItem({ title: "A" }, { id: "1", now: 1 });
  const b = M.makeItem({ title: "B" }, { id: "2", now: 2 });
  const list = M.upsert([a], b);
  assert.deepEqual(list.map((i) => i.id), ["1", "2"]);

  const edited = M.makeItem({ title: "A2" }, { id: "1", now: 1 });
  const next = M.upsert(list, edited);
  assert.equal(next.length, 2, "editing must not append a duplicate");
  assert.equal(next[0].title, "A2");
  assert.equal(list[0].title, "A", "input array must not be mutated");
});

test("remove deletes the item with that id, not a positional guess", () => {
  const items = ["1", "2", "3"].map((id) =>
    M.makeItem({ title: id }, { id, now: 0 }),
  );

  assert.deepEqual(M.remove(items, "2").map((i) => i.id), ["1", "3"]);
  assert.deepEqual(M.remove(items, "nope").map((i) => i.id), ["1", "2", "3"]);
  assert.equal(items.length, 3, "input array must not be mutated");
});

test("filterItems narrows by type, by tag, and by both", () => {
  const items = [
    M.makeItem({ type: "กิจกรรม", title: "A", tags: ["คอม"] }, { id: "1", now: 0 }),
    M.makeItem({ type: "กิจกรรม", title: "B", tags: ["วิศวะ"] }, { id: "2", now: 0 }),
    M.makeItem({ type: "การอบรม", title: "C", tags: ["คอม"] }, { id: "3", now: 0 }),
  ];

  assert.deepEqual(M.filterItems(items, { type: "กิจกรรม" }).map((i) => i.id), ["1", "2"]);
  assert.deepEqual(M.filterItems(items, { tag: "คอม" }).map((i) => i.id), ["1", "3"]);
  assert.deepEqual(
    M.filterItems(items, { type: "กิจกรรม", tag: "คอม" }).map((i) => i.id),
    ["1"],
  );
  assert.equal(M.filterItems(items, {}).length, 3);
  assert.equal(M.filterItems(items).length, 3);
});

test("allTags returns each tag once, sorted", () => {
  const items = [
    M.makeItem({ tags: ["b", "a"] }, { id: "1", now: 0 }),
    M.makeItem({ tags: ["a", "c"] }, { id: "2", now: 0 }),
  ];

  assert.deepEqual(M.allTags(items), ["a", "b", "c"]);
});

test("export wraps items with app, version, and timestamp", () => {
  const items = [M.makeItem({ title: "A" }, { id: "1", now: 5 })];

  assert.deepEqual(M.toExport(items, 42), {
    app: "doodee-future",
    version: 1,
    exportedAt: 42,
    items,
  });
});

test("parseImport accepts our wrapper and a bare array", () => {
  const items = [M.makeItem({ title: "A" }, { id: "1", now: 5 })];

  assert.deepEqual(M.parseImport(JSON.stringify(M.toExport(items, 42))), items);
  assert.deepEqual(M.parseImport(JSON.stringify(items)), items);
});

test("parseImport rejects broken files with a readable Thai message", () => {
  assert.throws(() => M.parseImport("not json"), /JSON/);
  assert.throws(() => M.parseImport('{"app":"doodee-future"}'), /ไม่พบรายการ/);
});

test("mergeImport upserts and never drops entries missing from the backup", () => {
  const mine = ["1", "2"].map((id) =>
    M.makeItem({ title: "mine " + id }, { id, now: 0 }),
  );
  const backup = [
    M.makeItem({ title: "backup 1" }, { id: "1", now: 0 }),
    M.makeItem({ title: "backup 3" }, { id: "3", now: 0 }),
  ];

  const { items, added, updated } = M.mergeImport(mine, backup);

  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.deepEqual(items.map((i) => i.id), ["1", "2", "3"]);
  assert.equal(items[0].title, "backup 1", "the backup wins for ids it carries");
  assert.equal(items[1].title, "mine 2", "an entry absent from the backup survives");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/*.test.js`
Expected: FAIL — `Cannot find module '../model.js'`.

- [ ] **Step 3: Write `model.js`**

```js
// ---------------------------------------------------------
// ตรรกะล้วน ๆ ห้ามมี chrome.* ในไฟล์นี้
// เพื่อให้ทดสอบด้วย `node --test` ได้ตรง ๆ
// อะไรที่แตะ storage ให้ไปอยู่ storage.js
// ---------------------------------------------------------
(function (root) {
  "use strict";

  const TYPES = [
    "รางวัล / เกียรติบัตร",
    "โครงงาน / วิจัย",
    "กิจกรรม",
    "การอบรม",
    "ผลงานสร้างสรรค์",
  ];

  const EXPORT_VERSION = 1;

  function str(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function newId() {
    return crypto.randomUUID();
  }

  // "วิศวะ, คอม ,, วิศวะ" -> ["วิศวะ", "คอม"]
  function normalizeTags(value) {
    const raw = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    const out = [];
    for (const entry of raw) {
      const tag = str(entry);
      if (tag && !out.includes(tag)) out.push(tag);
    }
    return out;
  }

  function formatTags(tags) {
    return normalizeTags(tags).join(", ");
  }

  function makeItem(fields, options) {
    const opts = options || {};
    return {
      id: str(opts.id) || newId(),
      type: str(fields.type),
      title: str(fields.title),
      org: str(fields.org),
      detail: str(fields.detail),
      tags: normalizeTags(fields.tags),
      createdAt: Number.isFinite(opts.now) ? opts.now : Date.now(),
    };
  }

  // ทุกครั้งที่อ่านจาก storage ต้องผ่านตรงนี้
  // ของเก่าที่บันทึกไว้ก่อนมี id จะได้ id ที่นี่
  // `changed` บอก storage.js ว่าต้องเขียนกลับไหม
  function normalize(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const items = list
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: str(entry.id) || newId(),
        type: str(entry.type),
        title: str(entry.title),
        org: str(entry.org),
        detail: str(entry.detail),
        tags: normalizeTags(entry.tags),
        createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      }));
    // เทียบทั้งก้อน รวมลำดับ key ด้วย — ของที่ normalize แล้วจะได้ false เสมอ
    return { items, changed: JSON.stringify(items) !== JSON.stringify(list) };
  }

  function upsert(items, item) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) return items.concat([item]);
    const next = items.slice();
    next[index] = item;
    return next;
  }

  function remove(items, id) {
    return items.filter((entry) => entry.id !== id);
  }

  function filterItems(items, criteria) {
    const type = (criteria && criteria.type) || "";
    const tag = (criteria && criteria.tag) || "";
    return items.filter(
      (entry) =>
        (!type || entry.type === type) && (!tag || entry.tags.includes(tag)),
    );
  }

  function allTags(items) {
    const out = [];
    for (const entry of items) {
      for (const tag of entry.tags) if (!out.includes(tag)) out.push(tag);
    }
    return out.sort();
  }

  function toExport(items, now) {
    return {
      app: "doodee-future",
      version: EXPORT_VERSION,
      exportedAt: Number.isFinite(now) ? now : Date.now(),
      items,
    };
  }

  // รับได้ทั้งไฟล์ที่เราส่งออกเอง และ array เปล่า ๆ ที่แก้มือมา
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("ไฟล์ไม่ใช่ JSON ที่ถูกต้อง");
    }
    const raw = Array.isArray(data)
      ? data
      : data && Array.isArray(data.items)
        ? data.items
        : null;
    if (!raw) throw new Error("ไม่พบรายการผลงานในไฟล์นี้");
    return normalize(raw).items;
  }

  // upsert เท่านั้น ห้ามแทนที่ทั้งก้อน
  // ไม่งั้นการ import ไฟล์เก่าจะลบของใหม่ทิ้ง — backup จะกลายเป็นตัวทำข้อมูลหาย
  function mergeImport(current, incoming) {
    let items = current;
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      if (items.some((entry) => entry.id === item.id)) updated += 1;
      else added += 1;
      items = upsert(items, item);
    }
    return { items, added, updated };
  }

  root.Model = {
    TYPES,
    EXPORT_VERSION,
    newId,
    normalizeTags,
    formatTags,
    makeItem,
    normalize,
    upsert,
    remove,
    filterItems,
    allTags,
    toExport,
    parseImport,
    mergeImport,
  };
})(globalThis);
```

- [ ] **Step 4: Add `package.json` and `.gitignore`**

`package.json` — this exists only so `npm test` works; the extension itself needs no dependencies and there must never be a `dependencies` block.

```json
{
  "name": "doodee-future",
  "version": "1.0.0",
  "private": true,
  "description": "Chrome extension: portfolio vault for filling in TCASFolio",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

`.gitignore`:

```
node_modules/
*.zip
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — `ℹ pass 13`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add model.js test/model.test.js package.json .gitignore
git commit -m "feat: add pure model layer with id migration, merge-import, and tests"
```

---

### Task 2: `storage.js`

**Files:**
- Create: `storage.js`

**Interfaces:**
- Consumes: `globalThis.Model` from Task 1 — `normalize`.
- Produces: `globalThis.Storage` with `ITEMS_KEY: "folioItems"`, `PANEL_KEY: "panelCollapsed"`, `getItems(): Promise<Item[]>`, `setItems(items: Item[]): Promise<void>`, `onItemsChanged(callback: (items: Item[]) => void): void`, `getPanelCollapsed(): Promise<boolean>`, `setPanelCollapsed(collapsed: boolean): Promise<void>`.

- [ ] **Step 1: Write `storage.js`**

There is no unit test for this file — that is the point of the split. It must stay thin enough that reading it is sufficient verification. If logic accumulates here, move it to `model.js` and test it there.

```js
// ---------------------------------------------------------
// ตัวต่อกับ chrome.storage.local เท่านั้น
// ตรรกะทั้งหมดอยู่ใน model.js — ไฟล์นี้ต้องบางพอที่จะไม่มีอะไรให้เทสต์
// ข้อมูลไม่ออกจากเครื่อง: ห้ามมี network call ในไฟล์นี้เด็ดขาด
// ---------------------------------------------------------
(function (root) {
  "use strict";

  const ITEMS_KEY = "folioItems";
  const PANEL_KEY = "panelCollapsed";

  async function getItems() {
    const data = await chrome.storage.local.get(ITEMS_KEY);
    const { items, changed } = root.Model.normalize(data[ITEMS_KEY]);
    // ย้ายข้อมูลรุ่นเก่าที่ยังไม่มี id — เกิดครั้งเดียวแล้วจบ
    if (changed) await chrome.storage.local.set({ [ITEMS_KEY]: items });
    return items;
  }

  async function setItems(items) {
    await chrome.storage.local.set({ [ITEMS_KEY]: items });
  }

  // popup กับ panel เปิดพร้อมกันได้ แก้ที่หนึ่งอีกที่ต้องอัปเดตตาม
  function onItemsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[ITEMS_KEY]) return;
      callback(root.Model.normalize(changes[ITEMS_KEY].newValue).items);
    });
  }

  async function getPanelCollapsed() {
    const data = await chrome.storage.local.get(PANEL_KEY);
    return data[PANEL_KEY] === true;
  }

  async function setPanelCollapsed(collapsed) {
    await chrome.storage.local.set({ [PANEL_KEY]: collapsed === true });
  }

  root.Storage = {
    ITEMS_KEY,
    PANEL_KEY,
    getItems,
    setItems,
    onItemsChanged,
    getPanelCollapsed,
    setPanelCollapsed,
  };
})(globalThis);
```

- [ ] **Step 2: Verify it parses and stayed thin**

Run: `node --check storage.js && echo "syntax ok" && grep -cE "fetch\(|XMLHttpRequest|https?://" storage.js`
Expected: `syntax ok` followed by `0` — no network APIs, no URLs.

The manifest is deliberately left alone in this task. Declaring the content
script before `content.js` exists makes Chrome refuse to load the extension
entirely, which would block the hands-on checks in Tasks 3 and 4. Task 5
adds the content-script wiring at the same time as the files it names.

- [ ] **Step 3: Commit**

```bash
git add storage.js
git commit -m "feat: add chrome.storage adapter over the model"
```

---

### Task 3: Popup — markup, styles, and id-based editing

**Files:**
- Modify: `popup.html` (whole file — the `<style>` block moves out)
- Create: `popup.css`
- Modify: `popup.js` (whole file)

**Interfaces:**
- Consumes: `Model.TYPES`, `Model.makeItem`, `Model.upsert`, `Model.remove`, `Model.formatTags`; `Storage.getItems`, `Storage.setItems`, `Storage.onItemsChanged`.
- Produces: nothing other tasks consume. Task 4 appends to the same `popup.js` and reuses its `el()`, `showStatus()`, and `render()` helpers, whose signatures are fixed here: `el(id: string): HTMLElement`, `showStatus(message: string, isError?: boolean): void`, `render(known?: Item[]): Promise<void>`.

- [ ] **Step 1: Replace `popup.html`**

The element ids for Task 4 (`exportBtn`, `importBtn`, `importFile`) are included here so Task 4 only touches `popup.js`.

```html
<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <h1 id="formHeading">เพิ่มผลงานจากเล่มเดิม</h1>

    <label for="type">ประเภท</label>
    <select id="type"></select>

    <label for="title">ชื่อผลงาน</label>
    <input id="title" type="text" />

    <label for="org">หน่วยงาน / ปี</label>
    <input id="org" type="text" placeholder="เช่น สพฐ. 2568" />

    <label for="tags">แท็ก (คั่นด้วยจุลภาค)</label>
    <input id="tags" type="text" placeholder="เช่น วิศวะ, คอม" />

    <label for="detail">รายละเอียด</label>
    <textarea id="detail"></textarea>

    <button id="saveBtn">บันทึกลงคลัง</button>
    <button id="cancelBtn" class="ghost" hidden>ยกเลิกการแก้ไข</button>

    <hr />

    <div class="row">
      <button id="exportBtn" class="ghost">ส่งออก JSON</button>
      <button id="importBtn" class="ghost">นำเข้า JSON</button>
    </div>
    <input id="importFile" type="file" accept="application/json,.json" hidden />
    <p id="status" role="status"></p>

    <hr />

    <h1>คลังผลงาน (<span id="count">0</span>)</h1>
    <div id="list"></div>
    <div id="empty">ยังไม่มีข้อมูล</div>

    <script src="model.js"></script>
    <script src="storage.js"></script>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `popup.css`**

Carried over from the old inline `<style>`, with the font stack switched to Mali and additions for tags, the status line, and the ghost buttons.

```css
:root {
  --bg: #14161a;
  --panel: #1d2027;
  --line: #2b2f38;
  --text: #e9eaee;
  --dim: #878d9b;
  --accent: #5b8cff;
  --danger: #ff7b7b;
  --ok: #7bd88f;
}

* { box-sizing: border-box; }

body {
  width: 360px;
  margin: 0;
  padding: 14px;
  background: var(--bg);
  color: var(--text);
  font-family: "Mali", "Noto Sans Thai", system-ui, sans-serif;
  font-size: 14px;
}

h1 {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
  margin: 0 0 12px;
}

label {
  display: block;
  font-size: 12px;
  color: var(--dim);
  margin: 8px 0 3px;
}

input, select, textarea {
  width: 100%;
  padding: 7px 9px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

textarea { min-height: 70px; resize: vertical; }

button {
  font-family: inherit;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

#saveBtn {
  width: 100%;
  margin-top: 12px;
  padding: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
}

.ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text);
  padding: 7px;
  font-size: 12px;
}

#cancelBtn { width: 100%; margin-top: 6px; }

.row { display: flex; gap: 6px; }
.row .ghost { flex: 1; }

#status { min-height: 16px; margin: 8px 0 0; font-size: 12px; }
#status.ok { color: var(--ok); }
#status.error { color: var(--danger); }

hr { border: none; border-top: 1px solid var(--line); margin: 16px 0; }

.item {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}

.item-title { font-weight: 600; margin-bottom: 2px; word-break: break-word; }
.item-meta { font-size: 12px; color: var(--dim); margin-bottom: 8px; }

.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tag {
  font-size: 11px;
  color: var(--dim);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 8px;
}

.item-actions { display: flex; gap: 6px; }
.item-actions button {
  flex: 1;
  padding: 6px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text);
}
/* ปุ่มคัดลอกข้อความยาวกว่าเพื่อน ให้กว้างกว่าหน่อย */
.item-actions .copy { flex: 2; }
.item-actions .del { color: var(--danger); }

#empty { color: var(--dim); font-size: 13px; text-align: center; padding: 16px 0; }
```

- [ ] **Step 3: Replace `popup.js`**

Two things to note. First, delete is a two-step arm-then-confirm on the button itself rather than `confirm()` — a modal dialog raised from an extension popup can dismiss the popup out from under you. Second, editing preserves the original `createdAt`.

```js
// ---------------------------------------------------------
// ข้อมูลทั้งหมดเก็บอยู่ในเครื่องเราเท่านั้น (chrome.storage.local)
// ไม่มีการส่งออกไปที่ไหนทั้งสิ้น
// ---------------------------------------------------------

const el = (id) => document.getElementById(id);

let editingId = null; // null = กำลังเพิ่มใหม่, มีค่า = กำลังแก้ไขชิ้นนั้น
let statusTimer = null;

function showStatus(message, isError) {
  const status = el("status");
  status.textContent = message;
  status.className = isError ? "error" : "ok";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = "";
  }, 4000);
}

function fillTypeOptions() {
  const select = el("type");
  for (const type of Model.TYPES) {
    const option = document.createElement("option");
    option.textContent = type;
    select.appendChild(option);
  }
}

function readForm() {
  return {
    type: el("type").value,
    title: el("title").value,
    org: el("org").value,
    tags: el("tags").value,
    detail: el("detail").value,
  };
}

function resetForm() {
  editingId = null;
  el("type").selectedIndex = 0;
  for (const id of ["title", "org", "tags", "detail"]) el(id).value = "";
  el("formHeading").textContent = "เพิ่มผลงานจากเล่มเดิม";
  el("saveBtn").textContent = "บันทึกลงคลัง";
  el("cancelBtn").hidden = true;
}

function startEditing(item) {
  editingId = item.id;
  el("type").value = item.type;
  el("title").value = item.title;
  el("org").value = item.org;
  el("tags").value = Model.formatTags(item.tags);
  el("detail").value = item.detail;
  el("formHeading").textContent = "แก้ไขผลงาน";
  el("saveBtn").textContent = "อัปเดต";
  el("cancelBtn").hidden = false;
  window.scrollTo(0, 0);
  el("title").focus();
}

function itemCard(item) {
  const box = document.createElement("div");
  box.className = "item";

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = item.title;

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = item.org ? `${item.type} · ${item.org}` : item.type;

  box.append(title, meta);

  if (item.tags.length) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const tag of item.tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      tags.appendChild(chip);
    }
    box.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy";
  copyBtn.textContent = "คัดลอกรายละเอียด";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(item.detail);
      copyBtn.textContent = "คัดลอกแล้ว ✓";
    } catch (error) {
      copyBtn.textContent = "คัดลอกไม่สำเร็จ";
    }
    setTimeout(() => {
      copyBtn.textContent = "คัดลอกรายละเอียด";
    }, 1200);
  });

  const editBtn = document.createElement("button");
  editBtn.className = "edit";
  editBtn.textContent = "แก้ไข";
  editBtn.addEventListener("click", () => startEditing(item));

  const delBtn = document.createElement("button");
  delBtn.className = "del";
  delBtn.textContent = "ลบ";
  let armed = false;
  let armTimer = null;
  delBtn.addEventListener("click", async () => {
    if (!armed) {
      // ยืนยันสองจังหวะแทน confirm() เพราะ dialog ทำให้ popup ปิดตัวเอง
      armed = true;
      delBtn.textContent = "แน่ใจ?";
      armTimer = setTimeout(() => {
        armed = false;
        delBtn.textContent = "ลบ";
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    // ลบด้วย id ไม่ใช่ตำแหน่งในลิสต์ — ตำแหน่งเปลี่ยนได้ระหว่างที่ popup เปิดอยู่
    const current = await Storage.getItems();
    await Storage.setItems(Model.remove(current, item.id));
    if (editingId === item.id) resetForm();
    showStatus("ลบแล้ว");
    render();
  });

  actions.append(copyBtn, editBtn, delBtn);
  box.appendChild(actions);
  return box;
}

async function render(known) {
  const items = known || (await Storage.getItems());
  el("count").textContent = items.length;
  el("empty").style.display = items.length ? "none" : "block";
  el("list").replaceChildren(...items.map(itemCard));
}

el("saveBtn").addEventListener("click", async () => {
  const fields = readForm();
  if (!fields.title.trim()) {
    showStatus("ต้องมีชื่อผลงานก่อนถึงจะบันทึกได้", true);
    el("title").focus();
    return;
  }

  const items = await Storage.getItems();
  const existing = editingId ? items.find((i) => i.id === editingId) : null;
  const item = Model.makeItem(fields, {
    id: editingId || undefined,
    // แก้ไขแล้ววันที่สร้างต้องไม่เปลี่ยน
    now: existing ? existing.createdAt : Date.now(),
  });

  await Storage.setItems(Model.upsert(items, item));
  showStatus(editingId ? "อัปเดตแล้ว" : "บันทึกแล้ว");
  resetForm();
  render();
});

el("cancelBtn").addEventListener("click", () => resetForm());

fillTypeOptions();
// อีกหน้าต่างหนึ่งแก้ข้อมูล หน้านี้ต้องตามทัน
Storage.onItemsChanged((items) => render(items));
render();
```

- [ ] **Step 4: Verify the model tests still pass**

Run: `npm test`
Expected: PASS — Task 3 touches no model code, so this is a regression check.

- [ ] **Step 5: Load the extension and verify by hand**

In Chrome: `chrome://extensions` → Developer mode on → Load unpacked → select this folder. It should load with no error badge. Open the popup and confirm:
- The type dropdown lists all five types.
- Saving with an empty title shows the red "ต้องมีชื่อผลงานก่อน…" message and saves nothing.
- Saving a full item clears the form and the item appears with its tag chips.
- "แก้ไข" loads the item into the form, the heading reads "แก้ไขผลงาน", and "อัปเดต" edits in place rather than creating a second copy.
- "ลบ" requires two clicks, and reverts to "ลบ" if left alone for 3 seconds.
- Any item saved before this change still shows up (id migration), and deleting the *middle* item of three removes the right one.

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: popup gains tags, in-place editing, and id-based deletion"
```

---

### Task 4: Popup — JSON export and import

**Files:**
- Modify: `popup.js` (append handlers before the `fillTypeOptions()` init block at the bottom)

**Interfaces:**
- Consumes: `Model.toExport`, `Model.parseImport`, `Model.mergeImport`; `Storage.getItems`, `Storage.setItems`; and `el()`, `showStatus()`, `render()` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Add the export handler**

Insert immediately after the `cancelBtn` listener in `popup.js`:

```js
el("exportBtn").addEventListener("click", async () => {
  const items = await Storage.getItems();
  const text = JSON.stringify(Model.toExport(items, Date.now()), null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `doodee-future-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  // ปล่อยทิ้งหลังดาวน์โหลดเริ่มแล้ว
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showStatus(`ส่งออก ${items.length} รายการแล้ว`);
});
```

- [ ] **Step 2: Add the import handlers**

Insert directly below the export handler:

```js
el("importBtn").addEventListener("click", () => el("importFile").click());

el("importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const incoming = Model.parseImport(await file.text());
    const current = await Storage.getItems();
    // รวมแบบ upsert — ของที่มีอยู่แล้วแต่ไม่มีในไฟล์ backup ต้องไม่หาย
    const { items, added, updated } = Model.mergeImport(current, incoming);
    await Storage.setItems(items);
    showStatus(`นำเข้าแล้ว: เพิ่ม ${added} · อัปเดต ${updated}`);
    render();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    event.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้
  }
});
```

- [ ] **Step 3: Verify the round-trip by hand**

Reload the extension at `chrome://extensions`, then:
1. With several items saved, click "ส่งออก JSON" — a `doodee-future-YYYY-MM-DD.json` file downloads and the status reads the item count.
2. Open the file: it has `app`, `version`, `exportedAt`, and an `items` array whose entries carry `id`, `tags`, and `createdAt`. Thai text is intact, not escaped into mojibake.
3. Delete one item in the popup, then import the file back. Status reads `เพิ่ม 1 · อัปเดต N`, and the deleted item returns.
4. Add a *new* item that is not in the file, import the file again, and confirm the new item **survives** — this is the whole point of merging rather than replacing.
5. Import a text file containing `hello` — the status shows "ไฟล์ไม่ใช่ JSON ที่ถูกต้อง" in red and nothing changes.
6. Import the same file twice in a row — the second attempt must still work (the `value = ""` reset).

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: add JSON export and merge-on-import backup"
```

---

### Task 5: Content script — the TCASFolio side panel

**Files:**
- Create: `content.js`
- Create: `content.css`
- Modify: `manifest.json` (whole file)

**Interfaces:**
- Consumes: `Model.TYPES`, `Model.filterItems`, `Model.allTags`; `Storage.getItems`, `Storage.onItemsChanged`, `Storage.getPanelCollapsed`, `Storage.setPanelCollapsed`. Both globals are already loaded — the manifest lists `model.js` and `storage.js` ahead of `content.js` in the same content-script entry, so they share one isolated world.
- Produces: nothing.

Read-only by design. The panel copies to the clipboard and never writes to the page, per the guide's rules 1 and 3.

- [ ] **Step 1: Replace `manifest.json`**

This lands here, not earlier, because Chrome refuses to load an extension
whose manifest names a content-script file that does not exist. Create
`content.js` and `content.css` in the next two steps before reloading.

Note what is *absent*: no `host_permissions` — the `content_scripts.matches`
entry already grants everything the panel needs, so the guide's target
manifest lists one line more than it has to. And `content.css` is a
web-accessible resource rather than a `content_scripts.css` entry, because it
is linked into a shadow root rather than injected into the page.

```json
{
  "manifest_version": 3,
  "name": "Doodee future",
  "version": "1.0",
  "description": "คลังเก็บข้อมูลผลงานจากเล่ม portfolio เดิม สำหรับกรอก TCASFolio",
  "permissions": ["storage"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Doodee future"
  },
  "content_scripts": [
    {
      "matches": ["https://student.mytcas.com/*"],
      "js": ["model.js", "storage.js", "content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["content.css"],
      "matches": ["https://student.mytcas.com/*"]
    }
  ]
}
```

- [ ] **Step 2: Create `content.css`**

These styles are linked into the shadow root, not the page. `all: initial` on `:host` is the load-bearing line: inherited properties (`font-family`, `color`, `line-height`) cross the shadow boundary from the page, and this resets them before ours are applied.

```css
:host {
  all: initial;
  display: block;
  position: fixed;
  top: 88px;
  right: 0;
  z-index: 2147483647;
  font-family: "Mali", "Noto Sans Thai", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #e9eaee;
}

.panel {
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: 70vh;
  background: #14161a;
  border: 1px solid #2b2f38;
  border-right: none;
  border-radius: 8px 0 0 8px;
  box-shadow: -4px 0 18px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.panel.is-collapsed { width: auto; }
.panel.is-collapsed .heading { display: none; }

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #1d2027;
  border-bottom: 1px solid #2b2f38;
}

.heading { flex: 1; font-size: 12px; color: #878d9b; white-space: nowrap; }

.toggle {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #2b2f38;
  border-radius: 4px;
  color: #e9eaee;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.body { padding: 10px; overflow-y: auto; }

.type-filter {
  width: 100%;
  padding: 6px 8px;
  background: #1d2027;
  border: 1px solid #2b2f38;
  border-radius: 5px;
  color: #e9eaee;
  font: inherit;
}

.tagbar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }

.chip {
  padding: 2px 9px;
  background: transparent;
  border: 1px solid #2b2f38;
  border-radius: 999px;
  color: #878d9b;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.chip.is-active { border-color: #5b8cff; color: #5b8cff; }

.list { margin-top: 10px; }

.item {
  padding: 9px;
  margin-bottom: 7px;
  background: #1d2027;
  border: 1px solid #2b2f38;
  border-radius: 6px;
}

.item-title { font-weight: 600; word-break: break-word; }
.item-meta { margin: 2px 0 7px; color: #878d9b; font-size: 11px; }

.copy {
  width: 100%;
  padding: 5px;
  background: transparent;
  border: 1px solid #2b2f38;
  border-radius: 5px;
  color: #e9eaee;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.empty { padding: 14px 0; color: #878d9b; font-size: 12px; text-align: center; }
```

- [ ] **Step 3: Create `content.js`**

```js
// ---------------------------------------------------------
// แถบด้านข้างบนหน้า TCASFolio — อ่านอย่างเดียว
// ไม่แตะฟอร์มจริง ไม่แตะข้อมูลที่ verified มีแต่ปุ่มคัดลอกให้เท่านั้น
// ---------------------------------------------------------
(function () {
  "use strict";

  const HOST_ID = "doodee-future-panel";

  // กันฉีดซ้ำ ถ้า script ถูกโหลดสองรอบ
  // ไม่ต้องใช้ MutationObserver: panel เป็น position:fixed ผูกกับ documentElement
  // ไม่ได้พึ่ง DOM ของหน้าเว็บเลย จึงไม่มีอะไรต้องรอ
  if (document.getElementById(HOST_ID)) return;

  let items = [];
  let activeType = "";
  let activeTag = "";
  let collapsed = false;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  // shadow root กัน css ของหน้าเว็บไม่ให้รั่วเข้ามา และกันของเราไม่ให้รั่วออกไป
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = chrome.runtime.getURL("content.css");

  const root = document.createElement("div");
  root.className = "panel";
  root.hidden = true; // เปิดหลัง css โหลดเสร็จ กันภาพแวบตอนยังไม่มีสไตล์
  const reveal = () => {
    root.hidden = false;
  };
  sheet.addEventListener("load", reveal);
  sheet.addEventListener("error", reveal); // css โหลดไม่ได้ ก็ยังต้องใช้งานได้

  const header = document.createElement("div");
  header.className = "header";

  const heading = document.createElement("span");
  heading.className = "heading";
  heading.textContent = "คลังผลงาน";

  const toggle = document.createElement("button");
  toggle.className = "toggle";
  toggle.addEventListener("click", async () => {
    collapsed = !collapsed;
    applyCollapsed();
    await Storage.setPanelCollapsed(collapsed);
  });

  header.append(heading, toggle);

  const body = document.createElement("div");
  body.className = "body";

  const typeSelect = document.createElement("select");
  typeSelect.className = "type-filter";
  const anyType = document.createElement("option");
  anyType.value = "";
  anyType.textContent = "ทุกประเภท";
  typeSelect.appendChild(anyType);
  for (const type of Model.TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeSelect.appendChild(option);
  }
  typeSelect.addEventListener("change", () => {
    activeType = typeSelect.value;
    renderList();
  });

  const tagBar = document.createElement("div");
  tagBar.className = "tagbar";

  const list = document.createElement("div");
  list.className = "list";

  body.append(typeSelect, tagBar, list);
  root.append(header, body);
  shadow.append(sheet, root);

  function applyCollapsed() {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.title = collapsed ? "ขยาย" : "ย่อ";
    root.classList.toggle("is-collapsed", collapsed);
  }

  function renderTagBar() {
    const tags = Model.allTags(items);
    tagBar.hidden = tags.length === 0;
    tagBar.replaceChildren(
      ...["", ...tags].map((tag) => {
        const chip = document.createElement("button");
        chip.className = "chip" + (activeTag === tag ? " is-active" : "");
        chip.textContent = tag || "ทั้งหมด";
        chip.addEventListener("click", () => {
          activeTag = tag;
          renderTagBar();
          renderList();
        });
        return chip;
      }),
    );
  }

  function card(item) {
    const box = document.createElement("div");
    box.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = item.org ? `${item.type} · ${item.org}` : item.type;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy";
    copyBtn.textContent = "คัดลอกรายละเอียด";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.detail);
        copyBtn.textContent = "คัดลอกแล้ว ✓";
      } catch (error) {
        copyBtn.textContent = "คัดลอกไม่สำเร็จ";
      }
      setTimeout(() => {
        copyBtn.textContent = "คัดลอกรายละเอียด";
      }, 1200);
    });

    box.append(title, meta, copyBtn);
    return box;
  }

  function renderList() {
    const shown = Model.filterItems(items, { type: activeType, tag: activeTag });
    heading.textContent = `คลังผลงาน (${shown.length}/${items.length})`;

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = items.length
        ? "ไม่มีรายการที่ตรงตัวกรอง"
        : "ยังไม่มีข้อมูล — เพิ่มได้จากไอคอนส่วนขยาย";
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(...shown.map(card));
  }

  function refresh(next) {
    items = next;
    // แท็กที่เลือกไว้อาจถูกลบไปแล้วจากอีกหน้าต่างหนึ่ง — ถ้าไม่มีแล้วให้เลิกกรอง
    if (activeTag && !Model.allTags(items).includes(activeTag)) activeTag = "";
    renderTagBar();
    renderList();
  }

  // ต่อกับ documentElement ไม่ใช่ body เผื่อ body มี transform
  // ซึ่งจะกลายเป็น containing block แล้วทำให้ position:fixed เพี้ยน
  document.documentElement.appendChild(host);

  Storage.onItemsChanged(refresh);

  (async () => {
    collapsed = await Storage.getPanelCollapsed();
    applyCollapsed();
    refresh(await Storage.getItems());
  })();
})();
```

- [ ] **Step 4: Verify the extension loads with no errors**

Run: `node -e "for (const f of require('./manifest.json').content_scripts[0].js.concat(['content.css','popup.js','popup.css','popup.html'])) require('node:fs').accessSync(f); console.log('all declared files present')"`
Expected: `all declared files present`

Then reload at `chrome://extensions` and confirm the card shows no "Errors" badge.

- [ ] **Step 5: Verify the panel by hand**

Log in to `https://student.mytcas.com/` and confirm:
- The panel appears at the right edge, styled — dark background, rounded left corners, its own font. If it renders with the site's fonts or spacing, the shadow root is not doing its job.
- The header count reads `(N/N)`.
- Choosing a type in the dropdown narrows the list and the count changes to `(shown/total)`.
- Tag chips appear only when items carry tags; clicking one filters, and "ทั้งหมด" clears it.
- Copy puts the full `detail` on the clipboard — paste it into a real TCASFolio textarea to confirm Thai text arrives intact.
- The collapse arrow hides the body, and the state survives a page reload.
- **Reload the page five times.** There must be exactly one `#doodee-future-panel` in the DOM each time — check with `document.querySelectorAll('#doodee-future-panel').length` in the console.
- Navigate between TCASFolio pages (it is a SPA) and confirm the panel persists and is not duplicated.
- Nothing in the application form is modified, and no verified field is touched.

- [ ] **Step 6: Commit**

```bash
git add content.js content.css manifest.json
git commit -m "feat: add read-only shadow-dom panel on TCASFolio"
```

---

### Task 6: Full verification pass

**Files:**
- Modify: `doodee-future-guide.md` (append a status section)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the automated tests**

Run: `npm test`
Expected: PASS — `ℹ pass 13`, `ℹ fail 0`. Paste the actual output into the commit or the report; do not claim a pass without it.

- [ ] **Step 2: Confirm the no-network rule holds**

Run: `grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?://" --include=*.js --include=*.html --include=*.css --include=*.json . --exclude-dir=.git --exclude-dir=docs --exclude-dir=node_modules`
Expected: the only matches are `https://student.mytcas.com/*` in `manifest.json`. Any other URL or any network API is a rule-2 violation and must be removed.

- [ ] **Step 3: Work through the guide's manual checklist**

From `doodee-future-guide.md`:
- Close and reopen Chrome entirely — saved items are still there.
- Save an item with a long mixed Thai/English `detail` (several paragraphs). It renders correctly in both popup and panel, and copies out intact.
- Reload TCASFolio several times — the panel injects exactly once each time.
- Export → remove the extension's storage (`chrome://extensions` → Doodee future → service worker console → `chrome.storage.local.clear()`) → reopen the popup (it should be empty) → import the file. All items return with their tags.

- [ ] **Step 4: Record the state in the guide**

Append to `doodee-future-guide.md`:

```markdown
---

## สถานะ (2026-08-18)

- **เฟส 1 — เสร็จแล้ว** เพิ่ม / แก้ไข / ลบ / แท็ก / คัดลอก / export / import JSON
- **เฟส 2 — เสร็จแล้ว** panel บน `student.mytcas.com` กรองตามประเภทและแท็ก คัดลอกทีละชิ้น ย่อ/ขยายได้และจำสถานะ
- **เฟส 3 — ยังไม่ทำ** ต้องเปิดหน้าจริงเพื่อหา selector ก่อน

ไฟล์ที่เพิ่มจากคู่มือเดิม: `model.js` (ตรรกะล้วน เทสต์ด้วย `npm test`) แยกจาก
`storage.js` (ตัวต่อกับ chrome.storage) เหตุผลและสิ่งที่ต่างจากคู่มือนี้อยู่ใน
`docs/superpowers/specs/2026-08-18-doodee-future-design.md`

ตอนแพ็กเป็น .zip ให้ตัด `test/`, `package.json`, `docs/`, `.git/` ออก
```

- [ ] **Step 5: Commit**

```bash
git add doodee-future-guide.md
git commit -m "docs: record phase 1+2 completion and packaging note"
```

---

## Notes for whoever executes this

- **The five type strings are data, not copy.** Changing their wording orphans items already in storage. If they ever must change, that is a migration in `Model.normalize`, not an edit to `Model.TYPES`.
- **`model.js` must never import `chrome`.** The moment it does, `npm test` breaks and the test suite is gone. If a change seems to need `chrome` in the model, the logic belongs in `storage.js` or the split is in the wrong place.
- **`storage.js` must never grow logic.** It has no tests by design.
- **Never `innerHTML` an item field.** `title`, `org`, `detail`, and `tags` are user text rendered into a page that also holds a live application form.
