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

  assert.deepEqual(M.parseImport(JSON.stringify(M.toExport(items, 42))).items, items);
  assert.deepEqual(M.parseImport(JSON.stringify(items)).items, items);
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
  assert.equal(M.parseImport(JSON.stringify([{ title: "ยังอ่านได้" }])).items.length, 1);
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

test("toExport ใส่รูปลงไฟล์ได้ และไฟล์ที่ไม่มีรูปยังหน้าตาเดิม", () => {
  const items = M.normalize([{ type: "กิจกรรม", title: "ก" }]).items;
  const id = items[0].id;

  const plain = M.toExport(items, 1000);
  assert.equal(plain.images, undefined, "ไม่ส่งรูปมา = ไฟล์ต้องไม่มีคีย์ images");

  const withImages = M.toExport(items, 1000, {
    [id]: [{ name: "a.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAA" }],
  });
  assert.equal(withImages.images[id].length, 1);
  assert.equal(withImages.items.length, 1);
});

test("toExport ทิ้งรูปของผลงานที่ไม่ได้ส่งออก และทิ้งรูปที่ไม่มีข้อมูล", () => {
  const items = M.normalize([{ type: "กิจกรรม", title: "ก" }]).items;
  const id = items[0].id;
  const out = M.toExport(items, 1000, {
    [id]: [
      { name: "ok.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAA" },
      { name: "เสีย.jpg", type: "image/jpeg" }, // ไม่มี data
    ],
    "ผลงานที่ถูกลบไปแล้ว": [{ name: "x.jpg", data: "data:image/jpeg;base64,BBB" }],
  });
  assert.deepEqual(Object.keys(out.images), [id]);
  assert.equal(out.images[id].length, 1);
});

test("parseImport อ่านรูปจากไฟล์ที่มี และคืน images ว่างเมื่อไฟล์เก่าไม่มีรูป", () => {
  const items = M.normalize([{ type: "กิจกรรม", title: "ก" }]).items;
  const id = items[0].id;

  const withImages = M.parseImport(
    JSON.stringify(M.toExport(items, 1000, { [id]: [{ name: "a.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAA" }] })),
  );
  assert.equal(withImages.items.length, 1);
  assert.equal(withImages.images[id].length, 1);

  const legacy = M.parseImport(JSON.stringify(M.toExport(items, 1000)));
  assert.equal(legacy.items.length, 1);
  assert.deepEqual(legacy.images, {}, "ไฟล์เก่าที่ไม่มีรูปต้องไม่พัง");

  const bareArray = M.parseImport(JSON.stringify(items));
  assert.equal(bareArray.items.length, 1, "array เปล่า ๆ ที่แก้มือยังต้องนำเข้าได้");
});

test("parseImport ไม่ยอมรับรูปที่ไม่ใช่ data URL ของภาพ", () => {
  const items = M.normalize([{ type: "กิจกรรม", title: "ก" }]).items;
  const id = items[0].id;
  const out = M.parseImport(
    JSON.stringify({
      app: "doodee-future",
      items,
      images: {
        [id]: [
          { name: "ดี.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAA" },
          { name: "อันตราย.svg", type: "image/svg+xml", data: "javascript:alert(1)" },
          { name: "ไม่มีข้อมูล.jpg", type: "image/jpeg" },
        ],
      },
    }),
  );
  assert.equal(out.images[id].length, 1);
  assert.equal(out.images[id][0].name, "ดี.jpg");
});

test("folioToItems แปลงแฟ้มที่ดักได้เป็นผลงานตามหมวด พร้อมชื่อไฟล์รูป", () => {
  // ค่าที่ดักได้จาก multipart เป็น string ของ JSON เสมอ — ต้องรับรูปนี้ได้ตรง ๆ
  const parsed = M.folioToItems({
    awards: JSON.stringify([
      {
        title: "เหรียญทองคณิต",
        description: "แข่งระดับประเทศ",
        level: "ระดับชาติ",
        organizer: "สสวท.",
        result: "เหรียญทอง",
        filenames: ["awardFiles0_abc.png", "awardFiles0_abc.png"],
        enabled: true,
      },
      { title: "", description: "บล็อกเปล่าที่ยังไม่ได้กรอก", filenames: [] },
    ]),
    activities: JSON.stringify([{ title: "ค่ายอาสา", description: "3 วัน", filenames: [] }]),
    creatives: "[]",
    trainings: "ไม่ใช่ JSON",
  });

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].item.type, "รางวัล / เกียรติบัตร");
  assert.equal(parsed[0].item.org, "สสวท.");
  assert.equal(parsed[0].item.level, "ระดับชาติ");
  assert.equal(parsed[0].item.result, "เหรียญทอง");
  assert.deepEqual(parsed[0].filenames, ["awardFiles0_abc.png"]); // ชื่อซ้ำต้องเหลือใบเดียว
  assert.equal(parsed[1].item.type, "กิจกรรม");
});

test("folioToItems ทิ้งระดับที่ไม่ตรงตัวเลือกของเว็บ", () => {
  const parsed = M.folioToItems({ awards: [{ title: "ก", level: "ระดับหมู่บ้าน" }] });
  assert.equal(parsed[0].item.level, "");
});

test("mergeFolioItems นำเข้าซ้ำแล้วไม่ได้ของซ้ำ และ id เดิมอยู่ครบ", () => {
  const first = M.folioToItems({ awards: [{ title: "เหรียญทอง", description: "เก่า" }] });
  const start = M.mergeFolioItems([], first);
  assert.equal(start.added, 1);
  const kept = { ...start.items[0], tags: ["วิศวะ"] }; // แท็กที่ผู้ใช้ตั้งเองทีหลัง

  const again = M.folioToItems({ awards: [{ title: "เหรียญทอง", description: "แก้แล้ว" }] });
  const second = M.mergeFolioItems([kept], again);

  assert.equal(second.items.length, 1);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.items[0].id, kept.id); // รูปผูกกับ id นี้ ห้ามเปลี่ยน
  assert.equal(second.items[0].detail, "แก้แล้ว");
  assert.deepEqual(second.items[0].tags, ["วิศวะ"]);
  assert.deepEqual(second.pairs[0], { id: kept.id, filenames: [] });
});

test("mergeFolioItems ไม่แตะผลงานที่ไม่เกี่ยวกับแฟ้มที่นำเข้า", () => {
  const mine = M.makeItem({ type: "กิจกรรม", title: "ของที่พิมพ์เอง" });
  const out = M.mergeFolioItems([mine], M.folioToItems({ awards: [{ title: "ใหม่" }] }));
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].id, mine.id);
});

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

test("นำเข้าอัตโนมัติจากแฟ้มต้องไม่ลบสถานะที่ผู้ใช้พิมพ์เอง", () => {
  // folioToItems ไม่เคยเติม status ให้ (เว็บไม่ส่งค่านี้มา) — สถานะที่พิมพ์เองต้องรอดจากการนำเข้าซ้ำ
  const mine = M.makeItem({ type: "กิจกรรม", title: "ค่ายทดสอบ", status: "เข้าร่วมครบ" });
  const out = M.mergeFolioItems([mine], M.folioToItems({ activities: [{ title: "ค่ายทดสอบ", description: "แก้แล้ว" }] }));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].detail, "แก้แล้ว");
  assert.equal(out.items[0].status, "เข้าร่วมครบ");
});

test("นำเข้าอัตโนมัติจากแฟ้มต้องไม่ลบจำนวนชั่วโมงที่ผู้ใช้พิมพ์เอง", () => {
  // folioToItems เติม hours: "" ให้เสมอ (เว็บไม่ส่งค่านี้มา) — ของที่พิมพ์เองต้องรอดจากการนำเข้าซ้ำ
  const mine = M.makeItem({ type: "กิจกรรม", title: "ค่ายทดสอบชั่วโมง", hours: "12" });
  const out = M.mergeFolioItems(
    [mine],
    M.folioToItems({ activities: [{ title: "ค่ายทดสอบชั่วโมง", description: "แก้แล้ว" }] }),
  );
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].detail, "แก้แล้ว");
  assert.equal(out.items[0].hours, "12");
});

test("ส่งออกแล้วนำเข้ากลับ ฉบับอังกฤษต้องครบ", () => {
  const items = [M.makeItem({ type: "กิจกรรม", title: "ก", en: { title: "A", detail: "B" } }, { id: "x", now: 1 })];
  const { items: back } = M.parseImport(JSON.stringify(M.toExport(items, 1)));
  assert.equal(back[0].en.title, "A");
  assert.equal(back[0].en.detail, "B");
});

// guessKind ของ content.js ห่อ kindFromHaystack ตัวนี้ไว้ชั้นเดียว (ส่วนที่เหลือพึ่ง DOM
// เทสต์ตรงนี้ไม่ได้) — ลำดับการสแกนใน FIELD_HINTS คือส่วนที่เคยไม่มีเทสต์คลุมเลย
test("kindFromHaystack จับป้ายจริงห้าแบบได้ถูกชนิด", () => {
  assert.equal(M.kindFromHaystack("สถานะการเข้าร่วม"), "status");
  assert.equal(M.kindFromHaystack("ผลการอบรม"), "result");
  assert.equal(M.kindFromHaystack("ผลตอบรับ / รางวัล"), "result");
  assert.equal(M.kindFromHaystack("ผลรางวัล / อันดับ"), "result");
  assert.equal(M.kindFromHaystack("รายละเอียด"), "detail");
});

test("kindFromHaystack: คำใบ้ของ org (สถาบัน) ต้องไม่ไปจับ สถานะการเข้าร่วม", () => {
  // ถ้าเรียงผิดจน org แซงหน้า status การเปลี่ยนลำดับ FIELD_HINTS ครั้งต่อไปจะพังแบบเงียบ ๆ
  assert.equal("สถานะการเข้าร่วม".includes("สถาบัน"), false, "สมมติฐานของเทสต์นี้: ไม่ใช่ substring กันเอง");
  assert.equal(M.kindFromHaystack("สถานะการเข้าร่วม"), "status");
});
