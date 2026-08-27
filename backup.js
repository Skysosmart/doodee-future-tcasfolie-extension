// หน้าคลัง — ซิงก์จากเว็บ / สำรอง / กู้คืน เป็นแท็บของตัวเอง ไม่ทำใน popup
//
// popup ปิดตัวเองทันทีที่ file dialog ของระบบเปิดขึ้น หน้าถูกทำลายก่อน change จะยิง
// ไฟล์ที่เลือกจึงหายเงียบ ๆ ไม่มี error ให้เห็น (เกิดจริง: กู้คืน backup แล้วคลังยังว่าง
// ทั้งที่กดครบทุกขั้น) และการดึงจากเว็บ + เขียนรูปหลายสิบ MB ก็ใช้เวลาเกินอายุ popup อยู่แล้ว
"use strict";

// คงที่ ไม่ให้แก้จากหน้าเว็บ — โทเคนต้องไม่มีทางถูกส่งไปโฮสต์อื่น
const API_PATH = "/api/extension/portfolio";
const API_URL = SiteCall.ORIGIN + API_PATH;
const TOKEN_KEY = "syncToken";

const el = (id) => document.getElementById(id);

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// ── คลังตอนนี้ ──────────────────────────────────────────────────────
async function refreshVault() {
  el("statsNote").textContent = "";
  try {
    const items = await Storage.getItems();
    const counts = await Storage.getImageCounts();
    const images = Object.values(counts).reduce((sum, n) => sum + n, 0);

    el("statItems").textContent = items.length;
    el("statImages").textContent = images;

    // ขนาดจริงที่กินอยู่ ไม่ใช่ค่าประมาณ — เจ้าของเพิ่งเสียคลังไปสองรอบ ต้องเห็นของจริง
    try {
      el("statSize").textContent = fmtBytes(await chrome.storage.local.getBytesInUse(null));
    } catch (error) {
      el("statSize").textContent = "–";
    }

    if (!items.length) el("statsNote").textContent = "คลังยังว่าง — ดึงจากเว็บหรือกู้คืนจากไฟล์ได้เลย";
    else if (!images) el("statsNote").textContent = "มีผลงานแล้วแต่ยังไม่มีรูปสักใบ";
    return { items: items.length, images };
  } catch (error) {
    el("statsNote").textContent = `อ่านคลังไม่ได้: ${error.message}`;
    return null;
  }
}

el("refreshBtn").addEventListener("click", refreshVault);

// ── ตรวจก่อนเข้าคลัง (ใช้ร่วมกันทั้งดึงจากเว็บและเปิดไฟล์) ─────────────
let staged = null;

function clearStage() {
  staged = null;
  el("stage").hidden = true;
  el("working").hidden = true;
  el("fileWarn").hidden = true;
  el("file").value = "";
}

// นับรูปดิบก่อน parseImport กรอง — ถ้าเว็บส่งลิงก์รูปแทน base64 มันจะถูกทิ้งเงียบ ๆ
// แล้วผู้ใช้จะเชื่อว่าได้รูปครบ ต้องบอกว่าหายไปกี่ใบและเพราะอะไร
function countRawImages(text) {
  try {
    const raw = JSON.parse(text);
    const groups = raw && typeof raw.images === "object" && raw.images ? raw.images : {};
    return Object.values(groups).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  } catch (error) {
    return 0;
  }
}

// รับได้สองรูปแบบ: ไฟล์สำรองของส่วนขยาย และไฟล์ส่งออกโปรไฟล์ของเว็บ (/api/profile/export)
// เว็บมีปุ่มส่งออกอยู่แล้วและไฟล์นั้นมีข้อมูลครบ ผู้ใช้ที่มีไฟล์อยู่ในมือจะได้ไม่ต้องรออะไร
function readAny(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("ไฟล์ไม่ใช่ JSON ที่ถูกต้อง");
  }
  if (SiteImport.looksLikeSiteExport(data)) {
    const out = SiteImport.convert(data);
    return {
      parsed: { items: Model.normalize(out.items).items, images: {} },
      note: `จากไฟล์ส่งออกโปรไฟล์ของเว็บ · ผลงาน ${out.counts.achievements} · กิจกรรม ${out.counts.activities}` +
        (out.skipped ? ` · ข้ามที่ซ่อนไว้ ${out.skipped}` : ""),
    };
  }
  return { parsed: Model.parseImport(text), note: "" };
}

function stageJson(text, source) {
  const read = readAny(text); // โยน error ออกไปให้ผู้เรียกแสดงตามบริบท
  const parsed = read.parsed;
  const kept = Object.values(parsed.images).reduce((sum, list) => sum + list.length, 0);
  const dropped = countRawImages(text) - kept;

  staged = { parsed, source };
  el("fileItems").textContent = parsed.items.length;
  el("fileImages").textContent = kept;
  el("fileSize").textContent = fmtBytes(text.length);
  const tail = read.note
    ? read.note
    : kept
      ? "กดบันทึกแล้วรออีกสักครู่ ระหว่างเขียนรูปห้ามปิดแท็บนี้"
      : "ชุดนี้ไม่มีรูปติดมา จะได้แต่ข้อความ";
  el("fileNote").textContent = `${source} — ${tail}`;

  const warn = el("fileWarn");
  warn.hidden = dropped <= 0;
  if (dropped > 0) {
    warn.textContent =
      `รูป ${dropped} ใบใช้ไม่ได้ ถูกตัดทิ้ง — รับเฉพาะ data:image/...;base64 ` +
      `ถ้าเว็บส่งมาเป็นลิงก์ ต้องแปลงเป็น base64 ก่อนส่ง`;
  }

  el("result").hidden = true;
  el("stage").hidden = false;
  el("stage").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

el("cancelBtn").addEventListener("click", () => {
  el("pickError").hidden = true;
  clearStage();
});

// ── ดึงจากเว็บ ─────────────────────────────────────────────────────
el("apiUrl").textContent = API_URL;

el("openSite").addEventListener("click", () => chrome.tabs.create({ url: SiteCall.SITE_URL }));

el("tokenToggle").addEventListener("click", () => {
  el("tokenBox").hidden = !el("tokenBox").hidden;
});

el("tokenSave").addEventListener("click", async () => {
  const value = el("token").value.trim();
  await chrome.storage.local.set({ [TOKEN_KEY]: value });
  el("pullNote").textContent = value ? "จำโทเคนไว้แล้ว" : "ลบโทเคนแล้ว";
});

el("tokenClear").addEventListener("click", async () => {
  el("token").value = "";
  await chrome.storage.local.remove(TOKEN_KEY);
  el("pullNote").textContent = "ลบโทเคนแล้ว";
});

async function loadToken() {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  if (data[TOKEN_KEY]) {
    el("token").value = data[TOKEN_KEY];
    el("tokenBox").hidden = false;
  }
}


// มีโทเคน = ยิงตรงได้เลย ไม่ต้องพึ่งคุกกี้ (เผื่อวันหนึ่งเว็บออก API key ให้)
async function pullDirect(token) {
  const res = await fetch(API_URL, {
    credentials: "include",
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch((error) => {
    throw new Error(`ต่อเว็บไม่ได้ — เช็กเน็ตหรือเว็บล่มอยู่ (${error.message})`);
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

el("pullBtn").addEventListener("click", async () => {
  const note = el("pullNote");
  const btn = el("pullBtn");
  btn.disabled = true;
  el("pickError").hidden = true;

  try {
    const token = el("token").value.trim();
    note.textContent = token ? "กำลังดึงจากเว็บ (ใช้โทเคน)…" : "กำลังดึงจากเว็บผ่านแท็บที่ล็อกอินอยู่…";
    const res = token ? await pullDirect(token) : await SiteCall.request(API_PATH);

    if (!res.ok) throw new Error(SiteCall.explain(res.status));
    if (SiteCall.looksLikeHtml(res.text)) {
      throw new Error("เว็บส่ง HTML กลับมาแทน JSON — น่าจะเด้งไปหน้าล็อกอิน ลองล็อกอินใหม่");
    }

    stageJson(res.text, "ดึงจากเว็บ doodee-future");
    note.textContent = `ดึงมาแล้ว ${fmtBytes(res.text.length)} — ตรวจแล้วกดบันทึกเข้าคลังด้านล่าง`;
  } catch (error) {
    note.textContent = error.message;
    clearStage();
  } finally {
    btn.disabled = false;
  }
});

// ── เปิดไฟล์ ───────────────────────────────────────────────────────
async function readFile(file) {
  el("pickError").hidden = true;
  el("pullNote").textContent = "";
  if (!file) return;
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    fail("ไฟล์นี้ไม่ใช่ .json — เลือกไฟล์ที่ได้จากปุ่ม ส่งออกไฟล์สำรอง");
    return;
  }
  try {
    stageJson(await file.text(), file.name);
  } catch (error) {
    fail(error.message);
  }
}

function fail(message) {
  const box = el("pickError");
  box.textContent = message;
  box.hidden = false;
  clearStage();
}

el("file").addEventListener("change", (event) => readFile(event.target.files[0]));

const drop = el("drop");
["dragenter", "dragover"].forEach((name) =>
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((name) =>
  drop.addEventListener(name, () => drop.classList.remove("is-over")),
);
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  readFile(event.dataTransfer.files[0]);
});

// ── เขียนลงคลัง ────────────────────────────────────────────────────
function progress(done, total, label) {
  el("barFill").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  el("workingText").textContent = label;
}

el("restoreBtn").addEventListener("click", async () => {
  if (!staged) return;
  const { parsed } = staged;

  el("restoreBtn").disabled = true;
  el("working").hidden = false;
  progress(0, 1, "กำลังเขียนผลงานลงคลัง…");

  try {
    const items = await Storage.getItems();
    // upsert — ของที่มีอยู่แล้วแต่ไม่มีในชุดใหม่ต้องไม่หาย
    const merged = Model.mergeImport(items, parsed.items);
    await Storage.setItems(merged.items);

    // mergeImport แจก id ใหม่ให้ชิ้นที่ id ซ้ำกันเองในชุด ต้องตามให้รูปไปถูกชิ้น
    // จับคู่ด้วยหัวข้อ+วันที่สร้าง ซึ่งไม่เปลี่ยนตอนแจก id ใหม่
    const keptIds = new Map(
      parsed.items.map((entry) => {
        const match = merged.items.find(
          (saved) => saved.title === entry.title && saved.createdAt === entry.createdAt,
        );
        return [entry.id, match ? match.id : entry.id];
      }),
    );

    const groups = Object.entries(parsed.images);
    let restored = 0;
    let skipped = 0;
    let failed = 0;
    for (let i = 0; i < groups.length; i += 1) {
      const [oldId, list] = groups[i];
      const id = keptIds.get(oldId) || oldId;
      progress(i, groups.length, `กำลังเขียนรูป ${i + 1}/${groups.length} ชุด…`);
      try {
        const existing = await Storage.getImages(id);
        if (existing.length) {
          skipped += list.length; // มีรูปอยู่แล้ว ห้ามทับของที่แนบเอง
          continue;
        }
        await Storage.setImages(id, list);
        restored += list.length;
      } catch (error) {
        failed += list.length; // เขียนไม่ได้ชุดเดียว ต้องไม่ล้มทั้งงาน
      }
    }

    el("stage").hidden = true;
    const after = await refreshVault();

    const box = el("result");
    box.hidden = false;
    box.classList.toggle("is-bad", failed > 0);
    el("resultHead").textContent = failed ? "บันทึกแล้ว แต่ไม่ครบ" : "บันทึกเข้าคลังแล้ว";

    const parts = [`เพิ่ม ${merged.added}`, `อัปเดต ${merged.updated}`];
    if (restored) parts.push(`รูป ${restored} ใบ`);
    if (skipped) parts.push(`ข้ามรูป ${skipped} ใบ (ชิ้นนั้นมีรูปอยู่แล้ว)`);
    if (failed) parts.push(`เขียนรูปไม่สำเร็จ ${failed} ใบ`);
    if (merged.redone) parts.push(`id ซ้ำในชุด ${merged.redone} (แยกเป็นคนละชิ้นให้แล้ว)`);
    el("resultLead").textContent = parts.join(" · ");

    // อ่านกลับจากคลังจริงมายืนยัน ไม่ใช่รายงานจากตัวแปรในหน้านี้
    el("resultCheck").textContent = after
      ? `ตรวจซ้ำจากคลังจริง: ${after.items} ผลงาน · ${after.images} รูป`
      : "";
  } catch (error) {
    el("working").hidden = true;
    const box = el("result");
    box.hidden = false;
    box.classList.add("is-bad");
    el("resultHead").textContent = "บันทึกไม่สำเร็จ";
    el("resultLead").textContent = error.message;
    el("resultCheck").textContent = "คลังยังเหมือนเดิม ต้นทางไม่ถูกแตะ ลองใหม่ได้";
  } finally {
    staged = null;
    el("restoreBtn").disabled = false;
    el("file").value = "";
  }
});

// ── ส่งออก ─────────────────────────────────────────────────────────
el("exportBtn").addEventListener("click", async () => {
  const note = el("exportNote");
  note.hidden = false;
  note.textContent = "กำลังรวมไฟล์…";
  try {
    const items = await Storage.getItems();
    const images = {};
    let imageCount = 0;
    for (const item of items) {
      try {
        const list = await Storage.getImages(item.id);
        if (list.length) {
          images[item.id] = list;
          imageCount += list.length;
        }
      } catch (error) {
        // รูปชิ้นเดียวอ่านไม่ได้ ต้องไม่ทำให้ backup ทั้งก้อนล่ม
      }
    }

    const text = JSON.stringify(Model.toExport(items, Date.now(), images));
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `doodee-future-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    note.textContent = `ส่งออกแล้ว ${items.length} ผลงาน · รูป ${imageCount} ใบ · ${fmtBytes(text.length)}`;
  } catch (error) {
    note.textContent = `ส่งออกไม่สำเร็จ: ${error.message}`;
  }
});

loadToken();
refreshVault();
