# Doodee future — คู่มือสร้าง Chrome Extension สำหรับ TCASFolio

## เป้าหมาย

ช่วยกรอกแฟ้มสะสมผลงานใน TCASFolio ให้เร็วขึ้น โดยดึงเนื้อหาจากเล่ม portfolio เดิมที่พิมพ์เก็บไว้ครั้งเดียว แล้วนำกลับมาใช้ซ้ำได้ทุกสาขาวิชา (ระบบรองรับได้สูงสุด 40 แฟ้ม)

---

## หลักการที่ต้องยึด

**1. ห้าม auto-fill ฟอร์มจริงในเฟสแรก**
ฟอร์มเป็น framework-based (React/Vue) การ set `input.value` ตรง ๆ จะไม่ trigger event ของ framework → กดบันทึกแล้วข้อมูลหาย
ถ้าจะทำจริงต้องใช้ native setter:
```js
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, "value"
).set;
setter.call(el, text);
el.dispatchEvent(new Event("input", { bubbles: true }));
```
แต่ยังเสี่ยงอยู่ดี — นี่คือใบสมัครจริง เฟสแรกใช้ **copy to clipboard** แล้วให้ผู้ใช้วางเอง

**2. ข้อมูลอยู่ในเครื่องเท่านั้น**
ใช้ `chrome.storage.local` ห้ามยิงข้อมูลออก network ทุกกรณี หน้านี้มีข้อมูลส่วนตัวจริง (เลขบัตร ผลการเรียน คะแนน verified)

**3. อย่าแตะข้อมูลที่ verified**
ข้อมูลที่มีเครื่องหมาย Verify มาจากหน่วยงานต้นทาง extension ควรอ่านอย่างเดียว

---

## โครงสร้างไฟล์

```
doodee-future/
├── manifest.json
├── popup.html          # คลังผลงาน — เพิ่ม / ดู / คัดลอก
├── popup.js
├── content.js          # แถบด้านข้างบนหน้า TCASFolio
├── content.css
└── storage.js          # ฟังก์ชันอ่าน/เขียน storage ใช้ร่วมกัน
```

### manifest.json (เป้าหมาย)

```json
{
  "manifest_version": 3,
  "name": "Doodee future",
  "version": "1.0",
  "permissions": ["storage"],
  "host_permissions": ["https://student.mytcas.com/*"],
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    {
      "matches": ["https://student.mytcas.com/*"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## Data model

```js
{
  id: "uuid",
  type: "รางวัล | โครงงาน | กิจกรรม | อบรม | ผลงานสร้างสรรค์",
  title: "ชื่อผลงาน",
  org: "หน่วยงาน / ปี",
  detail: "รายละเอียดแบบเต็ม",
  tags: ["วิศวะ", "คอม"],     // ไว้กรองตามสาขาที่สมัคร
  createdAt: 1234567890
}
```

เก็บทั้งหมดเป็น array ใต้ key เดียว `folioItems`

---

## เฟสการทำ

### เฟส 1 — คลังผลงาน (ไม่ต้องพึ่งหน้าเว็บเลย)
- popup: ฟอร์มเพิ่มผลงาน + รายการที่บันทึกไว้
- ปุ่มคัดลอกรายละเอียดลง clipboard
- ปุ่มลบ / แก้ไข
- export / import เป็นไฟล์ JSON (กัน storage หาย)

### เฟส 2 — แถบด้านข้างบนหน้า TCASFolio
- content script inject panel ลอยมุมขวา (`position: fixed`, `z-index` สูง)
- แสดงคลังผลงาน กรองตาม type และ tag
- ปุ่มคัดลอกทีละชิ้น
- ปุ่มย่อ/ขยาย panel จำสถานะไว้ใน storage

**ข้อควรระวัง:** หน้าเว็บ render ทีหลัง content script ต้องใช้ `MutationObserver` รอ element ที่ต้องการ

```js
const observer = new MutationObserver(() => {
  const target = document.querySelector("SELECTOR_ที่หาได้จาก_DevTools");
  if (target && !document.getElementById("doodee-future-panel")) {
    injectPanel();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
```

### เฟส 3 — ของแถมที่มีประโยชน์จริง
- **แบนเนอร์เตือนก่อนแก้ไข** — ทุกครั้งที่แก้ไข ไฟล์ PDF และลิงก์จะเปลี่ยนใหม่ ถ้าส่งลิงก์ให้มหาลัยไปแล้วเขาจะเห็นแค่เวอร์ชันเดิม ให้ทำเครื่องหมายแฟ้มที่ส่งไปแล้ว แล้วขึ้นเตือนตัวใหญ่ ๆ ตอนเปิดแก้
- backup ข้อความที่กำลังพิมพ์ลง storage อัตโนมัติทุก 5 วินาที (อ่านอย่างเดียว ไม่เขียนกลับฟอร์ม)

---

## วิธีหา selector

1. เปิดหน้าฟอร์มจริง
2. คลิกขวาที่ช่องที่ต้องการ → Inspect
3. ดู class / id ที่ไฮไลต์ใน DevTools
4. ทดสอบใน Console ก่อนเขียนลงโค้ด: `document.querySelectorAll("...")` ต้องได้ผลลัพธ์ตามที่คิด
5. เลี่ยง class ที่ดูเป็น hash สุ่ม (เช่น `css-1x2y3z`) เพราะเปลี่ยนทุก build — ใช้ `aria-label`, `name`, `placeholder`, หรือโครงสร้าง DOM แทน

---

## เช็กก่อนคิดฟีเจอร์ใหม่ (ระบบมีให้แล้ว)

- นับคำ / นับตัวอักษรในเรียงความ — มีแล้ว แบบเรียลไทม์
- แจ้งเตือนกรอกข้อมูลสำคัญไม่ครบ — มีแล้ว
- ดาวน์โหลด PDF / คัดลอกลิงก์ — มีแล้ว

---

## ทดสอบ

- ปิด-เปิดเบราว์เซอร์แล้วข้อมูลต้องยังอยู่
- ใส่ข้อความยาว ๆ และภาษาไทยผสมอังกฤษ ต้องไม่เพี้ยน
- โหลดหน้า TCASFolio ใหม่หลาย ๆ รอบ panel ต้องไม่ inject ซ้ำซ้อน
- ลอง export → ลบ storage → import กลับ ต้องได้ข้อมูลเดิมครบ
