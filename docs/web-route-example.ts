// app/api/extension/portfolio/route.ts
//
// ป้อนผลงานให้ส่วนขยาย TCASFolio (Doodee future)
// ยืนยันตัวตนด้วยเซสชันเดิมของเว็บ เพราะคำขอมาจาก content script ที่อยู่ในแท็บ
// doodee-future.com จึงเป็น same-origin คุกกี้ทำงานปกติ
// (ยิงตรงจาก chrome-extension:// ไม่ได้ คุกกี้ SameSite=Lax จะไม่ถูกส่ง)
//
// รูปแบบที่ตอบ = รูปแบบไฟล์สำรองของส่วนขยายเป๊ะ ๆ ดู docs/web-api-contract.md
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ค่าพวกนี้ต้องตรงกับตัวเลือกใน TCASFolio เป๊ะ ๆ ผิดช่องว่างเดียวส่วนขยายหาปุ่มไม่เจอ
const TYPE_BY_ACHIEVEMENT: Record<string, string> = {
  academic: "รางวัล / เกียรติบัตร",
  competition: "รางวัล / เกียรติบัตร",
  sports: "รางวัล / เกียรติบัตร",
  certification: "รางวัล / เกียรติบัตร",
  arts: "ผลงานสร้างสรรค์",
  leadership: "กิจกรรม",
  community_service: "กิจกรรม",
};

const LEVEL_BY_CODE: Record<string, string> = {
  school: "ระดับโรงเรียน/สถาบัน",
  local: "ระดับจังหวัด/เขต/ภาค",
  province: "ระดับจังหวัด/เขต/ภาค",
  regional: "ระดับจังหวัด/เขต/ภาค",
  national: "ระดับชาติ",
  international: "ระดับนานาชาติ",
};

// รูปทั้งก้อนถูกยัดใส่ JSON ก้อนเดียว ต้องมีเพดาน ไม่งั้นพอร์ตใหญ่ ๆ จะกิน RAM ทั้งเครื่อง
const MAX_IMAGES_PER_ITEM = 4;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 24_000_000;

type Img = { name: string; type: string; data: string };

function toEpoch(value: Date | null | undefined): number {
  return value ? value.getTime() : 0;
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** โหลดรูปจาก R2 มาแปลงเป็น data URL — ส่วนขยายรับเฉพาะ base64 ลิงก์จะถูกตัดทิ้ง */
async function toDataUrl(url: string, budget: { left: number }): Promise<Img | null> {
  if (!/^https?:\/\//i.test(url) || budget.left <= 0) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(type)) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || buffer.length > budget.left) return null;
    budget.left -= buffer.length;

    const name = decodeURIComponent(url.split("/").pop() || "image").split("?")[0];
    return { name, type, data: `data:${type};base64,${buffer.toString("base64")}` };
  } catch {
    return null; // รูปใบเดียวโหลดไม่ได้ ต้องไม่ทำให้ทั้งก้อนล่ม
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const wantImages = new URL(req.url).searchParams.get("images") !== "0";

  const [achievements, extracurricular] = await Promise.all([
    prisma.user_achievements.findMany({
      where: { user_id: userId, portfolio_visibility: true },
      orderBy: { date_achieved: "desc" },
    }),
    prisma.user_extracurricular.findMany({
      where: { user_id: userId },
      orderBy: [{ is_ongoing: "desc" }, { start_date: "desc" }],
    }),
  ]);

  const items: Record<string, unknown>[] = [];
  const images: Record<string, Img[]> = {};
  const budget = { left: MAX_TOTAL_BYTES };

  for (const row of achievements) {
    const id = `ach-${row.id}`;
    // ส่วนขยายไม่มีช่องวันที่ ใส่ไว้หัว detail แทน ไม่งั้นข้อมูลนี้หายไปเฉย ๆ
    const when = row.date_achieved
      ? row.date_achieved.toISOString().slice(0, 10).replace(/-/g, "/")
      : "";
    const detail = [when && `วันที่ ${when}`, text(row.description)].filter(Boolean).join("\n");

    items.push({
      id,
      type: TYPE_BY_ACHIEVEMENT[text(row.achievement_type)] ?? "รางวัล / เกียรติบัตร",
      title: text(row.title),
      org: text(row.organization),
      level: LEVEL_BY_CODE[text(row.achievement_level)] ?? "",
      result: "",
      hours: "",
      detail,
      tags: Array.isArray(row.skills_gained) ? (row.skills_gained as string[]).map(String) : [],
      createdAt: toEpoch(row.created_at),
    });

    if (!wantImages) continue;
    const urls = [
      text(row.certificate_url),
      ...(Array.isArray(row.evidence_urls) ? (row.evidence_urls as string[]).map(String) : []),
    ].filter(Boolean);

    const picked: Img[] = [];
    for (const url of urls.slice(0, MAX_IMAGES_PER_ITEM)) {
      const img = await toDataUrl(url, budget);
      if (img) picked.push(img);
    }
    if (picked.length) images[id] = picked;
  }

  for (const row of extracurricular) {
    const detail = [text(row.description), text(row.impact_description)].filter(Boolean).join("\n");
    items.push({
      id: `act-${row.id}`,
      type: "กิจกรรม",
      title: text(row.activity_name),
      org: text(row.organization),
      level: "",
      result: text(row.role),
      hours: row.hours_committed != null ? String(row.hours_committed) : "",
      detail,
      tags: [],
      createdAt: toEpoch(row.created_at),
    });
  }

  return NextResponse.json(
    { app: "doodee-future", version: 1, exportedAt: Date.now(), items, images },
    { headers: { "Cache-Control": "no-store" } },
  );
}
