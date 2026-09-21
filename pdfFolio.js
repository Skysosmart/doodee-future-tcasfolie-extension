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

  // ป้ายกำกับอยู่ที่ Model ที่เดียว — content.js ใช้ชุดเดียวกันหาช่องบนหน้าเว็บ
  const RESULT_LABELS = root.Model.RESULT_LABELS;
  const STATUS_LABELS = root.Model.STATUS_LABELS;
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
      const stripped = bareOf(src[i]);
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
            status: "",
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

        const status = afterLabel(row, STATUS_LABELS, true);
        if (status !== null) {
          current.status = status;
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
    bareOf,
    matchLevel,
    sectionType,
    parseMetaRow,
    looksLikeFolio,
    toDrafts,
  };
})(globalThis);
