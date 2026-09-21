// ตรรกะล้วน ๆ ของการวิเคราะห์พอร์ต — ห้ามมี chrome.* หรือ fetch ในไฟล์นี้
// ประกอบข้อความจากคลัง + อ่านคำตอบของ /api/portfolio/analyse ให้เป็นรูปที่หน้าจอใช้ได้
(function (root) {
  "use strict";

  // เว็บตัดข้อความที่ 16000 ตัว ส่งเกินไปก็ถูกตัดกลางคันโดยไม่บอก
  // ตัดเองที่ 15000 แล้วบอกผู้ใช้ว่าใส่ไปกี่ชิ้นจากทั้งหมดกี่ชิ้น
  const TEXT_LIMIT = 15000;

  function line(label, value) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? `${label}: ${text}` : "";
  }

  function itemToText(item) {
    const head = [item.type && `[${item.type}]`, item.title].filter(Boolean).join(" ").trim();
    const meta = [
      line("หน่วยงาน", item.org),
      line("ระดับ", item.level),
      line("ผลงาน", item.result),
      line("ชั่วโมง", item.hours),
    ].filter(Boolean);
    const tags = Array.isArray(item.tags) && item.tags.length ? `แท็ก: ${item.tags.join(", ")}` : "";
    return [head, ...meta, (item.detail || "").trim(), tags].filter(Boolean).join("\n");
  }

  function buildText(items, limit) {
    const cap = Number.isFinite(limit) ? limit : TEXT_LIMIT;
    const list = Array.isArray(items) ? items : [];
    const parts = [];
    let used = 0;

    for (const item of list) {
      const block = itemToText(item);
      if (!block) continue;
      // +2 คือบรรทัดว่างที่คั่นระหว่างชิ้น
      if (used && used + block.length + 2 > cap) break;
      if (block.length > cap) break;
      parts.push(block);
      used += block.length + 2;
    }

    return {
      text: parts.join("\n\n"),
      used: parts.length,
      total: list.length,
      truncated: parts.length < list.length,
    };
  }

  function strList(value, max) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const entry of list) {
      const text = typeof entry === "string" ? entry.trim() : "";
      if (text) out.push(text);
      if (max && out.length >= max) break;
    }
    return out;
  }

  function clampScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  // โมเดลบางทีห่อ JSON ด้วย ```json ทั้งที่ system prompt ห้ามไว้ — เผื่อไว้ดีกว่าพัง
  function stripFence(text) {
    const fenced = String(text).trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenced ? fenced[1] : text;
  }

  function parseAnalysis(bodyText) {
    let envelope;
    try {
      envelope = JSON.parse(bodyText);
    } catch (error) {
      throw new Error("เว็บตอบมาไม่ใช่ JSON");
    }
    if (envelope && typeof envelope.error === "string") throw new Error(envelope.error);

    let data = envelope;
    if (envelope && typeof envelope.content === "string") {
      try {
        data = JSON.parse(stripFence(envelope.content));
      } catch (error) {
        throw new Error("อ่านผลวิเคราะห์ไม่ออก — เว็บส่งข้อความที่ไม่ใช่ JSON กลับมา");
      }
    }
    if (!data || typeof data !== "object") throw new Error("ผลวิเคราะห์ว่างเปล่า");

    const faculties = (Array.isArray(data.recommendedFaculties) ? data.recommendedFaculties : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        name: typeof entry.faculty === "string" ? entry.faculty.trim() : "",
        reason: typeof entry.reason === "string" ? entry.reason.trim() : "",
        match: clampScore(entry.matchPercentage),
        evidence: strList(entry.evidence, 5),
        missing: strList(entry.missing, 5),
      }))
      .filter((entry) => entry.name);

    const skills = Object.entries(data.skillsScore && typeof data.skillsScore === "object" ? data.skillsScore : {})
      .map(([name, score]) => ({ name: String(name).trim(), score: clampScore(score) }))
      .filter((entry) => entry.name && entry.score !== null)
      .sort((a, b) => b.score - a.score);

    const groups = (data.classification && Array.isArray(data.classification.groups)
      ? data.classification.groups
      : []
    )
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        name: typeof entry.short === "string" && entry.short ? entry.short : String(entry.id || ""),
        confidence: clampScore(Number(entry.confidence) <= 1 ? Number(entry.confidence) * 100 : entry.confidence),
        evidence: strList(entry.evidence, 4),
      }))
      .filter((entry) => entry.name);

    const result = {
      version: Number(envelope && envelope.version) || Number(data.analysisVersion) || 1,
      overview: typeof data.overview === "string" ? data.overview.trim() : "",
      strengths: strList(data.strengths, 8),
      weaknesses: strList(data.weaknesses, 8),
      recommendations: strList(data.recommendations, 8),
      interests: strList(data.detectedInterests, 8),
      faculties,
      skills,
      groups,
      completeness: data.completeness && typeof data.completeness === "object" ? data.completeness : null,
    };

    // ตอบ 200 แต่ไม่มีเนื้อเลย ต้องไม่โชว์หน้าเปล่า ๆ แล้วบอกว่าสำเร็จ
    if (!result.overview && !result.strengths.length && !result.faculties.length) {
      throw new Error("เว็บตอบกลับมาแต่ไม่มีเนื้อผลวิเคราะห์");
    }
    return result;
  }

  root.Analysis = { TEXT_LIMIT, buildText, itemToText, parseAnalysis };
})(globalThis);
