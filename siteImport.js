// แปลงไฟล์ที่ doodee-future.com ส่งออก (/api/profile/export) ให้เป็นรูปที่คลังรับได้
//
// ตรรกะล้วน ๆ ห้ามมี chrome.* — เว็บมีปุ่มส่งออกโปรไฟล์อยู่แล้ว และไฟล์นั้นมีครบกว่าที่
// endpoint ของส่วนขยายให้ (มีทักษะ ความสนใจ การศึกษา ด้วย) รับไฟล์นี้ได้ตรง ๆ จะได้ไม่ต้อง
// รอ endpoint และผู้ใช้ที่มีไฟล์อยู่แล้วก็ใช้ได้ทันที
(function (root) {
  "use strict";

  // ต้องตรงกับตัวเลือกของ TCASFolio เป๊ะ ๆ (ดู Model.TYPES / Model.LEVELS)
  const TYPE_BY_ACHIEVEMENT = {
    academic: "รางวัล / เกียรติบัตร",
    competition: "รางวัล / เกียรติบัตร",
    sports: "รางวัล / เกียรติบัตร",
    certification: "รางวัล / เกียรติบัตร",
    arts: "ผลงานสร้างสรรค์",
    leadership: "กิจกรรม",
    community_service: "กิจกรรม",
  };

  const TYPE_BY_ACTIVITY = {
    research: "โครงงาน / วิจัย",
    academic: "โครงงาน / วิจัย",
    training: "การอบรม",
    workshop: "การอบรม",
    volunteer: "กิจกรรม",
    leadership: "กิจกรรม",
  };

  const LEVEL_BY_CODE = {
    school: "ระดับโรงเรียน/สถาบัน",
    local: "ระดับจังหวัด/เขต/ภาค",
    province: "ระดับจังหวัด/เขต/ภาค",
    regional: "ระดับจังหวัด/เขต/ภาค",
    national: "ระดับชาติ",
    international: "ระดับนานาชาติ",
  };

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function epoch(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }

  function tagList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => text(entry)).filter(Boolean);
  }

  // ส่วนขยายไม่มีช่องวันที่ ใส่ไว้หัว detail แทน ไม่งั้นข้อมูลนี้หายไปเฉย ๆ
  function withDate(detail, from, to) {
    const one = (value) => (value ? String(value).slice(0, 10).replace(/-/g, "/") : "");
    const start = one(from);
    const end = one(to);
    const when = start && end && start !== end ? `${start} - ${end}` : start || end;
    return [when && `วันที่ ${when}`, detail].filter(Boolean).join("\n");
  }

  function looksLikeSiteExport(data) {
    return !!(data && typeof data === "object" && data.profile && typeof data.profile === "object");
  }

  function fromAchievement(row) {
    const detail = withDate(text(row.description), row.date_achieved, null);
    return {
      id: `ach-${text(row.id) || text(row.title)}`,
      type: TYPE_BY_ACHIEVEMENT[text(row.achievement_type)] || "รางวัล / เกียรติบัตร",
      title: text(row.title),
      org: text(row.organization),
      level: LEVEL_BY_CODE[text(row.achievement_level)] || "",
      result: "",
      hours: "",
      detail,
      tags: tagList(row.skills_gained),
      createdAt: epoch(row.created_at),
    };
  }

  function fromActivity(row) {
    const detail = withDate(
      [text(row.description), text(row.impact_description)].filter(Boolean).join("\n"),
      row.start_date,
      row.end_date,
    );
    return {
      id: `act-${text(row.id) || text(row.activity_name)}`,
      type: TYPE_BY_ACTIVITY[text(row.activity_type)] || "กิจกรรม",
      title: text(row.activity_name),
      org: text(row.organization),
      level: "",
      result: text(row.role),
      hours: row.hours_committed == null ? "" : String(row.hours_committed),
      detail,
      tags: [],
      createdAt: epoch(row.created_at),
    };
  }

  // เว็บซ่อนผลงานบางชิ้นไว้ไม่ให้ขึ้นพอร์ต ต้องเคารพค่านั้น
  function isVisible(row) {
    return row.portfolio_visibility !== false;
  }

  function convert(data) {
    if (!looksLikeSiteExport(data)) throw new Error("ไฟล์นี้ไม่ใช่ไฟล์ส่งออกโปรไฟล์ของ doodee-future");
    const profile = data.profile;
    const achievements = Array.isArray(profile.achievements) ? profile.achievements : [];
    const activities = Array.isArray(profile.extracurricular) ? profile.extracurricular : [];

    const items = [
      ...achievements.filter(isVisible).map(fromAchievement),
      ...activities.map(fromActivity),
    ].filter((item) => item.title);

    // ไม่มีหัวข้อสักชิ้น = ไฟล์ผิดหรือโปรไฟล์ยังว่าง ต้องไม่ขึ้นว่าสำเร็จ
    if (!items.length) throw new Error("ไฟล์นี้ไม่มีผลงานหรือกิจกรรมที่ใส่ลงพอร์ตได้");

    return {
      items,
      skipped: achievements.length - achievements.filter(isVisible).length,
      counts: { achievements: achievements.length, activities: activities.length },
    };
  }

  root.SiteImport = { convert, looksLikeSiteExport, TYPE_BY_ACHIEVEMENT, TYPE_BY_ACTIVITY, LEVEL_BY_CODE };
})(globalThis);
