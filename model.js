// ตรรกะล้วน ๆ ห้ามมี chrome.* ในไฟล์นี้
// เพื่อให้ทดสอบด้วย `node --test` ได้ตรง ๆ
// อะไรที่แตะ storage ให้ไปอยู่ storage.js
(function (root) {
  "use strict";

  const TYPES = [
    "รางวัล / เกียรติบัตร",
    "โครงงาน / วิจัย",
    "กิจกรรม",
    "การอบรม",
    "ผลงานสร้างสรรค์",
  ];

  // ตรงกับตัวเลือกในช่อง "ระดับ" ของ TCASFolio เป๊ะ ๆ
  // เขียนต่างจากนี้แม้แต่ตัวเดียว ตอนเติมจะหาตัวเลือกไม่เจอ
  const LEVELS = [
    "ระดับโรงเรียน/สถาบัน",
    "ระดับจังหวัด/เขต/ภาค",
    "ระดับชาติ",
    "ระดับนานาชาติ",
  ];

  // ป้ายกำกับที่ TCASFolio ใช้ในแฟ้มและในฟอร์ม — เก็บไว้ที่เดียว
  // pdfFolio.js ใช้หาค่าจากไฟล์ · content.js ใช้เดาว่าช่องบนหน้าเว็บคือช่องอะไร
  // (content script โหลด model.js อยู่แล้ว ดู manifest.json)
  //
  // แต่ละหมวดมีป้ายของตัวเองป้ายเดียว: รางวัล→ผลรางวัล · กิจกรรม→สถานะการเข้าร่วม
  // อบรม→ผลการอบรม · ผลงานสร้างสรรค์→ผลตอบรับ (วัดจากแฟ้มจริง 2026-09-15)
  const STATUS_LABELS = ["สถานะการเข้าร่วม"];
  const RESULT_LABELS = ["ผลรางวัล / อันดับ", "ผลการอบรม", "ผลตอบรับ / รางวัล"];

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

  // ฉบับภาษาอังกฤษของผลงานชิ้นเดียวกัน — ใช้ตอนลงแฟ้มหลักสูตรอินเตอร์
  // ระดับ/หมวด/ชั่วโมง/ลิงก์/แท็ก/รูป ใช้ร่วมกัน ไม่ต้องแปล
  // (ตัวเลือก "ระดับ" ของ TCASFolio เป็นภาษาไทยทุกแฟ้ม แปลแล้วจะหาตัวเลือกไม่เจอ)
  const EN_FIELDS = ["title", "org", "when", "result", "status", "detail"];

  function normalizeEn(value) {
    const src = value && typeof value === "object" ? value : {};
    const out = {};
    for (const key of EN_FIELDS) out[key] = str(src[key]);
    return out;
  }

  function isEmptyEn(en) {
    return EN_FIELDS.every((key) => !str(en && en[key]));
  }

  function hasEnglish(item) {
    return !!(item && item.en && str(item.en.title));
  }

  // ห้ามถอยไปใช้ภาษาไทยเมื่อช่องอังกฤษว่าง — ข้อความไทยที่หลุดลงแฟ้มอินเตอร์
  // คือสิ่งที่ฟีเจอร์นี้มีไว้กัน ปล่อยว่างแล้วคนกรอกเห็นเองดีกว่า
  function inEnglish(item) {
    const en = normalizeEn(item && item.en);
    const out = { ...item };
    for (const key of EN_FIELDS) out[key] = en[key];
    return out;
  }

  function makeItem(fields, options) {
    const opts = options || {};
    return {
      id: str(opts.id) || newId(),
      type: str(fields.type),
      title: str(fields.title),
      org: str(fields.org),
      when: str(fields.when),
      level: LEVELS.includes(str(fields.level)) ? str(fields.level) : "",
      result: str(fields.result),
      status: str(fields.status),
      hours: str(fields.hours),
      link: str(fields.link),
      detail: str(fields.detail),
      tags: normalizeTags(fields.tags),
      en: normalizeEn(fields.en),
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
        when: str(entry.when),
        // ระดับที่ไม่ตรงตัวเลือกของเว็บ ปล่อยว่างดีกว่าเก็บค่าที่เติมไม่ได้
        level: LEVELS.includes(str(entry.level)) ? str(entry.level) : "",
        result: str(entry.result),
        status: str(entry.status),
        hours: str(entry.hours),
        link: str(entry.link),
        detail: str(entry.detail),
        tags: normalizeTags(entry.tags),
        en: normalizeEn(entry.en),
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
    // ค้นหาแบบ "ทุกคำต้องเจอ" ในหัวข้อ/หน่วยงาน/ผลรางวัล/รายละเอียด/แท็ก
    // คลังจริงมี 50+ ชิ้น การไล่หาด้วยตาคือจุดที่ช้าที่สุดตอนกรอก
    const words = String((criteria && criteria.q) || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const interOnly = !!(criteria && criteria.inter);
    return items.filter((entry) => {
      if (type && entry.type !== type) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (interOnly && !hasEnglish(entry)) return false;
      if (!words.length) return true;
      const en = normalizeEn(entry.en);
      const hay = [entry.title, entry.org, entry.when, entry.result, entry.status, entry.link, entry.detail,
                   entry.tags.join(" "), ...EN_FIELDS.map((key) => en[key])]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  function allTags(items) {
    const out = [];
    for (const entry of items) {
      for (const tag of entry.tags) if (!out.includes(tag)) out.push(tag);
    }
    return out.sort();
  }

  // รับรูปเข้ามาด้วยได้ เพื่อให้ไฟล์ที่ส่งออกเป็น backup ที่กู้กลับได้จริง
  // (ก่อนหน้านี้ส่งออกแต่ข้อความ พอคลังหายก็ต้องไล่แนบรูปใหม่ทั้งหมด)
  // ไม่ส่ง images เข้ามา = ไฟล์หน้าตาเหมือนเดิมเป๊ะ ของเก่ายังอ่านได้
  function toExport(items, now, images) {
    const out = {
      app: "doodee-future",
      version: EXPORT_VERSION,
      exportedAt: Number.isFinite(now) ? now : Date.now(),
      items,
    };
    if (!images) return out;

    const ids = new Set(items.map((entry) => entry.id));
    const packed = {};
    for (const [id, list] of Object.entries(images)) {
      if (!ids.has(id)) continue; // รูปของผลงานที่ไม่ได้ส่งออก = ขยะ ไม่ต้องพก
      const clean = (Array.isArray(list) ? list : []).filter(isImage);
      if (clean.length) packed[id] = clean;
    }
    out.images = packed;
    return out;
  }

  // รับเฉพาะ data URL ของภาพ — ไฟล์ backup แก้มือได้ และรูปจะถูกเอาไปยัดใส่ src
  // ปล่อยให้ javascript: หรือ svg ที่มีสคริปต์หลุดเข้ามาไม่ได้
  function isImage(img) {
    return !!(
      img &&
      typeof img.data === "string" &&
      /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(img.data)
    );
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
    const items = normalize(raw).items;
    // ไฟล์ที่ไม่มีผลงานเลยต้องไม่ขึ้นว่าสำเร็จ ผู้ใช้เลือกไฟล์ผิดจะได้รู้
    if (!items.length) throw new Error("ไฟล์นี้ไม่มีผลงานอยู่เลย");

    const images = {};
    const rawImages = data && typeof data.images === "object" && data.images ? data.images : {};
    for (const [id, list] of Object.entries(rawImages)) {
      const clean = (Array.isArray(list) ? list : []).filter(isImage);
      if (clean.length) images[id] = clean;
    }
    return { items, images };
  }

  // upsert เท่านั้น ห้ามแทนที่ทั้งก้อน
  // ไม่งั้นการ import ไฟล์เก่าจะลบของใหม่ทิ้ง — backup จะกลายเป็นตัวทำข้อมูลหาย
  function mergeImport(current, incoming) {
    let items = current;
    let added = 0;
    let updated = 0;
    let redone = 0;
    // id ซ้ำ "ภายในไฟล์เดียวกัน" เกิดได้ง่ายมากจากการ copy-paste ทั้งบล็อกในไฟล์
    // backup ถ้าปล่อยไว้ upsert จะเขียนทับกันเองแล้วเหลือชิ้นเดียวแบบเงียบ ๆ
    // — ตั้งใจจะโคลนกลับกลายเป็นของหาย จึงแจก id ใหม่ให้ตัวที่ซ้ำแทน
    const seen = new Set();
    for (const raw of incoming) {
      const item = seen.has(raw.id) ? { ...raw, id: newId() } : raw;
      if (seen.has(raw.id)) redone += 1;
      seen.add(raw.id);

      const current = items.find((entry) => entry.id === item.id);
      // ของที่ดึงจากเว็บ/แฟ้ม/PDF ไม่เคยมีฉบับอังกฤษมาด้วย ถ้าปล่อยให้ทับ
      // ฉบับอังกฤษจะหายทุกครั้งที่ซิงก์ — ว่างแปลว่า "ไม่รู้" ไม่ใช่ "ลบ"
      const next = current && isEmptyEn(item.en) ? { ...item, en: current.en } : item;

      if (current) updated += 1;
      else added += 1;
      items = upsert(items, next);
    }
    return { items, added, updated, redone };
  }

  // ---------- นำเข้าอัตโนมัติจากแฟ้มบน TCASFolio ----------
  // ชื่อฟิลด์ใน multipart ที่เว็บส่งตอนกด "บันทึกแฟ้ม" -> หมวดในคลังของเรา
  // ลำดับตรงกับ TYPES เพื่อให้ผลลัพธ์เรียงเหมือนที่เห็นบนใบสมัคร
  const FOLIO_SECTIONS = [
    ["awards", "รางวัล / เกียรติบัตร"],
    ["projects", "โครงงาน / วิจัย"],
    ["activities", "กิจกรรม"],
    ["trainings", "การอบรม"],
    ["creatives", "ผลงานสร้างสรรค์"],
  ];

  // ค่าที่ดักได้เป็น string ของ JSON เสมอ (multipart ไม่มีชนิดข้อมูล)
  // แต่ถ้ามีใครส่ง array มาแล้วก็รับได้ ไม่ต้องแปลงกลับไปกลับมา
  function parseFolioSection(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const data = JSON.parse(value);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return []; // ฟิลด์เดียวพังต้องไม่ทำให้ทั้งการนำเข้าล้ม
    }
  }

  function folioFilenames(entry) {
    const raw = Array.isArray(entry && entry.filenames) ? entry.filenames : [];
    const out = [];
    for (const name of raw) {
      const clean = str(name);
      if (clean && !out.includes(clean)) out.push(clean);
    }
    return out;
  }

  // แฟ้มที่ดักได้ -> รายการผลงาน + ชื่อไฟล์รูปของแต่ละชิ้น
  // ชิ้นที่ไม่มีหัวข้อเลยข้าม — บล็อกเปล่าที่ผู้ใช้กดเพิ่มไว้แต่ยังไม่กรอกก็ถูกส่งมาด้วย
  function folioToItems(fields, options) {
    const opts = options || {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const out = [];
    for (const [key, type] of FOLIO_SECTIONS) {
      for (const entry of parseFolioSection(fields && fields[key])) {
        if (!entry || typeof entry !== "object") continue;
        const title = str(entry.title);
        if (!title) continue;
        out.push({
          item: makeItem(
            {
              type,
              title,
              org: str(entry.organizer),
              when: str(entry.date) || str(entry.period),
              level: str(entry.level),
              result: str(entry.result),
              hours: "",
              link: str(entry.link),
              detail: str(entry.description),
              tags: [],
            },
            { now },
          ),
          filenames: folioFilenames(entry),
        });
      }
    }
    return out;
  }

  // นำเข้าซ้ำรอบสองต้องไม่ได้ของซ้ำ — เทียบด้วย หมวด+หัวข้อ เพราะแฟ้มบนเว็บไม่มี id
  // ให้เรา ชิ้นเดิมจะถูกเขียนทับด้วยข้อมูลล่าสุดจากแฟ้ม แต่ id เดิมอยู่ครบ
  // (รูปที่ผูกกับ id นั้นจึงไม่หลุด และแท็กที่ผู้ใช้ตั้งเองไว้ก็ยังอยู่)
  function mergeFolioItems(current, incoming) {
    let items = current;
    const pairs = [];
    let added = 0;
    let updated = 0;
    for (const entry of incoming) {
      const match = items.find(
        (old) => old.type === entry.item.type && old.title === entry.item.title,
      );
      const item = match
        ? {
            ...entry.item,
            id: match.id,
            createdAt: match.createdAt,
            tags: match.tags,
            en: isEmptyEn(entry.item.en) ? match.en : entry.item.en,
          }
        : entry.item;
      if (match) updated += 1;
      else added += 1;
      items = upsert(items, item);
      pairs.push({ id: item.id, filenames: entry.filenames });
    }
    return { items, pairs, added, updated };
  }

  root.Model = {
    TYPES,
    LEVELS,
    STATUS_LABELS,
    RESULT_LABELS,
    EXPORT_VERSION,
    newId,
    normalizeTags,
    formatTags,
    EN_FIELDS,
    normalizeEn,
    isEmptyEn,
    hasEnglish,
    inEnglish,
    makeItem,
    normalize,
    upsert,
    remove,
    filterItems,
    allTags,
    toExport,
    isImage,
    parseImport,
    mergeImport,
    FOLIO_SECTIONS,
    parseFolioSection,
    folioToItems,
    mergeFolioItems,
  };
})(globalThis);
