# pdf.js (vendored)

`pdfjs-dist@4.10.38` — legacy build, minified · Apache License 2.0 (ดู `LICENSE`)

ไฟล์ที่เอามา: `pdf.min.mjs` + `pdf.worker.min.mjs`

**ทำไมต้องฝังไว้ในนี้ ไม่โหลดจาก CDN** — CSP ของ MV3 ห้ามโหลดสคริปต์จากโดเมนอื่น
และกฎของโปรเจกต์คือข้อมูลไม่ออกจากเครื่อง

**ทำไมใช้ legacy build** — build ปกติใช้ top-level await ซึ่ง Chrome ที่โหลด
ส่วนขยายแบบ unpacked จัดการได้ไม่แน่นอน · legacy ถูกคอมไพล์ให้รองรับกว้างกว่า

**อัปเดตเวอร์ชัน:** `npm pack pdfjs-dist@<version>` แล้วก๊อป `legacy/build/pdf.min.mjs`
กับ `legacy/build/pdf.worker.min.mjs` มาทับ · ห้ามแก้ไฟล์เอง (ของภายนอก)
