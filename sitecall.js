// ตัวกลางคุยกับ doodee-future.com ผ่านแท็บของเว็บ
// ใช้ทั้งหน้า backup.html (ดึงผลงาน) และ analyse.html (ส่งไปวิเคราะห์)
//
// ยิงตรงจากหน้าส่วนขยายไม่ได้: คำขอจาก chrome-extension:// เป็น cross-site
// คุกกี้เซสชัน SameSite=Lax จะไม่ถูกส่ง — ต้องให้ content script ในแท็บเว็บยิงแทน
(function (root) {
  "use strict";

  const ORIGIN = "https://doodee-future.com";
  const SITE_URL = `${ORIGIN}/en/profile/portfolio`;
  // แท็บที่เปิดเองต้องเป็นหน้าที่ไม่เด้งต่อ — /en/profile/portfolio เด้งไป /login เมื่อยังไม่ล็อกอิน
  // แล้ว fetch ที่ค้างอยู่จะถูกยกเลิกกลางทาง กลายเป็น "Failed to fetch" (เจอจริง)
  // ส่วน "/" ก็เด้งไป /th ตาม next-intl จึงเปิด /th ตรง ๆ
  const WORK_URL = `${ORIGIN}/th`;

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  async function request(path, options) {
    const opts = options || {};
    const open = await chrome.tabs.query({ url: `${ORIGIN}/*` });
    let tab = open[0];
    const opened = !tab;

    if (opened) {
      tab = await chrome.tabs.create({ url: WORK_URL, active: false });
      for (let i = 0; i < 40; i += 1) {
        const now = await chrome.tabs.get(tab.id).catch(() => null);
        if (!now) throw new Error("แท็บเว็บถูกปิดไปก่อน");
        if (now.status === "complete") break;
        await sleep(500);
      }
      await sleep(600); // เผื่อ redirect ฝั่ง client ที่เกิดหลัง complete
    }

    try {
      // content script อาจยังไม่ทันฝังตัวในแท็บที่เพิ่งเปิด ลองซ้ำสองสามที
      let last;
      for (let i = 0; i < 6; i += 1) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, {
            tag: "doodee-call",
            path,
            method: opts.method || "GET",
            body: opts.body,
          });
          if (!res) throw new Error("แท็บเว็บไม่ตอบกลับ");
          // status 0 = ยิงไม่ออกเลย มักเพราะหน้ากำลังเปลี่ยนอยู่ ลองอีกทีก่อนยอมแพ้
          if (!res.ok && res.status === 0) {
            if (i < 2) {
              await sleep(1200);
              continue;
            }
            throw new Error(`ยิงจากแท็บเว็บไม่สำเร็จ (${res.why || "ไม่ทราบสาเหตุ"})`);
          }
          return res;
        } catch (error) {
          if (!/Could not establish connection|Receiving end does not exist/.test(error.message)) throw error;
          last = error;
          await sleep(700);
        }
      }
      throw new Error(
        `คุยกับแท็บ doodee-future ไม่ได้ — ลองโหลดส่วนขยายใหม่แล้วรีเฟรชหน้าเว็บ (${last && last.message})`,
      );
    } finally {
      if (opened) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  function explain(status) {
    if (status === 401 || status === 403) {
      return "เว็บบอกว่ายังไม่ได้ล็อกอิน — เปิดหน้าพอร์ตในเว็บแล้วล็อกอินก่อน ค่อยลองอีกที";
    }
    if (status === 404) return "เว็บยังไม่มี endpoint นี้ — ดูสเปกที่ docs/web-api-contract.md";
    if (status === 408) return "เว็บใช้เวลานานเกินไปแล้วตัดการเชื่อมต่อ ลองใหม่อีกที";
    if (status === 429) return "ยิงถี่เกินไป รอสักครู่แล้วลองใหม่";
    if (status >= 500) return `เว็บมีปัญหาฝั่งเซิร์ฟเวอร์ (${status}) ลองใหม่อีกที`;
    return `เว็บตอบ ${status}`;
  }

  // ล็อกอินหมดอายุมักได้หน้า HTML กลับมาพร้อม 200 ไม่ใช่ 401
  function looksLikeHtml(text) {
    return /^\s*</.test(text);
  }

  root.SiteCall = { ORIGIN, SITE_URL, request, explain, looksLikeHtml };
})(globalThis);
