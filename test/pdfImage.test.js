"use strict";

require("../pdfImage.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const I = globalThis.PdfImage;

// พื้นที่หน้ากระดาษ A4 ที่ Canva ส่งออก (จาก pdf.js viewport)
const PAGE = { width: 595, height: 842 };

function pixels(fill, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = typeof fill === "function" ? fill(i / 4, w, h) : fill;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("classify ทิ้งรูปที่ด้านสั้นเกินไป (ไอคอน/เส้นคั่น)", () => {
  const r = I.classify({ width: 800, height: 40 }, PAGE);
  assert.equal(r.keep, false);
  assert.match(r.why, /เล็ก/);
});

test("classify ทิ้งพื้นหลังที่ครอบเกือบทั้งหน้า", () => {
  const r = I.classify({ width: 2480, height: 3508, drawWidth: 595, drawHeight: 842 }, PAGE);
  assert.equal(r.keep, false);
  assert.match(r.why, /พื้นหลัง/);
});

test("classify เก็บรูปเกียรติบัตร/รูปถ่ายขนาดปกติ", () => {
  assert.equal(I.classify({ width: 1477, height: 1108, drawWidth: 240, drawHeight: 180 }, PAGE).keep, true);
  assert.equal(I.classify({ width: 540, height: 346, drawWidth: 200, drawHeight: 128 }, PAGE).keep, true);
});

test("classify ไม่ทิ้งรูปใหญ่ที่วางเป็นภาพประกอบครึ่งหน้า", () => {
  // ไฟล์ต้นฉบับใหญ่ แต่วางแค่ครึ่งหน้า = ภาพประกอบจริง ไม่ใช่พื้นหลัง
  const r = I.classify({ width: 3000, height: 2000, drawWidth: 300, drawHeight: 200 }, PAGE);
  assert.equal(r.keep, true);
});

test("isFlat จับรูปสีเดียวล้วน (มาสก์ของ Canva) แต่ไม่จับรูปที่มีรายละเอียด", () => {
  assert.equal(I.isFlat(pixels([255, 255, 255], 16, 16)), true);
  assert.equal(I.isFlat(pixels([12, 40, 90], 16, 16)), true);
  const noisy = pixels((i) => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256], 16, 16);
  assert.equal(I.isFlat(noisy), false);
});

test("fingerprint ให้ค่าเท่ากันสำหรับรูปเดียวกัน และต่างกันเมื่อภาพต่าง", () => {
  const a = pixels((i) => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256], 16, 16);
  const b = pixels((i) => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256], 16, 16);
  const c = pixels((i) => [(i * 7) % 256, (i * 3) % 256, (i * 29) % 256], 16, 16);
  assert.equal(I.fingerprint(a), I.fingerprint(b));
  assert.notEqual(I.fingerprint(a), I.fingerprint(c));
});

test("planShrink คำนวณขนาดใหม่ให้ไม่เกินเกณฑ์ และไม่ขยายรูปเล็ก", () => {
  const big = I.planShrink({ width: 6000, height: 4000 });
  assert.equal(big.scaled, true);
  assert.equal(Math.max(big.width, big.height), I.MAX_EDGE);
  assert.equal(big.height, Math.round((4000 * I.MAX_EDGE) / 6000));

  const small = I.planShrink({ width: 800, height: 600 });
  assert.equal(small.scaled, false);
  assert.equal(small.width, 800);
  assert.equal(small.height, 600);
});

test("dedupe ทิ้งรูปที่ลายนิ้วมือซ้ำ เก็บใบแรกไว้", () => {
  const kept = I.dedupe([
    { name: "a", fingerprint: "x1" },
    { name: "b", fingerprint: "x1" },
    { name: "c", fingerprint: "x2" },
  ]);
  assert.deepEqual(kept.map((i) => i.name), ["a", "c"]);
});

test("classify ทิ้งรูปที่วางบนหน้าเล็กมาก แม้ไฟล์ต้นฉบับจะใหญ่ (ลายประดับ)", () => {
  const r = I.classify({ width: 1200, height: 1200, drawWidth: 20, drawHeight: 20 }, PAGE);
  assert.equal(r.keep, false);
  assert.match(r.why, /เล็กเกินไป/);
});

test("classify เก็บรูปที่วางขนาดพอดูได้บนหน้า", () => {
  assert.equal(I.classify({ width: 900, height: 700, drawWidth: 120, drawHeight: 90 }, PAGE).keep, true);
});
