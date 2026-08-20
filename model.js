// ---------------------------------------------------------
// ตรรกะล้วน ๆ ห้ามมี chrome.* ในไฟล์นี้
// เพื่อให้ทดสอบด้วย `node --test` ได้ตรง ๆ
// อะไรที่แตะ storage ให้ไปอยู่ storage.js
// ---------------------------------------------------------
(function (root) {
  "use strict";

  const TYPES = [
    "รางวัล / เกียรติบัตร",
    "โครงงาน / วิจัย",
    "กิจกรรม",
    "การอบรม",
    "ผลงานสร้างสรรค์",
  ];

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

  function makeItem(fields, options) {
    const opts = options || {};
    return {
      id: str(opts.id) || newId(),
      type: str(fields.type),
      title: str(fields.title),
      org: str(fields.org),
      detail: str(fields.detail),
      tags: normalizeTags(fields.tags),
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
        detail: str(entry.detail),
        tags: normalizeTags(entry.tags),
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
    return items.filter(
      (entry) =>
        (!type || entry.type === type) && (!tag || entry.tags.includes(tag)),
    );
  }

  function allTags(items) {
    const out = [];
    for (const entry of items) {
      for (const tag of entry.tags) if (!out.includes(tag)) out.push(tag);
    }
    return out.sort();
  }

  function toExport(items, now) {
    return {
      app: "doodee-future",
      version: EXPORT_VERSION,
      exportedAt: Number.isFinite(now) ? now : Date.now(),
      items,
    };
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
    return items;
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

      if (items.some((entry) => entry.id === item.id)) updated += 1;
      else added += 1;
      items = upsert(items, item);
    }
    return { items, added, updated, redone };
  }

  root.Model = {
    TYPES,
    EXPORT_VERSION,
    newId,
    normalizeTags,
    formatTags,
    makeItem,
    normalize,
    upsert,
    remove,
    filterItems,
    allTags,
    toExport,
    parseImport,
    mergeImport,
  };
})(globalThis);
