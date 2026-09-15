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

const LONG = "รายละเอียดผลงานสมมติที่ยาวพอจะเป็นย่อหน้าจริง เขียนไว้เพื่อทดสอบตัวตัดชิ้นเท่านั้น";

function looksFolio(rows) {
  return F.looksLikeFolio([{ page: 1, rows }]);
}

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
  assert.deepEqual(F.parseMetaRow("ระดับชาติ ไม่มีค่าใช้จ่าย"), {
    level: "ระดับชาติ",
    when: "",
    hours: "",
    org: "",
  });
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
