
"use strict";

const KEY = "minbudget_v3";
const OLD_V2 = "minbudget_v2";
const OLD_V1 = "minbudget_v1";

const $ = id => document.getElementById(id);

const categories = {
  behov: { name: "Behov", percent: 50, color: "#167c80" },
  onskemal: { name: "Önskemål", percent: 30, color: "#e88b43" },
  framtid: { name: "Framtid", percent: 20, color: "#3e956a" }
};

const types = {
  fast: "Fast kostnad",
  rorlig: "Rörlig kostnad",
  lan: "Lån",
  sparande: "Sparande"
};

const money = n => new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK"
}).format(n);

const uid = () => crypto.randomUUID();

function today() {
  const d = new Date();
  return dateString(d);
}

function dateString(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) {
    return null;
  }
  const d = new Date(s + "T12:00:00");
  return !Number.isNaN(d.getTime()) &&
    dateString(d) === s ? d : null;
}

function addDays(s, days) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return dateString(d);
}

function paydayDate(year, month, day) {
  const last = new Date(year, month, 0).getDate();
  return dateString(
    new Date(year, month - 1, Math.min(day, last))
  );
}

function nextPayday(start, day) {
  const d = parseDate(start);
  return paydayDate(
    d.getMonth() === 11
      ? d.getFullYear() + 1 : d.getFullYear(),
    d.getMonth() === 11 ? 1 : d.getMonth() + 2,
    day
  );
}

function periodForDate(date, day) {
  const d = parseDate(date);
  let start = paydayDate(
    d.getFullYear(), d.getMonth() + 1, day
  );

  if (start > date) {
    const previous = new Date(
      d.getFullYear(), d.getMonth() - 1, 1
    );
    start = paydayDate(
      previous.getFullYear(),
      previous.getMonth() + 1,
      day
    );
  }

  return {
    start,
    end: addDays(nextPayday(start, day), -1)
  };
}

function cleanEntry(e) {
  return {
    id: String(e.id || uid()),
    name: String(e.name || "").trim(),
    amount: Number(e.amount),
    category: e.category,
    type: e.type,
    paid: e.paid === true,
    due: e.due || ""
  };
}

function validate(raw) {
  if (!raw || !Array.isArray(raw.periods) ||
      !Number.isInteger(raw.payday) ||
      raw.payday < 1 || raw.payday > 31) {
    throw new Error("Ogiltigt dataformat");
  }

  const ids = new Set();

  const periods = raw.periods.map(p => {
    if (!p || !parseDate(p.start) ||
        !parseDate(p.end) ||
        p.end < p.start ||
        !Array.isArray(p.expenses) ||
        !Number.isFinite(Number(p.income)) ||
        Number(p.income) < 0) {
      throw new Error("Ogiltig löneperiod");
    }

    const id = String(p.id || uid());
    if (ids.has(id)) throw new Error("Dubbla period-ID");
    ids.add(id);

    const expenses = p.expenses.map(e => {
      const item = cleanEntry(e);
      if (!item.name ||
          !Number.isFinite(item.amount) ||
          item.amount <= 0 ||
          !categories[item.category] ||
          !types[item.type] ||
          (item.due && !parseDate(item.due))) {
        throw new Error("Ogiltig kostnad");
      }
      return item;
    });

    return {
      id,
      start: p.start,
      end: p.end,
      income: Number(p.income),
      expenses
    };
  });

  periods.sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start <= periods[i - 1].end) {
      throw new Error("Löneperioder överlappar");
    }
  }

  return { payday: raw.payday, periods };
}

function migrate() {
  const result = { payday: 20, periods: [] };
  const raw2 = localStorage.getItem(OLD_V2);

  if (raw2) {
    const old = JSON.parse(raw2);
    if (!old.months || typeof old.months !== "object") {
      throw new Error("Kan inte läsa version 2");
    }

    // Gamla kalendermånader bevaras som egna
    // historiska perioder utan att ändra beloppen.
    for (const [month, m] of Object.entries(old.months)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Ogiltig gammal månad");
      }

      const [y, n] = month.split("-").map(Number);
      result.periods.push({
        id: uid(),
        start: month + "-01",
        end: dateString(new Date(y, n, 0)),
        income: Number(m.income) || 0,
        expenses: (m.expenses || []).map(e => ({
          ...e,
          paid: false,
          due: ""
        }))
      });
    }
    return validate(result);
  }

  const raw1 = localStorage.getItem(OLD_V1);
  if (raw1) {
    const old = JSON.parse(raw1);
    if (!Array.isArray(old.expenses)) {
      throw new Error("Kan inte läsa version 1");
    }

    const dates = periodForDate(today(), 20);
    result.periods.push({
      id: uid(),
      ...dates,
      income: Number(old.income) || 0,
      expenses: old.expenses.map(e => ({
        ...e,
        paid: false,
        due: ""
      }))
    });
  }

  return validate(result);
}

function load() {
  const saved = localStorage.getItem(KEY);
  return saved ? validate(JSON.parse(saved)) : migrate();
}

let data;

try {
  data = load();
} catch (error) {
  alert(
    "Kunde inte läsa tidigare uppgifter. " +
    "Ingen data har skrivits över. " +
    "Kontrollera säkerhetskopian."
  );
  throw error;
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function createInitialPeriod() {
  if (data.periods.length) return;

  const dates = periodForDate(today(), data.payday);
  data.periods.push({
    id: uid(),
    ...dates,
    income: 0,
    expenses: []
  });
  save();
}

createInitialPeriod();

let selectedId =
  data.periods.find(p =>
    p.start <= today() && p.end >= today()
  )?.id || data.periods[data.periods.length - 1].id;

let editingId = null;

const expanded = {
  behov: true,
  onskemal: true,
  framtid: true
};

function currentPeriod() {
  return data.periods.find(p => p.id === selectedId);
}

function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function periodLabel(start) {
  const d = parseDate(start);
  return new Intl.DateTimeFormat("sv-SE", {
    month: "long",
    year: "numeric"
  }).format(d);
}

function renderHeader() {
  const p = currentPeriod();

  $("periodTitle").textContent = periodLabel(p.start);
  $("periodDates").textContent =
    `${p.start} – ${p.end}`;

  $("payday").value = String(data.payday);
  $("periodStart").value = p.start;
  $("periodEnd").value = p.end;
  $("income").value = p.income || "";

  const index = data.periods.findIndex(
    item => item.id === selectedId
  );

  $("prevPeriod").disabled = index === 0;
  $("nextPeriod").disabled =
    index === data.periods.length - 1;
}

function renderTotals() {
  const p = currentPeriod();

  const total = p.expenses.reduce(
    (s, e) => s + e.amount, 0
  );

  const paid = p.expenses
    .filter(e => e.paid)
    .reduce((s, e) => s + e.amount, 0);

  const unpaid = total - paid;
  const available = p.income - total;

  $("totalIncome").textContent = money(p.income);
  $("totalExpenses").textContent = money(total);
  $("available").textContent = money(available);

  $("paidTotal").textContent = money(paid);
  $("unpaidTotal").textContent = money(unpaid);
  $("balanceAfterPaid").textContent =
    money(p.income - paid);

  $("available").classList.toggle(
    "negative", available < 0
  );
}

function renderCategories() {
  const p = currentPeriod();
  const container = $("categories");
  container.replaceChildren();

  for (const [key, category] of Object.entries(categories)) {
    const items = p.expenses.filter(
      e => e.category === key
    );

    const spent = items.reduce(
      (s, e) => s + e.amount, 0
    );

    const target = p.income * category.percent / 100;
    const usage = target > 0
      ? Math.min(100, spent / target * 100)
      : spent > 0 ? 100 : 0;

    const wrapper = element("div", "", "category");
    const heading = element(
      "button", "", "category-heading"
    );

    heading.type = "button";
    heading.setAttribute(
      "aria-expanded", String(expanded[key])
    );

    heading.append(
      element("span", `${category.percent}% – ${category.name}`),
      element("strong",
        `${money(spent)} ${expanded[key] ? "⌃" : "⌄"}`)
    );

    heading.onclick = () => {
      expanded[key] = !expanded[key];
      renderCategories();
    };

    const description = element(
      "small",
      `Riktmärke: ${money(target)} • ` +
      `Kvar: ${money(target - spent)}`
    );

    const bar = element("div", "", "progress");
    const fill = element("div", "", "progress-fill");
    fill.style.width = usage + "%";
    fill.style.background = category.color;
    bar.append(fill);

    wrapper.append(heading, description, bar);

    if (expanded[key]) {
      const list = element("div", "", "category-items");

      if (!items.length) {
        list.append(
          element("p", "Inga poster ännu.", "muted small")
        );
      }

      items.forEach(item => {
        const row = element(
          "div", "", "category-item"
        );

        row.append(
          element("span",
            `${item.paid ? "✓" : "○"} ${item.name}`),
          element("strong", money(item.amount))
        );

        list.append(row);
      });

      wrapper.append(list);
    }

    container.append(wrapper);
  }
}

function resetForm() {
  editingId = null;
  $("expenseForm").reset();
  $("formTitle").textContent = "➕ Lägg till en post";
  $("saveExpense").textContent = "+ Lägg till";
  $("cancelEdit").classList.add("hidden");
}

function startEdit(id) {
  const item = currentPeriod().expenses.find(
    e => e.id === id
  );

  if (!item) return;

  editingId = id;
  $("expenseName").value = item.name;
  $("expenseAmount").value = item.amount;
  $("expenseCategory").value = item.category;
  $("expenseType").value = item.type;
  $("expenseDue").value = item.due;
  $("expensePaid").checked = item.paid;

  $("formTitle").textContent = "✏️ Redigera post";
  $("saveExpense").textContent = "Spara ändringar";
  $("cancelEdit").classList.remove("hidden");

  $("entrySection").scrollIntoView({
    behavior: "smooth"
  });
}

function renderExpenses() {
  const list = $("expenseList");
  list.replaceChildren();

  const expenses = currentPeriod().expenses;

  if (!expenses.length) {
    list.append(
      element("p", "Inga poster registrerade.", "empty")
    );
    return;
  }

  expenses.forEach(item => {
    const row = element("div", "", "expense");
    const info = element("div", "", "expense-info");

    info.append(
      element("strong", item.name),
      element("small",
        `${categories[item.category].name} • ${types[item.type]}`),
      element("small",
        item.due ? `Betalningsdatum: ${item.due}` : "")
    );

    const actions = element(
      "div", "", "expense-actions"
    );

    const paid = element(
      "button",
      item.paid ? "✓ Betald" : "○ Obetald",
      item.paid ? "paid-btn" : "unpaid-btn"
    );

    paid.type = "button";
    paid.onclick = () => {
      item.paid = !item.paid;
      save();
      render();
    };

    const edit = element("button", "✎", "edit-btn");
    edit.type = "button";
    edit.setAttribute("aria-label", "Redigera " + item.name);
    edit.onclick = () => startEdit(item.id);

    const remove = element(
      "button", "✕", "delete-btn"
    );

    remove.type = "button";
    remove.setAttribute("aria-label", "Ta bort " + item.name);

    remove.onclick = () => {
      if (!confirm(`Ta bort "${item.name}"?`)) return;

      currentPeriod().expenses =
        currentPeriod().expenses.filter(
          e => e.id !== item.id
        );

      save();
      resetForm();
      render();
    };

    actions.append(
      element("strong", money(item.amount)),
      paid, edit, remove
    );

    row.append(info, actions);
    list.append(row);
  });
}

function render() {
  renderHeader();
  renderTotals();
  renderCategories();
  renderExpenses();
}

// Välj lönedag

for (let day = 1; day <= 31; day++) {
  const option = element("option", `Den ${day}:e`);
  option.value = day;
  $("payday").append(option);
}

$("payday").onchange = () => {
  data.payday = Number($("payday").value);
  save();
  alert(
    "Lönedagen har sparats. " +
    "Befintliga perioder ändras inte automatiskt."
  );
};

// Ändra periodens datum

$("saveDates").onclick = () => {
  const start = $("periodStart").value;
  const end = $("periodEnd").value;

  if (!parseDate(start) || !parseDate(end) || end < start) {
    alert("Kontrollera datumen.");
    return;
  }

  const overlap = data.periods.some(p =>
    p.id !== selectedId &&
    start <= p.end && end >= p.start
  );

  if (overlap) {
    alert("Datumen överlappar en annan löneperiod.");
    return;
  }

  const p = currentPeriod();
  p.start = start;
  p.end = end;

  data.periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  save();
  render();
};

// Byt mellan befintliga perioder

function navigate(direction) {
  const index = data.periods.findIndex(
    p => p.id === selectedId
  );

  const next = data.periods[index + direction];
  if (!next) return;

  selectedId = next.id;
  resetForm();
  render();
}

$("prevPeriod").onclick = () => navigate(-1);
$("nextPeriod").onclick = () => navigate(1);

// Ändra inkomst

$("income").onchange = () => {
  const value = Number($("income").value);

  if (!Number.isFinite(value) || value < 0) {
    alert("Ange en giltig inkomst.");
    render();
    return;
  }

  currentPeriod().income = value;
  save();
  render();
};

// Lägg till och redigera poster

$("expenseForm").onsubmit = event => {
  event.preventDefault();

  const name = $("expenseName").value.trim();
  const amount = Number($("expenseAmount").value);
  const category = $("expenseCategory").value;
  const type = $("expenseType").value;
  const due = $("expenseDue").value;
  const paid = $("expensePaid").checked;

  if (!name || !Number.isFinite(amount) ||
      amount <= 0 || !categories[category] ||
      !types[type] || (due && !parseDate(due))) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  const values = {
    name, amount, category, type, due, paid
  };

  if (editingId) {
    const item = currentPeriod().expenses.find(
      e => e.id === editingId
    );
    if (item) Object.assign(item, values);
  } else {
    currentPeriod().expenses.push({
      id: uid(), ...values
    });
  }

  save();
  resetForm();
  render();
};

$("cancelEdit").onclick = resetForm;

// Manuell kopiering

$("createPeriod").onclick = () => {
  const source = currentPeriod();

  $("newStart").value =
    addDays(source.end, 1);

  $("copyIncome").checked = true;
  $("copyList").replaceChildren();

  source.expenses.forEach(item => {
    const label = element("label", "", "check-row");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.checked =
      item.type === "fast" || item.type === "lan";

    label.append(
      checkbox,
      element("span", `${item.name} – ${money(item.amount)}`)
    );

    $("copyList").append(label);
  });

  $("copyDialog").showModal();
};

$("cancelCopy").onclick = () => {
  $("copyDialog").close();
};

$("confirmCopy").onclick = () => {
  const start = $("newStart").value;

  if (!parseDate(start)) {
    alert("Välj ett giltigt lönedatum.");
    return;
  }

  const source = currentPeriod();

  if (start <= source.end) {
    alert("Nästa period måste börja efter den nuvarande.");
    return;
  }

  const end = addDays(
    nextPayday(start, data.payday), -1
  );

  if (end < start) {
    alert("Kontrollera lönedatumet.");
    return;
  }

  if (data.periods.some(p =>
    start <= p.end && end >= p.start
  )) {
    alert(
      "Perioden överlappar en befintlig period. " +
      "Justera datumen först."
    );
    return;
  }

  const ids = new Set(
    [...$("copyList").querySelectorAll(
      'input[type="checkbox"]:checked'
    )].map(input => input.value)
  );

  const expenses = source.expenses
    .filter(item => ids.has(item.id))
    .map(item => ({
      ...item,
      id: uid(),
      paid: false,
      due: ""
    }));

  const next = {
    id: uid(),
    start,
    end,
    income: $("copyIncome").checked
      ? source.income : 0,
    expenses
  };

  data.periods.push(next);
  data.periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  selectedId = next.id;
  save();
  resetForm();
  $("copyDialog").close();
  render();
};

// Säkerhetskopiering

$("exportData").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `minbudget-backup-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$("importFile").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const imported = validate(
      JSON.parse(await file.text())
    );

    if (!imported.periods.length) {
      throw new Error("Säkerhetskopian är tom");
    }

    if (!confirm(
      "Alla nuvarande uppgifter ersätts. Fortsätta?"
    )) return;

    localStorage.setItem(
      KEY, JSON.stringify(imported)
    );

    data = imported;
    selectedId = data.periods[0].id;
    resetForm();
    render();

    alert("Säkerhetskopian är återställd.");
  } catch (error) {
    console.error(error);
    alert("Kunde inte läsa säkerhetskopian.");
  } finally {
    event.target.value = "";
  }
};

render();
