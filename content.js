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
  // เริ่มที่ย่อไว้เสมอ — panel ลอย fixed ทับปุ่มของใบสมัครจริงได้
  // (วัดแล้ว: elementFromPoint บนปุ่มชิดขอบขวาคืน host ตัวนี้ ไม่ใช่ปุ่ม)
  // ถ้าผู้ใช้เคยกางไว้ ค่าใน storage จะมากางให้เองตอน init
  let collapsed = true;

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
  toggle.type = "button";
  toggle.className = "toggle";
  toggle.addEventListener("click", async () => {
    collapsed = !collapsed;
    applyCollapsed();
    try {
      await Storage.setPanelCollapsed(collapsed);
    } catch (error) {
      // เช่น extension ถูก reload ทั้งที่หน้ายังเปิดอยู่ — สถานะบนจอกับที่บันทึกไว้
      // จะไม่ตรงกัน ปล่อยเงียบไม่ได้ ผู้ใช้ต้องรู้ว่ามันจะไม่จำ
      showNote("จำสถานะย่อ/ขยายไม่ได้ ครั้งหน้าจะกลับมาเป็นค่าเดิม");
    }
  });

  header.append(heading, toggle);

  const body = document.createElement("div");
  body.className = "body";

  // ที่เดียวของ panel ที่บอกได้ว่ามีอะไรพัง — storage ล้มเงียบ ๆ ไม่ได้
  const note = document.createElement("div");
  note.className = "note";
  note.hidden = true;

  function showNote(message) {
    note.textContent = message;
    note.hidden = false;
  }

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

  body.append(note, typeSelect, tagBar, list);
  root.append(header, body);
  shadow.append(sheet, root);

  function applyCollapsed() {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.title = collapsed ? "ขยายคลังผลงาน" : "ย่อคลังผลงาน";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    root.classList.toggle("is-collapsed", collapsed);
  }

  function renderTagBar() {
    const tags = Model.allTags(items);
    tagBar.hidden = tags.length === 0;
    tagBar.replaceChildren(
      ...["", ...tags].map((tag) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip" + (activeTag === tag ? " is-active" : "");
        chip.setAttribute("aria-pressed", String(activeTag === tag));
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
    copyBtn.type = "button";
    copyBtn.className = "copy";
    copyBtn.textContent = "คัดลอกรายละเอียด";
    let resetTimer = 0;
    copyBtn.addEventListener("click", async () => {
      clearTimeout(resetTimer); // กดรัว ๆ อันเก่าต้องไม่มาล้างป้ายของอันใหม่
      if (!item.detail) {
        // writeText("") สำเร็จเสมอ แล้วไปล้างของที่ผู้ใช้เพิ่งคัดลอกมาทิ้ง
        // ขึ้นว่า "คัดลอกแล้ว" ทั้งที่ล้าง clipboard ให้ ไม่ได้เด็ดขาด
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
  applyCollapsed(); // ย่อไว้ตั้งแต่ก่อนแปะ กันแวบกางทับฟอร์มระหว่างรอ storage
  document.documentElement.appendChild(host);

  Storage.onItemsChanged(refresh);

  (async () => {
    try {
      collapsed = await Storage.getPanelCollapsed();
      applyCollapsed();
      refresh(await Storage.getItems());
    } catch (error) {
      // อ่าน storage ไม่ได้ ห้ามทิ้งกล่องดำเปล่า ๆ ค้างบนใบสมัครจริง
      // ต้องกางให้เห็นข้อความ ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าเกิดอะไรขึ้น
      collapsed = false;
      applyCollapsed();
      showNote(`อ่านคลังผลงานไม่ได้: ${error.message}`);
    }
  })();
})();
