// ---------------------------------------------------------
// ตัวต่อกับ chrome.storage.local เท่านั้น
// ตรรกะทั้งหมดอยู่ใน model.js — ไฟล์นี้ต้องบางพอที่จะไม่มีอะไรให้เทสต์
// ข้อมูลไม่ออกจากเครื่อง: ห้ามมี network call ในไฟล์นี้เด็ดขาด
// ---------------------------------------------------------
(function (root) {
  "use strict";

  const ITEMS_KEY = "folioItems";
  const PANEL_KEY = "panelCollapsed";
  // รูปแยกคีย์จากรายการผลงาน — รูปเป็น base64 ใบละหลายร้อย KB
  // ถ้ารวมไว้ใน folioItems ทุกครั้งที่แก้แท็กตัวเดียว onChanged จะยิงทั้งก้อน
  // คีย์รูปคือ img:<itemId> เก็บเป็น array ของ { name, type, data }
  const IMAGE_PREFIX = "img:";

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
  // ถ้าจะให้กางตั้งแต่แรก เปลี่ยนค่า default ตรงนี้บรรทัดเดียว
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

  async function setImages(itemId, images) {
    const key = IMAGE_PREFIX + itemId;
    if (!images.length) {
      await chrome.storage.local.remove(key);
      return;
    }
    await chrome.storage.local.set({ [key]: images });
  }

  // นับรูปของทุกชิ้นทีเดียว ให้การ์ดโชว์ได้ว่าชิ้นไหนมีรูปกี่ใบ
  // โดยไม่ต้องโหลด base64 ทั้งหมดขึ้นมา — อ่านคีย์ทั้งหมดแล้วนับความยาว
  async function getImageCounts() {
    const all = await chrome.storage.local.get(null);
    const counts = {};
    for (const key of Object.keys(all)) {
      if (!key.startsWith(IMAGE_PREFIX)) continue;
      const list = all[key];
      counts[key.slice(IMAGE_PREFIX.length)] = Array.isArray(list) ? list.length : 0;
    }
    return counts;
  }

  // ลบผลงานแล้วรูปของมันต้องไปด้วย ไม่งั้นกินที่ค้างไว้ตลอด
  async function removeImages(itemId) {
    await chrome.storage.local.remove(IMAGE_PREFIX + itemId);
  }

  function onImagesChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const touched = Object.keys(changes).filter((k) => k.startsWith(IMAGE_PREFIX));
      if (touched.length) callback(touched.map((k) => k.slice(IMAGE_PREFIX.length)));
    });
  }

  root.Storage = {
    ITEMS_KEY,
    PANEL_KEY,
    IMAGE_PREFIX,
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
  };
})(globalThis);
