// แถบด้านข้างบนหน้า TCASFolio — คัดลอก / เติมฟอร์ม / แนบรูป จากคลังในเครื่อง
// เขียนลงหน้าเว็บได้ (ตามที่ผู้ใช้ขอ 2026-08-20) แต่: เติมเฉพาะช่องว่าง, ไม่ข้ามบล็อก,
// ไม่แตะข้อมูลที่ verified, โชว์แผนก่อนเขียนข้อความ, ไม่กดบันทึกแฟ้มให้
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
  let query = "";
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
  heading.textContent = "Doodee";

  const count = document.createElement("span");
  count.className = "count";

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

  // ปุ่มช่วยเหลือตรงหน้างาน — คนไม่อ่านคู่มือแยก แต่จะกด ? ตอนติด
  const helpBtn = document.createElement("button");
  helpBtn.type = "button";
  helpBtn.className = "toggle help";
  helpBtn.textContent = "?";
  helpBtn.title = "วิธีใช้";
  helpBtn.setAttribute("aria-expanded", "false");

  const help = document.createElement("div");
  help.className = "help-card";
  help.hidden = true;
  {
    const h = document.createElement("div");
    h.className = "help-head";
    h.textContent = "3 ขั้น ต่อผลงาน 1 ชิ้น";
    const ol = document.createElement("ol");
    for (const [main, sub] of [
      ["กด ＋ ลงพอร์ต ในการ์ด", "สร้างบล็อกให้ตรงหมวด + เลือกให้เอง ไม่ต้องแตะปุ่มของเว็บ"],
      ["ดูแผน → กด ยืนยันเติม", "ลงครบทุกช่อง · ผิดกด ย้อนกลับ"],
      ["กด แนบรูป (N)", "ตั้งเลย์เอาต์ + ย่อรูปใหญ่ให้เอง กันบันทึกไม่ผ่าน"],
      ["ติ๊ก ค่าใช้จ่าย เอง → กด บันทึกแฟ้ม ของเว็บ", "เว็บไม่บันทึกเอง ปิดแท็บก่อน = หาย"],
    ]) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = main;
      const small = document.createElement("small");
      small.textContent = sub;
      li.append(b, small);
      ol.appendChild(li);
    }
    const foot = document.createElement("div");
    foot.className = "help-foot";
    foot.textContent =
      "บล็อกที่มีอยู่แล้วใช้ เติมทั้งฟอร์ม แทน · เติมเฉพาะช่องว่าง ไม่แตะเรียงความ ไม่แตะของที่ Verify แล้ว";
    help.append(h, ol, foot);
  }
  helpBtn.addEventListener("click", () => {
    help.hidden = !help.hidden;
    helpBtn.setAttribute("aria-expanded", String(!help.hidden));
  });

  header.append(heading, count, helpBtn, toggle);

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

  // เขียนลงใบสมัครจริงต้องผ่านการยืนยันเสมอ ห้ามเติมทันทีที่กด
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "confirm";
  confirmBtn.textContent = "ยืนยันเติม";
  confirmBtn.hidden = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cancel";
  cancelBtn.textContent = "ยกเลิก";
  cancelBtn.hidden = true;

  const noteActions = document.createElement("div");
  noteActions.className = "note-actions";
  noteActions.append(confirmBtn, cancelBtn, undoBtn);
  note.append(noteText, noteActions);

  function showNote(message) {
    noteText.textContent = message;
    undoBtn.hidden = true;
    confirmBtn.hidden = true;
    cancelBtn.hidden = true;
    note.classList.remove("is-ok");
    note.hidden = false;
  }

  // เติมผิดช่องเกิดได้ง่ายมาก ต้องมีทางกลับเสมอ ไม่งั้นของเดิมที่พิมพ์ไว้หายฟรี
  function showFilled(message) {
    noteText.textContent = message;
    undoBtn.hidden = false;
    confirmBtn.hidden = true;
    cancelBtn.hidden = true;
    note.classList.add("is-ok");
    note.hidden = false;
  }

  function clearNote() {
    noteText.replaceChildren();
    undoBtn.hidden = true;
    confirmBtn.hidden = true;
    cancelBtn.hidden = true;
    note.classList.remove("is-ok");
    note.hidden = true;
  }

  const search = document.createElement("input");
  search.className = "search";
  search.type = "search";
  search.placeholder = "ค้นหาผลงาน…";
  search.addEventListener("input", () => {
    query = search.value;
    renderList();
  });

  const tagToggle = document.createElement("button");
  tagToggle.type = "button";
  tagToggle.className = "tagtoggle";
  tagToggle.textContent = "แท็ก ▾";
  tagToggle.addEventListener("click", () => {
    tagBar.hidden = !tagBar.hidden;
    tagToggle.textContent = tagBar.hidden ? "แท็ก ▾" : "แท็ก ▴";
  });

  const typeBar = document.createElement("div");
  typeBar.className = "typebar";

  function renderTypeBar() {
    typeBar.replaceChildren(
      ...["", ...Model.TYPES].map((type) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip" + (activeType === type ? " is-active" : "");
        chip.setAttribute("aria-pressed", String(activeType === type));
        chip.textContent = type ? type.split(" / ")[0] : "ทั้งหมด";
        chip.title = type || "ทุกหมวด";
        chip.addEventListener("click", () => {
          activeType = type;
          renderTypeBar();
          renderList();
        });
        return chip;
      }),
      tagToggle,
    );
  }

  const tagBar = document.createElement("div");
  tagBar.className = "tagbar";
  tagBar.hidden = true;

  const list = document.createElement("div");
  list.className = "list";

  body.append(search, typeBar, tagBar, list);
  root.append(header, help, note, body);
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
    tagToggle.hidden = tags.length === 0;
    if (!tags.length) tagBar.hidden = true;
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

  // เติมข้อมูลลงช่องที่ผู้ใช้เลือกไว้
  //
  // จงใจไม่ใช้ selector ของเว็บเลยสักตัว — ใช้ "ช่องที่เพิ่ง focus" แทน
  // เว็บเขาจะ deploy เปลี่ยนโครงสร้างกี่รอบก็ยังใช้ได้ และไม่ต้องเดาว่าช่องไหน
  // คือช่องอะไร เพราะคนกดเป็นคนเลือกเอง
  //
  // ห้ามเด็ดขาด: กดส่งฟอร์มแทนผู้ใช้ / แตะช่องที่แก้ไม่ได้ / ทับของเดิมโดยไม่ถาม

  const BLOCKED_TYPES = new Set([
    "password", "file", "checkbox", "radio", "hidden",
    "submit", "button", "image", "reset", "range", "color",
  ]);

  let lastField = null; // ช่องล่าสุดในหน้าเว็บที่ผู้ใช้คลิก (ไม่ใช่ของ panel)
  let lastFill = []; // [{ el, previous }] สำหรับปุ่มย้อนกลับ รองรับหลายช่องพร้อมกัน
  let pendingPlan = null; // แผนที่รอผู้ใช้ยืนยันก่อนเขียนลงฟอร์มจริง

  // คำที่ใช้เดาว่าช่องนั้นคือช่องอะไร — ดูจาก label/placeholder/name/id
  const FIELD_HINTS = [
    ["title", ["ชื่อผลงาน", "ชื่อรางวัล", "ชื่อโครงงาน", "ชื่อกิจกรรม", "ชื่อหลักสูตร",
               "ชื่อการอบรม", "หัวข้อ", "ชื่อเรื่อง", "ชื่อ", "title", "name", "topic", "subject",
               "free__title"]],
    ["org", ["หน่วยงาน", "องค์กร", "สถาบัน", "ผู้จัด", "ผู้มอบ", "แหล่งที่มา", "สถานที่",
             "โรงเรียน", "มหาวิทยาลัย", "organization", "organizer", "issuer", "institute",
             "provider", "agency", "school"]],
    ["detail", ["รายละเอียด", "คำอธิบาย", "อธิบาย", "เนื้อหา", "สรุป", "ประโยชน์", "บทบาท",
                "เรียงความ", "เหตุผล", "description", "detail", "summary", "content", "about",
                "essay", "reason", "free__body"]],
    ["year", ["ช่วงเวลา", "วันที่", "ปีที่", "ปี พ.ศ.", "พ.ศ.", "ค.ศ.", "ปีการศึกษา",
              "year", "date", "เมื่อ"]],
    ["level", ["ระดับ", "level", "scope"]],
    ["result", ["ผลรางวัล", "อันดับ", "ผลการแข่งขัน", "รางวัลที่ได้", "result", "award",
                "rank", "placement"]],
    ["hours", ["จำนวนชั่วโมง", "ชั่วโมง", "hours", "duration"]],
  ];

  // ทุกแหล่งที่บอกได้ว่าช่องนี้คือช่องอะไร — ใช้จับคู่
  // ช่องของ TCASFolio เป็น contenteditable div ซึ่งไม่มี .placeholder แบบ input
  // ต้องอ่านจาก attribute และคลาส (free__title / free__body) แทน
  // ฟอร์มจริงของ TCASFolio วางข้อความกำกับไว้เป็น element แยกเหนือช่อง
  // ไม่ได้ผูกด้วย <label for> — ถ้าดูแค่ label/aria จะได้ค่าว่างและจับคู่ไม่ได้เลย
  // จึงต้องไต่ขึ้นไปหาข้อความสั้น ๆ ที่อยู่ก่อนหน้าช่องนั้น
  function nearbyLabel(el) {
    let node = el;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      let sib = node.previousElementSibling;
      while (sib) {
        const text = (sib.textContent || "").replace(/\s+/g, " ").trim();
        // สั้นพอที่จะเป็นชื่อช่อง ไม่ใช่ย่อหน้าเนื้อหา
        if (text && text.length <= 60) return text;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function labelSources(el) {
    const wrap = el.closest("label");
    const attr = (n) => el.getAttribute(n) || "";
    return [
      el.labels && el.labels[0] ? el.labels[0].textContent : "",
      attr("aria-label"),
      el.placeholder || attr("placeholder") || attr("data-placeholder") || attr("aria-placeholder"),
      wrap ? wrap.textContent : "",
      el.name || "",
      el.id || "",
      (el.className || "").toString(),
      nearbyLabel(el),
    ].map((t) => String(t).replace(/\s+/g, " ").trim());
  }

  // ชื่อที่เอาไปโชว์ให้คนอ่าน — เอาแหล่งแรกที่อ่านรู้เรื่อง ไม่ใช่ต่อกันทุกแหล่ง
  function fieldLabel(el) {
    const [byLabel, aria, ph, wrap, name, id, cls, near] = labelSources(el);
    return byLabel || aria || ph || wrap || near || name || id || cls || "";
  }

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function candidateFields() {
    // ต้องเป็น [contenteditable] เปล่า ๆ ไม่ใช่ [contenteditable=true]
    // TCASFolio เขียน attribute เป็นค่าว่าง (contenteditable="") ซึ่งมีผลเป็น true
    // แต่ selector ที่เจาะจงค่าจะจับไม่ได้ — กรองจริงด้วย el.isContentEditable ใน isFillable
    const all = [...document.querySelectorAll("input, textarea, select, [contenteditable]")];
    return all.filter(
      (el) => !host.contains(el) && el !== host && isFillable(el) && !fieldProblem(el) && isVisible(el),
    );
  }

  function guessKind(el) {
    const haystack = labelSources(el).join(" ").toLowerCase();
    for (const [kind, words] of FIELD_HINTS) {
      for (const w of words) {
        if (haystack.includes(w.toLowerCase())) return kind;
      }
    }
    // ไม่มีคำใบ้เลย — ช่องยาว ๆ เดาว่าเป็นรายละเอียด อย่างอื่นไม่เดา
    return el.tagName === "TEXTAREA" || el.isContentEditable ? "detail" : "";
  }

  // ในคลังเก็บหน่วยงานกับวันที่รวมกันเป็น "ชื่อหน่วยงาน · 16 พฤษภาคม 2569"
  // ฟอร์มจริงแยกเป็นสองช่อง จึงต้องตัดตรงจุดคั่นให้ตรงช่อง
  function splitOrg(text) {
    const parts = String(text).split("·").map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      const tail = parts[parts.length - 1];
      // ท่อนท้ายที่มีตัวเลขคือวันที่ ไม่ใช่ชื่อหน่วยงาน
      if (/\d/.test(tail)) {
        return { org: parts.slice(0, -1).join(" · "), when: tail };
      }
    }
    const m = String(text).match(/(?:25|26|19|20)\d{2}/);
    return { org: String(text), when: m ? m[0] : "" };
  }

  // จับคู่ผลงานกับช่องในฟอร์ม — แต่ละชนิดเติมช่องเดียว
  //
  // กฎสองข้อที่ได้มาจากการลองกับหน้าจริง:
  // 1. เติมเฉพาะช่องที่ว่าง — ครั้งแรกที่ลอง มันเล็งช่อง "แตะเพื่อพิมพ์เรียงความ"
  //    ที่มี SOP เขียนไว้แล้ว เพราะคำว่าเรียงความก็นับเป็นรายละเอียดเหมือนกัน
  //    บนใบสมัครจริง การทับของที่เขียนไว้แล้วคือความเสียหาย ไม่ใช่ความสะดวก
  // 2. อยู่บล็อกเดียวกับหัวข้อ — หัวข้อกับรายละเอียดของผลงานชิ้นเดียวกัน
  //    ต้องอยู่ในกล่องเดียวกัน ไม่ใช่คนละที่บนหน้า
  function buildPlan(item) {
    const parted = splitOrg(item.org);
    const values = {
      title: item.title,
      org: parted.org,
      detail: item.detail,
      year: parted.when,
      level: item.level || "",
      result: item.result || "",
      hours: item.hours || "",
    };

    const all = candidateFields();
    const empty = all.filter((el) => !readField(el).trim());
    const skipped = all.length - empty.length;

    // เลือกขอบเขตด้วยการให้คะแนน แทนการไต่ขึ้นจากช่องหัวข้อ
    //
    // บนหน้าจริง พอเปิดแผงแก้ไขของบล็อก จะมีช่องสองชุดพร้อมกัน:
    // ชุดอินไลน์ในบล็อก (หัวข้อ + รายละเอียด) กับชุดในแผงแก้ไข
    // (หัวข้อ ระดับ ผลรางวัล หน่วยงาน ชั่วโมง ช่วงเวลา รายละเอียด)
    // การไต่จากหัวข้อตัวแรกจะไปเจอชุดอินไลน์ก่อนแล้วได้แค่ 2 ช่อง
    // จึงเปลี่ยนมาให้คะแนนทุกกล่อง แล้วเลือกกล่องที่กรอกได้ครบชนิดที่สุด
    // ช่องเรียงความ (free__body--rich) ไม่ใช่ "รายละเอียด" ของผลงานชิ้นไหน
    // — เคยถูกเลือกเพราะคำว่าเรียงความก็นับเป็น detail และมันว่างอยู่พอดี
    const isEssay = (el) => /free__body--rich/.test((el.className || "").toString());
    const allTitles = all.filter((el) => guessKind(el) === "title"); // รวมที่มีข้อความแล้ว

    const scopes = new Map();
    for (const el of empty) {
      if (isEssay(el)) continue;
      let node = el.parentElement;
      for (let d = 0; d < 8 && node; d += 1) {
        if (!scopes.has(node)) scopes.set(node, []);
        scopes.get(node).push(el);
        node = node.parentElement;
      }
    }

    let pool = empty.filter((el) => !isEssay(el));
    let chosenContainer = null;
    let bestKinds = -1;
    let bestSize = Infinity;
    for (const [container, fields] of scopes) {
      const kinds = new Set();
      for (const el of fields) {
        const kind = guessKind(el);
        if (!kind || !values[kind]) continue;
        kinds.add(kind);
      }
      if (!kinds.size) continue;
      // กล่องที่ครอบช่องหัวข้อ "ใด ๆ" มากกว่าหนึ่ง — ว่างหรือมีข้อความก็ตาม —
      // คือกล่องที่คร่อมผลงานหลายชิ้น ห้ามใช้เด็ดขาด (นับเฉพาะที่ว่างไม่พอ:
      // บล็อกที่กรอกหัวข้อไปแล้วยังเป็นของชิ้นอื่นอยู่ดี)
      if (allTitles.filter((t) => container.contains(t)).length > 1) continue;
      // ครอบคลุมชนิดได้มากกว่าชนะ ถ้าเท่ากันเอากล่องที่แคบกว่า
      if (kinds.size > bestKinds || (kinds.size === bestKinds && fields.length < bestSize)) {
        bestKinds = kinds.size;
        bestSize = fields.length;
        pool = fields;
        chosenContainer = container;
      }
    }
    // ไม่มีกล่องไหนปลอดภัยเลย (ทุกกล่องคร่อมหลายชิ้น) → ไม่เติมอะไร ดีกว่าเดา
    if (!chosenContainer) pool = [];

    // ชนิดช่องที่ "มีอยู่" ในกล่องที่เลือก — นับทั้งที่ว่างและที่มีข้อความแล้ว
    // วัดจริงบน TCASFolio: ช่องหน่วยงานในแผงแก้ไขถูกกรอกไปแล้ว จึงไม่อยู่ใน pool
    // แต่มันก็ยังเป็นช่องหน่วยงานอยู่ดี — ถ้านับแค่ที่เรากำลังเขียน จะพ่วงหน่วยงานซ้ำลงรายละเอียด
    const presentKinds = new Set(
      chosenContainer ? all.filter((el) => chosenContainer.contains(el)).map(guessKind).filter(Boolean) : [],
    );

    const used = new Set();
    const plan = [];
    for (const el of pool) {
      const kind = guessKind(el);
      if (!kind || used.has(kind) || !values[kind]) continue;
      used.add(kind);
      plan.push({
        el,
        kind,
        value: values[kind],
        previous: readField(el),
        label: fieldLabel(el).slice(0, 34) || "(ช่องไม่มีชื่อ)",
        note: "",
        // จุดยึดสำหรับหาช่องใหม่หลัง React re-render: กล่องที่เลือก และหัวข้อของมัน
        anchor: chosenContainer,
        anchorTitle: "",
      });
    }

    // TCASFolio มีแค่หัวข้อกับรายละเอียด ไม่มีช่องหน่วยงาน/ปีแยก
    // ถ้าปล่อยไว้เฉย ๆ ข้อมูลจะหาย จึงเอาไปไว้บรรทัดแรกของรายละเอียด
    // และบอกไว้ในแผนให้เห็น ไม่ใช่แอบต่อให้เงียบ ๆ
    const titleStep = plan.find((s) => s.kind === "title");
    for (const s of plan) {
      // ถ้าแผนเขียนหัวข้อเอง หัวข้อหลังเขียนคือค่านั้น; ถ้าไม่ (กล่องมีหัวข้อแล้ว) อ่านจากกล่อง
      s.anchorTitle = titleStep
        ? titleStep.value.trim()
        : ((chosenContainer && allTitles.find((t) => chosenContainer.contains(t))) ? readField(allTitles.find((t) => chosenContainer.contains(t))).trim() : "");
    }
    const detailStep = plan.find((s) => s.kind === "detail");
    // บรรทัดเดียวคั่น — TCASFolio วาดทุก \n เป็นย่อหน้าเปล่า \n\n จึงกลายเป็นช่องว่างหลายบรรทัด
    if (detailStep && item.org && !presentKinds.has("org")) {
      detailStep.body = item.detail;
      detailStep.value = `${item.org}\n${item.detail}`;
      detailStep.note = "พ่วงหน่วยงาน/ปีไว้บรรทัดแรก";
    }
    plan.skipped = skipped;
    return plan;
  }

  const KIND_TH = {
    title: "ชื่อ", org: "หน่วยงาน", detail: "รายละเอียด", year: "ปี",
    level: "ระดับ", result: "ผลรางวัล", hours: "ชั่วโมง",
  };

  function showPlan(plan) {
    pendingPlan = plan;
    clearNote();
    noteText.textContent = "";

    const head = document.createElement("div");
    head.className = "plan-head";
    head.textContent =
      `จะเติม ${plan.length} ช่อง — ตรวจก่อนกดยืนยัน` +
      (plan.skipped ? ` (ข้ามช่องที่มีข้อความอยู่แล้ว ${plan.skipped} ช่อง)` : "");
    noteText.append(head);

    for (const step of plan) {
      const row = document.createElement("div");
      row.className = "plan-row";
      const tag = document.createElement("span");
      tag.className = "plan-kind";
      tag.textContent = KIND_TH[step.kind];
      const where = document.createElement("span");
      where.textContent = ` → «${step.label}»`;
      row.append(tag, where);
      if (step.note) {
        const extra = document.createElement("span");
        extra.className = "plan-note";
        extra.textContent = ` (${step.note})`;
        row.append(extra);
      }
      if (step.previous.trim()) {
        const warn = document.createElement("span");
        warn.className = "plan-warn";
        warn.textContent = " ทับของเดิม";
        row.append(warn);
      }
      noteText.append(row);
    }

    confirmBtn.hidden = false;
    cancelBtn.hidden = false;
    undoBtn.hidden = true;
    note.classList.remove("is-ok");
    note.hidden = false;
  }

  // เขียนทีละช่องแล้วรอ ไม่ใช่รัวทีเดียว — React ถอด element ที่จำไว้ตอนวางแผนทิ้ง
  // หาช่องใหม่หลัง React สร้างบล็อกใหม่ — ต้องอยู่ "ในกล่องเดิมของแผน" และ "ยังว่าง"
  // ห้ามหาทั้งหน้าด้วยป้ายชื่ออย่างเดียว: ช่องอินไลน์ทุกบล็อกมีป้ายเหมือนกันหมด
  // หาทั้งหน้าจะได้บล็อกแรกของหน้า แล้วไปทับของที่คนอื่นกรอกไว้ (review C1)
  function refind(step) {
    const anchor = step.anchor; // element ที่ยังติดอยู่ ใช้หากล่องเดิมกลับมา
    let root = null;
    if (anchor && anchor.isConnected) root = anchor;
    if (!root && step.anchorTitle) {
      // กล่องเดิมหายทั้งก้อน — หาหัวข้อที่ตรงกับตอนวางแผน แล้วใช้ .block ชั้นนอกของมัน
      // เป็นขอบเขต ห้ามไต่เกินนั้น: ไต่ต่อไปจะเจอกล่องที่ครอบทุกบล็อกบนหน้า แล้วช่อง
      // "ป้ายเดียวกัน ช่องแรก" ที่เจอคือของบล็อกแรกของหน้า ไม่ใช่ของเรา (review C1, เกิดจริง)
      const t = [...document.querySelectorAll("[class*=free__title], input, textarea, [contenteditable]")]
        .filter((f) => !host.contains(f))
        .find((f) => guessKind(f) === "title" && readField(f).trim() === step.anchorTitle);
      if (t) {
        root = outerBlock(t);
        // หัวข้ออยู่ในแผงแก้ไข (ไม่มี .block ครอบ) → ใช้ฟอร์มที่ใกล้ที่สุดแทน
        if (!root || root === t.parentElement) root = t.closest("form, fieldset, section, [class*=panel], [class*=editor]") || null;
      }
    }
    if (!root) return null;
    // จับด้วย "ชนิด" ไม่ใช่ข้อความป้าย — React สร้างบล็อกใหม่แล้ว placeholder attribute
    // อาจหายหรือย้ายไปอยู่ data-placeholder ทำให้ป้ายไม่ตรงอักษรต่ออักษรทั้งที่เป็นช่องเดียวกัน
    // (วัดจริง: หัวข้อตรง กล่องถูก ช่องว่างอยู่ แต่ label !== step.label → ไม่เจอ)
    const inRoot = candidateFields().filter((f) => root.contains(f) && !readField(f).trim());
    return inRoot.find((f) => guessKind(f) === step.kind && fieldLabel(f) === step.label)
      || inRoot.find((f) => guessKind(f) === step.kind)
      || null;
  }

  async function applyPlan(plan) {
    const done = [];
    const failed = [];

    // หลังเขียนช่องก่อนหน้า React จะสร้างบล็อกใหม่ "หลายรอบ" — ถ้าเขียนช่องถัดไปตอน node
    // กำลังถูกสลับ ข้อความจะหายไปเฉย ๆ (วัดจริง: before connected → after detached, d ว่าง)
    // จึงรอจนบล็อกนิ่งก่อน: ตัว node ของช่องชนิดนั้นใน anchor ต้องคงเดิม 2 รอบติด
    const liveFieldFor = (step) => {
      let root = step.anchor && step.anchor.isConnected ? step.anchor : null;
      if (!root && step.anchorTitle) {
        const t = [...document.querySelectorAll("[class*=free__title], input, textarea, [contenteditable]")]
          .filter((f) => !host.contains(f))
          .find((f) => guessKind(f) === "title" && readField(f).trim() === step.anchorTitle);
        root = t ? outerBlock(t) : null;
      }
      if (!root) return null;
      return candidateFields().find((f) => root.contains(f) && guessKind(f) === step.kind) || null;
    };
    const settle = async (step) => {
      let prev = liveFieldFor(step);
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        const cur = liveFieldFor(step);
        if (cur && cur === prev && cur.isConnected) return cur;
        prev = cur;
      }
      return prev && prev.isConnected ? prev : null;
    };

    for (const [index, step] of plan.entries()) {
      let el = step.el;
      if (index > 0) {
        // ไม่ใช่ช่องแรก → รอให้บล็อกนิ่งก่อน แล้วใช้ node ที่นิ่งแล้วนั้น
        const stable = await settle(step);
        if (stable && !readField(stable).trim()) el = stable;
        else if (stable && readField(stable).trim()) el = null; // ช่องนี้ถูกกรอกไปแล้ว (ไม่ใช่เรา) อย่าทับ
      }
      if (el && !el.isConnected) el = refind(step);
      if (!el) {
        failed.push(step.label);
        continue;
      }

      // ช่องอินไลน์ (free__title/free__body) รับการแก้เฉพาะตอนบล็อกนั้น "ถูกเลือกอยู่"
      // ถ้ายังไม่เลือก คลิกเลือกก่อน รอให้ React สร้างใหม่เสร็จ แล้วหา node ใหม่ชนิดเดิม
      if (el.isContentEditable) {
        const blk = outerBlock(el);
        if (blk && !/is-selected/.test(blk.className || "")) {
          blk.click();
          await new Promise((r) => setTimeout(r, 500));
          const stable = await settle(step);
          if (stable && !readField(stable).trim()) el = stable;
          else if (!el.isConnected) { failed.push(step.label); continue; }
        }
      }

      writeField(el, step.value);
      await new Promise((r) => setTimeout(r, 250));

      // วัดจริง (seq-probe B4): เว็บ "commit" ช่อง contenteditable ตอน blur แล้วสร้างบล็อกใหม่
      // ถ้าปล่อยให้ blur เกิดตอนเราไป click ช่องถัดไป ช่องถัดไปจะหลุดกลางมือ (exec=false)
      // จึง blur เองตรงนี้ ให้เว็บสร้างใหม่ให้เสร็จก่อน แล้วค่อยไปช่องถัดไป
      if (el.isConnected && el.isContentEditable) {
        el.blur();
        await new Promise((r) => setTimeout(r, 400));
      }

      // เขียนแล้วต้องเช็คว่าติดจริง — วัดจริง: React ถอด node ทิ้ง "ระหว่าง" เขียน
      // (before: connected, after: detached) ข้อความติดอยู่ในบล็อกใหม่ แต่ถ้าอ่านจาก node เก่า
      // จะได้ค่าว่างแล้วนับว่าพลาดทั้งที่สำเร็จ — จึงต้องหา node ใหม่ "ชนิดเดียวกัน ในกล่องเดิม" มาอ่าน
      let landed = el.isConnected ? readField(el) : "";
      if (!landed.trim()) {
        const sameKind = (f) => guessKind(f) === step.kind;
        let again = null;
        if (step.anchor && step.anchor.isConnected) {
          again = candidateFields().find((f) => step.anchor.contains(f) && sameKind(f));
        }
        if (!again && step.anchorTitle) {
          // กล่องเดิมหายทั้งก้อน → หากล่องใหม่จากหัวข้อ (ขอบเขต .block ของมันเท่านั้น)
          const t = [...document.querySelectorAll("[class*=free__title], input, textarea, [contenteditable]")]
            .filter((f) => !host.contains(f))
            .find((f) => guessKind(f) === "title" && readField(f).trim() === step.anchorTitle);
          const root = t ? outerBlock(t) : null;
          if (root) again = candidateFields().find((f) => root.contains(f) && sameKind(f));
        }
        if (again) { landed = readField(again); el = again; }
      }

      // ถ้าพ่วงหน่วยงานไว้บรรทัดแรก ให้ยอมรับเมื่อ "เนื้อหา" ติด แม้เว็บจะตัดบรรทัดแรกทิ้ง
      const body = step.body || step.value;
      if (
        landed.trim() === step.value.trim() ||
        (landed.trim() && (landed.includes(step.value.slice(0, 20)) || landed.includes(body.slice(0, 20))))
      ) {
        done.push({ el, previous: step.previous });
      } else {
        failed.push(step.label);
      }
    }

    lastFill = done;
    pendingPlan = null;
    if (failed.length) {
      showFilled(`เติมได้ ${done.length} ช่อง · ไม่ติด ${failed.length} ช่อง (${failed.join(", ")})`);
    } else {
      showFilled(`เติมแล้ว ${done.length} ช่อง — ยังไม่ได้กดบันทึก`);
    }
  }

  function isFillable(el) {
    if (!el || el === host) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    // select เติมได้ถ้าตัวเลือกตรงกับค่าที่เก็บไว้ (เช่นช่อง "ระดับ" ของ TCASFolio)
    if (tag === "SELECT") return true;
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
    if (el.isContentEditable) return el.textContent;
    // ตัวเลือกแรกของ select คือ placeholder ("— เลือกระดับ —") ถือว่ายังว่าง
    if (el.tagName === "SELECT") {
      return el.selectedIndex > 0 ? (el.options[el.selectedIndex].textContent || "").trim() : "";
    }
    return el.value;
  }

  // React/Vue ไม่รู้จักการเซ็ต .value ตรง ๆ — ค่าจะขึ้นบนจอแต่ตอน submit เป็นว่าง
  // ต้องเรียก native setter ของ prototype แล้วยิง input event ให้เขาเห็นเอง
  function writeField(el, value) {
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => (o.textContent || "").trim() === value);
      if (!opt) return; // ไม่มีตัวเลือกที่ตรง อย่ามั่วเลือกอันอื่นให้
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, opt.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      // ช่องของ TCASFolio เป็น click-to-edit (มี data-edit) — focus() เฉย ๆ จาก isolated world
      // ไม่พอ: หัวข้อติด แต่รายละเอียดไม่ติด จนกว่าจะมี click จริงก่อน
      el.click();
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      // ขึ้นย่อหน้าด้วย Enter (insertParagraph) แทนการยัด \n ใน insertText —
      // เว็บจัดการ Enter เองตามธรรมชาติ ส่วน \n ดิบ ๆ เคยทำให้ย่อหน้าหายไปทั้งบล็อกหนึ่งครั้ง
      String(value).split("\n").forEach((part, i) => {
        if (i > 0) document.execCommand("insertParagraph", false, null);
        if (part) document.execCommand("insertText", false, part);
      });
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
    const alive = lastFill.filter((f) => f.el.isConnected);
    if (!alive.length) {
      showNote("ย้อนกลับไม่ได้แล้ว ช่องพวกนั้นไม่อยู่บนหน้านี้แล้ว");
      return;
    }
    for (const f of alive) writeField(f.el, f.previous);
    alive[0].el.focus();
    lastFill = [];
    clearNote();
  });

  let applying = false;
  confirmBtn.addEventListener("click", async () => {
    if (!pendingPlan || applying) return;
    const plan = pendingPlan;
    // แผนที่วางไว้ตอนแผงแก้ไขเปิด แล้วมากดยืนยันหลังแผงปิด — กล่องเดิมหายทั้งก้อน
    // ห้ามเอาแผนเก่าไปหาช่องทั้งหน้า ให้บอกผู้ใช้กดวางแผนใหม่
    if (plan.some((s) => !s.el.isConnected) && !(plan[0].anchor && plan[0].anchor.isConnected)) {
      pendingPlan = null;
      showNote("หน้าเปลี่ยนไปตั้งแต่วางแผน — กด \"เติมทั้งฟอร์ม\" อีกครั้งเพื่อวางแผนใหม่");
      return;
    }
    applying = true;
    confirmBtn.disabled = true;
    try {
      await applyPlan(plan);
    } finally {
      applying = false;
      confirmBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", () => {
    pendingPlan = null;
    // ปุ่มเดียวกันนี้ยังใช้ยกเลิกโหมดนำเข้าอัตโนมัติด้วย — ที่ค้างอยู่ต้องดับไปพร้อมข้อความ
    if (autoArmed) setArmed(false);
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
    lastFill = [{ el: target, previous }];
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

  // แนบรูปลงบล็อกของ TCASFolio
  //
  // กลไกของเว็บ (สำรวจจากหน้าจริง):
  //   - มี <input type=file accept="image/jpeg,image/png"> ซ่อนอยู่ตัวเดียวทั้งหน้า ใช้ร่วมกันทุกบล็อก
  //   - ต้องคลิกเลือกบล็อกก่อน แถบเครื่องมือถึงโผล่ ปุ่ม title="เพิ่มรูป" อยู่ในนั้น
  //   - กดเพิ่มรูปแล้วจะได้ช่องว่าง span.frame__phlabel "เลือกรูปภาพ" ในบล็อกนั้น
  //   - คลิกช่องว่าง → input รับไฟล์ของช่องนั้น → เว็บอัปโหลดขึ้น S3 ทันที
  //
  // ข้อจำกัดที่ต้องระวัง: ช่องรูปผูกกับบล็อกที่ "ถูกเลือกอยู่" ไม่ใช่กับผลงาน
  // จึงต้องหาบล็อกที่หัวข้อตรงกับผลงานชิ้นนี้ก่อน แล้วเลือกมันให้ชัวร์ก่อนป้อนไฟล์
  // ไม่งั้นรูปไปลงบล็อกผิด (เคยเกิดแล้วตอนเทสต์: ใบ SWU ไปอยู่กับ I-NEW GEN)

  let imageCounts = {};

  // ขอบเขตบล็อกต้องเป็น .block ชั้นนอก ไม่ใช่ .block__inner
  // closest("[class*=block]") จะชน block__inner ก่อน ซึ่งเป็นแค่ชั้นในของส่วนข้อความ
  // ส่วนรูป (.imgs) อยู่ใน block__inner อีกตัวที่เป็นพี่น้องกัน — หาจากชั้นในจึงไม่เจอ
  // สร้างบล็อกให้เอง:
  // จุดที่คนสับสนที่สุดคือลำดับ: ต้องกด "＋ เพิ่ม…" ของเว็บ แล้วคลิกเลือกบล็อก
  // ก่อน ถึงจะเติมได้ ปุ่มนี้ทำสองขั้นนั้นให้ แล้วค่อยโชว์แผนตามเดิม
  // (ยังต้องกดยืนยันเอง — เขียนลงใบสมัครจริง ห้ามลงมือเงียบ ๆ)
  const ADD_BUTTON_BY_TYPE = new Map([
    ["รางวัล / เกียรติบัตร", "เพิ่มรางวัล"],
    ["โครงงาน / วิจัย", "เพิ่มโครงงาน"],
    ["กิจกรรม", "เพิ่มกิจกรรม"],
    ["การอบรม", "เพิ่มการอบรม"],
    ["ผลงานสร้างสรรค์", "เพิ่มผลงาน"],
  ]);

  function findAddButton(type) {
    const want = ADD_BUTTON_BY_TYPE.get(type);
    if (!want) return null;
    return [...document.querySelectorAll("button")].find(
      (b) => !host.contains(b) && isVisible(b) && b.textContent.replace(/\s+/g, " ").trim().endsWith(want),
    ) || null;
  }

  function freshEmptyTitle() {
    return [...document.querySelectorAll("[class*=free__title]")]
      .find((el) => !host.contains(el) && isVisible(el) && !readField(el).trim()) || null;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function createBlockThenPlan(item, btn) {
    const add = findAddButton(item.type);
    if (!add) {
      showNote(
        ADD_BUTTON_BY_TYPE.has(item.type)
          ? `ไม่เจอปุ่ม "＋ ${ADD_BUTTON_BY_TYPE.get(item.type)}" บนหน้านี้ — เปิดหน้าแฟ้มก่อน`
          : `ผลงานนี้ไม่มีหมวด เลยไม่รู้ว่าต้องกดปุ่มไหน — ตั้งหมวดในไอคอนส่วนขยายก่อน`,
      );
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "กำลังสร้าง…";
    try {
      const before = new Set(pageBlocks());
      add.click();
      let title = null;
      for (let i = 0; i < 12 && !title; i += 1) {
        await wait(400);
        const found = freshEmptyTitle();
        if (found && !before.has(outerBlock(found))) title = found;
      }
      if (!title) {
        showNote("กดปุ่มเพิ่มของเว็บแล้วแต่ยังไม่เห็นบล็อกใหม่ — ลองกดอีกที");
        return;
      }
      const block = outerBlock(title);
      block.scrollIntoView({ block: "center" });
      await wait(400);
      (block.querySelector("[class*=cathead]") || block).click(); // เลือกบล็อก ไม่งั้นเว็บไม่ให้เขียน
      await wait(1600);

      const plan = buildPlan(item);
      if (!plan.length) {
        showNote("สร้างบล็อกให้แล้ว แต่ยังไม่เจอช่องที่เติมได้ — ลองคลิกที่บล็อกนั้นแล้วกด เติมทั้งฟอร์ม");
        return;
      }
      showPlan(plan);
      noteText.append(
        Object.assign(document.createElement("div"), {
          className: "note-sub",
          textContent: "สร้างบล็อกใหม่ให้แล้ว · ถ้ากดยกเลิก บล็อกเปล่าจะค้างอยู่ ลบเองได้ที่ปุ่มถังขยะของเว็บ",
        }),
      );
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function outerBlock(el) {
    let node = el;
    let best = null;
    while (node && node !== document.body) {
      const cls = (node.className || "").toString();
      if (/(^|\s)block(\s|$)/.test(cls)) best = node; // คลาส "block" เพียว ๆ คือชั้นนอกสุด
      node = node.parentElement;
    }
    return best || el.closest("[class*=block]") || el.parentElement;
  }

  function pageBlocks() {
    return [...document.querySelectorAll("[class*=free__title]")]
      .filter((el) => !host.contains(el))
      .map((titleEl) => ({ titleEl, block: outerBlock(titleEl) }));
  }

  // หาบล็อกของผลงานชิ้นนี้จากหัวข้อ ไม่ใช่ตำแหน่ง
  function blockFor(item) {
    const want = item.title.trim();
    if (!want) return null;
    // ตรงตัวเท่านั้น — การจับแบบขึ้นต้นเหมือนกันเคยชี้ผิดบล็อกได้แม้เหลือผู้สมัครคนเดียว
    // (SOP สองฉบับ ถ้ามีบล็อกฉบับเดียวบนหน้า ก็จะจับเป็นของอีกฉบับ) รูปขึ้น S3 แล้วถอนไม่ได้
    return pageBlocks().find((b) => b.titleEl.textContent.trim() === want) || null;
  }

  function pageFileInput() {
    return [...document.querySelectorAll('input[type="file"]')].find(
      (el) => !host.contains(el) && /image/.test(el.accept || ""),
    );
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // content script อยู่ isolated world — File ที่สร้างจากตรงนี้ React ของเว็บไม่รับ
  // (ทดสอบแล้ว: โค้ดเดียวกัน จาก isolated ไม่ติด จาก main ติด)
  // จึงฉีด inject.js ตัวเล็ก ๆ เข้า main world แล้วส่งรูปไปให้มันป้อนแทน
  let injectReady = null;
  function ensureInjected() {
    if (injectReady) return injectReady;
    injectReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("inject.js");
      script.addEventListener("load", () => {
        script.remove(); // โหลดแล้วไม่ต้องค้างไว้ใน DOM ของเขา
        resolve();
      });
      script.addEventListener("error", () => reject(new Error("โหลดตัวช่วยฝั่งหน้าเว็บไม่ได้")));
      (document.head || document.documentElement).appendChild(script);
    });
    return injectReady;
  }

  function handToPage(img) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve({ ok: false, why: "ฝั่งหน้าเว็บไม่ตอบ" });
      }, 5000);
      function onReply(event) {
        if (event.source !== window) return;
        const m = event.data;
        if (!m || m.tag !== "doodee-future:attach-result" || m.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve({ ok: m.ok === true, why: m.why || "" });
      }
      window.addEventListener("message", onReply);
      window.postMessage(
        { tag: "doodee-future:attach", requestId, image: { name: img.name, type: img.type, data: img.data } },
        "*",
      );
    });
  }

  let attachBusy = false; // เว็บมี input รูปตัวเดียวใช้ร่วมกัน สองลูปพร้อมกัน = รูปไขว้บล็อก

  // ย่อรูปก่อนอัป:
  // วัดจริง 2026-08-23: TCASFolio ส่งทั้งแฟ้มพร้อมรูปเป็นก้อนเดียวตอนกดบันทึก
  // รูป 6000×4000 ใบเดียว (29 MB) ทำให้ body 38 MB → เซิร์ฟเวอร์ตอบ 413
  // และหน้า error ไม่มี CORS header เว็บเลยบอกผิดเป็น "เชื่อมต่อไม่สำเร็จ"
  // ย่อตั้งแต่ตอนแนบ ปัญหานี้จะไม่เกิดอีก (ในคลังยังเก็บไฟล์เต็มไว้เหมือนเดิม)
  const UPLOAD_MAX_BYTES = 1_200_000;
  const UPLOAD_MAX_EDGE = 1800;

  function dataUrlBytes(dataUrl) {
    const base64 = String(dataUrl).slice(String(dataUrl).indexOf(",") + 1);
    return Math.round(base64.length * 0.75);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("อ่านไฟล์ที่ย่อแล้วไม่ได้"));
      reader.readAsDataURL(blob);
    });
  }

  // คืน { image, shrunk } — ถ้าย่อไม่สำเร็จก็ส่งของเดิมไป ดีกว่าไม่ได้แนบเลย
  async function shrinkForUpload(img) {
    const bytes = dataUrlBytes(img.data);
    let bitmap = null;
    try {
      const blob = await (await fetch(img.data)).blob();
      bitmap = await createImageBitmap(blob);
      const edge = Math.max(bitmap.width, bitmap.height);
      if (bytes <= UPLOAD_MAX_BYTES && edge <= UPLOAD_MAX_EDGE) return { image: img, shrunk: false };

      let scale = Math.min(1, UPLOAD_MAX_EDGE / edge);
      let quality = 0.85;
      let out = null;
      for (let round = 0; round < 6; round += 1) {
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        out = await canvas.convertToBlob({ type: "image/jpeg", quality });
        if (out.size <= UPLOAD_MAX_BYTES) break;
        if (quality > 0.6) quality -= 0.12;
        else scale *= 0.8;
      }
      if (!out || out.size >= bytes) return { image: img, shrunk: false };
      return {
        image: {
          name: String(img.name || "image").replace(/\.(png|webp|heic|heif)$/i, ".jpg"),
          type: "image/jpeg",
          data: await blobToDataUrl(out),
        },
        shrunk: true,
      };
    } catch (error) {
      return { image: img, shrunk: false };
    } finally {
      if (bitmap) bitmap.close();
    }
  }

  // เลือกเลย์เอาต์ให้พอดีจำนวนรูป จะได้ไม่ต้องไปกดดรอปดาวน์ของเว็บเอง
  async function setLayoutForCount(count) {
    const want = count <= 1 ? "เต็มกว้าง 4:3" : `${Math.min(count, 6)} รูป`;
    const select = [...document.querySelectorAll("select")].find(
      (el) => !host.contains(el) && isVisible(el) && [...el.options].some((o) => /A4|รูป/.test(o.textContent)),
    );
    if (!select) return false;
    if ((select.selectedOptions[0] || {}).textContent?.trim() === want) return true;
    if (![...select.options].some((o) => o.textContent.trim() === want)) return false;
    writeField(select, want); // writeField จับคู่ option ด้วยข้อความ ไม่มีตัวตรงก็ไม่แตะ
    await sleep(1100);
    return true;
  }

  async function attachImages(item, button) {
    if (attachBusy) {
      showNote("กำลังแนบรูปของอีกชิ้นอยู่ รอให้เสร็จก่อน");
      return;
    }
    attachBusy = true;
    try {
      await attachImagesInner(item, button);
    } finally {
      attachBusy = false;
    }
  }

  async function attachImagesInner(item, button) {
    // บล็อกของ TCASFolio ถูก React สร้างใหม่ทั้งก้อนหลังเกือบทุก action
    // (ปิดแผงแก้ไข, กดเพิ่มรูป, อัปโหลด) — reference ที่จับไว้หลุดทันที
    // จึงห้ามถือ element ไว้ข้าม await: หาใหม่จากหัวข้อทุกครั้งที่จะใช้
    const live = () => blockFor(item);

    if (!live()) {
      showNote("ยังไม่มีบล็อกของผลงานนี้บนหน้า — เติมข้อความก่อน แล้วค่อยแนบรูป");
      return;
    }

    let images;
    try {
      images = await Storage.getImages(item.id);
    } catch (error) {
      showNote(`โหลดรูปจากคลังไม่ได้: ${error.message}`);
      return;
    }
    if (!images.length) {
      showNote("ผลงานนี้ยังไม่มีรูปในคลัง — แนบจากไอคอนส่วนขยายก่อน");
      return;
    }
    if (!pageFileInput()) {
      showNote("หน้านี้ไม่มีช่องอัปโหลดรูปของ TCASFolio");
      return;
    }

    const realImages = (block) =>
      [...block.querySelectorAll("img")].filter((i) => /^(blob:|https?:\/\/[^/]*s3[.-])/.test(i.src || ""))
        .length;
    const selectBlock = async () => {
      const b = live();
      if (!b) return null;
      b.block.scrollIntoView({ block: "center" });
      await sleep(250);
      if (!/is-selected/.test(b.block.className || "")) {
        b.block.click();
        await sleep(700);
      }
      return live();
    };

    button.disabled = true;
    let done = 0;
    let shrunkCount = 0;
    let slotsFull = false;
    let titleShown = "";
    try {
      await ensureInjected();

      // ปิดแผงแก้ไขก่อน — ตอนแผงเปิดอยู่ ปุ่ม "เพิ่มรูป" จะไปทำกับบล็อกที่แผงถือ
      // หาเฉพาะปุ่ม ← ที่อยู่ในแผงแก้ไข (มีช่อง "ระดับ"/"ผลรางวัล" อยู่ด้วย) ไม่ใช่ทั้งหน้า:
      // ปุ่ม ← ลอย ๆ ของเว็บอาจเป็นปุ่มย้อนกลับออกจากฟอร์ม กดแล้วของที่กรอกไว้หายหมด
      const backBtn = [...document.querySelectorAll("button")].find((b) => {
        if (!b.getClientRects().length || b.textContent.trim() !== "←") return false;
        const panel = b.closest("[class*=panel], [class*=editor], [class*=drawer], aside, form");
        return !!panel && /ระดับ|ผลรางวัล|หน่วยงานที่จัด/.test(panel.textContent || "");
      });
      if (backBtn) {
        backBtn.click();
        await sleep(900);
      }

      // ตั้งเลย์เอาต์ให้พอดีจำนวนรูปก่อน ไม่ต้องให้คนไปกดดรอปดาวน์เอง
      if (await selectBlock()) await setLayoutForCount(images.length);

      for (const img of images) {
        button.textContent = `แนบรูป ${done + 1}/${images.length}…`;

        let cur = await selectBlock();
        if (!cur) break;
        titleShown = cur.titleEl.textContent.trim().slice(0, 30);
        // บอกเป้าหมายก่อนอัปโหลดใบแรก — รูปขึ้นเซิร์ฟเวอร์แล้วถอนจากตรงนี้ไม่ได้
        if (done === 0) showNote(`กำลังแนบรูป ${images.length} ใบ ลงบล็อก «${titleShown}»…`);

        // ไม่มีช่องว่าง → กดเพิ่มรูป แล้ว "หาบล็อกใหม่" เพราะ React สร้างใหม่ทั้งก้อน
        if (!cur.block.querySelector(".frame__ph")) {
          const add = [...document.querySelectorAll("button")].find(
            (b) => (b.title || "") === "เพิ่มรูป" && b.getClientRects().length,
          );
          if (!add) {
            slotsFull = true;
            break;
          }
          add.click();
          await sleep(1300);
          cur = live();
          if (!cur) break;
        }
        const slot = cur.block.querySelector(".frame__ph");
        if (!slot) {
          slotsFull = true;
          break;
        }

        const before = realImages(cur.block);

        // คลิกช่องให้เว็บตั้งเป้าหมาย — เว็บจะเรียก input.click() เปิด dialog จริง
        // ดักไม่ได้จาก isolated world จึงปล่อยให้เด้ง (เบราว์เซอร์บล็อกเองเพราะไม่มี gesture)
        slot.click();
        await sleep(400);

        const ready = await shrinkForUpload(img);
        if (ready.shrunk) shrunkCount += 1;
        const handed = await handToPage(ready.image);
        if (!handed.ok) {
          showNote(`ส่งรูปให้หน้าเว็บไม่ได้: ${handed.why}`);
          break;
        }

        // รอให้รูปจริงเพิ่มในบล็อก — หาบล็อกใหม่ทุกรอบเพราะมันถูกสร้างใหม่ตอนอัปโหลด
        let landed = false;
        for (let tries = 0; tries < 25; tries += 1) {
          await sleep(400);
          const b = live();
          if (b && realImages(b.block) > before) {
            landed = true;
            break;
          }
        }
        if (!landed) break;
        done += 1;
      }
    } finally {
      button.disabled = false;
      button.textContent = `แนบรูป (${images.length})`;
    }

    if (done === images.length) {
      showFilled(
        `แนบรูปแล้ว ${done} ใบ ลงบล็อก «${titleShown}»` +
          (shrunkCount ? ` · ย่อให้ ${shrunkCount} ใบ กันบันทึกไม่ผ่าน` : ""),
      );
      undoBtn.hidden = true; // รูปอัปโหลดขึ้นเซิร์ฟเวอร์แล้ว ย้อนด้วยปุ่มลบรูปของเว็บเอง
    } else if (slotsFull) {
      showNote(
        `แนบได้ ${done}/${images.length} ใบ — บล็อกนี้รับรูปเพิ่มไม่ได้แล้ว ` +
          `เปลี่ยนเลย์เอาต์รูปในแถบเครื่องมือของบล็อก (เช่น "2 รูป") แล้วกดแนบซ้ำ`,
      );
    } else {
      showNote(`แนบได้ ${done}/${images.length} ใบ — ที่เหลือลองกดซ้ำ`);
    }
  }

  function card(item) {
    const box = document.createElement("div");
    box.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const imgCount = imageCounts[item.id] || 0;
    const pills = [
      [item.type ? item.type.split(" / ")[0] : "", ""],
      [item.level, "is-level"],
      [item.result, ""],
      [imgCount ? `🖼 ${imgCount} รูป` : "", "is-img"],
    ];
    for (const [text, extra] of pills) {
      if (!text) continue;
      const pill = document.createElement("span");
      pill.className = "tag" + (extra ? " " + extra : "");
      pill.textContent = text;
      meta.append(pill);
    }
    if (item.org) meta.title = item.org;

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

    // ปุ่มย่อยพับไว้ก่อน — บนการ์ดเหลือแค่สองปุ่มที่ใช้จริงทุกครั้ง
    const moreRow = document.createElement("div");
    moreRow.className = "fillrow more";
    moreRow.hidden = true;
    const fillLabel = document.createElement("span");
    fillLabel.className = "fill-label";
    fillLabel.textContent = "เติมลงช่องที่เลือก:";
    moreRow.append(fillLabel);
    for (const [what, value] of [
      ["ชื่อ", item.title],
      ["หน่วยงาน", item.org],
      ["รายละเอียด", item.detail],
    ]) {
      if (value) moreRow.append(fillButton(item, what, value));
    }

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "fill fill-new";
    newBtn.textContent = "＋ ลงพอร์ต";
    newBtn.title = "สร้างบล็อกใหม่ในเว็บให้ตรงหมวด แล้วเติมข้อมูลชิ้นนี้";
    newBtn.addEventListener("click", () => { createBlockThenPlan(item, newBtn); });
    fillRow.append(newBtn);

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "fill fill-all";
    allBtn.textContent = "เติมทั้งฟอร์ม";
    allBtn.title = "ใช้กับบล็อกที่มีอยู่แล้วและเลือกไว้";
    allBtn.addEventListener("click", () => {
      const plan = buildPlan(item);
      if (!plan.length) {
        showNote("ไม่เจอช่องที่เติมได้บนหน้านี้ — เปิดฟอร์มเพิ่มผลงานก่อน แล้วค่อยกด");
        return;
      }
      showPlan(plan); // ยังไม่เขียนอะไรทั้งนั้น รอกดยืนยันก่อน
    });
    moreRow.append(allBtn);

    const n = imageCounts[item.id] || 0;
    if (n) {
      const imgBtn = document.createElement("button");
      imgBtn.type = "button";
      imgBtn.className = "fill fill-img";
      imgBtn.textContent = `แนบรูป (${n})`;
      imgBtn.addEventListener("click", () => attachImages(item, imgBtn));
      fillRow.append(imgBtn);
    }

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "morebtn";
    moreBtn.textContent = "⋯";
    moreBtn.title = "ปุ่มเพิ่มเติม";
    moreBtn.setAttribute("aria-expanded", "false");
    moreBtn.addEventListener("click", () => {
      moreRow.hidden = !moreRow.hidden;
      copyBtn.hidden = moreRow.hidden;
      moreBtn.setAttribute("aria-expanded", String(!moreRow.hidden));
    });
    fillRow.append(moreBtn);

    copyBtn.hidden = true;
    box.append(title, meta, fillRow, moreRow, copyBtn);
    return box;
  }

  function renderList() {
    const shown = Model.filterItems(items, { type: activeType, tag: activeTag, q: query });
    count.textContent =
      shown.length === items.length ? `${items.length} ผลงาน` : `${shown.length}/${items.length} ผลงาน`;

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = items.length
        ? "ไม่เจอผลงานที่ตรงกับที่ค้นหา"
        : "ยังไม่มีข้อมูล — เพิ่มได้จากไอคอนส่วนขยาย";
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(...shown.map(card));
  }

  async function refreshImageCounts() {
    try {
      imageCounts = await Storage.getImageCounts();
    } catch (error) {
      imageCounts = {};
    }
    renderList();
  }

  function refresh(next) {
    items = next;
    // แท็กที่เลือกไว้อาจถูกลบไปแล้วจากอีกหน้าต่างหนึ่ง — ถ้าไม่มีแล้วให้เลิกกรอง
    if (activeTag && !Model.allTags(items).includes(activeTag)) activeTag = "";
    renderTypeBar();
    renderTagBar();
    renderList();
  }

  // ---------- นำเข้าอัตโนมัติจากแฟ้มที่กรอกไว้บนเว็บ ----------
  // ทางเดียวที่จะได้ผลงานทั้งแฟ้มมาแบบครบ ๆ คือดักตอนเว็บส่งขึ้นเซิร์ฟเวอร์เอง
  // (อ่านจาก DOM ไม่ได้: หน้าแสดงทีละบล็อก ต้องกดเปิดทีละอัน และรูปเป็น thumbnail)
  // interceptor.js ใน main world เป็นคนดัก แล้วส่งมาที่นี่ผ่าน postMessage
  let autoArmed = false;
  let autoBusy = false;

  const autoBar = document.createElement("div");
  autoBar.className = "autobar";

  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "autobtn";
  autoBtn.textContent = "⇩ นำเข้าอัตโนมัติ";
  autoBtn.title = "ดึงผลงานทั้งหมดจากแฟ้มบนเว็บเข้าคลัง";
  autoBar.append(autoBtn);

  function applyAutoUI() {
    autoBtn.textContent = autoArmed ? "⏳ รออยู่… กดบันทึกแฟ้มได้เลย" : "⇩ นำเข้าอัตโนมัติ";
    autoBtn.classList.toggle("is-armed", autoArmed);
    autoBtn.disabled = autoBusy;
  }

  // ข้อความจบงาน ไม่ใช่ผลของการเติมฟอร์ม จึงต้องไม่มีปุ่ม "ย้อนกลับ" ให้กด
  // (ย้อนของที่เข้าคลังไปแล้วต้องไปลบทีละชิ้นจากไอคอนส่วนขยาย)
  function showDone(message) {
    showNote(message);
    note.classList.add("is-ok");
  }

  function autoSteps() {
    clearNote();
    noteText.replaceChildren();
    const head = document.createElement("div");
    head.className = "plan-head";
    head.textContent = "เปิดโหมดนำเข้าอัตโนมัติแล้ว — เหลือขั้นเดียว";
    const ol = document.createElement("ol");
    ol.className = "auto-steps";
    for (const [main, sub] of [
      [
        "กดปุ่ม “บันทึกแฟ้ม” ของเว็บ",
        "ตอนนั้นเว็บส่งทั้งแฟ้ม + ขอลิงก์รูปพร้อมกัน ส่วนขยายจะคัดลอกเข้าคลังให้เอง",
      ],
    ]) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = main;
      const small = document.createElement("small");
      small.textContent = sub;
      li.append(b, small);
      ol.appendChild(li);
    }
    const foot = document.createElement("div");
    foot.className = "note-sub";
    foot.textContent = "ไม่ต้องกดอะไรในแผงนี้อีก · โหมดนี้ค้างไว้จนกว่าจะดักได้หรือกดยกเลิก";
    noteText.append(head, ol, foot);
    cancelBtn.hidden = false;
    note.classList.remove("is-ok");
    note.hidden = false;
  }

  // ตัวดักถูกฉีดเข้า main world ตั้งแต่ document_start โดย manifest
  // แต่หน้าที่เปิดค้างไว้ตั้งแต่ก่อน reload ส่วนขยายจะไม่มีมัน — เช็คก่อนแล้วฉีดซ้ำให้เอง
  // ฉีดตอนนี้ยังทัน เพราะของที่ต้องดัก (PUT แฟ้ม + presign) เกิดตอนผู้ใช้กดบันทึกทีหลัง
  function pingTap() {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve(false);
      }, 600);
      function onReply(event) {
        if (event.source !== window) return;
        const m = event.data;
        if (!m || m.tag !== "doodee-future:pong" || m.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve(true);
      }
      window.addEventListener("message", onReply);
      window.postMessage({ tag: "doodee-future:ping", requestId }, "*");
    });
  }

  async function ensureTap() {
    if (await pingTap()) return true;
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("interceptor.js");
        script.addEventListener("load", () => {
          script.remove();
          resolve();
        });
        script.addEventListener("error", () => reject(new Error("โหลดตัวดักไม่ได้")));
        (document.head || document.documentElement).appendChild(script);
      });
    } catch (error) {
      return false;
    }
    return pingTap();
  }

  async function setArmed(armed) {
    autoArmed = armed === true;
    applyAutoUI();
    try {
      await Storage.setAutoImportArmed(autoArmed);
    } catch (error) {
      // จำไม่ได้ = พอรีโหลดหน้าแล้วโหมดจะหลุด ผู้ใช้กด F5 ไปแล้วรออยู่เก้อ ต้องบอก
      showNote("จำสถานะโหมดนำเข้าไม่ได้ — ถ้าโหลดหน้าใหม่แล้วโหมดหลุด ให้กดปุ่มนี้อีกครั้ง");
    }
  }

  autoBtn.addEventListener("click", async () => {
    if (autoBusy) return;
    if (autoArmed) {
      await setArmed(false);
      clearNote();
      return;
    }
    autoBtn.disabled = true;
    const ready = await ensureTap();
    autoBtn.disabled = false;
    // ไม่มีตัวดักในหน้านี้ = กดบันทึกแฟ้มไปก็ไม่มีอะไรเกิดขึ้น ต้องบอกก่อน ไม่ใช่ปล่อยให้รอเก้อ
    if (!ready) {
      showNote("ตัวดักยังไม่ทำงานในหน้านี้ — โหลดหน้าใหม่ (F5) แล้วกดปุ่มนี้อีกครั้ง");
      return;
    }
    await setArmed(true);
    autoSteps();
  });

  // รูปบน S3 เปิดตรง ๆ ไม่ได้ ต้องใช้ presigned URL ที่เว็บขอจาก POST /folios/presign
  // (ลิงก์มี ?AWSAccessKeyId=&Expires=&Signature= ต่อท้าย และหมดอายุ — ห้ามตัด query ทิ้ง)
  // interceptor ส่งลิงก์ทุกตัวที่เห็นมาสะสมไว้ที่นี่ — เก็บเฉพาะตัวที่มีลายเซ็นเท่านั้น
  // ที่อยู่เปล่า ๆ ไม่มีประโยชน์เลย: bucket ไม่ได้เปิดสาธารณะ ยิงไปก็ได้ AccessDenied อย่างเดียว
  const s3Seen = [];

  const isSigned = (url) => /[?&]Signature=/.test(String(url));

  function noteUrls(urls) {
    for (const url of Array.isArray(urls) ? urls : []) {
      if (typeof url === "string" && isSigned(url) && !s3Seen.includes(url)) s3Seen.push(url);
    }
  }

  const urlPath = (url) => String(url).split("?")[0];

  function knownUrls() {
    const out = s3Seen.slice();
    // รูปที่หน้าเว็บกำลังแสดงอยู่ก็มาจาก presign ชุดเดียวกัน และยังไม่หมดอายุ
    for (const img of document.querySelectorAll('img[src*="amazonaws.com"]')) {
      if (img.src && isSigned(img.src) && !out.includes(img.src)) out.push(img.src);
    }
    return out;
  }

  function findSigned(filename, known) {
    const tail = "/" + filename;
    // ตัวใหม่ที่สุดก่อน — ลิงก์ที่เพิ่งได้มามีเวลาเหลือมากกว่าตัวที่เห็นตั้งแต่เปิดหน้า
    for (let i = known.length - 1; i >= 0; i -= 1) {
      if (urlPath(known[i]).endsWith(tail)) return known[i];
    }
    return "";
  }

  // ที่อยู่เดียวที่ใช้ได้คือ presigned URL ของไฟล์นั้นเอง — ไม่มีตัวสำรอง ไม่ประกอบ URL เอง
  // (เคยลองประกอบเอง: ได้ AccessDenied ทุกใบ แถมยิงทิ้งเปล่าหลายรอบต่อรูปหนึ่งใบ)
  function imageUrls(filename, known) {
    const signed = findSigned(filename, known);
    return signed ? [signed] : [];
  }

  // ตอนกด "บันทึกแฟ้ม" เว็บยิง POST /folios/presign ของมันเองอยู่แล้ว แล้วได้ลิงก์กลับมาทั้งชุด
  // เรารอเก็บของชุดนั้น ไม่ยิงขอเอง — ไม่ต้องเดารูปแบบคำขอ ไม่ต้องยืมสิทธิ์ของผู้ใช้ไปยิงอะไรเพิ่ม
  // presign กับ PUT แฟ้มมาไล่ ๆ กัน ใครมาก่อนก็ได้ จึงต้องรอเป็นช่วงเวลา ไม่ใช่เช็คครั้งเดียว
  const LINK_WAIT_MS = 30000;

  function missingNames(filenames) {
    const known = knownUrls();
    return filenames.filter((name) => !findSigned(name, known));
  }

  async function waitForLinks(filenames, onProgress) {
    const deadline = Date.now() + LINK_WAIT_MS;
    let missing = missingNames(filenames);
    while (missing.length && Date.now() < deadline) {
      if (onProgress) onProgress(filenames.length - missing.length);
      await sleep(400);
      missing = missingNames(filenames);
    }
    return missing;
  }

  async function fetchImage(urls) {
    try {
      const reply = await chrome.runtime.sendMessage({ tag: "doodee-future:fetch-image", urls });
      if (reply && reply.ok) return reply;
      return { ok: false, why: (reply && reply.why) || "ไม่มีคำตอบจากส่วนขยาย" };
    } catch (error) {
      // service worker หลับ/ส่วนขยายเพิ่งรีโหลด — ข้อความ ไม่ใช่ผลงาน ยังเข้าคลังไปแล้ว
      return { ok: false, why: error && error.message ? error.message : String(error) };
    }
  }

  // ของเดิมที่มีอยู่ห้ามหาย: ชิ้นที่เคยนำเข้าแล้วอาจมีรูปที่ผู้ใช้เพิ่มเองอยู่ด้วย
  // เทียบด้วยชื่อไฟล์ ซ้ำแล้วไม่ต้องดึงใหม่ (ประหยัดทั้งเวลาและที่เก็บ)
  async function saveImages(itemId, filenames, known) {
    const current = await Storage.getImages(itemId);
    const have = new Set(current.map((img) => img.name));
    const want = filenames.filter((name) => !have.has(name));
    if (!want.length) return { ok: 0, failed: 0 };
    let ok = 0;
    let failed = 0;
    const next = current.slice();
    for (const name of want) {
      let urls = imageUrls(name, known);
      let got = urls.length ? await fetchImage(urls) : { ok: false, why: "ยังไม่ได้ลิงก์จาก presign" };
      // ลิงก์อาจเพิ่งมาถึงหลังรอบแรกผ่านไป — ลองอีกทีด้วยชุดล่าสุดก่อนตัดสินว่าพลาด
      if (!got.ok) {
        const fresh = imageUrls(name, knownUrls());
        if (fresh.length && fresh[0] !== urls[0]) {
          urls = fresh;
          got = await fetchImage(urls);
        }
      }
      if (!got.ok) {
        // ข้อความบนแผงบอกได้แค่ "ดึงไม่ได้" — สาเหตุจริงต้องดูที่นี่ (คอนโซลของหน้าเว็บ)
        console.warn("[doodee] ดึงรูปไม่สำเร็จ", name, got.why, urls);
        failed += 1;
        continue;
      }
      next.push({ name, type: got.type || "image/jpeg", data: got.data });
      ok += 1;
    }
    if (ok) await Storage.setImages(itemId, next);
    return { ok, failed };
  }

  async function runAutoImport(msg) {
    const parsed = Model.folioToItems(msg.fields);
    if (!parsed.length) {
      showNote("ดักแฟ้มได้แล้ว แต่ยังไม่มีผลงานที่กรอกหัวข้อไว้ให้นำเข้า");
      await setArmed(false);
      return;
    }

    const current = await Storage.getItems({ migrate: false });
    const merged = Model.mergeFolioItems(current, parsed);
    await Storage.setItems(merged.items);
    refresh(merged.items);
    // ปลดโหมดทันทีที่ข้อความเข้าคลังแล้ว — กันดักซ้ำถ้าผู้ใช้กดบันทึกแฟ้มอีกรอบระหว่างดึงรูป
    await setArmed(false);

    const summary = `นำเข้าแล้ว ${merged.added} ชิ้นใหม่` + (merged.updated ? ` · อัปเดต ${merged.updated} ชิ้นเดิม` : "");
    const total = parsed.reduce((sum, entry) => sum + entry.filenames.length, 0);
    if (!total) {
      showDone(`${summary} — แฟ้มนี้ไม่มีรูปแนบ`);
      return;
    }

    noteUrls(msg.s3);
    showNote(`${summary} — รอลิงก์รูปจากเว็บ 0/${total} ใบ…`);
    // รอชุดลิงก์ที่เว็บขอเองตอนบันทึกแฟ้มให้มาครบก่อน ค่อยเริ่มดึง
    const never = await waitForLinks(
      parsed.flatMap((entry) => entry.filenames),
      (ready) => showNote(`${summary} — รอลิงก์รูปจากเว็บ ${ready}/${total} ใบ…`),
    );

    showNote(`${summary} — กำลังดึงรูป ${total} ใบ…`);
    const known = knownUrls();
    const byId = new Map(merged.pairs.map((pair) => [pair.id, pair.filenames]));
    let ok = 0;
    let failed = 0;
    for (const [id, filenames] of byId) {
      if (!filenames.length) continue;
      const got = await saveImages(id, filenames, known);
      ok += got.ok;
      failed += got.failed;
      showNote(`${summary} — กำลังดึงรูป ${ok + failed}/${total} ใบ…`);
    }
    await refreshImageCounts();
    // แยกสาเหตุให้ชัด: ไม่ได้ลิงก์มาเลย ≠ ได้ลิงก์แล้วโหลดไม่ผ่าน — วิธีแก้คนละทาง
    const why = never.length
      ? ` (ดึงไม่ได้ ${failed} ใบ — เว็บไม่ได้ส่งลิงก์รูปมาตอนบันทึก ลองกดบันทึกแฟ้มอีกครั้ง)`
      : ` (ดึงไม่ได้ ${failed} ใบ — ลิงก์อาจหมดอายุ กดบันทึกแฟ้มอีกครั้งแล้วนำเข้าใหม่)`;
    showDone(`${summary} · รูป ${ok} ใบ` + (failed ? why : ""));
  }

  // ลิงก์รูปเข้ามาเรื่อย ๆ ตลอดเวลาที่ผู้ใช้เปิดดูบล็อกต่าง ๆ — เก็บไว้ก่อนเสมอ
  // ไม่ต้องรอเปิดโหมดนำเข้า (ตอนเปิดโหมดแล้วค่อยเก็บ = ลิงก์ที่หน้าโหลดไปแล้วหายหมด)
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg && msg.tag === "doodee-future:s3") noteUrls(msg.urls);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.tag !== "doodee-future:folio") return;
    if (!autoArmed || autoBusy) return; // ไม่ได้เปิดโหมดไว้ = ไม่แตะข้อมูลของเขา
    autoBusy = true;
    applyAutoUI();
    runAutoImport(msg)
      .catch((error) => {
        showNote(`นำเข้าอัตโนมัติไม่สำเร็จ: ${error && error.message ? error.message : error}`);
      })
      .finally(() => {
        autoBusy = false;
        applyAutoUI();
      });
  });

  body.prepend(autoBar); // ประกาศทีหลัง body.append จึงมาแปะเอาตอนนี้

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
      Storage.onImagesChanged(() => refreshImageCounts());
      await refreshImageCounts();
      collapsed = await Storage.getPanelCollapsed();
      // ผู้ใช้กดนำเข้าอัตโนมัติค้างไว้จากหน้าก่อน — โหมดต้องยังเปิดอยู่หลังโหลดใหม่
      autoArmed = await Storage.getAutoImportArmed();
      applyAutoUI();
      if (autoArmed) {
        collapsed = false; // ต้องเห็นว่ายังรออยู่ ไม่งั้นกดบันทึกแฟ้มแล้วงงว่าเกิดอะไรขึ้น
        autoSteps();
        ensureTap(); // โหมดค้างมาจากหน้าก่อน — หน้านี้ต้องมีตัวดักด้วย
      }
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
