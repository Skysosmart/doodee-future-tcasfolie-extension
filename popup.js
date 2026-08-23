// ข้อมูลทั้งหมดเก็บอยู่ในเครื่องเราเท่านั้น (chrome.storage.local)
// ไม่มีการส่งออกไปที่ไหนทั้งสิ้น

const el = (id) => document.getElementById(id);

let editingId = null; // null = กำลังเพิ่มใหม่, มีค่า = กำลังแก้ไขชิ้นนั้น
let statusTimer = null;

function showStatus(message, isError) {
  const status = el("status");
  status.textContent = message;
  status.className = isError ? "error" : "ok";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = "";
  }, 4000);
}

// เขียนทีละคิว — สองคลิกรัว ๆ จะได้ไม่อ่านค่าเดิมพร้อมกันแล้วเขียนทับกัน
let writeQueue = Promise.resolve();

async function mutate(change, okMessage) {
  const run = writeQueue.then(async () => {
    const items = await Storage.getItems();
    const next = change(items);
    if (next) await Storage.setItems(next);
  });
  writeQueue = run.catch(() => {}); // คิวต้องไม่ค้างถ้าอันก่อนหน้าพัง
  try {
    await run;
    if (okMessage) showStatus(okMessage);
    return true;
  } catch (error) {
    // storage พังเงียบ ๆ ไม่ได้ ผู้ใช้ต้องรู้ว่ากดแล้วไม่ติด
    showStatus(`ทำรายการไม่สำเร็จ: ${error.message}`, true);
    return false;
  }
}

function fillTypeOptions() {
  const select = el("type");
  for (const type of Model.TYPES) {
    const option = document.createElement("option");
    option.textContent = type;
    select.appendChild(option);
  }
}

// ระดับเว้นว่างได้ ไม่ใช่ทุกผลงานจะมีระดับ
function fillLevelOptions() {
  const select = el("level");
  const blank = document.createElement("option");
  blank.textContent = "";
  select.appendChild(blank);
  for (const level of Model.LEVELS) {
    const option = document.createElement("option");
    option.textContent = level;
    select.appendChild(option);
  }
}

function readForm() {
  return {
    type: el("type").value,
    title: el("title").value,
    org: el("org").value,
    level: el("level").value,
    result: el("result").value,
    hours: el("hours").value,
    tags: el("tags").value,
    detail: el("detail").value,
  };
}

// รูปที่แนบไว้กับฟอร์มตอนนี้ (ยังไม่บันทึก) — [{ name, type, data }]
let pendingImages = [];
// true เมื่อผู้ใช้แตะรูปในฟอร์มรอบนี้ (เพิ่ม/ลบ) — ถ้าไม่แตะ ห้ามเขียนทับรูปเดิมตอนบันทึก
// ไม่งั้น "โหลดรูปไม่ได้" ครั้งเดียวจะกลายเป็นลบรูปทั้งชุดตอนกดอัปเดตแก้คำผิด
let imagesTouched = false;
// true ระหว่างโหลดรูปของชิ้นที่แก้อยู่ — ระหว่างนี้บันทึกไม่ได้ กันทับของที่ยังไม่รู้ค่า
let imagesLoading = false;
let imageCounts = {};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // เกียรติบัตรถ่ายมือถือปกติไม่ถึง

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    reader.readAsDataURL(file);
  });
}

function renderPendingImages() {
  const list = el("imageList");
  list.replaceChildren(
    ...pendingImages.map((img, index) => {
      const box = document.createElement("div");
      box.className = "thumb";
      box.title = img.name;
      const pic = document.createElement("img");
      pic.src = img.data;
      pic.alt = img.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "เอารูปนี้ออก";
      remove.addEventListener("click", () => {
        pendingImages.splice(index, 1);
        imagesTouched = true;
        renderPendingImages();
      });
      box.append(pic, remove);
      return box;
    }),
  );
  el("imageBtn").textContent = pendingImages.length
    ? `＋ แนบรูปเพิ่ม (${pendingImages.length})`
    : "＋ แนบรูป";
}

function resetForm() {
  editingId = null;
  pendingImages = [];
  imagesTouched = false;
  imagesLoading = false;
  renderPendingImages();
  for (const option of [...el("type").querySelectorAll("[data-foreign]")]) {
    option.remove();
  }
  el("type").selectedIndex = 0;
  el("level").selectedIndex = 0;
  for (const id of ["title", "org", "result", "hours", "tags", "detail"]) el(id).value = "";
  el("formHeading").textContent = "เพิ่มผลงานจากเล่มเดิม";
  el("saveBtn").textContent = "บันทึกลงคลัง";
  el("cancelBtn").hidden = true;
}

async function startEditing(item) {
  editingId = item.id;
  pendingImages = [];
  imagesTouched = false;
  imagesLoading = true;
  renderPendingImages();
  let loaded = null;
  let loadError = null;
  try {
    loaded = await Storage.getImages(item.id);
  } catch (error) {
    loadError = error;
  }
  // ระหว่างรอโหลด ผู้ใช้อาจกดไปชิ้นอื่น/ยกเลิกแล้ว — ห้ามเอาผลมาวางลงตัวแปรเด็ดขาด
  // ไม่งั้นรูปของชิ้น A จะไปติดกับชิ้นที่บันทึกถัดไป (เคยพบใน review)
  if (editingId !== item.id) return;
  imagesLoading = false;
  if (loadError) {
    // โหลดไม่ได้ ≠ ไม่มีรูป — ปล่อย pendingImages ว่างแต่ห้ามเขียนทับตอนบันทึก
    showStatus(`โหลดรูปไม่ได้: ${loadError.message} — บันทึกได้ แต่รูปเดิมจะไม่ถูกแตะ`, true);
  } else {
    pendingImages = loaded;
  }
  renderPendingImages();
  // ของที่ import มาหรือแก้มือมาอาจมีประเภทที่ไม่อยู่ในลิสต์
  // ตั้ง value เฉย ๆ จะได้ selectedIndex -1 แล้วบันทึกกลับเป็นค่าว่าง
  // ซึ่งแปลว่าผลงานชิ้นนั้นหลุดจากตัวกรองทุกอันโดยไม่มีใครรู้
  if (item.type && !Model.TYPES.includes(item.type)) {
    const option = document.createElement("option");
    option.textContent = item.type;
    option.dataset.foreign = "true";
    el("type").appendChild(option);
  }
  el("type").value = item.type;
  el("title").value = item.title;
  el("org").value = item.org;
  el("level").value = item.level || "";
  el("result").value = item.result || "";
  el("hours").value = item.hours || "";
  el("tags").value = Model.formatTags(item.tags);
  el("detail").value = item.detail;
  el("formHeading").textContent = "แก้ไขผลงาน";
  el("saveBtn").textContent = "อัปเดต";
  el("cancelBtn").hidden = false;
  window.scrollTo(0, 0);
  el("title").focus();
}

function itemCard(item) {
  const box = document.createElement("div");
  box.className = "item";

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = item.title;

  const meta = document.createElement("div");
  meta.className = "item-meta";
  const extras = [item.level, item.result].filter(Boolean).join(" · ");
  meta.textContent = [item.type, item.org, extras].filter(Boolean).join(" · ");

  box.append(title, meta);

  if (item.tags.length) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const tag of item.tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      tags.appendChild(chip);
    }
    box.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy";
  copyBtn.textContent = "คัดลอกรายละเอียด";
  let resetTimer = 0;
  copyBtn.addEventListener("click", async () => {
    clearTimeout(resetTimer); // กดรัว ๆ อันเก่าต้องไม่มาล้างป้ายของอันใหม่
    if (!item.detail) {
      // writeText("") สำเร็จเสมอ แล้วไปล้างของที่ผู้ใช้เพิ่งคัดลอกมาทิ้ง
      copyBtn.textContent = "ไม่มีรายละเอียดให้คัดลอก";
    } else {
      try {
        await navigator.clipboard.writeText(item.detail);
        copyBtn.textContent = "คัดลอกแล้ว ✓";
      } catch (error) {
        copyBtn.textContent = "คัดลอกไม่สำเร็จ";
      }
    }
    resetTimer = setTimeout(() => {
      copyBtn.textContent = "คัดลอกรายละเอียด";
    }, 1200);
  });

  const editBtn = document.createElement("button");
  editBtn.className = "edit";
  editBtn.textContent = "แก้ไข";
  editBtn.addEventListener("click", () => startEditing(item));

  const delBtn = document.createElement("button");
  delBtn.className = "del";
  delBtn.textContent = "ลบ";
  let armed = false;
  let armTimer = null;
  delBtn.addEventListener("click", async () => {
    if (!armed) {
      // ยืนยันสองจังหวะแทน confirm() เพราะ dialog ทำให้ popup ปิดตัวเอง
      armed = true;
      delBtn.textContent = "แน่ใจ?";
      armTimer = setTimeout(() => {
        armed = false;
        delBtn.textContent = "ลบ";
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    // ลบด้วย id ไม่ใช่ตำแหน่งในลิสต์ — ตำแหน่งเปลี่ยนได้ระหว่างที่ popup เปิดอยู่
    const ok = await mutate((items) => Model.remove(items, item.id), "ลบแล้ว");
    if (ok) {
      // รูปไม่ได้อยู่ใน folioItems ต้องลบแยก ไม่งั้นกินที่ค้างตลอด
      Storage.removeImages(item.id).catch(() => {});
    }
    // ล้างฟอร์มเฉพาะตอนลบสำเร็จ — ลบไม่ติดแล้วล้าง ผู้ใช้จะเสียของที่พิมพ์ค้างไว้
    if (ok && editingId === item.id) resetForm();
    render(); // วาดใหม่เสมอ ปุ่มจะได้ไม่ค้างอยู่ที่ "แน่ใจ?"
  });

  actions.append(copyBtn, editBtn, delBtn);
  box.appendChild(actions);

  const n = imageCounts[item.id] || 0;
  if (n) {
    const badge = document.createElement("span");
    badge.className = "img-count";
    badge.textContent = `🖼 ${n}`;
    title.appendChild(badge);
  }
  return box;
}

async function render(known) {
  let items;
  try {
    items = known || (await Storage.getItems());
  } catch (error) {
    // อ่านไม่ได้ ห้ามวาดว่า "ยังไม่มีข้อมูล" เด็ดขาด — ผู้ใช้จะนึกว่าของหายทั้งคลัง
    // แล้วอาจไปเริ่มพิมพ์ใหม่ทับของเดิมที่จริง ๆ ยังอยู่
    showStatus(`อ่านคลังผลงานไม่ได้: ${error.message}`, true);
    el("count").textContent = "?";
    el("list").replaceChildren();
    el("empty").textContent = "อ่านข้อมูลไม่ได้ — ยังไม่ต้องพิมพ์ใหม่ ลองปิดแล้วเปิดใหม่ก่อน";
    el("empty").style.display = "block";
    return;
  }
  el("empty").textContent = "ยังไม่มีข้อมูล";
  // คลังว่าง = ครั้งแรก → โชว์ 3 ขั้นสั้น ๆ แทนข้อความเปล่า หายเองเมื่อมีผลงาน
  el("welcome").hidden = items.length > 0;
  try {
    imageCounts = await Storage.getImageCounts();
  } catch (error) {
    imageCounts = {}; // นับไม่ได้ก็แค่ไม่โชว์ป้าย ไม่ต้องล้มทั้งหน้า
  }

  // ชิ้นที่กำลังแก้อยู่ถูกลบไปจากที่อื่น — ต้องเลิกแก้
  // ไม่งั้นกด "อัปเดต" แล้ว upsert จะสร้างมันกลับขึ้นมาใหม่เงียบ ๆ
  if (editingId && !items.some((entry) => entry.id === editingId)) {
    resetForm();
    showStatus("ผลงานที่กำลังแก้ถูกลบไปแล้ว", true);
  }

  el("count").textContent = items.length;
  el("empty").style.display = items.length ? "none" : "block";
  el("welcome").hidden = items.length > 0;
  el("list").replaceChildren(...items.map(itemCard));
}

el("saveBtn").addEventListener("click", async () => {
  const fields = readForm();
  if (!fields.title.trim()) {
    showStatus("ต้องมีชื่อผลงานก่อนถึงจะบันทึกได้", true);
    el("title").focus();
    return;
  }

  if (imagesLoading) {
    showStatus("กำลังโหลดรูปของผลงานนี้อยู่ รอสักครู่แล้วกดบันทึกอีกที", true);
    return;
  }

  const wasEditing = editingId;
  // ชิ้นใหม่ต้องรู้ id ก่อนถึงจะเก็บรูปผูกกับมันได้
  const targetId = wasEditing || Model.newId();
  const ok = await mutate((items) => {
    const existing = wasEditing ? items.find((i) => i.id === wasEditing) : null;
    return Model.upsert(
      items,
      Model.makeItem(fields, {
        id: targetId,
        // แก้ไขแล้ววันที่สร้างต้องไม่เปลี่ยน
        now: existing ? existing.createdAt : Date.now(),
      }),
    );
  }, wasEditing ? "อัปเดตแล้ว" : "บันทึกแล้ว");

  if (!ok) return; // เขียนไม่สำเร็จ อย่าล้างฟอร์ม ผู้ใช้จะได้กดใหม่ได้

  // เขียนรูปเฉพาะตอนผู้ใช้แตะรูปจริง ๆ — แก้แค่ข้อความแล้วรูปเดิมต้องอยู่เหมือนเดิม
  if (imagesTouched) {
    try {
      await Storage.setImages(targetId, pendingImages);
    } catch (error) {
      // ข้อความติดแล้วแต่รูปไม่ติด — ล็อกฟอร์มไว้ที่ชิ้นนี้ (editingId = targetId)
      // ไม่งั้นกดบันทึกซ้ำจะสุ่ม id ใหม่แล้วได้ผลงานซ้ำสองชิ้น
      editingId = targetId;
      el("formHeading").textContent = "แก้ไขผลงาน";
      el("saveBtn").textContent = "อัปเดต";
      el("cancelBtn").hidden = false;
      showStatus(`บันทึกข้อความแล้ว แต่เก็บรูปไม่สำเร็จ: ${error.message} — กดอัปเดตอีกครั้งเพื่อลองใหม่`, true);
      render();
      return;
    }
  }
  resetForm();
  render();
});

el("cancelBtn").addEventListener("click", () => resetForm());

el("imageBtn").addEventListener("click", () => el("imageFile").click());

el("imageFile").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้
  if (!files.length) return;
  let skipped = 0;
  for (const file of files) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) { skipped += 1; continue; }
    if (file.size > MAX_IMAGE_BYTES) { skipped += 1; continue; }
    try {
      pendingImages.push({ name: file.name, type: file.type, data: await readFileAsDataUrl(file) });
      imagesTouched = true;
    } catch (error) {
      skipped += 1;
    }
  }
  renderPendingImages();
  if (skipped) {
    showStatus(`ข้ามไป ${skipped} ไฟล์ — รับเฉพาะ JPG/PNG ไม่เกิน 2 MB`, true);
  } else {
    showStatus(`แนบรูปแล้ว ${pendingImages.length} ใบ — กดบันทึกเพื่อเก็บ`);
  }
});

el("exportBtn").addEventListener("click", async () => {
  try {
    const items = await Storage.getItems();
    const text = JSON.stringify(Model.toExport(items, Date.now()), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `doodee-future-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();

    // ปล่อยทิ้งหลังดาวน์โหลดเริ่มแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showStatus(`ส่งออก ${items.length} รายการแล้ว`);
  } catch (error) {
    // นี่คือทางสำรองข้อมูล ถ้ามันเงียบ ผู้ใช้จะเชื่อว่า backup แล้วทั้งที่ไม่มีไฟล์
    showStatus(`ส่งออกไม่สำเร็จ: ${error.message}`, true);
  }
});

el("importBtn").addEventListener("click", () => el("importFile").click());
el("welcomeImport").addEventListener("click", () => el("importFile").click());

el("importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const incoming = Model.parseImport(await file.text());
    let added = 0;
    let updated = 0;
    let redone = 0;
    // ผ่านคิวเดียวกับ save/delete กันเขียนชนกัน
    const ok = await mutate((items) => {
      // รวมแบบ upsert — ของที่มีอยู่แล้วแต่ไม่มีในไฟล์ backup ต้องไม่หาย
      const result = Model.mergeImport(items, incoming);
      added = result.added;
      updated = result.updated;
      redone = result.redone;
      return result.items;
    });
    if (ok) {
      const extra = redone ? ` · id ซ้ำในไฟล์ ${redone} (แยกเป็นคนละชิ้นให้แล้ว)` : "";
      showStatus(`นำเข้าแล้ว: เพิ่ม ${added} · อัปเดต ${updated}${extra}`);
      render();
    }
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    event.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้
  }
});

fillTypeOptions();
fillLevelOptions();
// อีกหน้าต่างหนึ่งแก้ข้อมูล หน้านี้ต้องตามทัน
Storage.onItemsChanged((items) => render(items));
render();
