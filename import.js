// หน้านำเข้าพอร์ตจาก PDF — เชื่อม pdf.js เข้ากับ pdfText/pdfImage แล้วให้ผู้ใช้ตรวจก่อนบันทึก
//
// ไม่แตะระบบเดิม: อ่าน Model.TYPES/LEVELS มาใช้ และบันทึกผ่าน Storage แบบ upsert
// (เพิ่มของใหม่ ไม่ลบ ไม่ทับของเดิม) เหมือนปุ่มนำเข้า JSON ที่มีอยู่แล้ว
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

const MAX_PAGES_NO_ASK = 60;

const el = (id) => document.getElementById(id);
const views = {
  pick: el("pick"),
  reading: el("reading"),
  review: el("review"),
  done: el("done"),
};

let cancelled = false;
let drafts = [];
let imagesByPage = new Map();
let rawByPage = [];

function show(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
}

function fail(message) {
  const box = el("pickError");
  box.textContent = message;
  box.hidden = false;
  show("pick");
}

// ── อ่านไฟล์ ────────────────────────────────────────────────────────
async function readFile(file) {
  el("pickError").hidden = true;
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    fail("ไฟล์นี้ไม่ใช่ PDF — เลือกไฟล์ .pdf ที่ส่งออกจาก Canva, Word หรือ Google Docs");
    return;
  }

  cancelled = false;
  show("reading");
  el("readingStatus").textContent = "เปิดไฟล์…";
  el("barFill").style.width = "2%";

  let doc;
  try {
    const buffer = await file.arrayBuffer();
    doc = await pdfjsLib.getDocument({ data: buffer, isEvalSupported: false }).promise;
  } catch (error) {
    const why = String((error && error.name) || "");
    if (why === "PasswordException") {
      fail("ไฟล์นี้ใส่รหัสไว้ — ปลดรหัสแล้วส่งออกใหม่ก่อนนำเข้า");
    } else {
      fail(`เปิดไฟล์ไม่ได้ (${(error && error.message) || "ไม่ทราบสาเหตุ"}) — ไฟล์อาจเสียหาย`);
    }
    return;
  }

  if (doc.numPages > MAX_PAGES_NO_ASK) {
    const ok = confirm(
      `เล่มนี้มี ${doc.numPages} หน้า อ่านทั้งเล่มอาจใช้เวลาหลายนาที จะอ่านต่อมั้ย?`,
    );
    if (!ok) {
      show("pick");
      return;
    }
  }

  const pages = [];
  const seenShots = new Set();
  imagesByPage = new Map();
  rawByPage = [];

  for (let n = 1; n <= doc.numPages; n += 1) {
    if (cancelled) {
      show("pick");
      return;
    }
    el("readingStatus").textContent = `อ่านหน้า ${n}/${doc.numPages}`;
    el("barFill").style.width = `${Math.round((n / doc.numPages) * 100)}%`;

    try {
      const page = await doc.getPage(n);
      const text = await page.getTextContent();
      const items = (text.items || [])
        .filter((it) => it && typeof it.str === "string")
        .map((it) => ({
          str: it.str,
          x: it.transform ? it.transform[4] : 0,
          // pdf.js นับ y จากล่างขึ้นบน (y มาก = อยู่สูง) ซึ่งตรงกับที่ pdfText เรียงอยู่แล้ว
          // (buildRows เรียง y มาก→น้อย = บนลงล่าง) ส่งค่าดิบไปได้เลย ไม่ต้องกลับด้าน
          y: it.transform ? it.transform[5] : 0,
          w: Number(it.width) || 0,
          h: Number(it.height) || 0,
        }));
      pages.push({ page: n, items });
      rawByPage.push({ page: n, text: items.map((i) => i.str).join(" ") });

      // พื้นหลัง/ลายกราฟิกเดียวกันถูกฝังซ้ำทุกหน้า กันซ้ำข้ามทั้งเล่ม ไม่ใช่แค่ในหน้า
      const shots = (await PdfImage.fromPage(page, pdfjsLib)).filter((shot) => {
        if (!shot.fingerprint) return true;
        if (seenShots.has(shot.fingerprint)) return false;
        seenShots.add(shot.fingerprint);
        return true;
      });
      if (shots.length) imagesByPage.set(n, shots);
    } catch (error) {
      rawByPage.push({ page: n, text: `(อ่านหน้านี้ไม่ได้: ${error.message})` });
    }
  }

  const hasText = pages.some((p) => p.items.length);
  if (!hasText) {
    fail(
      "อ่านตัวอักษรจากไฟล์นี้ไม่ได้ — น่าจะเป็นไฟล์สแกนหรือรูปทั้งเล่ม " +
        "ลองส่งออกเป็น PDF ใหม่จาก Canva/Word แทนการสแกน",
    );
    return;
  }

  const result = PdfText.toDrafts(pages);
  drafts = result.drafts.map((d, i) => ({
    ...d,
    id: `draft-${i}`,
    org: "",
    result: "",
    chosen: true,
    pickedImages: new Set(),
  }));

  renderReview(result.skipped, doc.numPages);
  show("review");
}

// ── หน้าตรวจ ────────────────────────────────────────────────────────
function renderReview(skipped, pageCount) {
  const shots = [...imagesByPage.values()].reduce((n, list) => n + list.length, 0);
  el("reviewLead").textContent =
    `จากเล่ม ${pageCount} หน้า ได้ร่าง ${drafts.length} ชิ้น และรูป ${shots} ใบ · ` +
    `ติ๊กเลือกและแก้ให้ถูกก่อนบันทึก`;

  const box = el("drafts");
  box.replaceChildren(...drafts.map(draftCard));

  const list = el("skippedList");
  el("skipped").hidden = !skipped.length;
  list.replaceChildren(
    ...skipped.map((s) => {
      const li = document.createElement("li");
      li.textContent = `หน้า ${s.page} — ${s.why}`;
      return li;
    }),
  );

  // อ่านตัวอักษรได้แต่ตัดชิ้นไม่ได้เลย: โชว์ข้อความดิบ ดีกว่าหน้าว่าง
  el("rawBox").hidden = drafts.length > 0;
  if (!drafts.length) {
    el("raw").value = rawByPage.map((p) => `— หน้า ${p.page} —\n${p.text}`).join("\n\n");
  }
  updateSaveButton();
}

function field(labelText, node, wide) {
  const wrap = document.createElement("div");
  wrap.className = wide ? "field wide" : "field";
  const label = document.createElement("label");
  label.className = "small";
  label.textContent = labelText;
  wrap.append(label, node);
  return wrap;
}

function draftCard(draft) {
  const card = document.createElement("div");
  card.className = "draft";

  const top = document.createElement("div");
  top.className = "draft-top";

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = draft.chosen;
  check.addEventListener("change", () => {
    draft.chosen = check.checked;
    card.classList.toggle("is-off", !draft.chosen);
    updateSaveButton();
  });

  const label = document.createElement("strong");
  label.textContent = draft.title || "(ยังไม่มีหัวข้อ)";

  top.append(check, label);

  if (!draft.type) {
    const warn = document.createElement("span");
    warn.className = "needs";
    warn.textContent = "ยังไม่รู้หมวด";
    top.append(warn);
  }

  const page = document.createElement("span");
  page.className = "page-tag";
  page.textContent = `หน้า ${draft.page}`;
  top.append(page);

  const grid = document.createElement("div");
  grid.className = "grid";

  const title = document.createElement("input");
  title.type = "text";
  title.value = draft.title;
  title.addEventListener("input", () => {
    draft.title = title.value;
    label.textContent = draft.title || "(ยังไม่มีหัวข้อ)";
  });

  const type = document.createElement("select");
  type.append(new Option("— เลือกหมวด —", ""));
  for (const t of Model.TYPES) type.append(new Option(t, t));
  type.value = draft.type || "";
  type.addEventListener("change", () => {
    draft.type = type.value;
  });

  const level = document.createElement("select");
  level.append(new Option("— ไม่ระบุ —", ""));
  for (const l of Model.LEVELS) level.append(new Option(l, l));
  level.value = draft.level || "";
  level.addEventListener("change", () => {
    draft.level = level.value;
  });

  const org = document.createElement("input");
  org.type = "text";
  org.placeholder = "เช่น สำนักงานการวิจัยแห่งชาติ · 2569";
  org.addEventListener("input", () => {
    draft.org = org.value;
  });

  const detail = document.createElement("textarea");
  detail.rows = 6;
  detail.value = draft.detail;
  detail.addEventListener("input", () => {
    draft.detail = detail.value;
  });

  grid.append(
    field("หัวข้อ", title, true),
    field("หมวด", type),
    field("ระดับ", level),
    field("หน่วยงาน / ปี (ถ้ามี)", org, true),
    field("รายละเอียด", detail, true),
  );

  card.append(top, grid);

  const shots = imagesByPage.get(draft.page) || [];
  if (shots.length) {
    const row = document.createElement("div");
    row.className = "shots";
    shots.forEach((shot, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shot";
      btn.title = `${shot.width}×${shot.height} · ${Math.round(shot.bytes / 1024)} KB`;
      const img = document.createElement("img");
      img.src = shot.data;
      img.alt = "";
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = "✓";
      btn.append(img, mark);
      btn.addEventListener("click", () => {
        if (draft.pickedImages.has(index)) draft.pickedImages.delete(index);
        else draft.pickedImages.add(index);
        btn.classList.toggle("is-on", draft.pickedImages.has(index));
      });
      row.append(btn);
    });
    card.append(field(`รูปในหน้า ${draft.page} — คลิกเพื่อเลือกแนบ`, row, true));
  } else {
    const none = document.createElement("p");
    none.className = "shots-none";
    none.textContent = "ไม่มีรูปที่ใช้ได้ในหน้านี้";
    card.append(none);
  }

  return card;
}

function updateSaveButton() {
  const n = drafts.filter((d) => d.chosen).length;
  const btn = el("save");
  btn.disabled = n === 0;
  btn.textContent = n ? `บันทึก ${n} ชิ้นเข้าคลัง` : "บันทึกเข้าคลัง";
}

// ── บันทึก ──────────────────────────────────────────────────────────
async function save() {
  const chosen = drafts.filter((d) => d.chosen);
  if (!chosen.length) return;

  const btn = el("save");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก…";

  try {
    const existing = await Storage.getItems();
    const made = chosen.map((d) =>
      Model.makeItem({
        type: d.type,
        title: d.title,
        org: d.org,
        level: d.level,
        result: d.result,
        detail: d.detail,
      }),
    );
    // Model.upsert รับทีละชิ้น — วนใส่ทีละอันเพื่อให้ได้พฤติกรรมเดียวกับปุ่มนำเข้า JSON
    let next = existing;
    for (const item of made) next = Model.upsert(next, item);
    await Storage.setItems(next);

    let imageCount = 0;
    for (let i = 0; i < chosen.length; i += 1) {
      const draft = chosen[i];
      if (!draft.pickedImages.size) continue;
      const shots = imagesByPage.get(draft.page) || [];
      const picked = [...draft.pickedImages]
        .sort((a, b) => a - b)
        .map((index) => shots[index])
        .filter(Boolean)
        .map((shot) => ({ name: shot.name, type: shot.type, data: shot.data }));
      if (!picked.length) continue;
      await Storage.setImages(made[i].id, picked);
      imageCount += picked.length;
    }

    el("doneLead").textContent =
      `เพิ่มผลงาน ${made.length} ชิ้น และรูป ${imageCount} ใบ เข้าคลังแล้ว ` +
      `ของเดิมในคลังไม่ถูกลบหรือทับ`;
    show("done");
  } catch (error) {
    btn.disabled = false;
    updateSaveButton();
    alert(`บันทึกไม่สำเร็จ: ${error.message}`);
  }
}

// ── ต่อสายเหตุการณ์ ─────────────────────────────────────────────────
el("file").addEventListener("change", (event) => {
  readFile(event.target.files && event.target.files[0]);
});

const drop = el("drop");
for (const type of ["dragenter", "dragover"]) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
}
for (const type of ["dragleave", "drop"]) {
  drop.addEventListener(type, () => drop.classList.remove("is-over"));
}
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  readFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
});

el("cancelRead").addEventListener("click", () => {
  cancelled = true;
});

el("selectAll").addEventListener("click", () => {
  drafts.forEach((d) => {
    d.chosen = true;
  });
  el("drafts").replaceChildren(...drafts.map(draftCard));
  updateSaveButton();
});

el("selectNone").addEventListener("click", () => {
  drafts.forEach((d) => {
    d.chosen = false;
  });
  el("drafts").replaceChildren(...drafts.map(draftCard));
  updateSaveButton();
});

el("save").addEventListener("click", save);

el("again").addEventListener("click", () => {
  drafts = [];
  imagesByPage = new Map();
  el("file").value = "";
  show("pick");
});
