// MinBudget – enkel version. Data sparas i webbläsaren (minbudget_v4), samma format som tidigare säkerhetskopior.
(function () {
  "use strict";

  // ---------- data ----------
  const STORAGE_KEY = "minbudget_v4";
  const categories = { behov: "Behov", onskemal: "Tänk efter", framtid: "Framtid" };
  const types = { fast: "Fast kostnad", rorlig: "Rörlig kostnad", lan: "Lån", sparande: "Sparande" };
  const models = { "50/30/20": [50, 30, 20], "60/20/20": [60, 20, 20], "50/20/30": [50, 20, 30], "70/20/10": [70, 20, 10], "80/20": [80, 0, 20] };
  const defaultBudget = { model: "50/30/20", needs: 50, wants: 30, future: 20 };
  const monthNames = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const money = (n) => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(Number(n) || 0);
  const sum = (items) => items.reduce((t, i) => t + Number(i.amount || 0), 0);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- datum ----------
  const dateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function parseDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return null;
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(v, n) { const d = parseDate(v); d.setDate(d.getDate() + n); return dateString(d); }
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  const today = () => dateString(new Date());
  function paydayInMonth(y, m, day) { const last = new Date(y, m + 1, 0).getDate(); return dateString(new Date(y, m, Math.min(day, last))); }
  function periodAround(value, payday) {
    const d = parseDate(value);
    let start = paydayInMonth(d.getFullYear(), d.getMonth(), payday);
    if (start > value) start = paydayInMonth(d.getFullYear(), d.getMonth() - 1, payday);
    const s = parseDate(start);
    return { start, end: addDays(paydayInMonth(s.getFullYear(), s.getMonth() + 1, payday), -1) };
  }
  function shortDate(v) { const d = parseDate(v); return d ? `${d.getDate()} ${monthNames[d.getMonth()].slice(0, 3)}` : ""; }
  function periodName(start) { const d = parseDate(start); const n = monthNames[d.getMonth()]; return n[0].toUpperCase() + n.slice(1) + " " + d.getFullYear(); }

  // ---------- uträkningar ----------
  const isSaving = (e) => e.type === "sparande" || e.category === "framtid";
  function totals(p) {
    const ord = p.expenses.filter((e) => !isSaving(e));
    const sav = p.expenses.filter(isSaving);
    const ordTotal = sum(ord), ordPaid = sum(ord.filter((e) => e.paid));
    const savTotal = sum(sav), savPaid = sum(sav.filter((e) => e.paid));
    const withdrawals = sum(p.withdrawals), extraIncome = sum(p.sales);
    return {
      paid: ordPaid, unpaid: ordTotal - ordPaid, savedNet: savPaid - withdrawals, withdrawals, extraIncome,
      afterBills: p.income + extraIncome - ordTotal - savTotal + withdrawals,
    };
  }
  function dailyBudget(p, now = today()) {
    if (now < p.start) return { active: false, message: "Perioden har inte börjat ännu" };
    if (now > p.end) return { active: false, message: "Perioden är avslutad" };
    const days = daysBetween(now, p.end) + 1;
    return { active: true, amount: totals(p).afterBills / days, days };
  }
  function categorySpend(p) {
    const pct = { behov: p.budget.needs, onskemal: p.budget.wants, framtid: p.budget.future };
    return Object.keys(categories).map((k) => ({ key: k, name: categories[k], used: sum(p.expenses.filter((e) => e.category === k)), limit: (p.income * pct[k]) / 100 }));
  }

  // ---------- lagring ----------
  const makePeriod = (start, end, income = 0, expenses = [], budget = defaultBudget) => ({ id: uid(), start, end, income, expenses, withdrawals: [], sales: [], budget: { ...budget } });
  function validateData(r) {
    if (!r || !Array.isArray(r.periods) || !(Number(r.payday) >= 1 && Number(r.payday) <= 31)) throw new Error("Ogiltig säkerhetskopia");
    const tx = (items) => (items || []).map((i) => ({ id: String(i.id || uid()), name: String(i.name || ""), amount: Number(i.amount), date: i.date || "" }));
    const periods = r.periods.map((p) => {
      if (!parseDate(p.start) || !parseDate(p.end) || !Array.isArray(p.expenses)) throw new Error("Ogiltig löneperiod");
      const b = p.budget || defaultBudget;
      const ok = Math.abs(Number(b.needs) + Number(b.wants) + Number(b.future) - 100) < 0.001;
      return {
        id: String(p.id || uid()), start: p.start, end: p.end, income: Number(p.income) || 0,
        expenses: p.expenses.map((e) => ({
          id: String(e.id || uid()), name: String(e.name || ""), amount: Number(e.amount),
          category: categories[e.category] ? e.category : "behov", type: types[e.type] ? e.type : "fast",
          paid: e.paid === true, due: e.due || "", paidDate: e.paid ? e.paidDate || "" : "",
        })),
        withdrawals: tx(p.withdrawals), sales: tx(p.sales),
        budget: ok ? { model: b.model, needs: +b.needs, wants: +b.wants, future: +b.future } : { ...defaultBudget },
      };
    });
    periods.sort((a, b) => a.start.localeCompare(b.start));
    return { payday: Number(r.payday), periods };
  }
  function freshData() { const { start, end } = periodAround(today(), 25); return { payday: 25, periods: [makePeriod(start, end)] }; }
  function loadData() {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return validateData(JSON.parse(s)); } catch (e) { console.error(e); }
    return freshData();
  }
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  // ---------- tillstånd ----------
  let data = loadData();
  let index = (() => { const t = today(); const i = data.periods.findIndex((p) => p.start <= t && p.end >= t); return i >= 0 ? i : data.periods.length - 1; })();
  let tab = "oversikt";
  let billFilter = "obetalda";
  const period = () => data.periods[index];
  const $ = (s, r = document) => r.querySelector(s);
  const main = $("#main"), sheet = $("#sheet"), sheetBody = $("#sheetBody");

  // ---------- rendering ----------
  function render() {
    const p = period();
    $("#periodName").textContent = periodName(p.start);
    $("#periodDates").textContent = `${shortDate(p.start)} – ${shortDate(p.end)}`;
    $("#prev").disabled = index === 0;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    main.innerHTML = tab === "oversikt" ? overview(p) : tab === "rakningar" ? bills(p) : extra(p);
  }

  function overview(p) {
    if (p.income === 0 && p.expenses.length === 0) {
      return `<div class="hero" style="margin-top:2.5rem;text-align:center;padding:1.5rem">
        <h2 style="font-size:1.5rem">Välkommen 👋</h2>
        <p class="muted" style="margin-top:.5rem">Börja med att fylla i din lön, så räknar vi ut vad du har att leva på.</p>
        <button class="btn lg full" style="margin-top:1.25rem" data-act="settings">Fyll i lön</button></div>`;
    }
    const t = totals(p), d = dailyBudget(p);
    const upcoming = p.expenses.filter((e) => !e.paid).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).slice(0, 3);
    const cats = categorySpend(p).map((c) => {
      const ratio = c.limit > 0 ? Math.min(c.used / c.limit, 1) : c.used > 0 ? 1 : 0;
      const over = c.used - c.limit > 0.5;
      return `<div class="cat"><div class="cat-row"><span><span class="dot ${c.key}"></span>${c.name}</span>
        <span class="num ${over ? "danger" : "muted"}">${money(c.used)} / ${money(c.limit)}</span></div>
        <div class="bar"><div class="${over ? "over" : c.key}" style="width:${ratio * 100}%"></div></div></div>`;
    }).join("");
    return `
      <section class="hero">
        <p class="sm muted">Att leva på per dag</p>
        <p class="display big ${d.active && d.amount < 0 ? "danger" : ""}">${d.active ? money(d.amount) : "–"}</p>
        <p class="sm muted" style="margin-top:.25rem">${d.active ? `${money(t.afterBills)} kvar efter räkningar · ${d.days} ${d.days === 1 ? "dag" : "dagar"} kvar` : d.message}</p>
      </section>
      <div class="grid2">
        <div class="card"><p class="small muted">Kvar att betala</p><p class="display stat-value num">${money(t.unpaid)}</p></div>
        <div class="card"><p class="small muted">Sparat</p><p class="display stat-value num success">${money(t.savedNet)}</p></div>
      </div>
      <section class="card">
        <div class="head"><h2>Fördelning</h2><span class="small muted">${p.budget.needs}/${p.budget.wants}/${p.budget.future}</span></div>
        ${cats}
      </section>
      ${upcoming.length ? `<section class="card">
        <div class="head" style="margin-bottom:.5rem"><h2>Nästa att betala</h2><button class="link" data-act="allbills">Visa alla</button></div>
        <ul class="list">${upcoming.map((e) => `<li><span>${esc(e.name)}${e.due ? `<span class="muted" style="margin-left:.5rem">${shortDate(e.due)}</span>` : ""}</span><span class="num">${money(e.amount)}</span></li>`).join("")}</ul>
      </section>` : ""}`;
  }

  function bills(p) {
    const t = totals(p);
    const items = p.expenses
      .filter((e) => (billFilter === "alla" ? true : billFilter === "betalda" ? e.paid : !e.paid))
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.amount - a.amount);
    const seg = ["obetalda", "betalda", "alla"].map((f) => `<button data-filter="${f}" class="${f === billFilter ? "on" : ""}">${f}</button>`).join("");
    const list = items.length === 0
      ? `<p class="empty">${billFilter === "obetalda" ? "Allt är betalt 🎉" : "Inget här ännu"}</p>`
      : `<ul class="bills">${items.map((e) => `<li>
          <button class="check ${e.paid ? "on" : ""}" data-toggle="${e.id}" aria-label="${e.paid ? "Markera som obetald" : "Markera som betald"}">${e.paid ? "✓" : ""}</button>
          <button class="bill" data-edit="${e.id}">
            <span style="min-width:0"><span class="bill-name ${e.paid ? "paid" : ""}">${esc(e.name)}</span>
            <span class="small muted"><span class="dot ${e.category}" style="width:.375rem;height:.375rem;margin-right:.375rem"></span>${types[e.type]}${e.due ? ` · ${shortDate(e.due)}` : ""}</span></span>
            <span class="num">${money(e.amount)}</span>
          </button></li>`).join("")}</ul>`;
    return `<div class="seg">${seg}</div><p class="sm muted" style="padding:0 .25rem">Betalt ${money(t.paid)} · Kvar ${money(t.unpaid)}</p>${list}`;
  }

  function txList(title, total, items, empty, kind) {
    return `<section class="card">
      <div class="head" style="margin-bottom:0"><h2>${title}</h2><span class="num muted">${money(total)}</span></div>
      ${items.length === 0 ? `<p class="sm muted" style="padding:.75rem 0">${empty}</p>` :
        `<ul class="list" style="margin-top:.5rem">${items.map((i) => `<li><button class="item" data-tx="${kind}" data-id="${i.id}"><span>${esc(i.name)}<span class="muted" style="margin-left:.5rem">${shortDate(i.date)}</span></span><span class="num">${money(i.amount)}</span></button></li>`).join("")}</ul>`}
      <button class="btn sec full" style="margin-top:.5rem;height:2.25rem" data-tx="${kind}">+ Lägg till</button>
    </section>`;
  }
  function extra(p) {
    const t = totals(p);
    return txList("Extra inkomster", t.extraIncome, p.sales, "Inga extra inkomster", "sale") +
      txList("Tagit från sparandet", t.withdrawals, p.withdrawals, "Inga uttag", "withdraw");
  }

  // ---------- sheets ----------
  function openSheet(html, onReady) {
    sheetBody.innerHTML = `<div class="sheet-handle"></div>${html}`;
    if (!sheet.open) sheet.showModal();
    onReady && onReady(sheetBody);
  }
  const closeSheet = () => sheet.close();
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  function formShell(title, inner, canDelete) {
    return `<form id="f"><h2>${title}</h2><div class="sheet-content">${inner}
      <div class="btn-row"><button type="button" class="btn sec" data-close>Avbryt</button><button type="submit" class="btn">Spara</button></div>
      ${canDelete ? `<button type="button" class="btn ghost full" data-delete>Ta bort</button>` : ""}</div></form>`;
  }
  const field = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
  const options = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
  function wire(root, onSubmit, onDelete) {
    $("#f", root).addEventListener("submit", (e) => { e.preventDefault(); onSubmit(new FormData(e.target)); });
    $("[data-close]", root).addEventListener("click", closeSheet);
    const del = $("[data-delete]", root);
    if (del) del.addEventListener("click", onDelete);
    const first = $("input", root); if (first) first.focus();
  }

  function addSheet() {
    const c = (act, ico, t, s) => `<button class="choice" data-choose="${act}"><span class="choice-ico">${ico}</span><span><b>${t}</b><span class="sm muted">${s}</span></span></button>`;
    openSheet(`<h2>Vad vill du lägga till?</h2><div class="choices">
      ${c("expense", "≡", "Kostnad", "Räkning, köp eller sparande")}
      ${c("sale", "↙", "Extra pengar", "T.ex. något du sålt")}
      ${c("withdraw", "↗", "Ta från sparandet", "Flytta tillbaka till kontot")}</div>`, (root) => {
      root.querySelectorAll("[data-choose]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.choose; k === "expense" ? expenseSheet() : txSheet(k);
      }));
    });
  }

  function expenseSheet(item) {
    const f = item || { id: uid(), name: "", amount: "", category: "behov", type: "fast", paid: false, due: "", paidDate: "" };
    openSheet(formShell(item ? "Ändra kostnad" : "Ny kostnad", `
      ${field("Vad gäller det?", `<input name="name" required placeholder="T.ex. Hyra" value="${esc(f.name)}">`)}
      ${field("Belopp (kr)", `<input name="amount" required type="number" inputmode="decimal" min="0.01" step="0.01" value="${f.amount}">`)}
      <div class="grid2">
        ${field("Kategori", `<select name="category">${options(categories, f.category)}</select>`)}
        ${field("Typ", `<select name="type">${options(types, f.type)}</select>`)}
      </div>
      ${field("Förfaller (valfritt)", `<input name="due" type="date" value="${f.due}">`)}
      <label class="checkbox"><input name="paid" type="checkbox" ${f.paid ? "checked" : ""}> Redan betald</label>`, !!item), (root) => {
      wire(root, (fd) => {
        const name = String(fd.get("name")).trim(), amount = Number(fd.get("amount")), paid = fd.get("paid") === "on";
        if (!name || !(amount > 0)) return;
        const e = { ...f, name, amount, category: fd.get("category"), type: fd.get("type"), due: fd.get("due") || "", paid, paidDate: paid ? f.paidDate || today() : "" };
        const list = period().expenses, i = list.findIndex((x) => x.id === e.id);
        i >= 0 ? (list[i] = e) : list.push(e);
        commit();
      }, () => { period().expenses = period().expenses.filter((x) => x.id !== item.id); commit(); });
    });
  }

  function txSheet(kind, item) {
    const sale = kind === "sale", key = sale ? "sales" : "withdrawals";
    const title = sale ? (item ? "Ändra inkomst" : "Extra pengar") : item ? "Ändra uttag" : "Ta från sparandet";
    openSheet(formShell(title, `
      ${sale ? "" : `<p class="sm muted">Pengarna läggs tillbaka på kontot. Det räknas inte som en kostnad.</p>`}
      ${field(sale ? "Vad sålde du?" : "Anledning", `<input name="name" required placeholder="${sale ? "T.ex. Cykel" : "T.ex. Bilreparation"}" value="${esc(item ? item.name : "")}">`)}
      ${field("Belopp (kr)", `<input name="amount" required type="number" inputmode="decimal" min="0.01" step="0.01" value="${item ? item.amount : ""}">`)}
      ${field("Datum", `<input name="date" required type="date" value="${item ? item.date : today()}">`)}`, !!item), (root) => {
      wire(root, (fd) => {
        const name = String(fd.get("name")).trim(), amount = Number(fd.get("amount")), date = fd.get("date");
        if (!name || !(amount > 0) || !date) return;
        const t = { id: item ? item.id : uid(), name, amount, date };
        const list = period()[key], i = list.findIndex((x) => x.id === t.id);
        i >= 0 ? (list[i] = t) : list.push(t);
        commit();
      }, () => { period()[key] = period()[key].filter((x) => x.id !== item.id); commit(); });
    });
  }

  function settingsSheet() {
    const p = period();
    const startModel = p.budget.model in models ? p.budget.model : "custom";
    const modelOpts = Object.keys(models).map((k) => `<option value="${k}" ${k === startModel ? "selected" : ""}>${k}</option>`).join("") +
      `<option value="custom" ${startModel === "custom" ? "selected" : ""}>Egen fördelning</option>`;
    const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === data.payday ? "selected" : ""}>${i + 1}:e</option>`).join("");
    const pctField = (l, n, v) => field(`${l} %`, `<input name="${n}" type="number" min="0" max="100" value="${v}">`);
    openSheet(formShell("Inställningar", `
      ${field("Lön efter skatt (kr)", `<input name="income" type="number" inputmode="decimal" min="0" value="${p.income || ""}">`)}
      <div class="grid2">
        ${field("Lönedag", `<select name="payday">${days}</select>`)}
        ${field("Budgetmodell", `<select name="model" id="model">${modelOpts}</select>`)}
      </div>
      <div id="custom" class="grid3" ${startModel === "custom" ? "" : "hidden"}>
        ${pctField("Behov", "needs", p.budget.needs)}${pctField("Tänk efter", "wants", p.budget.wants)}${pctField("Framtid", "future", p.budget.future)}
        <p id="sumErr" class="sm danger" style="grid-column:span 3" hidden></p>
      </div>
      <details><summary>Mer</summary><div class="inner">
        <button type="button" class="btn outline full" id="export">Ladda ner säkerhetskopia</button>
        <label><span class="muted">Återställ säkerhetskopia (ersätter allt)</span><input type="file" id="import" accept=".json,application/json" style="display:block;margin-top:.25rem;width:100%"></label>
        ${data.periods.length > 1 ? `<button type="button" class="btn ghost full" id="delPeriod">Ta bort den här löneperioden</button>` : ""}
      </div></details>`, false), (root) => {
      const modelSel = $("#model", root), custom = $("#custom", root), err = $("#sumErr", root);
      const pcts = () => modelSel.value === "custom"
        ? ["needs", "wants", "future"].map((n) => Number($(`[name=${n}]`, root).value))
        : models[modelSel.value];
      const check = () => {
        const s = pcts().reduce((a, b) => a + b, 0);
        err.hidden = s === 100 || modelSel.value !== "custom";
        err.textContent = `Summan ska bli 100 % (nu ${s} %)`;
        return s === 100;
      };
      modelSel.addEventListener("change", () => { custom.hidden = modelSel.value !== "custom"; check(); });
      custom.addEventListener("input", check);
      wire(root, (fd) => {
        if (!check()) return;
        const [needs, wants, future] = pcts();
        data.payday = Number(fd.get("payday"));
        p.income = Number(fd.get("income")) || 0;
        p.budget = { model: modelSel.value, needs, wants, future };
        commit();
      });
      $("#export", root).addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        a.download = `minbudget-${today()}.json`;
        a.click();
      });
      $("#import", root).addEventListener("change", async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try { data = validateData(JSON.parse(await file.text())); index = data.periods.length - 1; commit(); }
        catch { alert("Filen kunde inte läsas."); }
      });
      const del = $("#delPeriod", root);
      if (del) del.addEventListener("click", () => {
        if (!confirm("Ta bort den här löneperioden?")) return;
        data.periods.splice(index, 1); index = Math.max(0, index - 1); commit();
      });
    });
  }

  function commit() { save(); closeSheet(); render(); }

  // ---------- händelser ----------
  $("#prev").addEventListener("click", () => { if (index > 0) { index--; render(); } });
  $("#next").addEventListener("click", () => {
    if (index < data.periods.length - 1) { index++; return render(); }
    // ny period: fasta kostnader, lån och sparande följer med (obetalda)
    const last = data.periods[data.periods.length - 1];
    const start = addDays(last.end, 1);
    const { end } = periodAround(start, data.payday);
    const carried = last.expenses.filter((e) => e.type !== "rorlig").map((e) => ({ ...e, id: uid(), paid: false, paidDate: "", due: "" }));
    data.periods.push(makePeriod(start, end, last.income, carried, last.budget));
    index++; save(); render();
  });
  $("#openSettings").addEventListener("click", settingsSheet);
  $("#addBtn").addEventListener("click", addSheet);
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));

  main.addEventListener("click", (e) => {
    const el = e.target.closest("button"); if (!el) return;
    const p = period();
    if (el.dataset.act === "settings") return settingsSheet();
    if (el.dataset.act === "allbills") { tab = "rakningar"; return render(); }
    if (el.dataset.filter) { billFilter = el.dataset.filter; return render(); }
    if (el.dataset.toggle) {
      const x = p.expenses.find((i) => i.id === el.dataset.toggle);
      x.paid = !x.paid; x.paidDate = x.paid ? today() : ""; save(); return render();
    }
    if (el.dataset.edit) return expenseSheet(p.expenses.find((i) => i.id === el.dataset.edit));
    if (el.dataset.tx) {
      const list = el.dataset.tx === "sale" ? p.sales : p.withdrawals;
      return txSheet(el.dataset.tx, el.dataset.id ? list.find((i) => i.id === el.dataset.id) : undefined);
    }
  });

  render();
})();
