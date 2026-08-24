"use strict";

require("../model.js");
require("../pdfText.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const P = globalThis.PdfText;
const M = globalThis.Model;

// ── fixture สังเคราะห์ ────────────────────────────────────────────────
// จำลองอาการที่วัดได้จากไฟล์ Canva จริง (2026-08-24): แต่ละย่อหน้าถูกฝังสองชุด
// ชุดหนึ่งวรรณยุกต์/สระหาย อีกชุดสมบูรณ์ ปนกับเศษบรรทัด
// ห้ามใช้ข้อความพอร์ตจริงของผู้ใช้ในไฟล์นี้ — เป็นข้อมูลส่วนตัว
const CRIPPLED = "ผลงานนวัตกรรม PDlite ทีได้ผ่านการคัดเลือกของสํ";
const INTACT = "ผลงานนวัตกรรม PDlite ที่ได้ผ่านการคัดเลือกของสำนักงานการวิจัยแห่งชาติ";
const FRAGMENT = "ผลงานนวั";

test("buildLines จัดกลุ่ม text item ที่อยู่บรรทัดเดียวกันตามพิกัด y แล้วเรียงตาม x", () => {
  const lines = P.buildLines([
    { str: "กลาง", x: 50, y: 700 },
    { str: "ซ้าย", x: 10, y: 701 }, // ต่างกัน 1 หน่วย = บรรทัดเดียวกัน
    { str: "ขวา", x: 90, y: 700 },
    { str: "บรรทัดล่าง", x: 10, y: 660 },
  ]);
  assert.deepEqual(lines, ["ซ้ายกลางขวา", "บรรทัดล่าง"]);
});

test("buildLines เรียงจากบนลงล่าง (y ของ PDF นับขึ้น)", () => {
  const lines = P.buildLines([
    { str: "ล่าง", x: 10, y: 100 },
    { str: "บน", x: 10, y: 700 },
  ]);
  assert.deepEqual(lines, ["บน", "ล่าง"]);
});

test("repairThai เก็บบรรทัดที่วรรณยุกต์ครบ ทิ้งฝาแฝดพิการ", () => {
  const kept = P.repairThai([CRIPPLED, INTACT]);
  assert.deepEqual(kept, [INTACT]);
});

test("repairThai ทิ้งเศษบรรทัดที่เป็นส่วนหนึ่งของบรรทัดที่ยาวกว่า", () => {
  const kept = P.repairThai([FRAGMENT, INTACT, "านั งานการวิ ั แห่ ชาติ"]);
  assert.deepEqual(kept, [INTACT]);
});

test("repairThai ไม่ทิ้งหัวข้อสั้นที่ไม่ใช่เศษของย่อหน้าใด", () => {
  const kept = P.repairThai(["I-NEW GEN AWARD 2026", INTACT]);
  assert.deepEqual(kept, ["I-NEW GEN AWARD 2026", INTACT]);
});

test("repairThai รักษาลำดับเดิมและไม่ทำข้อความอังกฤษหาย", () => {
  const kept = P.repairThai(["Tech Stack", "Preview", INTACT]);
  assert.deepEqual(kept, ["Tech Stack", "Preview", INTACT]);
});

test("guessType เดาหมวดจากคำใบ้ และคืนค่าที่อยู่ใน Model.TYPES เท่านั้น", () => {
  assert.equal(P.guessType("ได้รับรางวัลเหรียญทองระดับชาติ"), "รางวัล / เกียรติบัตร");
  assert.equal(P.guessType("โครงงานวิจัยเรื่องเซนเซอร์"), "โครงงาน / วิจัย");
  assert.equal(P.guessType("เข้าร่วมค่าย 4 วัน 3 คืน"), "การอบรม");
  assert.equal(P.guessType("Cyber Bootcamp ฝึกอบรม"), "การอบรม");
  assert.equal(P.guessType("จิตอาสาโรงพยาบาล"), "กิจกรรม");
  assert.equal(P.guessType("ข้อความที่ไม่มีคำใบ้อะไรเลย"), "", "ไม่มีคำใบ้ต้องไม่เดามั่ว");
  for (const text of ["รางวัล", "โครงงาน", "ค่าย", "จิตอาสา"]) {
    const guessed = P.guessType(text);
    assert.ok(!guessed || M.TYPES.includes(guessed), `"${guessed}" ต้องอยู่ใน Model.TYPES`);
  }
});

test("guessLevel เดาระดับ และคืนค่าที่ตรงกับ Model.LEVELS เป๊ะ", () => {
  assert.equal(P.guessLevel("การแข่งขันระดับชาติ"), "ระดับชาติ");
  assert.equal(P.guessLevel("MakeX ระดับนานาชาติ"), "ระดับนานาชาติ");
  assert.equal(P.guessLevel("แข่งระดับจังหวัด"), "ระดับจังหวัด/เขต/ภาค");
  assert.equal(P.guessLevel("กิจกรรมภายในโรงเรียน"), "ระดับโรงเรียน/สถาบัน");
  assert.equal(P.guessLevel("ไม่ได้บอกระดับไว้"), "");
  for (const text of ["ระดับชาติ", "นานาชาติ", "จังหวัด", "โรงเรียน"]) {
    const guessed = P.guessLevel(text);
    assert.ok(!guessed || M.LEVELS.includes(guessed), `"${guessed}" ต้องอยู่ใน Model.LEVELS`);
  }
});

test("segment ตัดเป็นชิ้นด้วยหัวข้อสั้นที่ตามด้วยย่อหน้ายาว", () => {
  const body = "ก".repeat(200);
  const out = P.segment([
    { page: 1, lines: ["I-NEW GEN AWARD 2026", body] },
    { page: 2, lines: ["MakeX: Challenger", body] },
  ]);
  assert.equal(out.drafts.length, 2);
  assert.equal(out.drafts[0].title, "I-NEW GEN AWARD 2026");
  assert.equal(out.drafts[0].detail, body);
  assert.equal(out.drafts[0].page, 1);
  assert.equal(out.drafts[1].title, "MakeX: Challenger");
});

test("segment ปิดชิ้นที่ขอบหน้า ไม่ลากย่อหน้าข้ามหน้า", () => {
  const body = "ข".repeat(200);
  const out = P.segment([
    { page: 1, lines: ["หัวข้อหนึ่ง", body] },
    { page: 2, lines: [body] },
  ]);
  assert.equal(out.drafts.length, 2);
  assert.equal(out.drafts[0].page, 1);
  assert.equal(out.drafts[1].title, "", "หน้าที่ไม่มีหัวข้อต้องได้ชิ้นที่หัวข้อว่าง ไม่ใช่ไปต่อท้ายชิ้นก่อน");
  assert.equal(out.drafts[1].page, 2);
});

test("segment รายงานหน้าที่ข้าม พร้อมเหตุผล", () => {
  const out = P.segment([
    { page: 1, lines: ["PORTFOLIO", "ชื่อ นาย ก"] }, // หน้าปก ไม่มีย่อหน้ายาว
    { page: 2, lines: ["หัวข้อ", "ค".repeat(200)] },
  ]);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].page, 1);
  assert.match(out.skipped[0].why, /ย่อหน้า/);
});

test("segment รวมหลายย่อหน้าใต้หัวข้อเดียวด้วยการขึ้นบรรทัด", () => {
  const p1 = "ง".repeat(200);
  const p2 = "จ".repeat(200);
  const out = P.segment([{ page: 1, lines: ["หัวข้อ", p1, p2] }]);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].detail, `${p1}\n${p2}`);
});

test("toDrafts ต่อท่อครบตั้งแต่ text item ถึงร่างที่เดาหมวดแล้ว", () => {
  // จำลองของจริง: ย่อหน้าเดียวถูกฝังสองชุด — ชุดสมบูรณ์ (ยาว) กับชุดพิการที่ถอด
  // เครื่องหมายออกแล้วถูกตัดกลางคำ ตัวพิการต้องถูกทิ้ง ไม่ใช่ไปกลายเป็นหัวข้อ
  const intact =
    "เข้าร่วมค่าย 4 วัน 3 คืน กับคณะวิศวกรรมศาสตร์ ได้เรียนรู้การทำงานเป็นทีมและการแก้ปัญหาเฉพาะหน้า " +
    "ซึ่งเป็นประสบการณ์ที่ทำให้เห็นภาพการเรียนจริงในมหาวิทยาลัยชัดเจนขึ้นมาก และช่วยให้ตัดสินใจเลือกสาขาได้";
  const crippled = P.stripMarks(intact).slice(0, Math.round(intact.length * 0.7));

  const out = P.toDrafts([
    {
      page: 1,
      items: [
        { str: "ค่ายอยากเป็นวิศวฯ", x: 10, y: 700, h: 16 },
        { str: crippled, x: 10, y: 650, h: 14 },
        { str: intact, x: 10, y: 600, h: 14 },
      ],
    },
  ]);

  assert.equal(out.drafts.length, 1);
  const d = out.drafts[0];
  assert.equal(d.title, "ค่ายอยากเป็นวิศวฯ", "ตัวพิการต้องไม่แย่งที่หัวข้อ");
  assert.equal(d.detail, intact);
  assert.equal(d.type, "การอบรม");
  assert.equal(d.page, 1);
});

test("toDrafts ทนกับหน้าว่างและ item ที่ไม่มีข้อความ", () => {
  const out = P.toDrafts([
    { page: 1, items: [] },
    { page: 2, items: [{ str: "   ", x: 0, y: 0 }] },
  ]);
  assert.equal(out.drafts.length, 0);
  assert.equal(out.skipped.length, 2);
});

test("groupParagraphs รวมบรรทัดที่ตัดคำของย่อหน้าเดียวกัน และตัดที่ช่องว่างใหญ่", () => {
  // ของจริง: ย่อหน้าถูกตัดเป็นบรรทัดสั้น ๆ ห่างกันเท่าความสูงตัวอักษร
  const rows = [
    { y: 700, h: 16, text: "หัวข้อผลงาน" },
    { y: 660, h: 14, text: "บรรทัดแรกของย่อหน้า" }, // ห่าง 40 = ขึ้นย่อหน้าใหม่
    { y: 644, h: 14, text: "ต่อจากบรรทัดแรก" }, // ห่าง 16 ≈ ความสูง = บรรทัดเดียวกัน
    { y: 628, h: 14, text: "และบรรทัดที่สาม" },
  ];
  assert.deepEqual(P.groupParagraphs(rows), [
    "หัวข้อผลงาน",
    "บรรทัดแรกของย่อหน้าต่อจากบรรทัดแรกและบรรทัดที่สาม",
  ]);
});

test("joinParts เว้นวรรคคำอังกฤษ แต่ไม่แทรกช่องว่างกลางคำไทย", () => {
  assert.equal(
    P.joinParts([
      { str: "PROJECT", x: 10, w: 60 },
      { str: "&", x: 78, w: 8 },
      { str: "COMPETITION", x: 92, w: 100 },
    ]),
    "PROJECT & COMPETITION",
  );
  assert.equal(
    P.joinParts([
      { str: "ผลงาน", x: 10, w: 30 },
      { str: "นวัตกรรม", x: 40, w: 40 },
    ]),
    "ผลงานนวัตกรรม",
  );
});

test("dropTwins ลบชุดพิการที่ Canva วางติดกันในบรรทัดเดียว", () => {
  // ถอดเครื่องหมายแล้วเป็น "ทาหนาท" ซ้ำติดกัน — เก็บชุดที่มีวรรณยุกต์ครบ
  assert.equal(P.dropTwins("ทําหน้าทีทำหน้าที่"), "ทำหน้าที่");
  assert.equal(P.dropTwins("ผมได้ทําผมได้ทำ"), "ผมได้ทำ");
  // ไม่มีของซ้ำ ต้องไม่แตะ
  assert.equal(P.dropTwins("ผลงานนวัตกรรมที่ผ่านการคัดเลือก"), "ผลงานนวัตกรรมที่ผ่านการคัดเลือก");
  // คำซ้ำที่ผู้เขียนตั้งใจและสั้นกว่าเกณฑ์ ต้องไม่ถูกลบ
  assert.equal(P.dropTwins("มาก ๆ"), "มาก ๆ");
});

test("dropOverlapping ทิ้ง item ที่กล่องซ้อนอยู่ใต้ item ที่คะแนนดีกว่า", () => {
  // วัดจริงหน้า 8: ชุดสมบูรณ์เป็น item เดียวยาว ชุดพิการเป็นเศษหลายชิ้นวางทับสนิท
  const kept = P.dropOverlapping([
    { str: "จำนวนมากและผ่านการคัดเลือกอย่างเข้มข้น", x: 10, y: 700, w: 200, h: 14 },
    { str: "จํานวนมากและผ่านการคั", x: 12, y: 700, w: 100, h: 14 },
    { str: "เลื", x: 120, y: 700, w: 20, h: 14 },
    { str: "หัวข้ออื่นที่ไม่ทับใคร", x: 10, y: 660, w: 120, h: 14 },
  ]);
  assert.deepEqual(
    kept.map((i) => i.str),
    ["จำนวนมากและผ่านการคัดเลือกอย่างเข้มข้น", "หัวข้ออื่นที่ไม่ทับใคร"],
  );
});

test("dropOverlapping ไม่ทิ้งอะไรเมื่อไม่มีกล่องซ้อนกัน", () => {
  const items = [
    { str: "บรรทัดหนึ่ง", x: 10, y: 700, w: 80, h: 14 },
    { str: "บรรทัดสอง", x: 10, y: 680, w: 80, h: 14 },
  ];
  assert.equal(P.dropOverlapping(items).length, 2);
});

test("dropOverlapping ทนกับ item ที่ไม่มีขนาด (ตัวอ่านที่ไม่ให้ w/h)", () => {
  const items = [
    { str: "ก", x: 10, y: 700 },
    { str: "ข", x: 10, y: 700 },
  ];
  assert.equal(P.dropOverlapping(items).length, 2, "ไม่มีขนาด = วัดการซ้อนไม่ได้ ต้องไม่เดาทิ้ง");
});

test("dropOrphanMarks ทิ้ง item ที่มีแต่เครื่องหมายไม่มีพยัญชนะ", () => {
  // เศษที่ Canva ทิ้งไว้: วรรณยุกต์/สระลอยเดี่ยว ๆ ไม่ทับใคร แต่ไปเกาะคำถัดไป
  // ทำให้ได้ "ปฏิบัติงานที่ัิโรงพยาบาล"
  const kept = P.dropOrphanMarks([
    { str: "ปฏิบัติงานที่", x: 10, y: 700, w: 80, h: 14 },
    { str: "ัิ", x: 95, y: 700, w: 6, h: 14 },
    { str: "โรงพยาบาล", x: 105, y: 700, w: 60, h: 14 },
  ]);
  assert.deepEqual(kept.map((i) => i.str), ["ปฏิบัติงานที่", "โรงพยาบาล"]);
});

test("dropOrphanMarks ไม่แตะคำปกติ ตัวเลข หรือคำอังกฤษ", () => {
  const items = [
    { str: "ที่", x: 0, y: 0 },
    { str: "2026", x: 0, y: 0 },
    { str: "MakeX", x: 0, y: 0 },
    { str: "ๆ", x: 0, y: 0 },
    { str: "&", x: 0, y: 0 }, // วรรคตอนในหัวข้อ ห้ามทิ้ง
    { str: "-", x: 0, y: 0 },
  ];
  assert.equal(P.dropOrphanMarks(items).length, 6);
});

test("dropOverlapping ทิ้งชิ้นซ้ำที่ข้อความเหมือนกันเป๊ะและกล่องทับกัน", () => {
  // pdf.js ซอย glyph run ซ้อนกัน ทำให้ได้ item เดียวกันหลายชิ้น จะได้ SOPSOPSOP
  const kept = P.dropOverlapping([
    { str: "SOP", x: 10, y: 700, w: 30, h: 16 },
    { str: "SOP", x: 10, y: 700, w: 30, h: 16 },
    { str: "SOP", x: 11, y: 700, w: 30, h: 16 },
  ]);
  assert.equal(kept.length, 1);
});

test("clean ล้างอักขระควบคุมที่ pdf.js ส่งมาปน", () => {
  assert.equal(P.clean("\u0000\u0001ปกติ"), "ปกติ");
  assert.equal(P.clean("ท้าทาย"), "ท้าทาย");
});
