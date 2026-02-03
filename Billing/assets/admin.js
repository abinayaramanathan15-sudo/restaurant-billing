/* Admin: settings + menu CRUD + monthly sales report */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, String(v));
    }
    for (const c of children) node.appendChild(c);
    return node;
  };

  const store = window.BillingStorage;
  store.ensureSeeded();

  const toastHost = $("#toastHost");
  function toast(title, detail) {
    const t = el("div", { class: "toast" }, [
      el("div", {}, [
        el("div", { class: "toast__title", text: title }),
        detail ? el("div", { class: "muted small", text: detail }) : el("div", { class: "muted small", text: "" }),
      ]),
      el("div", { class: "pill", text: "OK" }),
    ]);
    toastHost.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Settings elements
  const saveSettingsBtn = $("#saveSettingsBtn");
  const shopNameInput = $("#shopNameInput");
  const currencyInput = $("#currencyInput");
  const upiIdInput = $("#upiIdInput");
  const payeeNameInput = $("#payeeNameInput");
  const defaultTablesInput = $("#defaultTablesInput");

  // Menu elements
  const menuForm = $("#menuForm");
  const menuIdInput = $("#menuIdInput");
  const menuNameInput = $("#menuNameInput");
  const menuPriceInput = $("#menuPriceInput");
  const menuImageUrlInput = $("#menuImageUrlInput");
  const menuAvailableInput = $("#menuAvailableInput");
  const menuResetBtn = $("#menuResetBtn");
  const menuTableBody = $("#menuTableBody");

  // Report elements
  const reportMonthInput = $("#reportMonthInput");
  const runReportBtn = $("#runReportBtn");
  const reportSummary = $("#reportSummary");
  const reportItemsBody = $("#reportItemsBody");

  function loadSettingsToForm() {
    const s = store.getSettings();
    shopNameInput.value = s.shopName || "";
    currencyInput.value = s.currency || "₹";
    upiIdInput.value = s.upiId || "";
    payeeNameInput.value = s.payeeName || "";
    defaultTablesInput.value = Array.isArray(s.defaultTables) ? s.defaultTables.join(", ") : "";
  }

  function saveSettingsFromForm() {
    const prev = store.getSettings();
    const tables = defaultTablesInput.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const next = {
      ...prev,
      shopName: shopNameInput.value.trim() || "Restaurant",
      currency: currencyInput.value.trim() || "₹",
      upiId: upiIdInput.value.trim(),
      payeeName: payeeNameInput.value.trim() || (shopNameInput.value.trim() || "Restaurant"),
      defaultTables: tables.length ? tables : prev.defaultTables,
    };
    store.setSettings(next);
    toast("Saved", "Settings updated");
  }

  function fmtMoney(n) {
    const s = store.getSettings();
    const val = (Number(n) || 0).toFixed(2);
    return `${s.currency || "₹"}${val}`;
  }

  // Menu CRUD
  function resetMenuForm() {
    menuIdInput.value = "";
    menuNameInput.value = "";
    menuPriceInput.value = "";
    menuImageUrlInput.value = "";
    menuAvailableInput.checked = true;
    menuNameInput.focus();
  }

  function renderMenuTable() {
    const menu = store.getMenu();
    menuTableBody.innerHTML = "";
    for (const item of menu) {
      const tr = document.createElement("tr");
      const img = el("img", { class: "thumb", alt: item.name, src: item.imageUrl || "" });
      tr.appendChild(el("td", {}, [img]));
      tr.appendChild(el("td", { text: item.name }));
      tr.appendChild(el("td", { text: fmtMoney(item.price) }));
      tr.appendChild(el("td", { text: item.isAvailable ? "Yes" : "No" }));

      const actions = el("td", { class: "alignRight" });
      const wrap = el("div", { class: "rowActions" });
      const editBtn = el("button", { class: "btn", type: "button", text: "Edit" });
      const delBtn = el("button", { class: "btn btn--danger", type: "button", text: "Delete" });

      editBtn.addEventListener("click", () => {
        menuIdInput.value = item.id;
        menuNameInput.value = item.name;
        menuPriceInput.value = String(Number(item.price || 0));
        menuImageUrlInput.value = item.imageUrl || "";
        menuAvailableInput.checked = !!item.isAvailable;
        toast("Edit", item.name);
      });

      delBtn.addEventListener("click", () => {
        const ok = confirm(`Delete "${item.name}"?`);
        if (!ok) return;
        const next = store.getMenu().filter((m) => m.id !== item.id);
        store.saveMenu(next);

        // Also remove from open orders (optional cleanup)
        const open = store.getOpenOrders();
        for (const o of open) {
          if (o.items && o.items[item.id]) delete o.items[item.id];
        }
        store.saveOpenOrders(open);

        renderMenuTable();
        toast("Deleted", item.name);
      });

      wrap.appendChild(editBtn);
      wrap.appendChild(delBtn);
      actions.appendChild(wrap);
      tr.appendChild(actions);
      menuTableBody.appendChild(tr);
    }
  }

  function normalizeId(name) {
    const base = name
      .toLowerCase()
      .trim()
      .replaceAll(/[^a-z0-9]+/g, "_")
      .replaceAll(/^_+|_+$/g, "");
    return base || store.uid("item");
  }

  function upsertMenuItemFromForm() {
    const name = menuNameInput.value.trim();
    const price = Number(menuPriceInput.value || 0);
    if (!name) {
      toast("Missing", "Name is required");
      return;
    }
    if (!(price >= 0)) {
      toast("Invalid", "Price must be a number");
      return;
    }

    const menu = store.getMenu();
    const idExisting = menuIdInput.value.trim();
    const id = idExisting || normalizeId(name);

    const nextItem = {
      id,
      name,
      price,
      imageUrl: menuImageUrlInput.value.trim() || "",
      isAvailable: !!menuAvailableInput.checked,
    };

    const idx = menu.findIndex((m) => m.id === idExisting);
    if (idx >= 0) menu[idx] = nextItem;
    else {
      // Ensure unique id if creating
      if (menu.some((m) => m.id === id)) nextItem.id = store.uid(id);
      menu.push(nextItem);
    }
    store.saveMenu(menu);
    renderMenuTable();
    resetMenuForm();
    toast("Saved", nextItem.name);
  }

  // Monthly report
  function setDefaultReportMonth() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    reportMonthInput.value = `${yyyy}-${mm}`;
  }

  function runReport() {
    const monthVal = reportMonthInput.value; // YYYY-MM
    if (!monthVal) {
      toast("Pick month", "Select a month to run report");
      return;
    }
    const [yyyyStr, mmStr] = monthVal.split("-");
    const yyyy = Number(yyyyStr);
    const mm = Number(mmStr); // 1-12
    const start = new Date(yyyy, mm - 1, 1, 0, 0, 0, 0);
    const end = new Date(yyyy, mm, 1, 0, 0, 0, 0);

    const sales = store.getSales().filter((s) => {
      const t = new Date(s.timestamp);
      return t >= start && t < end;
    });

    const totalRevenue = sales.reduce((sum, s) => sum + (Number(s.totals?.total) || 0), 0);
    const orderCount = sales.length;
    const avg = orderCount ? totalRevenue / orderCount : 0;

    const itemAgg = new Map(); // id -> { name, qty, amount }
    for (const sale of sales) {
      for (const li of sale.lineItems || []) {
        const key = li.id || li.name;
        const prev = itemAgg.get(key) || { name: li.name, qty: 0, amount: 0 };
        prev.qty += Number(li.qty) || 0;
        prev.amount += (Number(li.price) || 0) * (Number(li.qty) || 0);
        itemAgg.set(key, prev);
      }
    }

    const items = Array.from(itemAgg.values()).sort((a, b) => b.amount - a.amount);

    reportSummary.innerHTML = "";
    reportSummary.appendChild(stat("Revenue", fmtMoney(totalRevenue)));
    reportSummary.appendChild(stat("Orders", String(orderCount)));
    reportSummary.appendChild(stat("Avg order", fmtMoney(avg)));
    reportSummary.appendChild(stat("Top item", items[0] ? `${items[0].name} (${items[0].qty})` : "—"));

    reportItemsBody.innerHTML = "";
    if (items.length === 0) {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", { text: "No sales for this month." }));
      tr.appendChild(el("td", { class: "alignRight", text: "—" }));
      tr.appendChild(el("td", { class: "alignRight", text: "—" }));
      reportItemsBody.appendChild(tr);
      return;
    }

    for (const it of items) {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", { text: it.name }));
      tr.appendChild(el("td", { class: "alignRight", text: String(it.qty) }));
      tr.appendChild(el("td", { class: "alignRight", text: fmtMoney(it.amount) }));
      reportItemsBody.appendChild(tr);
    }
  }

  function stat(label, value) {
    return el("div", { class: "stat" }, [el("div", { class: "stat__label", text: label }), el("div", { class: "stat__value", text: value })]);
  }

  function wireEvents() {
    saveSettingsBtn.addEventListener("click", saveSettingsFromForm);
    menuResetBtn.addEventListener("click", resetMenuForm);
    menuForm.addEventListener("submit", (e) => {
      e.preventDefault();
      upsertMenuItemFromForm();
    });
    runReportBtn.addEventListener("click", runReport);
  }

  // Init
  wireEvents();
  loadSettingsToForm();
  renderMenuTable();
  setDefaultReportMonth();
  runReport();
})();

