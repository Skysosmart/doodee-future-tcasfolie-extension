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
  assert.equal(G.unpua("ท"), "ท่");
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
