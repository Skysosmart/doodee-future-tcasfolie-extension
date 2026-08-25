// ตัวต่อกับ chrome.storage.local เท่านั้น
// ตรรกะทั้งหมดอยู่ใน model.js — ไฟล์นี้ต้องบางพอที่จะไม่มีอะไรให้เทสต์
// ข้อมูลไม่ออกจากเครื่อง: ห้ามมี network call ในไฟล์นี้เด็ดขาด
(function (root) {
  "use strict";

  const ITEMS_KEY = "folioItems";
  const PANEL_KEY = "panelCollapsed";
  // รูปแยกคีย์จากรายการผลงาน — รูปเป็น base64 ใบละหลายร้อย KB
  // ถ้ารวมไว้ใน folioItems ทุกครั้งที่แก้แท็กตัวเดียว onChanged จะยิงทั้งก้อน
  // คีย์รูปคือ img:<itemId> เก็บเป็น array ของ { name, type, data }
  const IMAGE_PREFIX = "img:";
  // ดัชนีจำนวนรูปต่อชิ้น { itemId: count } — ให้การ์ดโชว์ป้ายได้โดยไม่ต้องดึง base64
  // ทุกใบขึ้นมาเทียบ (get(null) ดึงทุกคีย์รวมรูปหลายสิบ MB ทุกครั้งที่วาดใหม่)
  const IMAGE_INDEX_KEY = "imgIndex";
  // ธงว่าผู้ใช้กด "นำเข้าอัตโนมัติ" ค้างไว้ รอจังหวะที่เว็บส่งแฟ้มขึ้นเซิร์ฟเวอร์
  const AUTO_IMPORT_KEY = "autoImportArmed";

  // ย้ายข้อมูลรุ่นเก่าที่ยังไม่มี id — เกิดครั้งเดียวแล้วจบ
  // panel ส่ง { migrate: false } เพราะถ้าสอง context อ่านพร้อมกันตอนยังไม่มี id
  // ต่างคนต่างสุ่ม id คนละชุดแล้วเขียนทับกัน ฝั่งที่แพ้จะถือ id ที่ไม่มีอยู่จริง
  // แก้แล้วได้ของซ้ำ ลบแล้วไม่หาย — ให้ popup เป็นคนย้ายอยู่ที่เดียว
  async function getItems(options) {
    const data = await chrome.storage.local.get(ITEMS_KEY);
    const { items, changed } = root.Model.normalize(data[ITEMS_KEY]);
    const mayMigrate = !options || options.migrate !== false;
    if (changed && mayMigrate) await chrome.storage.local.set({ [ITEMS_KEY]: items });
    return items;
  }

  async function setItems(items) {
    await chrome.storage.local.set({ [ITEMS_KEY]: items });
  }

  // popup กับ panel เปิดพร้อมกันได้ แก้ที่หนึ่งอีกที่ต้องอัปเดตตาม
  function onItemsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[ITEMS_KEY]) return;
      callback(root.Model.normalize(changes[ITEMS_KEY].newValue).items);
    });
  }

  // ยังไม่เคยตั้งค่า = ย่อไว้ก่อน panel ลอยทับปุ่มของใบสมัครจริงได้
  async function getPanelCollapsed() {
    const data = await chrome.storage.local.get(PANEL_KEY);
    if (data[PANEL_KEY] === undefined) return true;
    return data[PANEL_KEY] === true;
  }

  async function setPanelCollapsed(collapsed) {
    await chrome.storage.local.set({ [PANEL_KEY]: collapsed === true });
  }

  async function getImages(itemId) {
    const key = IMAGE_PREFIX + itemId;
    const data = await chrome.storage.local.get(key);
    return Array.isArray(data[key]) ? data[key] : [];
  }

  async function readIndex() {
    const data = await chrome.storage.local.get(IMAGE_INDEX_KEY);
    const idx = data[IMAGE_INDEX_KEY];
    return idx && typeof idx === "object" ? { ...idx } : {};
  }

  async function writeIndexEntry(itemId, count) {
    const idx = await readIndex();
    if (count > 0) idx[itemId] = count;
    else delete idx[itemId];
    await chrome.storage.local.set({ [IMAGE_INDEX_KEY]: idx });
  }

  async function setImages(itemId, images) {
    const key = IMAGE_PREFIX + itemId;
    if (!images.length) {
      await chrome.storage.local.remove(key);
    } else {
      await chrome.storage.local.set({ [key]: images });
    }
    await writeIndexEntry(itemId, images.length);
  }

  // นับรูปของทุกชิ้นจากดัชนี — ไม่ต้องดึง base64 สักไบต์
  // ถ้าดัชนีไม่มี (คลังที่มีรูปจากรุ่นก่อนหน้า) สร้างขึ้นครั้งเดียวจากคีย์จริง
  async function getImageCounts() {
    const data = await chrome.storage.local.get(IMAGE_INDEX_KEY);
    if (data[IMAGE_INDEX_KEY] && typeof data[IMAGE_INDEX_KEY] === "object") {
      return { ...data[IMAGE_INDEX_KEY] };
    }
    const all = await chrome.storage.local.get(null); // ครั้งเดียวตอนย้ายรุ่น
    const counts = {};
    for (const key of Object.keys(all)) {
      if (!key.startsWith(IMAGE_PREFIX)) continue;
      const list = all[key];
      if (Array.isArray(list) && list.length) counts[key.slice(IMAGE_PREFIX.length)] = list.length;
    }
    await chrome.storage.local.set({ [IMAGE_INDEX_KEY]: counts });
    return counts;
  }

  // ลบผลงานแล้วรูปของมันต้องไปด้วย ไม่งั้นกินที่ค้างไว้ตลอด
  async function removeImages(itemId) {
    await chrome.storage.local.remove(IMAGE_PREFIX + itemId);
    await writeIndexEntry(itemId, 0);
  }

  function onImagesChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // ฟังที่ดัชนีพอ — มันเปลี่ยนทุกครั้งที่รูปเปลี่ยน และตัวมันเล็ก
      if (changes[IMAGE_INDEX_KEY]) callback(Object.keys(changes[IMAGE_INDEX_KEY].newValue || {}));
    });
  }

  // ติดอาวุธไว้ข้ามการรีโหลดหน้า — ผู้ใช้ต้องกด F5 หลังกดปุ่มนำเข้าอัตโนมัติ
  // ถ้าเก็บไว้แค่ในตัวแปร สถานะจะหายไปพร้อมหน้าเดิมแล้วดักไม่ทัน
  async function getAutoImportArmed() {
    const data = await chrome.storage.local.get(AUTO_IMPORT_KEY);
    return data[AUTO_IMPORT_KEY] === true;
  }

  async function setAutoImportArmed(armed) {
    if (armed === true) await chrome.storage.local.set({ [AUTO_IMPORT_KEY]: true });
    else await chrome.storage.local.remove(AUTO_IMPORT_KEY);
  }

  root.Storage = {
    ITEMS_KEY,
    PANEL_KEY,
    IMAGE_PREFIX,
    IMAGE_INDEX_KEY,
    AUTO_IMPORT_KEY,
    getItems,
    setItems,
    onItemsChanged,
    getPanelCollapsed,
    setPanelCollapsed,
    getImages,
    setImages,
    getImageCounts,
    removeImages,
    onImagesChanged,
    getAutoImportArmed,
    setAutoImportArmed,
  };
})(globalThis);
