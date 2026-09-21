const test = require("node:test");
const assert = require("node:assert");
require("../model.js");
require("../siteImport.js");

// ข้อมูลสมมติทั้งหมด ไม่ใช่พอร์ตจริงของใคร
const exportFile = () => ({
  exportDate: "2026-08-27T05:04:55.070Z",
  exportFormat: "json",
  mode: "full",
  profile: {
    basicInfo: { name: "นักเรียนสมมติ", email: "a@example.com" },
    achievements: [
      {
        id: "217",
        achievement_type: "competition",
        title: "รางวัลเหรียญทองการแข่งขันสมมติ",
        description: "พัฒนาเว็บไซต์ให้ทีม",
        organization: "หน่วยงานสมมติ",
        date_achieved: null,
        achievement_level: "national",
        skills_gained: ["web", "  ", "teamwork"],
        created_at: "2026-08-25T02:27:40.445Z",
        portfolio_visibility: true,
      },
      {
        id: "218",
        achievement_type: "arts",
        title: "ผลงานศิลปะสมมติ",
        description: "",
        achievement_level: "school",
        date_achieved: "2026-04-01T00:00:00.000Z",
        created_at: "2026-08-25T02:27:41.000Z",
        portfolio_visibility: true,
      },
      { id: "219", title: "ชิ้นที่ถูกซ่อน", achievement_type: "academic", portfolio_visibility: false },
    ],
    extracurricular: [
      {
        id: "147",
        activity_name: "ค่ายสมมติ",
        activity_type: "research",
        role: "หัวหน้าทีม",
        organization: null,
        start_date: "2026-03-01T00:00:00.000Z",
        end_date: "2026-03-05T00:00:00.000Z",
        hours_committed: 16,
        description: "ทดลองเวิร์กช็อป",
        impact_description: "ตัดสินใจเลือกสาขาได้",
        created_at: "2026-08-25T02:27:40.845Z",
      },
    ],
  },
  statistics: { totalAchievements: 3, totalExtracurricular: 1 },
});

test("รู้จักไฟล์ส่งออกของเว็บ", () => {
  assert.strictEqual(SiteImport.looksLikeSiteExport(exportFile()), true);
  assert.strictEqual(SiteImport.looksLikeSiteExport({ items: [] }), false);
});

test("แปลงครบทั้งผลงานและกิจกรรม", () => {
  const out = SiteImport.convert(exportFile());
  assert.strictEqual(out.items.length, 3, "ชิ้นที่ถูกซ่อนต้องไม่มา");
  assert.strictEqual(out.skipped, 1);
});

test("type และ level ตรงกับตัวเลือกของ TCASFolio", () => {
  const out = SiteImport.convert(exportFile());
  for (const item of out.items) {
    assert.ok(Model.TYPES.includes(item.type), `type ไม่ตรง: ${item.type}`);
    if (item.level) assert.ok(Model.LEVELS.includes(item.level), `level ไม่ตรง: ${item.level}`);
  }
  const [award, art, camp] = out.items;
  assert.strictEqual(award.type, "รางวัล / เกียรติบัตร");
  assert.strictEqual(award.level, "ระดับชาติ");
  assert.strictEqual(art.type, "ผลงานสร้างสรรค์");
  assert.strictEqual(camp.type, "โครงงาน / วิจัย");
});

test("ผ่าน normalize ของคลังโดยไม่มีอะไรถูกล้างทิ้ง", () => {
  const out = SiteImport.convert(exportFile());
  const normalized = Model.normalize(out.items).items;
  assert.deepStrictEqual(
    normalized.map((entry) => entry.level),
    out.items.map((entry) => entry.level),
    "level ที่เขียนผิดจะถูก normalize ล้างเป็นว่าง",
  );
});

test("วันที่ไปอยู่หัว detail เพราะคลังไม่มีช่องวันที่", () => {
  const out = SiteImport.convert(exportFile());
  assert.match(out.items[1].detail, /^วันที่ 2026\/04\/01/);
  assert.match(out.items[2].detail, /^วันที่ 2026\/03\/01 - 2026\/03\/05/);
});

test("ช่วงวันที่เท่ากันไม่เขียนซ้ำสองรอบ", () => {
  const file = exportFile();
  file.profile.extracurricular[0].end_date = file.profile.extracurricular[0].start_date;
  const out = SiteImport.convert(file);
  assert.match(out.items[2].detail, /^วันที่ 2026\/03\/01\n/);
});

test("ชั่วโมงเป็น string และ role ไปอยู่ช่องผลงาน", () => {
  const camp = SiteImport.convert(exportFile()).items[2];
  assert.strictEqual(camp.hours, "16");
  assert.strictEqual(camp.result, "หัวหน้าทีม");
});

test("hours_committed เป็น 0 ต้องไม่กลายเป็นค่าว่าง", () => {
  const file = exportFile();
  file.profile.extracurricular[0].hours_committed = 0;
  assert.strictEqual(SiteImport.convert(file).items[2].hours, "0");
});

test("แท็กว่างถูกตัด และ null ไม่ทำให้พัง", () => {
  const out = SiteImport.convert(exportFile());
  assert.deepStrictEqual(out.items[0].tags, ["web", "teamwork"]);
  assert.deepStrictEqual(out.items[1].tags, []);
});

test("id ไม่ชนกันระหว่างผลงานกับกิจกรรม", () => {
  const out = SiteImport.convert(exportFile());
  assert.strictEqual(new Set(out.items.map((entry) => entry.id)).size, out.items.length);
});

test("createdAt แปลงเป็น epoch ms", () => {
  const out = SiteImport.convert(exportFile());
  assert.strictEqual(out.items[0].createdAt, Date.parse("2026-08-25T02:27:40.445Z"));
});

test("ไฟล์ผิดชนิดต้องบอกตรง ๆ", () => {
  assert.throws(() => SiteImport.convert({ items: [] }), /ไม่ใช่ไฟล์ส่งออกโปรไฟล์/);
});

test("โปรไฟล์ว่างต้องไม่ขึ้นว่าสำเร็จ", () => {
  assert.throws(
    () => SiteImport.convert({ profile: { achievements: [], extracurricular: [] } }),
    /ไม่มีผลงานหรือกิจกรรม/,
  );
});

test("ชิ้นที่ไม่มีหัวข้อถูกทิ้ง", () => {
  const file = exportFile();
  file.profile.achievements.push({ id: "999", title: "   ", achievement_type: "academic" });
  assert.strictEqual(SiteImport.convert(file).items.length, 3);
});
