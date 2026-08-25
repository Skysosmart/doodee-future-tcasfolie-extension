# สัญญาระหว่าง doodee-future.com กับส่วนขยาย

ส่วนขยายดึงผลงานจากเว็บด้วยปุ่ม **ดึงจากเว็บ** ในหน้า `backup.html`
เว็บต้องเปิด endpoint เดียว และตอบ JSON ตามรูปแบบด้านล่าง

```
GET https://doodee-future.com/api/extension/portfolio
```

URL นี้ **ฝังตายในโค้ด** (`backup.js` : `API_URL`) แก้จากหน้าเว็บไม่ได้
เพื่อไม่ให้โทเคนของผู้ใช้ถูกส่งไปโฮสต์อื่นได้เลย ถ้าจะย้าย path ต้องแก้ที่ตัวส่วนขยาย

## รูปแบบที่ตอบกลับ

เหมือนไฟล์สำรองของส่วนขยายทุกประการ — ใช้ตัวอ่านตัวเดียวกัน (`Model.parseImport`)
ที่มีเทสต์คุมอยู่แล้ว เว็บส่งไฟล์นี้ให้ดาวน์โหลดตรง ๆ ก็ยังนำเข้าได้เหมือนกัน

```jsonc
{
  "app": "doodee-future",
  "version": 1,
  "exportedAt": 1756100000000,
  "items": [
    {
      "id": "ocr-001",                    // ไม่ซ้ำกันในไฟล์ก็พอ ส่วนขยายจัดการเองถ้าชนของเดิม
      "type": "award",                    // award | project | activity | training | work
      "title": "รางวัลชนะเลิศ MakeX Challenger",
      "org": "สพฐ. ร่วมกับ MakeX Thailand",
      "level": "national",                // school | local | province | national | international
      "result": "ชนะเลิศ",
      "hours": 24,                        // ตัวเลข หรือละไว้
      "startDate": "2025-11-02",          // ว่างได้
      "endDate": "2025-11-04",
      "detail": "ออกแบบและเขียนโปรแกรมหุ่นยนต์…",
      "tags": ["robotics", "programming"],
      "createdAt": 1756000000000          // ใช้จับคู่รูปตอนนำเข้า ห้ามเปลี่ยนค่าเมื่อส่งซ้ำ
    }
  ],
  "images": {
    "ocr-001": [
      { "name": "makex-cert.jpg", "type": "image/jpeg", "data": "data:image/jpeg;base64,/9j/4AAQ…" }
    ]
  }
}
```

**ข้อบังคับของรูป** `data` ต้องเป็น `data:image/(jpeg|jpg|png|webp|gif);base64,…` เท่านั้น
ลิงก์ `https://…` จะถูกตัดทิ้ง (กัน `javascript:` และ SVG ที่ฝังสคริปต์) ส่วนขยายจะขึ้นเตือนว่า
ตัดไปกี่ใบ ไม่เงียบ ถ้าเว็บเก็บรูปไว้ที่ storage ต้องอ่านมาแปลงเป็น base64 ก่อนตอบ

**ขนาด** TCASFolio รับไฟล์ต่อใบไหวราว 1.2 MB / ด้านยาว 1800 px (เกินกว่านั้นตอนกดบันทึกแฟ้ม
จะได้ 413 ที่โผล่มาเป็น "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ") ส่วนขยายย่อให้ก่อนอัปอยู่แล้ว
แต่ถ้าเว็บย่อมาให้เลยจะประหยัดทั้งเวลาโหลดและพื้นที่ในคลัง

## การยืนยันตัวตน

รองรับสองทาง ทำอย่างใดอย่างหนึ่งก็พอ

1. **คุกกี้** ส่วนขยายยิงด้วย `credentials: "include"` แต่คำขอมาจาก origin
   `chrome-extension://…` ซึ่งนับเป็น cross-site — คุกกี้ที่ตั้ง `SameSite=Lax`
   (ค่าเริ่มต้นของ NextAuth) **จะไม่ถูกส่งมา** ถ้าจะใช้ทางนี้ คุกกี้ต้องเป็น
   `SameSite=None; Secure`
2. **โทเคน** ส่วนขยายส่ง `Authorization: Bearer <token>` ถ้าผู้ใช้วางโทเคนไว้
   เว็บออกโทเคนอายุยาวให้ที่หน้าโปรไฟล์ ทางนี้ไม่ติดเรื่อง SameSite เลย — **แนะนำ**

ตอบ `401` เมื่อไม่ผ่าน ส่วนขยายจะบอกผู้ใช้ให้ไปใช้โทเคน ไม่ใช่ขึ้นเลขดิบ

## CORS

ส่วนขยายมี `host_permissions` ของโดเมนนี้ จึงอ่านคำตอบได้โดยไม่ต้องมี
`Access-Control-Allow-Origin` แต่ถ้าจะให้ยิงจากหน้าเว็บอื่นด้วย ค่อยเพิ่มทีหลัง

## ตัวอย่าง route (Next.js App Router)

```ts
// app/api/extension/portfolio/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await authFromBearerOrCookie(req); // ของเว็บเอง
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.portfolioItem.findMany({ where: { userId: user.id } });

  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    org: r.org ?? "",
    level: r.level ?? "",
    result: r.result ?? "",
    hours: r.hours ?? undefined,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    detail: r.detail ?? "",
    tags: r.tags ?? [],
    createdAt: r.createdAt.getTime(),
  }));

  const images: Record<string, { name: string; type: string; data: string }[]> = {};
  for (const r of rows) {
    const files = await loadCertificates(r.id); // คืน Buffer + mime
    if (!files.length) continue;
    images[r.id] = files.map((f) => ({
      name: f.name,
      type: f.mime,
      data: `data:${f.mime};base64,${f.buffer.toString("base64")}`,
    }));
  }

  return NextResponse.json({
    app: "doodee-future",
    version: 1,
    exportedAt: Date.now(),
    items,
    images,
  });
}
```

## ฝั่งส่วนขยายทำอะไรกับของที่ได้

- **upsert ไม่ใช่ทับ** ของเดิมที่ไม่มีในชุดใหม่ไม่หาย
- **ไม่ทับรูป** ชิ้นที่มีรูปอยู่แล้วจะถูกข้าม (ผู้ใช้อาจแนบเองไว้)
- ผู้ใช้เห็นจำนวนก่อนบันทึกทุกครั้ง และผลลัพธ์อ่านกลับจากคลังจริงมายืนยัน

## ยังไม่ทำ

`PUT` กลับขึ้นเว็บ — ตอนนี้เป็นทางเดียว เว็บ -> ส่วนขยาย
ถ้าจะซิงก์สองทางต้องคุยเรื่องว่าใครชนะเมื่อแก้ทั้งสองฝั่ง ยังไม่มีคำตอบ จึงยังไม่ทำ
