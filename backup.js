// หน้าสำรอง/กู้คืนคลัง — เป็นแท็บของตัวเอง ไม่ทำใน popup
//
// popup ปิดตัวเองทันทีที่ file dialog ของระบบเปิดขึ้น หน้าถูกทำลายก่อน change จะยิง
// ไฟล์ที่เลือกจึงหายเงียบ ๆ ไม่มี error ให้เห็น (เกิดจริง: กู้คืน backup แล้วคลังยังว่าง
// ทั้งที่กดครบทุกขั้น) แท็บไม่มีปัญหานี้ และการเขียนรูปหลายสิบ MB ก็ใช้เวลาเกินอายุ popup อยู่แล้ว
"use strict";

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

    // ขนาดจริงที่กินอยู่ ไม่ใช่ค่าประมาณ — ผู้ใช้เพิ่งเสียคลังไปสองรอบ ต้องเห็นของจริง
    let used = 0;
    try {
      used = await chrome.storage.local.getBytesInUse(null);
      el("statSize").textContent = fmtBytes(used);
    } catch (error) {
      el("statSize").textContent = "–";
    }

    if (!items.length) {
      el("statsNote").textContent = "คลังยังว่าง — กู้คืนจากไฟล์สำรองด้านล่างได้เลย";
    } else if (!images) {
      el("statsNote").textContent = "มีผลงานแล้วแต่ยังไม่มีรูปสักใบ";
    }
    return { items: items.length, images };
  } catch (error) {
    el("statsNote").textContent = `อ่านคลังไม่ได้: ${error.message}`;
    return null;
  }
}

el("refreshBtn").addEventListener("click", refreshVault);

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
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
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

// ── กู้คืน ─────────────────────────────────────────────────────────
let staged = null;

function clearPreview() {
  staged = null;
  el("preview").hidden = true;
  el("result").hidden = true;
  el("working").hidden = true;
  el("file").value = "";
}

function fail(message) {
  const box = el("pickError");
  box.textContent = message;
  box.hidden = false;
  clearPreview();
}

async function readFile(file) {
  el("pickError").hidden = true;
  el("result").hidden = true;
  if (!file) return;
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    fail("ไฟล์นี้ไม่ใช่ .json — เลือกไฟล์ที่ได้จากปุ่ม ส่งออกไฟล์สำรอง");
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    fail(`เปิดไฟล์ไม่ได้: ${error.message}`);
    return;
  }

  let parsed;
  try {
    parsed = Model.parseImport(text);
  } catch (error) {
    fail(error.message);
    return;
  }

  const images = Object.values(parsed.images).reduce((sum, list) => sum + list.length, 0);
  staged = { parsed, name: file.name };

  el("fileItems").textContent = parsed.items.length;
  el("fileImages").textContent = images;
  el("fileSize").textContent = fmtBytes(text.length);
  el("fileNote").textContent = images
    ? `${file.name} — กดกู้คืนแล้วรออีกสักครู่ ระหว่างเขียนรูปห้ามปิดแท็บนี้`
    : `${file.name} — ไฟล์นี้ไม่มีรูปติดมา จะได้แต่ข้อความ`;
  el("preview").hidden = false;
}

el("file").addEventListener("change", (event) => readFile(event.target.files[0]));
el("cancelBtn").addEventListener("click", () => {
  el("pickError").hidden = true;
  clearPreview();
});

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

function progress(done, total, label) {
  el("barFill").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  el("workingText").textContent = label;
}

el("restoreBtn").addEventListener("click", async () => {
  if (!staged) return;
  const { parsed } = staged;

  el("preview").hidden = true;
  el("working").hidden = false;
  progress(0, 1, "กำลังเขียนผลงานลงคลัง…");

  try {
    const items = await Storage.getItems();
    // upsert — ของที่มีอยู่แล้วแต่ไม่มีในไฟล์ต้องไม่หาย
    const merged = Model.mergeImport(items, parsed.items);
    await Storage.setItems(merged.items);

    // mergeImport แจก id ใหม่ให้ชิ้นที่ id ซ้ำกันเองในไฟล์ ต้องตามให้รูปไปถูกชิ้น
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
        failed += list.length; // เขียนไม่ได้ชุดเดียว ต้องไม่ล้มทั้งการกู้คืน
      }
    }

    el("working").hidden = true;
    const after = await refreshVault();

    const box = el("result");
    box.hidden = false;
    box.classList.toggle("is-bad", failed > 0);
    el("resultHead").textContent = failed ? "กู้คืนแล้ว แต่ไม่ครบ" : "กู้คืนเข้าคลังแล้ว";

    const parts = [`เพิ่ม ${merged.added}`, `อัปเดต ${merged.updated}`];
    if (restored) parts.push(`รูป ${restored} ใบ`);
    if (skipped) parts.push(`ข้ามรูป ${skipped} ใบ (ชิ้นนั้นมีรูปอยู่แล้ว)`);
    if (failed) parts.push(`เขียนรูปไม่สำเร็จ ${failed} ใบ`);
    if (merged.redone) parts.push(`id ซ้ำในไฟล์ ${merged.redone} (แยกเป็นคนละชิ้นให้แล้ว)`);
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
    el("resultHead").textContent = "กู้คืนไม่สำเร็จ";
    el("resultLead").textContent = error.message;
    el("resultCheck").textContent = "คลังยังเหมือนเดิม ไฟล์สำรองไม่ถูกแตะ ลองใหม่ได้";
  } finally {
    staged = null;
    el("file").value = "";
  }
});

refreshVault();
