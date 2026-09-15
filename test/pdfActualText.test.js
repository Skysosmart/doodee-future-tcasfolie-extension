"use strict";

require("../pdfGlyphs.js");
require("../pdfActualText.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const A = globalThis.PdfActualText;
const G = globalThis.PdfGlyphs;

const span = { type: "beginMarkedContentProps", tag: "Span" };
const end = { type: "endMarkedContent" };
const NUL = String.fromCharCode(0);

test("decodeHex อ่าน UTF-16BE ทั้งที่มีและไม่มี BOM", () => {
  assert.equal(A.decodeHex("FEFF0E1F0E49"), "ฟ้");
  assert.equal(A.decodeHex("0E1F0E49"), "ฟ้");
  assert.equal(A.decodeHex(""), "");
});

test("applyActualText แทนข้อความของกลุ่มที่อยู่ในช่วง Span", () => {
  const out = G.applyActualText(
    [
      { str: "แ", x: 0, y: 700, w: 4 },
      span,
      { str: "ฟ", x: 4, y: 700, w: 5 },
      { str: "", x: 9, y: 700, w: 0 },
      end,
      { str: "มสะสม", x: 9, y: 700, w: 20 },
    ],
    ["ฟ้"],
  );
  assert.deepEqual(out.map((i) => i.str), ["แ", "ฟ้", "มสะสม"]);
});

test("applyActualText ไม่กลืนช่องว่างหัวช่วง และไม่คร่อมระยะของมัน", () => {
  // วัดจริง 2026-09-15: ช่องว่างจริงอยู่ "ใน" ช่วง Span
  // ถ้ากลืนไป ระยะห่างจะหาย แล้ว "2 จิตอาสา" กลายเป็น "2จิตอาสา"
  // ซึ่งทำให้ตัวจับลำดับผลงานของ pdfFolio พลาดทั้งชิ้น (ได้ร่าง 12 แทน 16)
  const out = G.applyActualText(
    [
      { str: "2", x: 44.76, y: 700, w: 4.46 },
      span,
      { str: " ", x: 49.21, y: 700, w: 15.17 },
      { str: "จ", x: 61.09, y: 700, w: 5.45 },
      { str: NUL, x: 66.67, y: 700, w: 0 },
      end,
    ],
    ["จิ"],
  );
  assert.deepEqual(out.map((i) => i.str), ["2", " ", "จิ"]);
  const replaced = out[2];
  assert.equal(replaced.x, 61.09, "ต้องเริ่มที่ตัวอักษรตัวแรก ไม่ใช่ที่ช่องว่าง");
  assert.ok(Math.abs(replaced.w - 5.45) < 1e-6, "ความกว้างต้องไม่คร่อมช่องว่างหัวช่วง");
});

test("applyActualText ไม่กลืนช่องว่างท้ายช่วง", () => {
  const out = G.applyActualText(
    [
      span,
      { str: "ก", x: 10, y: 700, w: 5 },
      { str: " ", x: 15, y: 700, w: 8 },
      end,
      { str: "ข", x: 23, y: 700, w: 5 },
    ],
    ["กิ"],
  );
  assert.deepEqual(out.map((i) => i.str), ["กิ", " ", "ข"]);
  assert.equal(out[0].w, 5);
});

test("applyActualText ทิ้งทั้งหน้าถ้าจำนวน Span ไม่ตรงกัน", () => {
  const items = [{ str: "ก", x: 0, y: 700, w: 5 }, span, { str: "ข", x: 5, y: 700, w: 5 }, end];
  // มี Span หนึ่งช่วง แต่ได้ข้อความมาสองก้อน = จับคู่ไม่ได้ ห้ามเดา
  const out = G.applyActualText(items, ["ค", "ง"]);
  assert.deepEqual(out.filter((i) => typeof i.str === "string").map((i) => i.str), ["ก", "ข"]);
});

test("applyActualText ไม่มี span มาเลย = คืนของเดิม", () => {
  const items = [{ str: "ก", x: 0, y: 700, w: 5 }];
  assert.equal(G.applyActualText(items, []), items);
});

test("applyActualText Span ที่ไม่มี ActualText ปล่อยของเดิมไว้", () => {
  // Span ที่ไม่มี ActualText คืนค่าว่างมา — ต้องไม่ลบข้อความทิ้ง
  const out = G.applyActualText([span, { str: "abc", x: 0, y: 700, w: 10 }, end], [""]);
  assert.deepEqual(out.map((i) => i.str), ["abc"]);
});

test("spansFromPage คืน [] เมื่ออ่านไม่ได้ ไม่โยน error", async () => {
  assert.deepEqual(await A.spansFromPage(null, { num: 1, gen: 0 }), []);
  assert.deepEqual(await A.spansFromPage(new Uint8Array([1, 2, 3]), { num: 9, gen: 0 }), []);
});
