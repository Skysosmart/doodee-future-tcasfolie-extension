// ตรรกะแปลงข้อความจาก PDF เป็นร่างผลงาน — ล้วน ๆ ห้ามมี chrome.* ห้ามมี DOM
// ห้ามพึ่ง pdf.js ด้วย: ฝั่งที่เรียก pdf.js แปลง text item ให้เป็น { str, x, y } มาให้
// จะได้ทดสอบด้วย `node --test` ตรง ๆ และเปลี่ยนตัวอ่าน PDF ได้ในอนาคตโดยไม่แตะที่นี่
(function (root) {
  "use strict";

  // วรรณยุกต์ สระบน-ล่าง และ ํ (ที่ประกอบเป็น ำ) — ชุดที่ Canva ทำหายตอนส่งออก
  // มีสองตัว: ตัว /g/ สำหรับนับ/แทนที่ และตัวไม่มี /g/ สำหรับเช็คอักษรเดี่ยว
  // (regex ที่มี /g/ จำ lastIndex ข้ามรอบ ใช้ .test() ในลูปแล้วจะข้ามตัวอักษร)
  const MARK = /[ัิ-ฺ็-๎]/g;
  const MARK_ONE = /[ัิ-ฺ็-๎]/;

  const TYPE_HINTS = [
    ["รางวัล / เกียรติบัตร", ["รางวัล", "เหรียญ", "ชนะเลิศ", "เกียรติบัตร", "award", "certificate"]],
    ["โครงงาน / วิจัย", ["โครงงาน", "วิจัย", "สิ่งประดิษฐ์", "นวัตกรรม", "project", "research"]],
    ["การอบรม", ["ค่าย", "อบรม", "ฝึกอบรม", "bootcamp", "camp", "workshop", "course"]],
    ["กิจกรรม", ["จิตอาสา", "กิจกรรม", "ชมรม", "อาสาสมัคร", "volunteer"]],
    ["ผลงานสร้างสรรค์", ["ผลงานสร้างสรรค์", "ออกแบบ", "เว็บไซต์", "portfolio"]],
  ];

  const LEVEL_HINTS = [
    ["ระดับนานาชาติ", ["นานาชาติ", "international", "world"]],
    ["ระดับชาติ", ["ระดับชาติ", "ประเทศ", "national"]],
    ["ระดับจังหวัด/เขต/ภาค", ["จังหวัด", "เขต", "ภาค", "provincial"]],
    ["ระดับโรงเรียน/สถาบัน", ["โรงเรียน", "สถาบัน", "ภายในโรงเรียน", "school"]],
  ];

  // สั้นกว่านี้ = อาจเป็นหัวข้อ · ยาวกว่านี้ = ย่อหน้าเนื้อหา
  const TITLE_MAX = 80;
  const BODY_MIN = 150;

  // ถอดเครื่องหมายเพื่อเทียบว่า "เป็นข้อความเดียวกันมั้ย"
  // ต้องยุบ ำ (U+0E33) เป็น า ด้วย เพราะชุดพิการของ Canva เขียนเป็น ํ + า
  // ถ้าไม่ยุบ ฝาแฝดจะไม่ตรงกันเลย ("ทาหนาท" กับ "ทำหนาท")
  function stripMarks(text) {
    return String(text)
      .replace(MARK, "")
      .replace(/ำ/g, "า")
      .replace(/\s+/g, "");
  }

  // คะแนน "ความสมบูรณ์" ของข้อความ ใช้ตัดสินว่าฝาแฝดคู่ไหนคือตัวจริง
  // นับเครื่องหมาย + ให้แต้ม ำ (ชุดพิการมักเสียตัวนี้) แล้วหักหนักถ้าเจอ "ํา"
  // ซึ่งคือร่องรอยการเขียน ำ แบบแตกร่างของ Canva — วัดจริงแล้วสองชุดมักได้
  // จำนวนเครื่องหมายเท่ากัน ตัวตัดสินจริงคือ ำ กับ ํา
  function variantScore(text) {
    const t = String(text || "");
    const marks = countMarks(t);
    const sara = (t.match(/ำ/g) || []).length;
    const broken = (t.match(/ํา/g) || []).length;
    return marks + sara - broken * 2;
  }

  function countMarks(text) {
    const found = String(text).match(MARK);
    return found ? found.length : 0;
  }

  // เศษที่ Canva ทิ้งไว้อีกแบบ: วรรณยุกต์/สระลอยเดี่ยว ๆ ไม่ทับใคร แต่พอต่อบรรทัด
  // จะไปเกาะคำถัดไป ("ปฏิบัติงานที่" + "ัิ" + "โรงพยาบาล" → "ปฏิบัติงานที่ัิโรงพยาบาล")
  // item ที่ไม่มีพยัญชนะ/ตัวเลข/ตัวอักษรละตินเลย ไม่ใช่คำ ทิ้งได้ปลอดภัย
  // (ๆ ฯ ไม่ใช่เครื่องหมายผสม จึงไม่ถูกทิ้ง)
  // "ตัวจริง" ที่ยืนได้เอง: พยัญชนะไทย ก-ฮ · สระที่เขียนเรียงบรรทัด (ะ า เ-ไ ฤ ฦ) ·
  // ๆ ฯ · เลขไทย/อารบิก · อักษรละติน · เครื่องหมายวรรคตอนและสัญลักษณ์ทั่วไป
  // ห้ามใช้ช่วง [ะ-ๅ] เพราะมันครอบ ั ิ ี ึ ื ุ ู (เครื่องหมายผสม) เข้ามาด้วย
  // ต้องนับวรรคตอนเป็นตัวจริงด้วย ไม่งั้นจะกิน "&" "-" "." ในหัวข้อไปหมด
  // (วัดจริง: "MakeX: Challenger - Robotics" กลายเป็น "MakeX: Challenger Robotics")
  const STANDALONE = /[ก-ฮะาเ-ไฤฦๆฯ๐-๙A-Za-z0-9!-\/:-@\[-`{-~]/;

  function dropOrphanMarks(items) {
    return (items || []).filter((item) => {
      const str = String((item && item.str) || "");
      if (!str.trim()) return false;
      return STANDALONE.test(str);
    });
  }

  // Canva วาดสองชุด "ทับกันสนิท" ในหน้า — วัดจริงหน้า 8 ของเล่ม MU CPE:
  // ชุดสมบูรณ์เป็น item เดียวยาว ชุดพิการเป็นเศษหลายชิ้น กล่องซ้อนกัน 100%
  // ตัดด้วยเรขาคณิตตรงนี้แม่นกว่าเดาจากสตริง เพราะจับได้ทั้งกรณีที่ถูกตัดกลางคำ
  //
  // เก็บ item ที่ variantScore ดีกว่า (เท่ากันเอาตัวยาวกว่า) — item ที่ไม่มี w/h
  // วัดการซ้อนไม่ได้ ต้องไม่เดาทิ้ง ไม่งั้นตัวอ่านที่ไม่ให้ขนาดจะได้หน้าว่าง
  function boxOverlapRatio(a, b) {
    const aw = Number(a.w);
    const ah = Number(a.h);
    const bw = Number(b.w);
    const bh = Number(b.h);
    if (!(aw > 0 && ah > 0 && bw > 0 && bh > 0)) return 0;
    const ax = Number(a.x) || 0;
    const ay = Number(a.y) || 0;
    const bx = Number(b.x) || 0;
    const by = Number(b.y) || 0;
    const ix = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const iy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    if (ix <= 0 || iy <= 0) return 0;
    return (ix * iy) / Math.min(aw * ah, bw * bh);
  }

  function dropOverlapping(items, minRatio) {
    const list = (items || []).filter((i) => i && String(i.str || "").trim());
    const limit = Number.isFinite(minRatio) ? minRatio : 0.5;
    const drop = new Set();

    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j || drop.has(i)) continue;
        if (boxOverlapRatio(list[i], list[j]) < limit) continue;
        const sa = String(list[i].str);
        const sb = String(list[j].str);
        // ข้อความเหมือนกันเป๊ะและกล่องทับกัน = ชิ้นซ้ำ (pdf.js ซอย glyph run ซ้อนกัน)
        // เก็บตัวที่มาก่อนไว้ ไม่งั้นคะแนนเท่ากันแล้วไม่มีใครถูกทิ้ง จะได้ SOPSOPSOP
        if (sa === sb) {
          if (j < i) drop.add(i);
          continue;
        }
        const a = variantScore(sa);
        const b = variantScore(sb);
        const bIsBetter = b > a || (b === a && sb.length > sa.length);
        if (bIsBetter) drop.add(i);
      }
    }

    return list.filter((_, i) => !drop.has(i));
  }

  // ต่อ item ในบรรทัดเดียวกัน: ภาษาไทยไม่เว้นคำ และ pdf.js ซอย item กลางคำ
  // จึงต่อตรง ๆ — ยกเว้นตรงที่มีช่องว่างจริงในหน้า (วัดจาก x) หรือคำอังกฤษชนกัน
  // pdf.js บางทีส่ง U+0000 หรืออักขระควบคุมมาปนใน str ถ้าปล่อยไว้จะไปโผล่ในร่าง
  function clean(text) {
    return String(text || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  }

  function joinParts(parts) {
    let out = "";
    for (let i = 0; i < parts.length; i += 1) {
      const cur = parts[i];
      if (i === 0) {
        out = cur.str;
        continue;
      }
      const prev = parts[i - 1];
      let space;
      if (Number.isFinite(prev.w) && prev.w > 0) {
        space = cur.x - (prev.x + prev.w) > 1.2; // มีช่องว่างจริงในหน้า
      } else {
        space = /[A-Za-z0-9)\]]$/.test(out) && /^[A-Za-z0-9(\[]/.test(cur.str);
      }
      out += (space ? " " : "") + cur.str;
    }
    return out.trim();
  }

  // text item ของหน้า → แถว { y, text }: จัดกลุ่มตาม y (PDF นับขึ้น เรียงมากไปน้อย)
  function buildRows(items, tolerance) {
    const tol = Number.isFinite(tolerance) ? tolerance : 2;
    const rows = [];
    for (const item of items || []) {
      const str = clean(item && typeof item.str === "string" ? item.str : "");
      if (!str.trim()) continue;
      const y = Number(item.y) || 0;
      const x = Number(item.x) || 0;
      const w = Number(item.w);
      const h = Number(item.h);
      const row = rows.find((r) => Math.abs(r.y - y) <= tol);
      if (row) {
        row.parts.push({ x, w, str });
        if (Number.isFinite(h)) row.h = Math.max(row.h || 0, h);
      } else {
        rows.push({ y, h: Number.isFinite(h) ? h : 0, parts: [{ x, w, str }] });
      }
    }
    return rows
      .sort((a, b) => b.y - a.y)
      .map((r) => ({ y: r.y, h: r.h || 0, text: dropTwins(joinParts(r.parts.sort((a, b) => a.x - b.x))) }))
      .filter((r) => r.text);
  }

  function buildLines(items, tolerance) {
    return buildRows(items, tolerance).map((r) => r.text);
  }

  // ช่องว่างที่ตามด้วยวรรณยุกต์/สระบน เป็นไปไม่ได้ในภาษาไทยที่พิมพ์ถูก —
  // เจอแบบนี้คือเศษจาก glyph run ที่ Canva ซอยพัง เช่น "านั งานการวิ ั แห่ ชาติ"
  const BROKEN_RUN = /\s[ัิ-ฺ็-๎]/;

  // a เป็นลำดับย่อยของ b มั้ย (ตัวอักษรครบตามลำดับ ไม่ต้องติดกัน)
  function isSubsequence(a, b) {
    let i = 0;
    for (let j = 0; j < b.length && i < a.length; j += 1) {
      if (a[i] === b[j]) i += 1;
    }
    return i === a.length;
  }

  // วัดจริงกับไฟล์ Canva (2026-08-24): แต่ละย่อหน้าถูกฝังสองชุด ชุดหนึ่งวรรณยุกต์หาย
  // (และมักถูกตัดกลางคำ จึงไม่ใช่ "ข้อความเดียวกัน" ตรง ๆ) ปนกับเศษบรรทัด
  //
  // กฎที่ได้จากการวัด:
  //   1. บรรทัดที่มีช่องว่างก่อนวรรณยุกต์ = เศษ ทิ้งทันที
  //   2. ถ้าถอดเครื่องหมายแล้ว A เป็นลำดับย่อยของ B และ (A ยาว ≥ ครึ่งของ B
  //      หรือ A เป็นสตริงย่อยติดกันของ B) → A กับ B คือย่อหน้าเดียวกัน/เศษของมัน
  //      เก็บตัวที่เครื่องหมายมากกว่า เท่ากันเอาตัวยาวกว่า
  //   เงื่อนไข "ครึ่งหนึ่ง" สำคัญ: ภาษาไทยมีตัวอักษรซ้ำเยอะ หัวข้อสั้น ๆ อาจเป็น
  //   ลำดับย่อยของย่อหน้ายาวโดยบังเอิญ ถ้าไม่กันไว้หัวข้อจะหายหมด
  // Canva วางสองชุดไว้ "บรรทัดเดียวกัน ติดกัน" ด้วย เช่น
  //   "ทําหน้าที" + "ทำหน้าที่"  →  "ทําหน้าทีทำหน้าที่"
  // ถอดเครื่องหมายแล้วจะเห็นเป็นข้อความซ้ำติดกันเป๊ะ ("ทาหนาท" + "ทาหนาท")
  // จับด้วยการหาช่วงซ้ำที่ประชิดกันในพื้นที่ที่ถอดเครื่องหมายออกแล้ว
  // แล้วทิ้งชุดที่เครื่องหมายน้อยกว่า (คือชุดพิการ)
  function dropTwins(text, minRun) {
    const min = Number.isFinite(minRun) ? minRun : 6;
    let out = String(text || "");
    let guard = 0;
    let skipFrom = 0;

    while (guard < 40) {
      guard += 1;
      // แผนที่: ตำแหน่งในสตริงที่ถอดเครื่องหมายแล้ว → ตำแหน่งจริง
      const idx = [];
      let bare = "";
      for (let i = 0; i < out.length; i += 1) {
        const ch = out[i];
        if (MARK_ONE.test(ch) || /\s/.test(ch)) continue;
        bare += ch === "ำ" ? "า" : ch; // ยุบให้ตรงกับ stripMarks ไม่งั้นฝาแฝดไม่ match
        idx.push(i);
      }

      // หาคู่ฝาแฝดที่ประชิดกัน: ช่วง A = bare[p..p+k) แล้วช่วงถัดไปขึ้นต้นเหมือน A
      // (j = ความยาวที่ตรงกัน) ครอบทั้งกรณีซ้ำเป๊ะ (j === k) และกรณีชุดพิการถูกตัดสั้น (j < k)
      let hit = null;
      for (let p = skipFrom; p < bare.length && !hit; p += 1) {
        const maxRun = Math.min(80, bare.length - p - min);
        for (let k = maxRun; k >= min; k -= 1) {
          let j = 0;
          while (j < k && p + k + j < bare.length && bare[p + j] === bare[p + k + j]) j += 1;
          if (j < min) continue;
          // ต้องตรงกันเกือบทั้งช่วง ไม่งั้นจะกินข้อความไปครึ่ง ๆ แล้วเหลือเศษ
          // ("อายุที่ต้องการ…" + "อายุทีต้องการความช่ ยเหลื" ตรงกันแค่ครึ่ง)
          // ปล่อยคู่นั้นไว้ให้คนตรวจลบเอง อ่านออกง่ายกว่าเศษที่ถูกกินไปครึ่งตัว
          if (j * 10 < k * 6) continue;
          hit = { p, k, j };
          break;
        }
      }
      if (!hit) break;

      const { p, k, j } = hit;
      const aStart = idx[p];
      const bStart = idx[p + k];
      const bEnd = p + k + j < idx.length ? idx[p + k + j] : out.length;
      const first = out.slice(aStart, bStart);
      const second = out.slice(bStart, bEnd);
      const sFirst = variantScore(first);
      const sSecond = variantScore(second);

      // คะแนนเท่ากัน = ไม่ใช่ฝาแฝดพิการ แต่เป็นข้อความที่ซ้ำจริง (ผู้เขียนตั้งใจ)
      // แตะไม่ได้ ไม่งั้นจะไปลบเนื้อหาจริงของเขา — ข้ามไปหาคู่อื่น
      if (sFirst === sSecond) {
        skipFrom = p + 1;
        continue;
      }

      const keep = sSecond > sFirst ? second : first;
      out = out.slice(0, aStart) + keep + out.slice(bEnd);
      skipFrom = 0;
    }

    return out;
  }

  function keepIndexes(texts) {
    const info = texts.map((t) => ({ key: stripMarks(t), score: variantScore(t) }));
    const drop = new Set();
    for (let i = 0; i < info.length; i += 1) {
      if (BROKEN_RUN.test(texts[i])) {
        drop.add(i);
        continue;
      }
      for (let j = 0; j < info.length; j += 1) {
        if (i === j || drop.has(i)) continue;
        const a = info[i];
        const b = info[j];
        if (!a.key || !b.key) continue;
        const sameParagraph =
          isSubsequence(a.key, b.key) &&
          (a.key.length * 2 >= b.key.length || b.key.includes(a.key));
        if (!sameParagraph) continue;
        const bIsBetter =
          b.score > a.score || (b.score === a.score && b.key.length > a.key.length);
        if (bIsBetter) drop.add(i);
      }
    }
    return new Set(texts.map((_, i) => i).filter((i) => !drop.has(i)));
  }

  function repairThai(lines) {
    const list = (lines || []).map((l) => String(l).trim()).filter(Boolean);
    const keep = keepIndexes(list);
    return list.filter((_, i) => keep.has(i));
  }

  function repairRows(rows) {
    const list = (rows || []).filter((r) => r && String(r.text || "").trim());
    const keep = keepIndexes(list.map((r) => String(r.text).trim()));
    return list.filter((_, i) => keep.has(i));
  }

  // แถว → ย่อหน้า: บรรทัดที่ห่างกันไม่เกิน 1.6 เท่าของ "ความสูงตัวอักษร" คือย่อหน้าเดียวกัน
  //
  // ใช้ความสูงตัวอักษรเป็นไม้วัด ไม่ใช่ค่ากลางของระยะห่าง — วัดจริงแล้วพบว่า
  // ค่ากลางใช้ไม่ได้เวลาหน้ามีไม่กี่บรรทัด (มีช่องว่างเดียว ค่ากลางก็คือช่องว่างนั้น
  // ทุกอย่างจึงถูกรวมเป็นย่อหน้าเดียวหมด รวมหัวข้อเข้ากับเนื้อหา)
  // ถ้าไม่มีความสูงมา (fixture เก่า/ตัวอ่านอื่น) ถอยไปใช้ระยะห่างที่แคบที่สุดในหน้า
  function groupParagraphs(rows, factor) {
    const list = (rows || []).filter((r) => r && String(r.text || "").trim());
    if (!list.length) return [];

    const heights = list.map((r) => Number(r.h) || 0).filter((h) => h > 0).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < list.length; i += 1) gaps.push(Math.abs(list[i - 1].y - list[i].y));
    const lineHeight = heights.length
      ? heights[Math.floor(heights.length / 2)]
      : gaps.length
        ? Math.min(...gaps)
        : 0;
    const limit = lineHeight * (Number.isFinite(factor) ? factor : 1.6);

    const paras = [];
    let buf = String(list[0].text).trim();
    for (let i = 1; i < list.length; i += 1) {
      const gap = Math.abs(list[i - 1].y - list[i].y);
      const text = String(list[i].text).trim();
      if (limit > 0 && gap <= limit) {
        const space = /[A-Za-z0-9)\]]$/.test(buf) && /^[A-Za-z0-9(\[]/.test(text);
        buf += (space ? " " : "") + text;
      } else {
        paras.push(buf);
        buf = text;
      }
    }
    paras.push(buf);
    return paras.map((t) => dropTwins(t)).filter(Boolean);
  }

  function guessFrom(hints, text) {
    const hay = String(text || "").toLowerCase();
    for (const [value, words] of hints) {
      if (words.some((w) => hay.includes(w.toLowerCase()))) return value;
    }
    return "";
  }

  function guessType(text) {
    return guessFrom(TYPE_HINTS, text);
  }

  function guessLevel(text) {
    return guessFrom(LEVEL_HINTS, text);
  }

  // บรรทัดของทุกหน้า → ร่าง: หัวข้อคือบรรทัดสั้นที่ตามด้วยย่อหน้ายาว
  // ขอบหน้าปิดชิ้นเสมอ — เล่มออกแบบอิสระ การลากข้ามหน้าเดาผิดบ่อยกว่าเดาถูก
  function segment(pages) {
    const drafts = [];
    const skipped = [];

    for (const entry of pages || []) {
      const page = Number(entry && entry.page) || 0;
      const lines = ((entry && entry.lines) || []).map((l) => String(l).trim()).filter(Boolean);
      const bodies = lines.filter((l) => l.length >= BODY_MIN);
      if (!bodies.length) {
        skipped.push({ page, why: "ไม่มีย่อหน้าที่ยาวพอจะเป็นรายละเอียดผลงาน" });
        continue;
      }

      let current = null;
      const push = () => {
        if (current && current.detail) drafts.push(current);
        current = null;
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const isBody = line.length >= BODY_MIN;
        if (isBody) {
          if (!current) current = { title: "", detail: "", page };
          current.detail = current.detail ? `${current.detail}\n${line}` : line;
          continue;
        }
        // บรรทัดสั้น: เป็นหัวข้อได้ถ้ามีย่อหน้ายาวตามมา
        const nextBody = lines.slice(i + 1).find((l) => l.length >= BODY_MIN);
        if (nextBody) {
          push();
          current = { title: line, detail: "", page };
        }
      }
      push();
    }

    return { drafts, skipped };
  }

  // ท่อเต็ม: text item ต่อหน้า → ร่างที่เดาหมวด/ระดับแล้ว
  function toDrafts(pages) {
    const prepared = (pages || []).map((p) => ({
      page: Number(p && p.page) || 0,
      lines: groupParagraphs(repairRows(buildRows(dropOrphanMarks(dropOverlapping((p && p.items) || []))))),
    }));

    const { drafts, skipped } = segment(prepared);
    return {
      drafts: drafts.map((d) => ({
        ...d,
        type: guessType(`${d.title} ${d.detail}`),
        level: guessLevel(`${d.title} ${d.detail}`),
      })),
      skipped,
    };
  }

  root.PdfText = {
    TITLE_MAX,
    BODY_MIN,
    clean,
    stripMarks,
    countMarks,
    variantScore,
    joinParts,
    boxOverlapRatio,
    dropOverlapping,
    dropOrphanMarks,
    dropTwins,
    buildRows,
    buildLines,
    repairThai,
    repairRows,
    groupParagraphs,
    guessType,
    guessLevel,
    segment,
    toDrafts,
  };
})(globalThis);
