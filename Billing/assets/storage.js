/* LocalStorage-backed data layer (v1)
   Keys:
   - menu.v1
   - settings.v1
   - orders.open.v1
   - orders.selected.v1
   - sales.v1
*/

(function () {
  "use strict";

  const KEYS = {
    menu: "menu.v1",
    settings: "settings.v1",
    openOrders: "orders.open.v1",
    selectedOrder: "orders.selected.v1",
    sales: "sales.v1",
  };

  function safeJsonParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function get(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return safeJsonParse(raw, fallback);
  }

  function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function moneyRound(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function defaultSettings() {
    return {
      shopName: "Restaurant",
      currency: "₹",
      upiId: "",
      payeeName: "Restaurant",
      defaultTables: ["Table 1", "Table 2", "Table 3", "Table 4", "Table 5", "Table 6", "Table 7", "Table 8", "Table 9", "Table 10"],
    };
  }

  function seedImage(text, accent) {
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#0b1020" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <circle cx="520" cy="90" r="110" fill="#ffffff" opacity="0.10"/>
  <circle cx="120" cy="320" r="160" fill="#ffffff" opacity="0.07"/>
  <text x="32" y="220" fill="#ffffff" opacity="0.92" font-size="56" font-weight="800" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial">${text}</text>
  <text x="36" y="260" fill="#ffffff" opacity="0.7" font-size="18" font-weight="700" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial">Click to add</text>
</svg>
`.trim();
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function defaultMenu() {
    return [
      {
        id: "idly",
        name: "Idly",
        price: 20,
        imageUrl: "https://images.pexels.com/photos/6287527/pexels-photo-6287527.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
      {
        id: "puttu",
        name: "Puttu",
        price: 40,
        imageUrl: "https://images.pexels.com/photos/16244806/pexels-photo-16244806.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
      {
        id: "poori",
        name: "Poori",
        price: 35,
        imageUrl: "https://images.pexels.com/photos/6287509/pexels-photo-6287509.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
      {
        id: "dosa",
        name: "Dosa",
        price: 50,
        imageUrl: "https://images.pexels.com/photos/8478051/pexels-photo-8478051.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
      {
        id: "vada",
        name: "Vada",
        price: 15,
        imageUrl: "https://images.pexels.com/photos/8478069/pexels-photo-8478069.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
      {
        id: "pazhampori",
        name: "Pazhampori",
        price: 25,
        imageUrl: "https://images.pexels.com/photos/2586924/pexels-photo-2586924.jpeg?auto=compress&cs=tinysrgb&w=800",
        isAvailable: true,
      },
    ];
  }

  function ensureSeeded() {
    const menu = get(KEYS.menu, null);
    if (!Array.isArray(menu) || menu.length === 0) set(KEYS.menu, defaultMenu());

    const settings = get(KEYS.settings, null);
    if (!settings || typeof settings !== "object") set(KEYS.settings, defaultSettings());

    const openOrders = get(KEYS.openOrders, null);
    if (!Array.isArray(openOrders)) set(KEYS.openOrders, []);

    const selected = get(KEYS.selectedOrder, null);
    if (!selected || typeof selected !== "object") set(KEYS.selectedOrder, { orderId: null });

    const sales = get(KEYS.sales, null);
    if (!Array.isArray(sales)) set(KEYS.sales, []);
  }

  function getSettings() {
    ensureSeeded();
    return get(KEYS.settings, defaultSettings());
  }
  function setSettings(next) {
    set(KEYS.settings, next);
  }

  function getMenu() {
    ensureSeeded();
    return get(KEYS.menu, defaultMenu());
  }
  function saveMenu(items) {
    set(KEYS.menu, items);
  }

  function getOpenOrders() {
    ensureSeeded();
    return get(KEYS.openOrders, []);
  }
  function saveOpenOrders(orders) {
    set(KEYS.openOrders, orders);
  }

  function getSelectedOrderId() {
    ensureSeeded();
    return get(KEYS.selectedOrder, { orderId: null }).orderId || null;
  }
  function setSelectedOrderId(orderId) {
    set(KEYS.selectedOrder, { orderId: orderId || null });
  }

  function getSales() {
    ensureSeeded();
    return get(KEYS.sales, []);
  }
  function appendSale(sale) {
    const sales = getSales();
    sales.push(sale);
    set(KEYS.sales, sales);
  }

  function computeTotals(lineItems) {
    const subtotal = moneyRound(lineItems.reduce((sum, li) => sum + li.price * li.qty, 0));
    const tax = 0;
    const total = subtotal;
    return { subtotal, tax, total };
  }

  window.BillingStorage = {
    KEYS,
    ensureSeeded,
    nowIso,
    uid,
    moneyRound,
    computeTotals,
    getSettings,
    setSettings,
    getMenu,
    saveMenu,
    getOpenOrders,
    saveOpenOrders,
    getSelectedOrderId,
    setSelectedOrderId,
    getSales,
    appendSale,
  };
})();

