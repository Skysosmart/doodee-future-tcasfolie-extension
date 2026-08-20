// ---------------------------------------------------------
// แถบด้านข้างบนหน้า TCASFolio — อ่านอย่างเดียว
// ไม่แตะฟอร์มจริง ไม่แตะข้อมูลที่ verified มีแต่ปุ่มคัดลอกให้เท่านั้น
// ---------------------------------------------------------
(function () {
  "use strict";

  const HOST_ID = "doodee-future-panel";

  // กันฉีดซ้ำ ถ้า script ถูกโหลดสองรอบ
  // ไม่ต้องใช้ MutationObserver: panel เป็น position:fixed ผูกกับ documentElement
  // ไม่ได้พึ่ง DOM ของหน้าเว็บเลย จึงไม่มีอะไรต้องรอ
  if (document.getElementById(HOST_ID)) return;

  let items = [];
  let activeType = "";
  let activeTag = "";
  let collapsed = false;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  // shadow root กัน css ของหน้าเว็บไม่ให้รั่วเข้ามา และกันของเราไม่ให้รั่วออกไป
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = chrome.runtime.getURL("content.css");

  const root = document.createElement("div");
  root.className = "panel";
  root.hidden = true; // เปิดหลัง css โหลดเสร็จ กันภาพแวบตอนยังไม่มีสไตล์
  const reveal = () => {
    root.hidden = false;
  };
  sheet.addEventListener("load", reveal);
  sheet.addEventListener("error", reveal); // css โหลดไม่ได้ ก็ยังต้องใช้งานได้

  const header = document.createElement("div");
  header.className = "header";

  const heading = document.createElement("span");
  heading.className = "heading";
  heading.textContent = "คลังผลงาน";

  const toggle = document.createElement("button");
  toggle.className = "toggle";
  toggle.addEventListener("click", async () => {
    collapsed = !collapsed;
    applyCollapsed();
    await Storage.setPanelCollapsed(collapsed);
  });

  header.append(heading, toggle);

  const body = document.createElement("div");
  body.className = "body";

  const typeSelect = document.createElement("select");
  typeSelect.className = "type-filter";
  const anyType = document.createElement("option");
  anyType.value = "";
  anyType.textContent = "ทุกประเภท";
  typeSelect.appendChild(anyType);
  for (const type of Model.TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeSelect.appendChild(option);
  }
  typeSelect.addEventListener("change", () => {
    activeType = typeSelect.value;
    renderList();
  });

  const tagBar = document.createElement("div");
  tagBar.className = "tagbar";

  const list = document.createElement("div");
  list.className = "list";

  body.append(typeSelect, tagBar, list);
  root.append(header, body);
  shadow.append(sheet, root);

  function applyCollapsed() {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.title = collapsed ? "ขยาย" : "ย่อ";
    root.classList.toggle("is-collapsed", collapsed);
  }

  function renderTagBar() {
    const tags = Model.allTags(items);
    tagBar.hidden = tags.length === 0;
    tagBar.replaceChildren(
      ...["", ...tags].map((tag) => {
        const chip = document.createElement("button");
        chip.className = "chip" + (activeTag === tag ? " is-active" : "");
        chip.textContent = tag || "ทั้งหมด";
        chip.addEventListener("click", () => {
          activeTag = tag;
          renderTagBar();
          renderList();
        });
        return chip;
      }),
    );
  }

  function card(item) {
    const box = document.createElement("div");
    box.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = item.org ? `${item.type} · ${item.org}` : item.type;

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

    box.append(title, meta, copyBtn);
    return box;
  }

  function renderList() {
    const shown = Model.filterItems(items, { type: activeType, tag: activeTag });
    heading.textContent = `คลังผลงาน (${shown.length}/${items.length})`;

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = items.length
        ? "ไม่มีรายการที่ตรงตัวกรอง"
        : "ยังไม่มีข้อมูล — เพิ่มได้จากไอคอนส่วนขยาย";
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(...shown.map(card));
  }

  function refresh(next) {
    items = next;
    // แท็กที่เลือกไว้อาจถูกลบไปแล้วจากอีกหน้าต่างหนึ่ง — ถ้าไม่มีแล้วให้เลิกกรอง
    if (activeTag && !Model.allTags(items).includes(activeTag)) activeTag = "";
    renderTagBar();
    renderList();
  }

  // ต่อกับ documentElement ไม่ใช่ body เผื่อ body มี transform
  // ซึ่งจะกลายเป็น containing block แล้วทำให้ position:fixed เพี้ยน
  document.documentElement.appendChild(host);

  Storage.onItemsChanged(refresh);

  (async () => {
    collapsed = await Storage.getPanelCollapsed();
    applyCollapsed();
    refresh(await Storage.getItems());
  })();
})();
