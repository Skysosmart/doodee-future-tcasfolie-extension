// หน้าวิเคราะห์พอร์ต — ประกอบข้อความจากคลัง ส่งไปที่ระบบวิเคราะห์ของเว็บ แล้ววาดผล
//
// ยิงผ่านแท็บของเว็บเหมือนหน้าคลัง (ดู sitecall.js) และเป็นแท็บของตัวเอง
// เพราะการวิเคราะห์ใช้เวลาได้ถึงสามนาที popup ตายก่อนแน่นอน
"use strict";

const ANALYSE_PATH = "/api/portfolio/analyse";
const CACHE_KEY = "lastAnalysis";

const el = (id) => document.getElementById(id);
let payload = null;

function fmtWhen(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadVault() {
  const items = await Storage.getItems();
  const built = Analysis.buildText(items);
  payload = built;

  el("statItems").textContent = items.length;
  el("statChars").textContent = built.text.length.toLocaleString("th-TH");
  el("statSent").textContent = built.used;
  el("preview").value = built.text;

  const run = el("runBtn");
  if (!items.length) {
    run.disabled = true;
    el("status").textContent = "คลังยังว่าง — ใส่ผลงานเข้าคลังก่อน";
  } else if (built.truncated) {
    // ตัดแล้วต้องบอก ไม่ใช่ส่งไปครึ่งเดียวแล้วรายงานว่าวิเคราะห์ทั้งพอร์ต
    el("status").textContent =
      `ข้อความยาวเกินที่เว็บรับได้ ส่งไป ${built.used} จาก ${built.total} ชิ้น (เรียงตามลำดับในคลัง)`;
  }
}

// ── วาดผล ──────────────────────────────────────────────────────────
function fillList(node, values) {
  node.innerHTML = "";
  for (const value of values) {
    const li = document.createElement("li");
    li.textContent = value;
    node.appendChild(li);
  }
}

function fillChips(node, values) {
  node.innerHTML = "";
  for (const value of values) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = value;
    node.appendChild(span);
  }
}

function drawFaculties(list) {
  const box = el("faculties");
  box.innerHTML = "";
  for (const item of list) {
    const card = document.createElement("div");
    card.className = "faculty";

    const top = document.createElement("div");
    top.className = "faculty-top";
    const name = document.createElement("span");
    name.className = "faculty-name";
    name.textContent = item.name;
    top.appendChild(name);
    if (item.match !== null) {
      const match = document.createElement("span");
      match.className = "faculty-match";
      match.textContent = `${item.match}%`;
      top.appendChild(match);
    }
    card.appendChild(top);

    if (item.match !== null) {
      const meter = document.createElement("div");
      meter.className = "meter";
      const fill = document.createElement("i");
      fill.style.width = `${item.match}%`;
      meter.appendChild(fill);
      card.appendChild(meter);
    }

    if (item.reason) {
      const why = document.createElement("p");
      why.className = "faculty-why";
      why.textContent = item.reason;
      card.appendChild(why);
    }

    if (item.evidence.length || item.missing.length) {
      const tags = document.createElement("div");
      tags.className = "faculty-tags";
      for (const text of item.evidence) {
        const tag = document.createElement("span");
        tag.className = "tag-have";
        tag.textContent = `มีแล้ว: ${text}`;
        tags.appendChild(tag);
      }
      for (const text of item.missing) {
        const tag = document.createElement("span");
        tag.className = "tag-miss";
        tag.textContent = `ยังขาด: ${text}`;
        tags.appendChild(tag);
      }
      card.appendChild(tags);
    }

    box.appendChild(card);
  }
}

function drawSkills(list) {
  const box = el("skills");
  box.innerHTML = "";
  for (const item of list) {
    const row = document.createElement("div");
    row.className = "skill";

    const name = document.createElement("span");
    name.textContent = item.name;

    const meter = document.createElement("div");
    meter.className = "meter";
    const fill = document.createElement("i");
    fill.style.width = `${item.score}%`;
    meter.appendChild(fill);

    const score = document.createElement("b");
    score.textContent = item.score;

    row.append(name, meter, score);
    box.appendChild(row);
  }
}

function render(result, when) {
  el("overview").textContent = result.overview;
  el("stamp").textContent = when ? `วิเคราะห์เมื่อ ${fmtWhen(when)}` : "";
  fillChips(el("groups"), result.groups.map((g) => (g.confidence !== null ? `${g.name} ${g.confidence}%` : g.name)));

  el("facultyCard").hidden = !result.faculties.length;
  if (result.faculties.length) drawFaculties(result.faculties);

  el("strengthCard").hidden = !result.strengths.length;
  if (result.strengths.length) fillList(el("strengths"), result.strengths);

  el("weakCard").hidden = !result.weaknesses.length;
  if (result.weaknesses.length) fillList(el("weaknesses"), result.weaknesses);

  el("recCard").hidden = !result.recommendations.length;
  if (result.recommendations.length) fillList(el("recommendations"), result.recommendations);

  el("skillCard").hidden = !result.skills.length;
  if (result.skills.length) drawSkills(result.skills);

  el("interestCard").hidden = !result.interests.length;
  if (result.interests.length) fillChips(el("interests"), result.interests);

  el("result").hidden = false;
}

// ── ยิงวิเคราะห์ ────────────────────────────────────────────────────
el("openVault").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("backup.html") });
});

el("runBtn").addEventListener("click", async () => {
  if (!payload || !payload.text) return;

  const btn = el("runBtn");
  btn.disabled = true;
  el("working").hidden = false;
  el("status").textContent = "";

  const started = Date.now();
  const ticker = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    el("elapsed").textContent = `กำลังวิเคราะห์… ${secs} วินาที (ใช้เวลาได้ถึงราวสองนาที อย่าปิดแท็บ)`;
  }, 1000);
  el("elapsed").textContent = "กำลังวิเคราะห์…";

  try {
    const res = await SiteCall.request(ANALYSE_PATH, {
      method: "POST",
      body: { text: payload.text, fileName: "doodee-vault" },
    });

    if (!res.ok) throw new Error(SiteCall.explain(res.status));
    if (SiteCall.looksLikeHtml(res.text)) {
      throw new Error("เว็บส่ง HTML กลับมาแทน JSON — น่าจะเด้งไปหน้าล็อกอิน");
    }

    const result = Analysis.parseAnalysis(res.text);
    const when = Date.now();
    render(result, when);
    // เก็บไว้ให้เปิดดูซ้ำได้โดยไม่ต้องยิงใหม่ (แต่ละครั้งใช้เวลาและโควตา AI ของเว็บ)
    await chrome.storage.local.set({ [CACHE_KEY]: { result, when, items: payload.used } });
    el("status").textContent = `เสร็จใน ${Math.round((Date.now() - started) / 1000)} วินาที · จาก ${payload.used} ชิ้น`;
  } catch (error) {
    el("status").textContent = error.message;
  } finally {
    clearInterval(ticker);
    el("working").hidden = true;
    btn.disabled = false;
  }
});

async function loadCached() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  const cached = data[CACHE_KEY];
  if (!cached || !cached.result) return;
  render(cached.result, cached.when);
  el("status").textContent = `แสดงผลครั้งล่าสุด (${cached.items} ชิ้น) — กดส่งไปวิเคราะห์อีกครั้งได้ถ้าคลังเปลี่ยนแล้ว`;
}

loadVault().then(loadCached);
