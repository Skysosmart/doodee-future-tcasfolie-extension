// ---------------------------------------------------------
// ตัวต่อกับ chrome.storage.local เท่านั้น
// ตรรกะทั้งหมดอยู่ใน model.js — ไฟล์นี้ต้องบางพอที่จะไม่มีอะไรให้เทสต์
// ข้อมูลไม่ออกจากเครื่อง: ห้ามมี network call ในไฟล์นี้เด็ดขาด
// ---------------------------------------------------------
(function (root) {
  "use strict";

  const ITEMS_KEY = "folioItems";
  const PANEL_KEY = "panelCollapsed";

  async function getItems() {
    const data = await chrome.storage.local.get(ITEMS_KEY);
    const { items, changed } = root.Model.normalize(data[ITEMS_KEY]);
    // ย้ายข้อมูลรุ่นเก่าที่ยังไม่มี id — เกิดครั้งเดียวแล้วจบ
    if (changed) await chrome.storage.local.set({ [ITEMS_KEY]: items });
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

  root.Storage = {
    ITEMS_KEY,
    PANEL_KEY,
    getItems,
    setItems,
    onItemsChanged,
    getPanelCollapsed,
    setPanelCollapsed,
  };
})(globalThis);
