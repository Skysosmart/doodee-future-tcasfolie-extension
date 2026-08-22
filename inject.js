// ---------------------------------------------------------
// ตัวช่วยฝั่ง main world ของหน้า TCASFolio — ทำงานเรื่องเดียว: รับรูปจาก
// content script แล้วป้อนเข้า <input type=file> ของเว็บในฐานะ File ของ realm เว็บเอง
//
// ทำไมต้องมีไฟล์นี้: content script อยู่ isolated world — File/DataTransfer
// ที่สร้างจากฝั่งนั้นเป็นคนละ realm กับ React ของเว็บ พอ handler อ่าน
// e.target.files[0] จะได้ object ที่ไม่ใช่ File ของมัน แล้วเงียบไปเฉย ๆ
// (ทดสอบแล้ว: โค้ดเดียวกันเป๊ะ จาก isolated ไม่ติด จาก main ติด)
//
// ไฟล์นี้แตะหน้าเว็บได้ จึงต้องทำให้น้อยที่สุด: ไม่อ่าน DOM อื่น ไม่เก็บอะไร
// ไม่ส่งอะไรออกนอกหน้า ฟังเฉพาะข้อความที่มาจาก window เดียวกันและมีลายเซ็นของเรา
// ---------------------------------------------------------
(function () {
  "use strict";
  const TAG = "doodee-future:attach";
  const REPLY = "doodee-future:attach-result";
  if (window.__doodeeAttachReady) return;
  window.__doodeeAttachReady = true;

  function toFile(img) {
    const [head, b64] = String(img.data).split(",");
    const mime = (head.match(/data:([^;]+)/) || [])[1] || img.type || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], img.name || "image.jpg", { type: mime });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.tag !== TAG || typeof msg.requestId !== "string") return;

    const reply = (ok, why) =>
      window.postMessage({ tag: REPLY, requestId: msg.requestId, ok, why: why || "" }, "*");

    try {
      const input = [...document.querySelectorAll('input[type="file"]')].find((el) =>
        /image/.test(el.accept || ""),
      );
      if (!input) return reply(false, "ไม่เจอช่องอัปโหลดของเว็บ");

      const dt = new DataTransfer();
      dt.items.add(toFile(msg.image));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      reply(true);
    } catch (error) {
      reply(false, error && error.message ? error.message : String(error));
    }
  });
})();
