// ดักคำขอของหน้าเว็บเพื่อ "นำเข้าอัตโนมัติ" — ต้องอยู่ main world เท่านั้น
// content script อยู่ isolated world มองไม่เห็น fetch/XHR ของเว็บ จึงอ่าน body ที่เว็บส่งไม่ได้
// ไฟล์นี้ไม่เก็บอะไรลงดิสก์ ไม่ยิงคำขอของตัวเองสักตัว — อ่านของที่เว็บยิงอยู่แล้วเท่านั้น
// รันที่ document_start เพราะคำขอชุดแรกของหน้ายิงตั้งแต่ยังโหลดไม่เสร็จ ช้ากว่านั้นคือพลาด
(function () {
  "use strict";

  // แผงเช็คว่าตัวดักอยู่ในหน้านี้จริงไหมก่อนบอกให้ผู้ใช้กดบันทึกแฟ้ม
  // (ถ้าเพิ่ง reload ส่วนขยายทั้งที่หน้ายังเปิดอยู่ หน้าเดิมจะไม่มีตัวดักเลย แล้วรอเก้อ)
  // ตอบตั้งแต่ก่อนเช็คซ้ำ — ฉีดซ้ำแล้ว pong ต้องยังมา ไม่งั้นแผงเข้าใจผิดว่าไม่มีตัวดัก
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.tag !== "doodee-future:ping") return;
    window.postMessage({ tag: "doodee-future:pong", requestId: msg.requestId }, "*");
  });

  if (window.__doodeeFolioTap) return;
  window.__doodeeFolioTap = true;

  const API = "tcas65.as.r.appspot.com";
  const FOLIO_PATH = /\/folios\/tcasfolios\/([A-Za-z0-9_-]+)/;
  const PRESIGN_PATH = /\/folios\/presign\b/;
  const S3_URL = /https?:\/\/[^"'\s\\)]+\.amazonaws\.com\/[^"'\s\\)]+/g;
  const FIELDS = [
    "awards",
    "projects",
    "activities",
    "trainings",
    "creatives",
    "courseId",
    "programId",
    "majorId",
    "projectId",
  ];

  // ลิงก์รูปที่ส่งให้แผงไปแล้ว — กันส่งซ้ำ ไม่ได้เก็บอะไรอย่างอื่นไว้เลย
  const seen = { s3: [] };

  // ลิงก์รูปบน S3 เป็น presigned URL: มี ?AWSAccessKeyId=&Expires=&Signature= ต่อท้าย
  // และหมดอายุตามเวลาใน Expires — ห้ามตัด query ทิ้ง ไม่งั้นโหลดรูปไม่ได้ (403)
  function noteS3(text) {
    if (typeof text !== "string") return;
    const flat = text.replace(/\\\//g, "/"); // JSON บางตัวหนี / เป็น \/
    const fresh = [];
    for (const url of flat.match(S3_URL) || []) {
      if (seen.s3.includes(url)) continue;
      seen.s3.push(url);
      fresh.push(url);
    }
    // ลิงก์มีอายุจำกัด ส่งให้แผงทันทีที่เห็น ดีกว่าให้แผงมาถามตอนหมดอายุไปแล้ว
    if (fresh.length) window.postMessage({ tag: "doodee-future:s3", urls: fresh }, "*");
  }

  // multipart ที่เว็บประกอบเองเป็น string — เกิดขึ้นเมื่อไม่ได้ใช้ FormData
  // ตัดตาม boundary แล้วอ่าน name= กับเนื้อหลังบรรทัดว่าง
  function parseMultipart(text) {
    const out = {};
    const head = text.match(/^--([^\r\n]+)/);
    if (!head) return out;
    for (const part of text.split("--" + head[1])) {
      const name = part.match(/name="([^"]+)"/);
      if (!name) continue;
      const at = part.indexOf("\r\n\r\n");
      if (at === -1) continue;
      out[name[1]] = part.slice(at + 4).replace(/\r\n$/, "");
    }
    return out;
  }

  function readBody(body) {
    if (!body) return null;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const out = {};
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }
    if (typeof body === "string") return parseMultipart(body);
    return null;
  }

  function hasFolioFields(fields) {
    return !!fields && FIELDS.some((key) => key in fields);
  }

  function sendFolio(folioId, fields) {
    window.postMessage(
      { tag: "doodee-future:folio", folioId: folioId || "", s3: seen.s3.slice(), fields },
      "*",
    );
  }

  function onRequest(url, method, body) {
    if (!url || url.indexOf(API) === -1) return;
    if (String(method || "GET").toUpperCase() !== "PUT") return;
    const match = url.match(FOLIO_PATH);
    if (!match) return;
    const fields = readBody(body);
    if (!hasFolioFields(fields)) return;
    sendFolio(match[1], fields);
  }

  // ลิงก์รูปมาเองอยู่แล้ว: ตอนกด "บันทึกแฟ้ม" เว็บยิง POST /folios/presign แล้วได้
  // presigned URL กลับมาทั้งชุด — อ่านจาก response ของเว็บพอ ไม่ต้องยิงขอเอง
  // (จับจากทุก response ของ API ไม่เจาะจง endpoint เผื่อเว็บเปลี่ยน path ทีหลัง)
  function onResponse(url, text) {
    if (!url || url.indexOf(API) === -1) return;
    noteS3(text);
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input, init) {
      let url = "";
      let method = "GET";
      try {
        url = typeof input === "string" ? input : (input && input.url) || "";
        method = (init && init.method) || (input && input.method) || "GET";
        onRequest(url, method, init && init.body);
      } catch (error) {
        /* ดักพลาดต้องไม่ทำให้คำขอจริงของเว็บพัง */
      }
      const done = nativeFetch.apply(this, arguments);
      return done.then((res) => {
        try {
          if (url && url.indexOf(API) !== -1) {
            res
              .clone()
              .text()
              .then((text) => onResponse(url, text))
              .catch(() => {});
          }
        } catch (error) {
          /* อ่าน response ไม่ได้ก็ปล่อยผ่าน */
        }
        return res;
      });
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const open = XHR.open;
    const send = XHR.send;
    XHR.open = function (method, url) {
      this.__doodeeMethod = method;
      this.__doodeeUrl = url;
      return open.apply(this, arguments);
    };
    XHR.send = function (body) {
      try {
        onRequest(this.__doodeeUrl, this.__doodeeMethod, body);
        this.addEventListener("load", () => {
          try {
            const type = this.responseType;
            if (type === "" || type === "text") onResponse(this.__doodeeUrl, this.responseText);
            else if (type === "json") onResponse(this.__doodeeUrl, JSON.stringify(this.response));
          } catch (error) {
            /* ปล่อยผ่าน */
          }
        });
      } catch (error) {
        /* ปล่อยผ่าน */
      }
      return send.apply(this, arguments);
    };
  }
})();
