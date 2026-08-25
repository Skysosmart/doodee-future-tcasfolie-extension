# สัญญาระหว่าง doodee-future.com กับส่วนขยาย

ส่วนขยายดึงผลงานจากเว็บด้วยปุ่ม **ดึงจากเว็บ** ในหน้า `backup.html`

```
GET https://doodee-future.com/api/extension/portfolio
```

path ฝังตายในโค้ด (`backup.js` : `API_PATH`) แก้จากหน้าเว็บไม่ได้ และ `host_permissions`
มีโดเมนเดียว — ทั้งสองอย่างเพื่อไม่ให้โทเคนของผู้ใช้ถูกส่งไปโฮสต์อื่นได้เลย

## ยืนยันตัวตนด้วยเซสชันเดิมของเว็บ

เว็บใช้ NextAuth (`auth.ts`) แบบ JWT คุกกี้ `authjs.session-token` เป็น `SameSite=Lax`
**คำขอจาก `chrome-extension://` เป็น cross-site คุกกี้จะไม่ถูกส่งไปเลย** ส่วนขยายจึงไม่ยิงตรง
แต่ให้ content script ที่อยู่ในแท็บ doodee-future.com ยิงแทน — เป็น same-origin คุกกี้ทำงานปกติ
ผู้ใช้แค่ล็อกอินค้างไว้ ไม่ต้องมีโทเคน ไม่ต้องคัดลอกอะไร

```
backup.html  --chrome.tabs.sendMessage-->  site.js (ในแท็บเว็บ)
                                              |  fetch("/api/extension/portfolio")
                                              |  credentials: same-origin
             <---------- JSON --------------  '
```

ถ้าไม่มีแท็บเว็บเปิดอยู่ ส่วนขยายจะเปิดให้เองแบบพื้นหลัง ถามเสร็จแล้วปิดคืน

route จึงเขียนแบบเดียวกับหน้า `app/[locale]/profile/portfolio/page.tsx` คือ

```ts
const session = await auth();
if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
```

**ไม่ต้องใช้ `/api/v1` + API key** เพราะคีย์ในระบบเป็นของแอดมิน (`api_keys.owner_email`,
สร้างที่ `/admin/api-keys`) นักเรียนออกเองไม่ได้ และยังต้องแนบ `X-Doodee-User-Id` อีก
ช่องโทเคนในหน้าส่วนขยายเก็บไว้เป็นทางสำรองเฉยๆ ถ้าวันหนึ่งอยากยิงจากที่อื่น

## รูปแบบที่ตอบกลับ

เหมือนไฟล์สำรองของส่วนขยายทุกประการ ใช้ตัวอ่านตัวเดียวกัน (`Model.parseImport`)
ที่มีเทสต์คุมอยู่แล้ว เว็บจะให้ดาวน์โหลดเป็นไฟล์แทนก็ยังนำเข้าได้เหมือนกัน

```jsonc
{
  "app": "doodee-future",
  "version": 1,
  "exportedAt": 1756100000000,
  "items": [
    {
      "id": "ach-128",                        // ไม่ซ้ำกันในก้อนนี้ก็พอ
      "type": "รางวัล / เกียรติบัตร",           // ห้าค่าเท่านั้น ดูตารางล่าง
      "title": "รางวัลชนะเลิศ MakeX Challenger",
      "org": "สพฐ. ร่วมกับ MakeX Thailand",
      "level": "ระดับชาติ",                    // สี่ค่าเท่านั้น ดูตารางล่าง
      "result": "ชนะเลิศ",
      "hours": "24",                          // string ไม่ใช่ number
      "detail": "ออกแบบและเขียนโปรแกรมหุ่นยนต์…",
      "tags": ["robotics"],
      "createdAt": 1756000000000              // ใช้จับคู่รูปตอนนำเข้า ห้ามเปลี่ยนเมื่อส่งซ้ำ
    }
  ],
  "images": {
    "ach-128": [
      { "name": "makex.jpg", "type": "image/jpeg", "data": "data:image/jpeg;base64,/9j/4AAQ…" }
    ]
  }
}
```

ไม่มีช่อง `startDate` / `endDate` — ส่วนขยายไม่มีที่เก็บ ถ้าอยากให้วันที่ติดไปด้วย
ใส่ไว้ในบรรทัดแรกของ `detail` ฟิลด์ที่ไม่รู้จักจะถูกตัดทิ้งตอน `normalize`

### `type` — ห้าค่านี้เท่านั้น

เขียนผิดแม้แต่ช่องว่างเดียว ปุ่ม `＋ ลงพอร์ต` จะหาปุ่มของ TCASFolio ไม่เจอ

| ค่าที่ต้องส่ง | ไปกดปุ่มไหนใน TCASFolio | มาจาก `achievement_type` |
|---|---|---|
| `รางวัล / เกียรติบัตร` | เพิ่มรางวัล | `academic` `competition` `sports` `certification` |
| `โครงงาน / วิจัย` | เพิ่มโครงงาน | (ยังไม่มีในเว็บ) |
| `กิจกรรม` | เพิ่มกิจกรรม | `leadership` `community_service` + ทุกแถวใน `user_extracurricular` |
| `การอบรม` | เพิ่มการอบรม | (ยังไม่มีในเว็บ) |
| `ผลงานสร้างสรรค์` | เพิ่มผลงาน | `arts` |

### `level` — สี่ค่านี้เท่านั้น

ตรงกับตัวเลือกในช่อง "ระดับ" ของ TCASFolio เป๊ะ ๆ **ค่าอื่นจะถูกล้างเป็นว่าง** ไม่ error

| ค่าที่ต้องส่ง | ตรงกับ `achievement_level` ในฐานข้อมูล |
|---|---|
| `ระดับโรงเรียน/สถาบัน` | `school` |
| `ระดับจังหวัด/เขต/ภาค` | `regional` (และ `local`, `province`) |
| `ระดับชาติ` | `national` |
| `ระดับนานาชาติ` | `international` |

### แปลงจากตารางที่มีอยู่แล้ว

| ฟิลด์ส่วนขยาย | `user_achievements` | `user_extracurricular` |
|---|---|---|
| `type` | จาก `achievement_type` (ดูตารางบน) | `กิจกรรม` |
| `title` | `title` | `activity_name` |
| `org` | `organization` | `organization` |
| `level` | `achievement_level` | เว้นว่าง |
| `result` | ไม่มี — ดึงจาก `title`/`description` ถ้ามี | `role` |
| `hours` | ไม่มี | `hours_committed` (แปลงเป็น string) |
| `detail` | `description` | `description` + `impact_description` |
| `createdAt` | `created_at` เป็น epoch ms | `created_at` เป็น epoch ms |
| รูป | `certificate_url` + `evidence_urls` | ไม่มี |

กรองด้วย `portfolio_visibility = true` และควรกรอง `verification_status` ที่ยังไม่ผ่านออก
ผลจาก OCR ที่อยู่ใน `user_competition_entries` (`source_type = 'portfolio_ai'`) ส่งมาได้เหมือนกัน
โดยแมป `raw_competition_name` -> `title`, `raw_organization` -> `org`,
`raw_achievement_level` -> `level`, `raw_description` -> `detail`

## รูป

`data` ต้องเป็น `data:image/(jpeg|jpg|png|webp|gif);base64,…` เท่านั้น
ลิงก์ `https://…` จะถูกตัดทิ้ง (กัน `javascript:` กับ SVG ที่ฝังสคริปต์) ส่วนขยายจะขึ้นเตือนว่า
ตัดไปกี่ใบ ไม่เงียบ รูปอยู่บน R2 จึงต้องดึงมาแปลงเป็น base64 ฝั่งเซิร์ฟเวอร์ก่อนตอบ

TCASFolio รับไหวราว **1.2 MB / ด้านยาว 1800 px** ต่อใบ เกินกว่านั้นตอนกดบันทึกแฟ้มจะได้ 413
ที่โผล่มาเป็น "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" ส่วนขยายย่อให้ก่อนอัปอยู่แล้ว แต่ถ้าเว็บย่อมาให้เลย
จะประหยัดทั้งเวลาโหลดและพื้นที่ในคลัง

รับ `?images=0` ด้วยจะดี ไว้ให้ดึงเฉพาะข้อความตอนอยากได้เร็ว ๆ

## ตัวอย่าง route

วางได้ที่ `app/api/extension/portfolio/route.ts` — ตัวเต็มอยู่ใน
[`docs/web-route-example.ts`](web-route-example.ts) ก๊อปไปวางแล้วแก้ตรงที่ยังไม่ตรงกับของจริง

## ฝั่งส่วนขยายทำอะไรกับของที่ได้

- **upsert ไม่ใช่ทับ** ของเดิมที่ไม่มีในชุดใหม่ไม่หาย
- **ไม่ทับรูป** ชิ้นที่มีรูปอยู่แล้วจะถูกข้าม (ผู้ใช้อาจแนบเองไว้)
- ผู้ใช้เห็นจำนวนก่อนบันทึกทุกครั้ง และผลลัพธ์อ่านกลับจากคลังจริงมายืนยัน

## ยังไม่ทำ

`PUT` กลับขึ้นเว็บ — ตอนนี้ทางเดียว เว็บ -> ส่วนขยาย
ซิงก์สองทางต้องตอบก่อนว่าใครชนะเมื่อแก้ทั้งสองฝั่ง ยังไม่มีคำตอบ จึงยังไม่ทำ
