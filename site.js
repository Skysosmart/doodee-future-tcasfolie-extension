// content script บน doodee-future.com — ยิง API ให้แทนหน้าส่วนขยาย
//
// หน้า backup.html อยู่ที่ origin chrome-extension:// ซึ่งนับเป็น cross-site
// คุกกี้เซสชันของเว็บเป็น SameSite=Lax จึงไม่ถูกส่งไปด้วย ยิงตรงได้ 401 ตลอด
// แต่ในแท็บของเว็บเองเป็น same-origin คุกกี้ทำงานปกติ ผู้ใช้แค่ล็อกอินค้างไว้
"use strict";

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.tag !== "doodee-pull" || typeof msg.path !== "string") return;

  (async () => {
    try {
      const res = await fetch(msg.path, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      reply({ ok: res.ok, status: res.status, text: await res.text() });
    } catch (error) {
      reply({ ok: false, status: 0, why: error && error.message ? error.message : String(error) });
    }
  })();

  return true; // ตอบแบบ async
});
