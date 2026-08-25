// content script บน doodee-future.com — ยิง API ให้แทนหน้าส่วนขยาย
//
// หน้าของส่วนขยายอยู่ที่ origin chrome-extension:// ซึ่งนับเป็น cross-site
// คุกกี้เซสชันของเว็บเป็น SameSite=Lax จึงไม่ถูกส่งไปด้วย ยิงตรงได้ 401 ตลอด
// แต่ในแท็บของเว็บเองเป็น same-origin คุกกี้ทำงานปกติ ผู้ใช้แค่ล็อกอินค้างไว้
"use strict";

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.tag !== "doodee-call" || typeof msg.path !== "string") return;
  // path เท่านั้น ห้ามรับ URL เต็ม — จะได้ยิงออกนอกโดเมนนี้ไม่ได้เลย
  if (!msg.path.startsWith("/api/")) {
    reply({ ok: false, status: 0, why: "path ต้องขึ้นต้นด้วย /api/" });
    return;
  }

  (async () => {
    try {
      const init = {
        method: msg.method === "POST" ? "POST" : "GET",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      };
      if (init.method === "POST") {
        init.headers["content-type"] = "application/json";
        init.body = typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body || {});
      }
      const res = await fetch(msg.path, init);
      reply({ ok: res.ok, status: res.status, text: await res.text() });
    } catch (error) {
      reply({ ok: false, status: 0, why: error && error.message ? error.message : String(error) });
    }
  })();

  return true; // ตอบแบบ async
});
