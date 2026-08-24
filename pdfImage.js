// ดึงรูปจาก PDF แล้วคัดเฉพาะที่ใช้ได้จริง — ตรรกะการ "ตัดสินใจ" แยกไว้เป็นฟังก์ชันล้วน
// (classify / isFlat / fingerprint / planShrink / dedupe) เพื่อเทสต์ด้วย node --test ได้
// ส่วนที่แตะ canvas กับ pdf.js อยู่ท้ายไฟล์ และจะทำงานเฉพาะในเบราว์เซอร์
//
// ตัวย่อรูปในไฟล์นี้เป็นของระบบนำเข้าเอง ไม่ได้ใช้ร่วมกับ content.js
// จงใจ: ระบบเดิม (เติมฟอร์ม/แนบรูป) ต้องไม่ถูกแตะเลยแม้แต่บรรทัดเดียว
(function (root) {
  "use strict";

  // เกณฑ์เดียวกับตอนแนบรูปในระบบเดิม เพราะ TCASFolio ส่งทั้งแฟ้มเป็นก้อนเดียว
  // ตอนกดบันทึก รูปใหญ่ทำให้เซิร์ฟเวอร์ตอบ 413 (ดู Ruling 22 ใน build log)
  const MAX_EDGE = 1800;
  const MAX_BYTES = 1_200_000;

  const MIN_EDGE = 200; // ด้านสั้นกว่านี้คือไอคอน/เส้นคั่น ไม่ใช่รูปผลงาน
  const PAGE_COVER = 0.9; // วางกินพื้นที่หน้าเกินนี้ = พื้นหลัง
  const MIN_DRAW = 48; // วางบนหน้าเล็กกว่านี้ (จุด) = ลายประดับ ไม่ใช่รูปผลงาน

  // รูปที่ควรเก็บไว้มั้ย — ตัดสินจาก "ขนาดไฟล์" คู่กับ "ขนาดที่วางบนหน้า"
  // ขนาดไฟล์อย่างเดียวไม่พอ: ภาพประกอบความละเอียดสูงก็ใหญ่ได้ ต่างกันที่พื้นหลัง
  // ถูกวางให้กินเกือบทั้งหน้า
  function classify(image, page) {
    const w = Number(image && image.width) || 0;
    const h = Number(image && image.height) || 0;
    if (Math.min(w, h) < MIN_EDGE) return { keep: false, why: `เล็กเกินไป (${w}×${h})` };

    const pw = Number(page && page.width) || 0;
    const ph = Number(page && page.height) || 0;
    const dw = Number(image && image.drawWidth) || 0;
    const dh = Number(image && image.drawHeight) || 0;
    if (pw > 0 && ph > 0 && dw > 0 && dh > 0) {
      if (dw >= pw * PAGE_COVER && dh >= ph * PAGE_COVER) {
        return { keep: false, why: "กินพื้นที่เกือบทั้งหน้า — เป็นพื้นหลัง" };
      }
      if (Math.min(dw, dh) < MIN_DRAW) {
        return { keep: false, why: `วางบนหน้าเล็กเกินไป (${Math.round(dw)}×${Math.round(dh)} จุด)` };
      }
    }

    return { keep: true, why: "" };
  }

  // มาสก์ของ Canva เป็นสีเดียวล้วน — ดูจากช่วงความต่างของค่าสว่าง
  function isFlat(image, tolerance) {
    const tol = Number.isFinite(tolerance) ? tolerance : 4;
    const data = image && image.data;
    if (!data || !data.length) return true;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      if (max - min > tol) return false;
    }
    return true;
  }

  // ลายนิ้วมือหยาบ ๆ ไว้จับรูปซ้ำ — Canva ฝังรูปเดียวกันหลายรอบในเล่ม
  // ย่อค่าสว่างเป็น 16 ระดับพอ ไม่ต้องแม่นระดับพิกเซล
  function fingerprint(image) {
    const data = image && image.data;
    if (!data || !data.length) return "";
    let out = "";
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      out += Math.round(lum / 16).toString(16);
    }
    return out;
  }

  function planShrink(size) {
    const w = Number(size && size.width) || 0;
    const h = Number(size && size.height) || 0;
    const edge = Math.max(w, h);
    if (!edge || edge <= MAX_EDGE) return { width: w, height: h, scaled: false };
    const ratio = MAX_EDGE / edge;
    return {
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio)),
      scaled: true,
    };
  }

  function dedupe(images) {
    const seen = new Set();
    return (images || []).filter((img) => {
      const key = img && img.fingerprint;
      if (!key) return true; // ไม่มีลายนิ้วมือ = วัดไม่ได้ ต้องไม่เดาทิ้ง
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── ส่วนที่ต้องมีเบราว์เซอร์ ────────────────────────────────────────
  // ทำงานได้เฉพาะในหน้า import.html — ในเทสต์ (node) จะไม่ถูกเรียก

  function thumbData(bitmap, size) {
    const n = size || 16;
    const canvas = new OffscreenCanvas(n, n);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, n, n);
    return ctx.getImageData(0, 0, n, n);
  }

  async function toJpeg(bitmap) {
    const plan = planShrink({ width: bitmap.width, height: bitmap.height });
    let quality = 0.85;
    let scale = 1;
    let blob = null;

    for (let round = 0; round < 6; round += 1) {
      const w = Math.max(1, Math.round(plan.width * scale));
      const h = Math.max(1, Math.round(plan.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // รูปโปร่งใสของ Canva ต้องได้พื้นขาว ไม่ใช่ดำ
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (blob.size <= MAX_BYTES) break;
      if (quality > 0.6) quality -= 0.12;
      else scale *= 0.8;
    }

    const reader = new FileReader();
    const data = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("อ่านรูปที่แปลงแล้วไม่ได้"));
      reader.readAsDataURL(blob);
    });
    return { data, bytes: blob.size };
  }

  // อ่านรูปทั้งหมดที่ถูกวาดในหน้านั้น แล้วคัดตามกฎด้านบน
  // pdf.js ไม่มี API ตรง ๆ สำหรับ "รูปในหน้า" ต้องไล่ operator list เอง
  async function fromPage(page, pdfjsLib) {
    const ops = await page.getOperatorList();
    const viewport = page.getViewport({ scale: 1 });
    const OPS = pdfjsLib.OPS;
    const out = [];
    const seenNames = new Set();

    // ต้องรู้ "ขนาดที่วาดบนหน้า" ไม่ใช่แค่ขนาดไฟล์ ไม่งั้นแยกพื้นหลังจากภาพประกอบไม่ได้
    // pdf.js ไม่ได้บอกมาตรง ๆ ต้องไล่ transform state เอง (save/restore/transform)
    // matrix [a,b,c,d,e,f] — รูปถูกวาดในกรอบ 1×1 หน่วย จึงได้ขนาดจริงจาก |a| กับ |d|
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = (m, n) => [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];

    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
        continue;
      }
      if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (fn === OPS.transform) {
        const m = ops.argsArray[i] || [];
        if (m.length >= 6) ctm = mul(ctm, m);
        continue;
      }
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject) continue;

      const drawWidth = Math.abs(Math.hypot(ctm[0], ctm[1]));
      const drawHeight = Math.abs(Math.hypot(ctm[2], ctm[3]));
      const args = ops.argsArray[i] || [];
      const name = args[0];
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);

      let obj = null;
      try {
        obj = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("รอรูปนานเกินไป")), 8000);
          try {
            page.objs.get(name, (value) => {
              clearTimeout(timer);
              resolve(value);
            });
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      } catch (error) {
        continue; // รูปเดียวอ่านไม่ได้ ต้องไม่ทำให้ทั้งหน้าพัง
      }
      if (!obj || !obj.width || !obj.height) continue;

      const verdict = classify(
        { width: obj.width, height: obj.height, drawWidth, drawHeight },
        { width: viewport.width, height: viewport.height },
      );
      if (!verdict.keep) continue;

      let bitmap = null;
      try {
        bitmap = await imageFromObj(obj);
        if (!bitmap) continue;
        const thumb = thumbData(bitmap, 16);
        if (isFlat(thumb)) continue; // มาสก์สีเดียว
        const print = fingerprint(thumb);
        const jpeg = await toJpeg(bitmap);
        out.push({
          name: `page${page.pageNumber}-${out.length + 1}.jpg`,
          type: "image/jpeg",
          data: jpeg.data,
          bytes: jpeg.bytes,
          width: bitmap.width,
          height: bitmap.height,
          fingerprint: print,
          page: page.pageNumber,
        });
      } catch (error) {
        continue;
      } finally {
        if (bitmap && typeof bitmap.close === "function") bitmap.close();
      }
    }

    return dedupe(out);
  }

  // pdf.js คืนรูปมาได้หลายรูปแบบ: ImageBitmap ตรง ๆ หรือ RGBA/RGB ดิบ
  async function imageFromObj(obj) {
    if (obj.bitmap) return obj.bitmap;
    if (!obj.data) return null;

    const { width, height, data } = obj;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const perPixel = data.length / (width * height);

    if (perPixel >= 4) {
      rgba.set(data.subarray(0, rgba.length));
    } else if (perPixel >= 3) {
      for (let p = 0, q = 0; q < rgba.length; p += 3, q += 4) {
        rgba[q] = data[p];
        rgba[q + 1] = data[p + 1];
        rgba[q + 2] = data[p + 2];
        rgba[q + 3] = 255;
      }
    } else if (perPixel >= 1) {
      for (let p = 0, q = 0; q < rgba.length; p += 1, q += 4) {
        rgba[q] = data[p];
        rgba[q + 1] = data[p];
        rgba[q + 2] = data[p];
        rgba[q + 3] = 255;
      }
    } else {
      return null;
    }

    return createImageBitmap(new ImageData(rgba, width, height));
  }

  root.PdfImage = {
    MAX_EDGE,
    MAX_BYTES,
    MIN_EDGE,
    MIN_DRAW,
    PAGE_COVER,
    classify,
    isFlat,
    fingerprint,
    planShrink,
    dedupe,
    thumbData,
    toJpeg,
    fromPage,
  };
})(globalThis);
