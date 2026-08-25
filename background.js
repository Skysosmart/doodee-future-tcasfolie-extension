// ดึงรูปจากแฟ้มบนเว็บมาเก็บเข้าคลัง — ต้องทำที่นี่ ไม่ใช่ที่ content script
// เพราะ S3 ไม่ได้ตอบ CORS header ให้ origin ของ student.mytcas.com
// fetch จาก service worker ใช้สิทธิ์ host_permissions ของส่วนขยาย จึงไม่ติด CORS
// ไม่มีการส่งข้อมูลของผู้ใช้ออกไปไหน — ขาออกมีแค่ GET รูปของเจ้าตัวเองจาก S3
(function () {
  "use strict";

  const MAX_BYTES = 8_000_000; // รูปเดียวใหญ่กว่านี้ = ไฟล์แปลก ไม่ใช่รูปพอร์ต

  function toDataUrl(buffer, type) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    // ต่อทีละก้อน — String.fromCharCode รับ argument ทีละล้านตัวไม่ไหว (stack overflow)
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return `data:${type || "image/jpeg"};base64,${btoa(binary)}`;
  }

  // S3 ตอบ content-type ตามที่ตอนอัปโหลดตั้งไว้ ซึ่งบ่อยครั้งเป็น binary/octet-stream
  // เชื่อ header ไม่ได้ ต้องดูหัวไฟล์จริง — เดิมเช็ค /^image\// แล้วทิ้งรูปที่ใช้ได้ไปเปล่า ๆ
  function sniffType(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
    if (bytes[0] === 0x3c) return ""; // '<' = หน้า error ของ S3 (AccessDenied/NoSuchKey)
    return "";
  }

  async function fetchOne(url) {
    const res = await fetch(url, { credentials: "omit", cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength) throw new Error("ไฟล์ว่าง");
    if (buffer.byteLength > MAX_BYTES) throw new Error("ไฟล์ใหญ่เกินไป");
    const header = res.headers.get("content-type") || "";
    const sniffed = sniffType(new Uint8Array(buffer.slice(0, 16)));
    const type = sniffed || (/^image\//.test(header) ? header.split(";")[0] : "");
    if (!type) throw new Error(`ไม่ใช่รูป (header ${header || "ไม่ระบุ"})`);
    return { data: toDataUrl(buffer, type), type };
  }

  // ที่อยู่รูปบน S3 เดาไม่ได้แน่ ๆ ตัวเดียว (id ของแฟ้มไม่ใช่ id บน URL ที่กดบันทึก)
  // จึงส่งมาหลายตัวเลือกแล้วไล่ยิงตามลำดับ ตัวไหนได้ก่อนใช้ตัวนั้น
  async function fetchImage(urls) {
    const tried = [];
    for (const url of Array.isArray(urls) ? urls : []) {
      try {
        const got = await fetchOne(url);
        return { ok: true, url, ...got };
      } catch (error) {
        tried.push({ url, why: error && error.message ? error.message : String(error) });
      }
    }
    // สาเหตุจริงอยู่ตรงนี้ที่เดียว — เปิดคอนโซลของ service worker ได้จาก chrome://extensions
    console.warn("[doodee] ดึงรูปไม่ผ่านทุกที่อยู่", tried);
    return {
      ok: false,
      why: tried.length ? tried.map((t) => t.why).join(" / ") : "ไม่มีที่อยู่รูปให้ลอง",
      tried,
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.tag !== "doodee-future:fetch-image") return undefined;
    fetchImage(msg.urls).then(reply, (error) =>
      reply({ ok: false, why: error && error.message ? error.message : String(error) }),
    );
    return true; // ตอบแบบ async
  });
})();
