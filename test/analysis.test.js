const test = require("node:test");
const assert = require("node:assert");
require("../analysis.js");

const item = (over) => ({
  type: "รางวัล / เกียรติบัตร",
  title: "ชนะเลิศหุ่นยนต์",
  org: "สพฐ.",
  level: "ระดับชาติ",
  result: "ชนะเลิศ",
  hours: "24",
  detail: "ออกแบบและเขียนโปรแกรมหุ่นยนต์",
  tags: ["robotics"],
  ...over,
});

test("ประกอบข้อความครบทุกช่องที่มีค่า", () => {
  const text = Analysis.itemToText(item());
  for (const want of ["[รางวัล / เกียรติบัตร] ชนะเลิศหุ่นยนต์", "หน่วยงาน: สพฐ.", "ระดับ: ระดับชาติ", "ชั่วโมง: 24", "แท็ก: robotics"]) {
    assert.ok(text.includes(want), `ขาด ${want}`);
  }
});

test("ช่องว่างไม่โผล่เป็นบรรทัดเปล่า", () => {
  const text = Analysis.itemToText(item({ org: "", hours: "", tags: [], result: "" }));
  assert.ok(!/\n\n/.test(text));
  assert.ok(!text.includes("หน่วยงาน"));
});

test("ชิ้นที่ไม่มีอะไรเลยถูกข้าม", () => {
  const built = Analysis.buildText([item(), { type: "", title: "", detail: "" }]);
  assert.strictEqual(built.used, 1);
});

test("ตัดที่เพดานแล้วบอกว่าตัด", () => {
  const many = Array.from({ length: 50 }, () => item());
  const built = Analysis.buildText(many, 500);
  assert.ok(built.used > 0 && built.used < 50);
  assert.strictEqual(built.truncated, true);
  assert.ok(built.text.length <= 500);
});

test("ไม่ตัดเมื่อยังไม่ถึงเพดาน", () => {
  const built = Analysis.buildText([item(), item()]);
  assert.strictEqual(built.truncated, false);
  assert.strictEqual(built.total, 2);
});

const v2 = JSON.stringify({
  content: JSON.stringify({
    analysisVersion: 2,
    overview: "พอร์ตเน้นวิศวกรรมและหุ่นยนต์",
    strengths: ["ทำหุ่นยนต์ต่อเนื่อง", "  ", "ทำงานเป็นทีม"],
    weaknesses: ["ขาดผลงานเขียนโปรแกรมเชิงลึก"],
    recommendedFaculties: [
      { faculty: "วิศวกรรมคอมพิวเตอร์", reason: "มีผลงานหุ่นยนต์", matchPercentage: 88, evidence: ["MakeX"], missing: ["โครงงานซอฟต์แวร์"] },
      { faculty: "", reason: "ไม่มีชื่อ", matchPercentage: 50 },
    ],
    recommendations: ["ทำโครงงานซอฟต์แวร์เพิ่ม"],
    detectedInterests: ["หุ่นยนต์"],
    skillsScore: { "การแก้ปัญหา": 70, "ภาวะผู้นำ": 95, "พัง": "ไม่ใช่ตัวเลข" },
    classification: { groups: [{ id: "eng", short: "วิศวกรรม", confidence: 0.9, evidence: ["หุ่นยนต์"] }] },
  }),
  version: 2,
});

test("อ่านคำตอบ v2 ได้ครบ", () => {
  const out = Analysis.parseAnalysis(v2);
  assert.strictEqual(out.version, 2);
  assert.strictEqual(out.faculties.length, 1, "คณะที่ไม่มีชื่อต้องถูกทิ้ง");
  assert.strictEqual(out.faculties[0].match, 88);
  assert.deepStrictEqual(out.strengths, ["ทำหุ่นยนต์ต่อเนื่อง", "ทำงานเป็นทีม"]);
  assert.strictEqual(out.groups[0].confidence, 90, "confidence 0-1 ต้องแปลงเป็นเปอร์เซ็นต์");
});

test("ทักษะเรียงจากมากไปน้อย และทิ้งค่าที่ไม่ใช่ตัวเลข", () => {
  const out = Analysis.parseAnalysis(v2);
  assert.deepStrictEqual(out.skills.map((s) => s.name), ["ภาวะผู้นำ", "การแก้ปัญหา"]);
});

test("คะแนนนอกช่วงถูกบีบเข้า 0-100", () => {
  const body = JSON.stringify({ content: JSON.stringify({ overview: "x", recommendedFaculties: [{ faculty: "ก", matchPercentage: 250 }] }) });
  assert.strictEqual(Analysis.parseAnalysis(body).faculties[0].match, 100);
});

test("JSON ที่ถูกห่อด้วย ```json ยังอ่านได้", () => {
  const body = JSON.stringify({ content: "```json\n{\"overview\":\"ok\"}\n```", version: 1 });
  assert.strictEqual(Analysis.parseAnalysis(body).overview, "ok");
});

test("เว็บตอบ error ต้องโยนข้อความของเว็บออกมา", () => {
  assert.throws(() => Analysis.parseAnalysis(JSON.stringify({ error: "Analysis failed" })), /Analysis failed/);
});

test("ตอบ 200 แต่ว่างเปล่า ต้องไม่นับว่าสำเร็จ", () => {
  const body = JSON.stringify({ content: JSON.stringify({ overview: "", strengths: [], recommendedFaculties: [] }) });
  assert.throws(() => Analysis.parseAnalysis(body), /ไม่มีเนื้อผลวิเคราะห์/);
});

test("ไม่ใช่ JSON ต้องบอกตรง ๆ", () => {
  assert.throws(() => Analysis.parseAnalysis("<html>login</html>"), /ไม่ใช่ JSON/);
});
