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

test("mergeImport re-ids entries that share an id inside one file", () => {
  // copy-paste ทั้งบล็อกในไฟล์ backup คือวิธีโคลนผลงานด้วยมือที่คนทำกันจริง
  // ถ้า upsert ทับกันเองจะเหลือชิ้นเดียว แปลว่าตั้งใจเพิ่มแล้วกลับได้ของหาย
  const incoming = [
    M.makeItem({ title: "ต้นฉบับ" }, { id: "dup-1", now: 0 }),
    M.makeItem({ title: "ที่ copy มา" }, { id: "dup-1", now: 0 }),
  ];

  const { items, added, updated, redone } = M.mergeImport([], incoming);

  assert.equal(items.length, 2, "ทั้งสองชิ้นต้องรอด ไม่ใช่ทับกันเอง");
  assert.equal(redone, 1);
  assert.equal(added, 2);
  assert.equal(updated, 0);
  assert.notEqual(items[0].id, items[1].id);
  assert.deepEqual(
    items.map((i) => i.title),
    ["ต้นฉบับ", "ที่ copy มา"],
  );
});

test("parseImport refuses a file that carries no items", () => {
  // เลือกไฟล์ผิดแล้วขึ้นเขียวว่าสำเร็จ คือทางที่ผู้ใช้จะเชื่อว่า restore แล้ว
  assert.throws(() => M.parseImport("[]"), /ไม่มีผลงาน/);
  assert.throws(
    () => M.parseImport(JSON.stringify({ app: "doodee-future", items: [] })),
    /ไม่มีผลงาน/,
  );
  // ของที่มีจริงต้องยังผ่านเหมือนเดิม
  assert.equal(M.parseImport(JSON.stringify([{ title: "ยังอ่านได้" }])).length, 1);
});

test("ฟิลด์ใหม่ ระดับ/ผลรางวัล/ชั่วโมง ถูกเก็บและกรองค่าที่ใช้ไม่ได้ทิ้ง", () => {
  const ok = M.makeItem(
    { title: "x", level: "ระดับชาติ", result: "เหรียญทอง", hours: "30" },
    { id: "a", now: 0 },
  );
  assert.equal(ok.level, "ระดับชาติ");
  assert.equal(ok.result, "เหรียญทอง");
  assert.equal(ok.hours, "30");

  // ระดับที่ไม่ตรงตัวเลือกของเว็บ เติมลงฟอร์มไม่ได้อยู่ดี เก็บไว้ก็หลอกตัวเอง
  const bad = M.makeItem({ title: "x", level: "ระดับหมู่บ้าน" }, { id: "b", now: 0 });
  assert.equal(bad.level, "");

  // ของเก่าที่ยังไม่มีสามฟิลด์นี้ ต้องได้ค่าว่างและถูกเขียนกลับหนึ่งครั้ง
  const { items, changed } = M.normalize([
    { id: "c", type: "กิจกรรม", title: "เก่า", org: "", detail: "", tags: [], createdAt: 1 },
  ]);
  assert.equal(items[0].level, "");
  assert.equal(items[0].result, "");
  assert.equal(items[0].hours, "");
  assert.equal(changed, true, "ต้องบอกให้ storage เขียนกลับ");
  assert.equal(M.normalize(items).changed, false, "ครั้งที่สองต้องนิ่งแล้ว");
});

test("filterItems matches every search word across title, org, detail and tags", () => {
  const items = Model.normalize([
    { title: "MakeX Challenger", org: "MakeX Thailand", detail: "หุ่นยนต์", tags: ["หุ่นยนต์"], type: "รางวัล / เกียรติบัตร" },
    { title: "ค่าย Click Camp", org: "ม.มหิดล", detail: "cyber security กับ website", tags: ["CTF"], type: "การอบรม" },
  ]).items;

  assert.equal(Model.filterItems(items, { q: "makex" }).length, 1);
  assert.equal(Model.filterItems(items, { q: "MAKEX thailand" }).length, 1, "ไม่สนตัวพิมพ์ใหญ่เล็ก และทุกคำต้องเจอ");
  assert.equal(Model.filterItems(items, { q: "makex มหิดล" }).length, 0, "คำที่อยู่คนละชิ้นต้องไม่ match");
  assert.equal(Model.filterItems(items, { q: "ctf" }).length, 1, "ค้นจากแท็กได้");
  assert.equal(Model.filterItems(items, { q: "  " }).length, 2, "ช่องว่างล้วนคือไม่กรอง");
  assert.equal(Model.filterItems(items, { q: "security", type: "รางวัล / เกียรติบัตร" }).length, 0, "ต้องทำงานร่วมกับตัวกรองหมวด");
});
