// ---------------------------------------------------------
// ข้อมูลทั้งหมดเก็บอยู่ในเครื่องเราเท่านั้น (chrome.storage.local)
// ไม่มีการส่งออกไปที่ไหนทั้งสิ้น
// ---------------------------------------------------------

const KEY = "folioItems";

// ดึงรายการทั้งหมดจากที่เก็บ
async function getItems() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || []; // ถ้ายังไม่เคยบันทึก จะได้ลิสต์ว่าง
}

// เขียนรายการทั้งหมดกลับลงที่เก็บ
async function setItems(items) {
  await chrome.storage.local.set({ [KEY]: items });
}

// วาดรายการออกมาบนหน้าจอ
async function render() {
  const items = await getItems();
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");

  document.getElementById("count").textContent = items.length;
  list.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item, index) => {
    const box = document.createElement("div");
    box.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.type} · ${item.org}`;

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "คัดลอกรายละเอียด";
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(item.detail);
      copyBtn.textContent = "คัดลอกแล้ว ✓";
      setTimeout(() => (copyBtn.textContent = "คัดลอกรายละเอียด"), 1200);
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "ลบ";
    delBtn.className = "del";
    delBtn.onclick = async () => {
      const current = await getItems();
      current.splice(index, 1); // เอาตัวที่ตำแหน่งนี้ออก
      await setItems(current);
      render();
    };

    actions.append(copyBtn, delBtn);
    box.append(title, meta, actions);
    list.appendChild(box);
  });
}

// ปุ่มบันทึก
document.getElementById("saveBtn").addEventListener("click", async () => {
  const title = document.getElementById("title").value.trim();
  if (!title) return; // ไม่มีชื่อผลงาน ก็ไม่บันทึก

  const items = await getItems();
  items.push({
    type: document.getElementById("type").value,
    title: title,
    org: document.getElementById("org").value.trim(),
    detail: document.getElementById("detail").value.trim(),
  });
  await setItems(items);

  // ล้างช่องกรอกให้พร้อมกรอกอันต่อไป
  document.getElementById("title").value = "";
  document.getElementById("org").value = "";
  document.getElementById("detail").value = "";

  render();
});

render(); // วาดครั้งแรกตอนเปิด popup
