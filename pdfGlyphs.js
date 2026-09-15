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

  // "มองเห็นได้" = ไม่ใช่ช่องว่างและไม่ใช่อักขระควบคุม
  function visible(text) {
    return /[^\u0000-\u0020\u007f]/.test(String(text || ""));
  }

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

  // จับคู่ Span ที่ N จาก pdf.js กับข้อความที่ N จาก content stream
  // จำนวนไม่ตรง = จับคู่ไม่ได้ ทิ้งทั้งหน้า ห้ามเดาทีละคู่
  // (วัดจริง: หน้าเรียงความมี Span ที่อ่านไม่ถึง จึงต้องยอมถอยเป็นหน้า ๆ)
  //
  // ชิ้นที่แทนแล้วต้อง "กว้างเท่าทั้งช่วง" ไม่ใช่เท่าชิ้นแรก
  // ไม่งั้นระยะที่หายไปจะกลายเป็นช่องว่างปลอม ("สำนักงาน" -> "สำ นักงาน")
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

    const flush = () => {
      if (!group) return;
      const text = texts[group.index];
      const items = group.items;
      // ชิ้นที่แทนต้องกินแค่ช่วง "ตัวอักษรที่มองเห็นได้" เท่านั้น
      // ช่องว่างหัวและท้ายช่วงห้ามถูกกลืน และห้ามถูกคร่อมด้วยความกว้าง —
      // dropOrphanMarks ทิ้ง item ที่มีแต่ช่องว่าง แล้ว joinParts เว้นวรรคจาก
      // ระยะห่างอย่างเดียว ถ้ากลืนไปจะได้ "2จิตอาสา" แทน "2 จิตอาสา"
      let first = -1;
      let last = -1;
      for (let i = 0; i < items.length; i += 1) {
        // .trim() ไม่ตัด U+0000 ซึ่ง pdf.js ส่งมาปนด้วย ถ้านับเป็นตัวอักษร
        // ความกว้างจะเลยไปจากตัวจริง
        if (!visible(items[i].str)) continue;
        if (first === -1) first = i;
        last = i;
      }
      if (first === -1 || !text) {
        for (const item of items) out.push({ ...item });
        group = null;
        return;
      }
      const head = items[first];
      const right = Number(items[last].x) + (Number(items[last].w) || 0);
      const width = Math.max(right - Number(head.x), Number(head.w) || 0);
      // นอกช่วงตัวอักษร เก็บเฉพาะชิ้นที่ "กินที่" จริง ๆ — ชิ้นกว้างศูนย์
      // ไม่มีผลต่อระยะห่าง และถูกทิ้งอยู่แล้วในขั้นถัดไป
      const carry = (item) => { if (Number(item.w) > 0) out.push({ ...item }); };
      for (const item of items.slice(0, first)) carry(item);
      out.push({ ...head, str: text, w: width });
      for (const item of items.slice(last + 1)) carry(item);
      group = null;
    };

    for (const item of list) {
      if (item && item.type === "beginMarkedContentProps" && item.tag === "Span") {
        depth += 1;
        if (depth === 1) {
          index += 1;
          group = { index, items: [] };
        }
        continue;
      }
      if (item && item.type === "endMarkedContent") {
        if (depth > 0) depth -= 1;
        if (depth === 0) flush();
        continue;
      }
      if (!item || typeof item.str !== "string") continue;
      if (group) group.items.push(item);
      else out.push({ ...item });
    }
    flush();
    return out;
  }

  root.PdfGlyphs = {
    ZERO_ADVANCE,
    unpua,
    countPua,
    composeThai,
    normalizeItems,
    applyActualText,
  };
})(globalThis);
