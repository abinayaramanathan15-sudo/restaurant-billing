/* Cashier app: menu + multi-table open tickets + billing actions */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "text") node.textContent = v;
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, String(v));
    }
    for (const c of children) node.appendChild(c);
    return node;
  };

  const store = window.BillingStorage;
  store.ensureSeeded();

  const state = {
    menu: store.getMenu(),
    settings: store.getSettings(),
    openOrders: store.getOpenOrders(),
    selectedOrderId: store.getSelectedOrderId(),
  };

  // Elements
  const shopNameEl = $("#shopName");
  const menuGridEl = $("#menuGrid");
  const cartItemsEl = $("#cartItems");
  const subtotalTextEl = $("#subtotalText");
  const totalTextEl = $("#totalText");
  const selectedTicketMetaEl = $("#selectedTicketMeta");

  const tableSelectEl = $("#tableSelect");
  const openTicketsListEl = $("#openTicketsList");
  const newTicketBtn = $("#newTicketBtn");
  const clearCartBtn = $("#clearCartBtn");
  const payNowBtn = $("#payNowBtn");
  const printBillBtn = $("#printBillBtn");

  const toastHost = $("#toastHost");
  const payModal = $("#payModal");
  const payModalMeta = $("#payModalMeta");
  const markPaidBtn = $("#markPaidBtn");
  const qrCanvas = $("#qrCanvas");
  const upiText = $("#upiText");

  const receiptPrint = $("#receiptPrint");

  function fmtMoney(n) {
    const { currency } = state.settings;
    const val = (Number(n) || 0).toFixed(2);
    return `${currency}${val}`;
  }

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

  function persistOrders() {
    store.saveOpenOrders(state.openOrders);
    store.setSelectedOrderId(state.selectedOrderId);
  }

  function ensureSelectedTicket() {
    if (state.openOrders.length === 0) return null;
    const exists = state.openOrders.some((o) => o.orderId === state.selectedOrderId);
    if (!exists) state.selectedOrderId = state.openOrders[0].orderId;
    persistOrders();
    return getSelectedOrder();
  }

  function getSelectedOrder() {
    return state.openOrders.find((o) => o.orderId === state.selectedOrderId) || null;
  }

  function defaultTables() {
    const list = Array.isArray(state.settings.defaultTables) ? state.settings.defaultTables : [];
    return list.length ? list : store.getSettings().defaultTables;
  }

  function ensureTicketsFromTables() {
    // Convenience: if no open tickets, create one for the first table.
    if (state.openOrders.length > 0) return;
    const tables = defaultTables();
    const first = tables[0] || "Table 1";
    const order = { orderId: store.uid("order"), tableLabel: first, createdAt: store.nowIso(), items: {} };
    state.openOrders = [order];
    state.selectedOrderId = order.orderId;
    persistOrders();
  }

  function renderTableSelect() {
    const tables = defaultTables();
    tableSelectEl.innerHTML = "";

    for (const t of tables) {
      tableSelectEl.appendChild(el("option", { value: t, text: t }));
    }

    const selected = getSelectedOrder();
    if (selected) tableSelectEl.value = selected.tableLabel;
  }

  function renderOpenTickets() {
    openTicketsListEl.innerHTML = "";
    for (const o of state.openOrders) {
      const isCurrent = o.orderId === state.selectedOrderId;
      const chip = el("button", { class: "chip", type: "button", "aria-current": isCurrent ? "true" : "false" }, [
        document.createTextNode(o.tableLabel),
      ]);
      chip.addEventListener("click", () => {
        state.selectedOrderId = o.orderId;
        persistOrders();
        renderAll();
      });
      openTicketsListEl.appendChild(chip);
    }
  }

  function renderMenu() {
    state.menu = store.getMenu();
    menuGridEl.innerHTML = "";

    for (const item of state.menu) {
      const disabled = !item.isAvailable;
      const card = el("div", { class: "menuCard", role: "button", tabindex: disabled ? "-1" : "0", "aria-disabled": disabled ? "true" : "false" });
      const imgWrap = el("div", { class: "menuCard__img" });
      const img = el("img", { alt: item.name, src: item.imageUrl || "" });
      imgWrap.appendChild(img);
      const body = el("div", { class: "menuCard__body" }, [
        el("div", {}, [el("div", { class: "menuCard__name", text: item.name }), el("div", { class: "muted small", text: fmtMoney(item.price) })]),
        el("div", { class: "pill", text: disabled ? "Sold out" : "Add" }),
      ]);

      card.appendChild(imgWrap);
      card.appendChild(body);

      function add() {
        if (disabled) return;
        const order = ensureSelectedTicket();
        if (!order) {
          toast("No ticket", "Create/select a table first.");
          return;
        }
        const curr = order.items[item.id]?.qty || 0;
        order.items[item.id] = { qty: curr + 1 };
        persistOrders();
        toast("Added", `${item.name} · ${fmtMoney(item.price)}`);
        renderCart();
        renderOpenTickets();
      }

      card.addEventListener("click", add);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          add();
        }
      });

      menuGridEl.appendChild(card);
    }
  }

  function buildLineItems(order) {
    const menuById = new Map(state.menu.map((m) => [m.id, m]));
    const lineItems = [];
    for (const [id, meta] of Object.entries(order.items || {})) {
      const m = menuById.get(id);
      if (!m) continue;
      const qty = Number(meta.qty) || 0;
      if (qty <= 0) continue;
      lineItems.push({ id: m.id, name: m.name, price: Number(m.price) || 0, qty, imageUrl: m.imageUrl || "" });
    }
    return lineItems;
  }

  function renderCart() {
    state.settings = store.getSettings();
    state.menu = store.getMenu();
    state.openOrders = store.getOpenOrders();
    state.selectedOrderId = store.getSelectedOrderId();

    const order = ensureSelectedTicket();
    if (!order) {
      cartItemsEl.innerHTML = el("div", { class: "muted small", text: "No open tickets yet." }).outerHTML;
      selectedTicketMetaEl.textContent = "No table selected";
      subtotalTextEl.textContent = fmtMoney(0);
      totalTextEl.textContent = fmtMoney(0);
      payNowBtn.disabled = true;
      printBillBtn.disabled = true;
      clearCartBtn.disabled = true;
      return;
    }

    payNowBtn.disabled = false;
    printBillBtn.disabled = false;
    clearCartBtn.disabled = false;

    selectedTicketMetaEl.textContent = `${order.tableLabel} · Open since ${new Date(order.createdAt).toLocaleString()}`;

    const lineItems = buildLineItems(order);
    const totals = store.computeTotals(lineItems);

    subtotalTextEl.textContent = fmtMoney(totals.subtotal);
    totalTextEl.textContent = fmtMoney(totals.total);

    cartItemsEl.innerHTML = "";
    if (lineItems.length === 0) {
      cartItemsEl.appendChild(el("div", { class: "muted small", text: "Cart is empty. Click a menu item to add." }));
      return;
    }

    for (const li of lineItems) {
      const row = el("div", { class: "cartRow" });
      row.appendChild(
        el("div", { class: "cartRow__left" }, [
          el("img", { class: "thumb thumb--small", alt: li.name, src: li.imageUrl || "" }),
          el("div", {}, [
            el("div", { class: "cartRow__name", text: li.name }),
            el("div", { class: "cartRow__meta", text: `${fmtMoney(li.price)} each` }),
          ]),
        ])
      );

      const qtyControls = el("div", { class: "qtyControls" });
      const minus = el("button", { class: "btn qtyBtn", type: "button", text: "−" });
      const plus = el("button", { class: "btn qtyBtn", type: "button", text: "+" });
      const qtyText = el("div", { class: "qtyText", text: String(li.qty) });

      minus.addEventListener("click", () => {
        const o = getSelectedOrder();
        if (!o) return;
        const curr = o.items[li.id]?.qty || 0;
        const next = Math.max(0, curr - 1);
        if (next === 0) delete o.items[li.id];
        else o.items[li.id] = { qty: next };
        persistOrders();
        renderCart();
      });
      plus.addEventListener("click", () => {
        const o = getSelectedOrder();
        if (!o) return;
        const curr = o.items[li.id]?.qty || 0;
        o.items[li.id] = { qty: curr + 1 };
        persistOrders();
        renderCart();
      });

      qtyControls.appendChild(minus);
      qtyControls.appendChild(qtyText);
      qtyControls.appendChild(plus);
      row.appendChild(qtyControls);

      cartItemsEl.appendChild(row);
    }
  }

  function createNewTicket() {
    const tables = defaultTables();
    const used = new Set(state.openOrders.map((o) => o.tableLabel));
    const free = tables.find((t) => !used.has(t));
    const label = free || `Table ${state.openOrders.length + 1}`;
    const order = { orderId: store.uid("order"), tableLabel: label, createdAt: store.nowIso(), items: {} };
    state.openOrders.unshift(order);
    state.selectedOrderId = order.orderId;
    persistOrders();
    renderAll();
    toast("New ticket", label);
  }

  function setSelectedOrderByTableLabel(label) {
    const existing = state.openOrders.find((o) => o.tableLabel === label);
    if (existing) {
      state.selectedOrderId = existing.orderId;
      persistOrders();
      renderAll();
      return;
    }
    // Create new ticket for this table label
    const order = { orderId: store.uid("order"), tableLabel: label, createdAt: store.nowIso(), items: {} };
    state.openOrders.unshift(order);
    state.selectedOrderId = order.orderId;
    persistOrders();
    renderAll();
  }

  function clearSelectedCart() {
    const order = getSelectedOrder();
    if (!order) return;
    order.items = {};
    persistOrders();
    renderCart();
    toast("Cleared", `${order.tableLabel} cart cleared`);
  }

  function buildUpiUri({ upiId, payeeName, amount, note }) {
    // UPI deep link format (common): upi://pay?pa=<upiId>&pn=<name>&am=<amount>&cu=INR&tn=<note>
    const params = new URLSearchParams();
    if (upiId) params.set("pa", upiId);
    if (payeeName) params.set("pn", payeeName);
    if (amount != null) params.set("am", (Number(amount) || 0).toFixed(2));
    params.set("cu", "INR");
    if (note) params.set("tn", note);
    return `upi://pay?${params.toString()}`;
  }

  function openPayModal() {
    const order = getSelectedOrder();
    if (!order) return;
    const lineItems = buildLineItems(order);
    const totals = store.computeTotals(lineItems);
    if (totals.total <= 0) {
      toast("Nothing to pay", "Cart is empty.");
      return;
    }

    const uri = buildUpiUri({
      upiId: state.settings.upiId || "",
      payeeName: state.settings.payeeName || state.settings.shopName || "Restaurant",
      amount: totals.total,
      note: `${order.tableLabel} ${new Date().toLocaleDateString()}`,
    });

    payModalMeta.textContent = `${order.tableLabel} · Total ${fmtMoney(totals.total)}`;
    upiText.textContent = state.settings.upiId ? `UPI: ${state.settings.upiId}` : "Set UPI ID in Admin → Settings";

    if (window.SimpleQR && typeof window.SimpleQR.drawToCanvas === "function") {
      window.SimpleQR.drawToCanvas(qrCanvas, uri);
    } else {
      const ctx = qrCanvas.getContext("2d");
      ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
      ctx.fillStyle = "#000000";
      ctx.font = "12px monospace";
      ctx.fillText("QR lib missing", 10, 30);
    }

    payModal.dataset.upiUri = uri;
    payModal.showModal();
  }

  function closeTicketAsPaid() {
    const order = getSelectedOrder();
    if (!order) return;

    const lineItems = buildLineItems(order);
    const totals = store.computeTotals(lineItems);
    if (totals.total <= 0) return;

    store.appendSale({
      orderId: order.orderId,
      tableLabel: order.tableLabel,
      timestamp: store.nowIso(),
      lineItems,
      totals,
      payment: { method: "UPI_QR", ref: null },
    });

    // Remove from open orders
    state.openOrders = state.openOrders.filter((o) => o.orderId !== order.orderId);
    if (state.openOrders.length) state.selectedOrderId = state.openOrders[0].orderId;
    else state.selectedOrderId = null;
    persistOrders();

    toast("Paid", `${order.tableLabel} closed`);
    renderAll();
  }

  function buildReceiptHtml(order) {
    const lineItems = buildLineItems(order);
    const totals = store.computeTotals(lineItems);
    const shop = state.settings.shopName || "Restaurant";
    const when = new Date().toLocaleString();

    const itemsHtml = lineItems
      .map((li) => {
        const amount = store.moneyRound(li.price * li.qty);
        return `
          <div class="receipt__item">
            <div class="receipt__itemName">${escapeHtml(li.name)} x${li.qty}</div>
            <div>${escapeHtml(fmtMoney(amount))}</div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="receipt">
        <div class="receipt__title">${escapeHtml(shop)}</div>
        <div class="receipt__meta">${escapeHtml(order.tableLabel)} · ${escapeHtml(when)}</div>
        <div class="receipt__hr"></div>
        <div class="receipt__items">${itemsHtml || ""}</div>
        <div class="receipt__hr"></div>
        <div class="receipt__row"><div>Subtotal</div><div>${escapeHtml(fmtMoney(totals.subtotal))}</div></div>
        <div class="receipt__row receipt__row--bold"><div>Total</div><div>${escapeHtml(fmtMoney(totals.total))}</div></div>
        <div class="receipt__hr"></div>
        <div class="receipt__meta">Thank you!</div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function printBill() {
    const order = getSelectedOrder();
    if (!order) return;
    const lineItems = buildLineItems(order);
    if (lineItems.length === 0) {
      toast("Nothing to print", "Cart is empty.");
      return;
    }
    receiptPrint.innerHTML = buildReceiptHtml(order);
    window.print();
  }

  function wireEvents() {
    newTicketBtn.addEventListener("click", createNewTicket);
    tableSelectEl.addEventListener("change", (e) => setSelectedOrderByTableLabel(e.target.value));
    clearCartBtn.addEventListener("click", clearSelectedCart);
    payNowBtn.addEventListener("click", openPayModal);
    printBillBtn.addEventListener("click", printBill);
    markPaidBtn.addEventListener("click", (e) => {
      // form method=dialog closes automatically; we still run logic
      e.preventDefault();
      closeTicketAsPaid();
      try {
        payModal.close();
      } catch {
        // ignore
      }
    });
  }

  function renderAll() {
    state.settings = store.getSettings();
    shopNameEl.textContent = state.settings.shopName || "Restaurant";
    state.openOrders = store.getOpenOrders();
    state.selectedOrderId = store.getSelectedOrderId();
    ensureTicketsFromTables();
    ensureSelectedTicket();
    renderTableSelect();
    renderOpenTickets();
    renderMenu();
    renderCart();
  }

  wireEvents();
  renderAll();
})();

