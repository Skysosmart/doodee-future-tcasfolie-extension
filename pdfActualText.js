// กู้ข้อความที่ Chrome ซ่อนไว้ใน /Span<</ActualText>> — ตรรกะล้วน ห้ามมี chrome.* ห้ามมี DOM
//
// pdf.js อ่าน ActualText เฉพาะจาก structure tree ไฟล์ของ Chrome ไม่ได้ใช้ทางนั้น
// (getOperatorList คืน ["Span", null] — ค่าหายไปตั้งแต่ใน worker) จึงต้องเปิด
// content stream อ่านเอง แล้วจับคู่กับลำดับ Span ที่ pdf.js รายงาน
//
// ทุกเส้นทางที่ไม่แน่ใจให้คืน [] แล้วปล่อยให้ผลจาก pdfGlyphs ยืนไป
// ข้อความที่ผิดแย่กว่าวรรณยุกต์ที่หาย
(function (root) {
  "use strict";

  // นับ "ทุก" Span ไม่ใช่เฉพาะตัวที่มี ActualText — pdf.js ก็นับทุกตัว
  // ถ้านับไม่เหมือนกัน ลำดับจะเลื่อนแล้วข้อความจะไปโผล่ผิดที่
  const SPAN = /\/Span\s*(?:<<([\s\S]*?)>>\s*)?BDC/g;
  const ACTUAL = /\/ActualText\s*<([0-9A-Fa-f]+)>/;

  function decodeHex(hex) {
    const clean = String(hex || "").replace(/[^0-9A-Fa-f]/g, "");
    let out = "";
    for (let i = 0; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (code === 0xfeff) continue; // BOM
      out += String.fromCharCode(code);
    }
    return out;
  }

  function latin1(bytes) {
    let out = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return out;
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ตัดสตรีมด้วย /Length เท่านั้น — การไล่หา "endstream"/"endobj" ไม่ปลอดภัย
  // เพราะข้อมูลที่บีบอัดแล้วมีไบต์ชุดนั้นปนอยู่ได้
  function makeReader(raw) {
    function objAt(num, gen) {
      const re = new RegExp(`(?:^|[^0-9])${num}\\s+${gen}\\s+obj`, "g");
      const m = re.exec(raw);
      return m ? m.index + m[0].length : -1;
    }
    function intVal(dict, key) {
      const direct = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dict);
      if (direct) return Number(direct[1]);
      const indirect = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(dict);
      if (!indirect) return null;
      const at = objAt(Number(indirect[1]), Number(indirect[2]));
      if (at === -1) return null;
      const v = /\s*(\d+)/.exec(raw.slice(at, at + 40));
      return v ? Number(v[1]) : null;
    }
    return { objAt, intVal };
  }

  // แปลงไฟล์ทั้งก้อนเป็นสตริงครั้งเดียว ไม่ใช่ทุกหน้า (ไฟล์จริง 5.7MB × 10 หน้า)
  let cacheKey = null;
  let cacheRaw = "";

  async function spansFromPage(bytes, ref) {
    try {
      if (!bytes || !ref) return [];
      if (cacheKey !== bytes) {
        cacheRaw = latin1(bytes);
        cacheKey = bytes;
      }
      const raw = cacheRaw;
      const { objAt, intVal } = makeReader(raw);

      const at = objAt(ref.num, ref.gen);
      if (at === -1) return [];
      const pageDict = raw.slice(at, raw.indexOf("endobj", at));

      const refs = [];
      const single = /\/Contents\s+(\d+)\s+(\d+)\s+R/.exec(pageDict);
      if (single) {
        refs.push([Number(single[1]), Number(single[2])]);
      } else {
        const arr = /\/Contents\s*\[([^\]]*)\]/.exec(pageDict);
        if (!arr) return [];
        const re = /(\d+)\s+(\d+)\s+R/g;
        let m;
        while ((m = re.exec(arr[1]))) refs.push([Number(m[1]), Number(m[2])]);
      }
      if (!refs.length) return [];

      let text = "";
      for (const [num, gen] of refs) {
        const start = objAt(num, gen);
        if (start === -1) return [];
        const sAt = raw.indexOf("stream", start);
        if (sAt === -1) return [];
        const dict = raw.slice(start, sAt);
        if (!/\/FlateDecode/.test(dict)) return [];
        const len = intVal(dict, "Length");
        if (!Number.isFinite(len)) return [];
        let from = sAt + 6;
        if (raw[from] === "\r") from += 1;
        if (raw[from] === "\n") from += 1;
        const packed = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) packed[i] = raw.charCodeAt(from + i) & 0xff;
        text += latin1(await inflate(packed));
      }

      const out = [];
      SPAN.lastIndex = 0;
      let hit;
      while ((hit = SPAN.exec(text))) {
        const props = hit[1] || "";
        const actual = ACTUAL.exec(props);
        out.push(actual ? decodeHex(actual[1]) : ""); // Span ที่ไม่มี ActualText = ค่าว่าง
      }
      return out;
    } catch (error) {
      return []; // ไฟล์ใส่รหัส คลายไม่ออก อะไรก็ตาม — ถอยไปใช้ผลของ pdfGlyphs
    }
  }

  root.PdfActualText = { decodeHex, spansFromPage };
})(globalThis);
