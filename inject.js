// content script อยู่ isolated world — File ที่สร้างจากตรงนั้น React ของเว็บไม่รับ
// (วัดแล้ว: โค้ดเดียวกัน จาก isolated ไม่ติด จาก main ติด) ไฟล์นี้จึงอยู่ main world
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
