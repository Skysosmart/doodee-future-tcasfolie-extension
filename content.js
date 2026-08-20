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
  let userToggled = false;

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
    userToggled = true; // init ที่ยังค้างอยู่ต้องไม่ย้อนสิ่งที่ผู้ใช้เพิ่งกด
    collapsed = !collapsed;
    applyCollapsed();
    try {
      await Storage.setPanelCollapsed(collapsed);
      clearNote(); // สำเร็จแล้วต้องไม่มีคำเตือนเก่าค้างอยู่
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
  // ต้องอยู่นอก .body เพราะตอนย่อ .body เป็น display:none ทั้งก้อน
  // ถ้าเอาไว้ข้างใน ข้อความจะโผล่เฉพาะตอนกาง ซึ่งคือตอนที่ไม่ค่อยต้องใช้
  const note = document.createElement("div");
  note.className = "note";
  note.hidden = true;

  const noteText = document.createElement("span");
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "undo";
  undoBtn.textContent = "ย้อนกลับ";
  undoBtn.hidden = true;
  note.append(noteText, undoBtn);

  function showNote(message) {
    noteText.textContent = message;
    undoBtn.hidden = true;
    note.classList.remove("is-ok");
    note.hidden = false;
  }

  // เติมผิดช่องเกิดได้ง่ายมาก ต้องมีทางกลับเสมอ ไม่งั้นของเดิมที่พิมพ์ไว้หายฟรี
  function showFilled(message) {
    noteText.textContent = message;
    undoBtn.hidden = false;
    note.classList.add("is-ok");
    note.hidden = false;
  }

  function clearNote() {
    noteText.textContent = "";
    undoBtn.hidden = true;
    note.classList.remove("is-ok");
    note.hidden = true;
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

  body.append(typeSelect, tagBar, list);
  root.append(header, note, body);
  shadow.append(sheet, root);

  function applyCollapsed() {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.title = collapsed ? "ขยายคลังผลงาน" : "ย่อคลังผลงาน";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    root.classList.toggle("is-collapsed", collapsed);
    // ย้าย host ด้วย ไม่ใช่แค่ .panel — ตอนย่อจะได้ไปนั่งกลางขอบขวา
    // ห่างจากมุมบนขวาที่เมนูบัญชี/ปุ่มออกจากระบบของเว็บชอบอยู่
    host.classList.toggle("is-collapsed", collapsed);
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

  // -------------------------------------------------------------
  // เติมข้อมูลลงช่องที่ผู้ใช้เลือกไว้
  //
  // จงใจไม่ใช้ selector ของเว็บเลยสักตัว — ใช้ "ช่องที่เพิ่ง focus" แทน
  // เว็บเขาจะ deploy เปลี่ยนโครงสร้างกี่รอบก็ยังใช้ได้ และไม่ต้องเดาว่าช่องไหน
  // คือช่องอะไร เพราะคนกดเป็นคนเลือกเอง
  //
  // ห้ามเด็ดขาด: กดส่งฟอร์มแทนผู้ใช้ / แตะช่องที่แก้ไม่ได้ / ทับของเดิมโดยไม่ถาม
  // -------------------------------------------------------------

  const BLOCKED_TYPES = new Set([
    "password", "file", "checkbox", "radio", "hidden",
    "submit", "button", "image", "reset", "range", "color",
  ]);

  let lastField = null; // ช่องล่าสุดในหน้าเว็บที่ผู้ใช้คลิก (ไม่ใช่ของ panel)
  let lastFill = null; // { el, previous } สำหรับปุ่มย้อนกลับ

  function isFillable(el) {
    if (!el || el === host) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    return !BLOCKED_TYPES.has((el.type || "text").toLowerCase());
  }

  // capture: หยุด propagation ที่ host กัน bubble ของหน้าเว็บได้ แต่ capture
  // วิ่งลงมาถึง document ก่อนเสมอ จึงต้องกรองเหตุการณ์ของ panel ออกเอง
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target === host) return;
      // ไป focus ช่องที่เติมไม่ได้ (password, ปุ่ม, select) ต้อง "ลืม" ช่องเก่าด้วย
      // ไม่งั้นกดเติมแล้วมันจะไปลงช่องก่อนหน้าที่ผู้ใช้ไม่ได้มองอยู่
      lastField = isFillable(event.target) ? event.target : null;
    },
    true,
  );

  function fieldProblem(el) {
    if (!el || !el.isConnected) {
      return "คลิกช่องในฟอร์มที่จะกรอกก่อน แล้วค่อยกดปุ่มนี้";
    }
    if (el.readOnly || el.disabled || el.getAttribute("aria-readonly") === "true") {
      return "ช่องนี้แก้ไม่ได้ — อาจเป็นข้อมูลที่ verify แล้ว ไม่แตะให้";
    }
    return "";
  }

  function readField(el) {
    return el.isContentEditable ? el.textContent : el.value;
  }

  // React/Vue ไม่รู้จักการเซ็ต .value ตรง ๆ — ค่าจะขึ้นบนจอแต่ตอน submit เป็นว่าง
  // ต้องเรียก native setter ของ prototype แล้วยิง input event ให้เขาเห็นเอง
  function writeField(el, value) {
    if (el.isContentEditable) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, value);
      return;
    }
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  undoBtn.addEventListener("click", () => {
    if (!lastFill || !lastFill.el.isConnected) {
      showNote("ย้อนกลับไม่ได้แล้ว ช่องนั้นไม่อยู่บนหน้านี้แล้ว");
      return;
    }
    writeField(lastFill.el, lastFill.previous);
    lastFill.el.focus();
    lastFill = null;
    clearNote();
  });

  function fillField(value, what, button, armed) {
    const target = lastField;
    const problem = fieldProblem(target);
    if (problem) {
      showNote(problem);
      return false;
    }

    const previous = readField(target);
    // ช่องมีของอยู่แล้ว = ผู้ใช้พิมพ์ไว้เอง หรือเว็บเติมมา ต้องถามก่อนทับ
    if (previous.trim() && !armed) {
      button.textContent = "ทับของเดิม?";
      return true;
    }

    writeField(target, value);
    lastFill = { el: target, previous };
    target.focus();
    showFilled(`เติม "${what}" ลงช่องที่เลือกแล้ว`);
    return false;
  }

  function fillButton(item, what, value) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fill";
    button.textContent = what;
    let armTimer = 0;
    let armed = false;
    button.addEventListener("click", () => {
      clearTimeout(armTimer);
      armed = fillField(value, what, button, armed);
      if (armed) {
        // ปล่อยไว้นานเกินไปแล้วมากดโดนพอดีจะกลายเป็นทับของเดิมโดยไม่ตั้งใจ
        armTimer = setTimeout(() => {
          armed = false;
          button.textContent = what;
        }, 3000);
      } else {
        button.textContent = what;
      }
    });
    return button;
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

    const fillRow = document.createElement("div");
    fillRow.className = "fillrow";
    const fillLabel = document.createElement("span");
    fillLabel.className = "fill-label";
    fillLabel.textContent = "เติมลงช่องที่เลือก:";
    fillRow.append(fillLabel);
    for (const [what, value] of [
      ["ชื่อ", item.title],
      ["หน่วยงาน", item.org],
      ["รายละเอียด", item.detail],
    ]) {
      if (value) fillRow.append(fillButton(item, what, value));
    }

    box.append(title, meta, fillRow, copyBtn);
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
  // เหตุการณ์จาก shadow จะ retarget มาเป็น host แล้ว bubble ต่อไปถึง document
  // ของเว็บ ซึ่งอาจมี handler ปิดเมนู/ตรวจฟอร์มรออยู่ — กดปุ่มคัดลอกของเราแล้ว
  // ไปสั่งงานหน้าเว็บเขาไม่ได้ เราเป็นแค่ผู้อาศัย
  // กันได้เฉพาะ handler ฝั่ง bubble (ซึ่งเป็นแบบที่ใช้กันทั่วไป) — วัดแล้วว่าเงียบสนิท
  // ส่วน capture ที่ผูกไว้ที่ document กันไม่ได้เลย เพราะ capture วิ่งจากบนลงล่าง
  // ถึง document ก่อนจะมาถึง host ของเรา ไม่มีจังหวะให้หยุด
  for (const type of ["pointerdown", "mousedown", "click", "keydown", "focusin"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  applyCollapsed(); // ย่อไว้ตั้งแต่ก่อนแปะ กันแวบกางทับฟอร์มระหว่างรอ storage
  document.documentElement.appendChild(host);

  (async () => {
    try {
      Storage.onItemsChanged(refresh);
      collapsed = await Storage.getPanelCollapsed();
      // ผู้ใช้กดย่อ/กางไปแล้วระหว่างรออ่าน ค่าเก่าที่เพิ่งอ่านมาถือว่าตกยุค
      if (!userToggled) applyCollapsed();
      refresh(await Storage.getItems({ migrate: false }));
    } catch (error) {
      // อ่าน storage ไม่ได้ ห้ามทิ้งกล่องดำเปล่า ๆ ค้างบนใบสมัครจริง
      // ต้องกางให้เห็นข้อความ ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าเกิดอะไรขึ้น
      collapsed = false;
      applyCollapsed();
      showNote(`อ่านคลังผลงานไม่ได้: ${error.message} — ลองโหลดหน้านี้ใหม่`);
    }
  })();
})();
