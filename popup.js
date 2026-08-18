// ---------------------------------------------------------
// ข้อมูลทั้งหมดเก็บอยู่ในเครื่องเราเท่านั้น (chrome.storage.local)
// ไม่มีการส่งออกไปที่ไหนทั้งสิ้น
// ---------------------------------------------------------

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

function readForm() {
  return {
    type: el("type").value,
    title: el("title").value,
    org: el("org").value,
    tags: el("tags").value,
    detail: el("detail").value,
  };
}

function resetForm() {
  editingId = null;
  el("type").selectedIndex = 0;
  for (const id of ["title", "org", "tags", "detail"]) el(id).value = "";
  el("formHeading").textContent = "เพิ่มผลงานจากเล่มเดิม";
  el("saveBtn").textContent = "บันทึกลงคลัง";
  el("cancelBtn").hidden = true;
}

function startEditing(item) {
  editingId = item.id;
  el("type").value = item.type;
  el("title").value = item.title;
  el("org").value = item.org;
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
  meta.textContent = item.org ? `${item.type} · ${item.org}` : item.type;

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
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(item.detail);
      copyBtn.textContent = "คัดลอกแล้ว ✓";
    } catch (error) {
      copyBtn.textContent = "คัดลอกไม่สำเร็จ";
    }
    setTimeout(() => {
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
    // ล้างฟอร์มเฉพาะตอนลบสำเร็จ — ลบไม่ติดแล้วล้าง ผู้ใช้จะเสียของที่พิมพ์ค้างไว้
    if (ok && editingId === item.id) resetForm();
    render(); // วาดใหม่เสมอ ปุ่มจะได้ไม่ค้างอยู่ที่ "แน่ใจ?"
  });

  actions.append(copyBtn, editBtn, delBtn);
  box.appendChild(actions);
  return box;
}

async function render(known) {
  const items = known || (await Storage.getItems());

  // ชิ้นที่กำลังแก้อยู่ถูกลบไปจากที่อื่น — ต้องเลิกแก้
  // ไม่งั้นกด "อัปเดต" แล้ว upsert จะสร้างมันกลับขึ้นมาใหม่เงียบ ๆ
  if (editingId && !items.some((entry) => entry.id === editingId)) {
    resetForm();
    showStatus("ผลงานที่กำลังแก้ถูกลบไปแล้ว", true);
  }

  el("count").textContent = items.length;
  el("empty").style.display = items.length ? "none" : "block";
  el("list").replaceChildren(...items.map(itemCard));
}

el("saveBtn").addEventListener("click", async () => {
  const fields = readForm();
  if (!fields.title.trim()) {
    showStatus("ต้องมีชื่อผลงานก่อนถึงจะบันทึกได้", true);
    el("title").focus();
    return;
  }

  const wasEditing = editingId;
  const ok = await mutate((items) => {
    const existing = wasEditing ? items.find((i) => i.id === wasEditing) : null;
    return Model.upsert(
      items,
      Model.makeItem(fields, {
        id: wasEditing || undefined,
        // แก้ไขแล้ววันที่สร้างต้องไม่เปลี่ยน
        now: existing ? existing.createdAt : Date.now(),
      }),
    );
  }, wasEditing ? "อัปเดตแล้ว" : "บันทึกแล้ว");

  if (!ok) return; // เขียนไม่สำเร็จ อย่าล้างฟอร์ม ผู้ใช้จะได้กดใหม่ได้
  resetForm();
  render();
});

el("cancelBtn").addEventListener("click", () => resetForm());

el("exportBtn").addEventListener("click", async () => {
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
});

el("importBtn").addEventListener("click", () => el("importFile").click());

el("importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const incoming = Model.parseImport(await file.text());
    let added = 0;
    let updated = 0;
    // ผ่านคิวเดียวกับ save/delete กันเขียนชนกัน
    const ok = await mutate((items) => {
      // รวมแบบ upsert — ของที่มีอยู่แล้วแต่ไม่มีในไฟล์ backup ต้องไม่หาย
      const result = Model.mergeImport(items, incoming);
      added = result.added;
      updated = result.updated;
      return result.items;
    });
    if (ok) {
      showStatus(`นำเข้าแล้ว: เพิ่ม ${added} · อัปเดต ${updated}`);
      render();
    }
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    event.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้
  }
});

fillTypeOptions();
// อีกหน้าต่างหนึ่งแก้ข้อมูล หน้านี้ต้องตามทัน
Storage.onItemsChanged((items) => render(items));
render();
