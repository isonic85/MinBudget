
"use strict";

const STORAGE_KEY = "minbudget_v4";
const $ = id => document.getElementById(id);

const categoryInfo = {
  behov: { name: "Behov", percent: 50, color: "#167c80" },
  onskemal: { name: "Önskemål", percent: 30, color: "#e88b43" },
  framtid: { name: "Framtid", percent: 20, color: "#3e956a" }
};

const typeNames = {
  fast: "Fast kostnad",
  rorlig: "Rörlig kostnad",
  lan: "Lån",
  sparande: "Sparande"
};

const money = value => new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 2
}).format(value);

const uid = () => crypto.randomUUID();

function dateString(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function today() {
  return dateString(new Date());
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const d = new Date(value + "T12:00:00");
  return !Number.isNaN(d.getTime()) &&
    dateString(d) === value ? d : null;
}

function addDays(value, count) {
  const date = parseDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + count);
  return dateString(date);
}

function paydayInMonth(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate();
  return dateString(
    new Date(year, month - 1, Math.min(day, lastDay))
  );
}

function nextPayday(start, payday) {
  const date = parseDate(start);
  const month = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    1
  );

  return paydayInMonth(
    month.getFullYear(),
    month.getMonth() + 1,
    payday
  );
}

function periodAround(date, payday) {
  const d = parseDate(date);
  let start = paydayInMonth(
    d.getFullYear(),
    d.getMonth() + 1,
    payday
  );

  if (start > date) {
    const previous = new Date(
      d.getFullYear(), d.getMonth() - 1, 1
    );

    start = paydayInMonth(
      previous.getFullYear(),
      previous.getMonth() + 1,
      payday
    );
  }

  return {
    start,
    end: addDays(nextPayday(start, payday), -1)
  };
}

function makePeriod(start, end, income = 0, expenses = []) {
  return {
    id: uid(),
    start,
    end,
    income,
    expenses
  };
}

function normalizeExpense(item) {
  return {
    id: String(item.id || uid()),
    name: String(item.name || "").trim(),
    amount: Number(item.amount),
    category: item.category,
    type: item.type,
    paid: item.paid === true,
    due: item.due || ""
  };
}

function validateData(raw) {
  if (!raw ||
      !Number.isInteger(raw.payday) ||
      raw.payday < 1 ||
      raw.payday > 31 ||
      !Array.isArray(raw.periods)) {
    throw new Error("Ogiltigt dataformat");
  }

  const periods = raw.periods.map(period => {
    if (!period ||
        !parseDate(period.start) ||
        !parseDate(period.end) ||
        period.end < period.start ||
        !Number.isFinite(Number(period.income)) ||
        Number(period.income) < 0 ||
        !Array.isArray(period.expenses)) {
      throw new Error("Ogiltig löneperiod");
    }

    const expenses = period.expenses.map(item => {
      const e = normalizeExpense(item);

      if (!e.name ||
          !Number.isFinite(e.amount) ||
          e.amount <= 0 ||
          !categoryInfo[e.category] ||
          !typeNames[e.type] ||
          (e.due && !parseDate(e.due))) {
        throw new Error("Ogiltig kostnad");
      }

      return e;
    });

    return {
      id: String(period.id || uid()),
      start: period.start,
      end: period.end,
      income: Number(period.income),
      expenses
    };
  });

  periods.sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start <= periods[i - 1].end) {
      throw new Error("Löneperioder överlappar");
    }
  }

  const ids = periods.map(p => p.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Dubbla period-ID");
  }

  return { payday: raw.payday, periods };
}

function migrateOldData() {
  const v3 = localStorage.getItem("minbudget_v3");

  if (v3) {
    return validateData(JSON.parse(v3));
  }

  const v2 = localStorage.getItem("minbudget_v2");

  if (v2) {
    const old = JSON.parse(v2);

    if (!old.months ||
        typeof old.months !== "object" ||
        Array.isArray(old.months)) {
      throw new Error("Ogiltig version 2");
    }

    const periods = Object.entries(old.months).map(
      ([month, values]) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
            !values ||
            !Array.isArray(values.expenses)) {
          throw new Error("Ogiltig gammal månad");
        }

        const [year, number] = month.split("-").map(Number);
        const end = dateString(new Date(year, number, 0));

        return makePeriod(
          month + "-01",
          end,
          Number(values.income),
          values.expenses.map(e => ({
            ...e,
            paid: false,
            due: ""
          }))
        );
      }
    );

    return validateData({ payday: 20, periods });
  }

  const v1 = localStorage.getItem("minbudget_v1");

  if (v1) {
    const old = JSON.parse(v1);

    if (!Array.isArray(old.expenses)) {
      throw new Error("Ogiltig version 1");
    }

    const dates = periodAround(today(), 20);

    return validateData({
      payday: 20,
      periods: [
        makePeriod(
          dates.start,
          dates.end,
          Number(old.income),
          old.expenses.map(e => ({
            ...e,
            paid: false,
            due: ""
          }))
        )
      ]
    });
  }

  return {
    payday: 20,
    periods: []
  };
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved) {
    return validateData(JSON.parse(saved));
  }

  const migrated = migrateOldData();

  // Spara ny version utan att radera gamla.
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(migrated)
  );

  return migrated;
}

let data;

try {
  data = loadData();
} catch (error) {
  console.error(error);
  alert(
    "Kunde inte läsa dina tidigare uppgifter. " +
    "Ingenting har raderats eller skrivits över. " +
    "Kontrollera säkerhetskopian innan du fortsätter."
  );
  throw error;
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(data)
    );
  } catch (error) {
    alert("Kunde inte spara uppgifterna.");
    throw error;
  }
}

if (data.periods.length === 0) {
  const dates = periodAround(today(), data.payday);

  data.periods.push(
    makePeriod(dates.start, dates.end)
  );

  save();
}

let selectedId =
  data.periods.find(p =>
    p.start <= today() && p.end >= today()
  )?.id || data.periods[data.periods.length - 1].id;

let editingId = null;

const expanded = {
  behov: false,
  onskemal: false,
  framtid: false
};

function currentPeriod() {
  return data.periods.find(p => p.id === selectedId);
}

function el(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function periodName(start) {
  return new Intl.DateTimeFormat("sv-SE", {
    month: "long",
    year: "numeric"
  }).format(parseDate(start));
}

function formatDate(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short"
  }).format(parseDate(date));
}

function totals() {
  const p = currentPeriod();

  const planned = p.expenses.reduce(
    (sum, item) => sum + item.amount, 0
  );

  const paid = p.expenses
    .filter(item => item.paid)
    .reduce((sum, item) => sum + item.amount, 0);

  return {
    planned,
    paid,
    unpaid: planned - paid,
    available: p.income - planned
  };
}

function renderOverview() {
  const p = currentPeriod();
  const t = totals();

  $("periodName").textContent = periodName(p.start);
  $("periodDates").textContent =
    formatDate(p.start) + " – " +
    formatDate(p.end) + " " +
    parseDate(p.end).getFullYear();

  $("available").textContent = money(t.available);
  $("available").classList.toggle(
    "negative", t.available < 0
  );

  $("paidTotal").textContent = money(t.paid);
  $("unpaidTotal").textContent = money(t.unpaid);

  const index = data.periods.findIndex(
    p => p.id === selectedId
  );

  $("prevPeriod").disabled = index <= 0;
  $("nextPeriod").disabled =
    index >= data.periods.length - 1;
}

function editExpense(id) {
  const item = currentPeriod().expenses.find(
    e => e.id === id
  );

  if (!item) return;

  editingId = id;

  $("expenseDialogTitle").textContent = "Redigera kostnad";
  $("expenseName").value = item.name;
  $("expenseAmount").value = item.amount;
  $("expenseCategory").value = item.category;
  $("expenseType").value = item.type;
  $("expenseDue").value = item.due;
  $("expensePaid").checked = item.paid;
  $("deleteExpense").classList.remove("hidden");

  $("expenseDialog").showModal();
}

function renderCategories() {
  const container = $("categories");
  container.replaceChildren();

  const p = currentPeriod();

  for (const [key, category] of Object.entries(categoryInfo)) {
    const items = p.expenses.filter(
      item => item.category === key
    );

    const sum = items.reduce(
      (total, item) => total + item.amount, 0
    );

    const target = p.income * category.percent / 100;
    const percentage = target > 0
      ? Math.min(100, sum / target * 100)
      : sum > 0 ? 100 : 0;

    const wrapper = el("div", "", "category");
    const toggle = el("button", "", "category-toggle");

    toggle.type = "button";
    toggle.setAttribute(
      "aria-expanded", String(expanded[key])
    );

    const title = el("div", "", "category-title");
    const dot = el("span", "", "dot");
    dot.style.background = category.color;

    title.append(
      dot,
      el("strong", category.name),
      el("small", category.percent + " %")
    );

    const value = el("div", "", "category-value");
    value.append(
      el("span", money(sum)),
      el("span", expanded[key] ? "⌃" : "⌄", "chevron")
    );

    toggle.append(title, value);
    toggle.onclick = () => {
      expanded[key] = !expanded[key];
      renderCategories();
    };

    const progress = el("div", "", "progress");
    const fill = el("div", "", "progress-fill");

    fill.style.width = percentage + "%";
    fill.style.background = category.color;
    progress.append(fill);

    wrapper.append(toggle, progress);

    if (expanded[key]) {
      const detail = el("div", "", "category-detail");

      if (items.length === 0) {
        detail.append(
          el("p", "Inga kostnader ännu.", "empty")
        );
      }

      items.forEach(item => {
        const row = el("div", "", "category-item");
        const info = el("div", "", "item-info");

        info.append(
          el("strong", item.name),
          el("small",
            typeNames[item.type] +
            (item.due ? " • " + formatDate(item.due) : "")
          )
        );

        const actions = el("div", "", "item-actions");
        const paidButton = el(
          "button",
          item.paid ? "✓ Betald" : "○ Obetald",
          "paid-toggle" + (item.paid ? " is-paid" : "")
        );

        paidButton.type = "button";
        paidButton.setAttribute(
          "aria-label",
          "Ändra betalningsstatus för " + item.name
        );

        paidButton.onclick = () => {
          item.paid = !item.paid;
          save();
          render();
        };

        const editButton = el("button", "✎", "edit-btn");
        editButton.type = "button";
        editButton.setAttribute(
          "aria-label", "Redigera " + item.name
        );
        editButton.onclick = () => editExpense(item.id);

        actions.append(
          el("strong", money(item.amount)),
          paidButton,
          editButton
        );

        row.append(info, actions);
        detail.append(row);
      });

      wrapper.append(detail);
    }

    container.append(wrapper);
  }
}

function render() {
  renderOverview();
  renderCategories();
}

function closeExpense() {
  editingId = null;
  $("expenseForm").reset();
  $("deleteExpense").classList.add("hidden");
  $("expenseDialog").close();
}

$("addBtn").onclick = () => {
  editingId = null;
  $("expenseForm").reset();
  $("expenseDialogTitle").textContent =
    "Lägg till kostnad";
  $("deleteExpense").classList.add("hidden");
  $("expenseDialog").showModal();
};

$("cancelExpense").onclick = closeExpense;

$("expenseForm").onsubmit = event => {
  event.preventDefault();

  const name = $("expenseName").value.trim();
  const amount = Number($("expenseAmount").value);
  const category = $("expenseCategory").value;
  const type = $("expenseType").value;
  const due = $("expenseDue").value;
  const paid = $("expensePaid").checked;

  if (!name ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !categoryInfo[category] ||
      !typeNames[type] ||
      (due && !parseDate(due))) {
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
  closeExpense();
  render();
};

$("deleteExpense").onclick = () => {
  if (!editingId) return;

  if (!confirm("Vill du ta bort kostnaden?")) return;

  currentPeriod().expenses =
    currentPeriod().expenses.filter(
      e => e.id !== editingId
    );

  save();
  closeExpense();
  render();
};

function navigate(direction) {
  const index = data.periods.findIndex(
    p => p.id === selectedId
  );

  const next = data.periods[index + direction];
  if (!next) return;

  selectedId = next.id;
  render();
}

$("prevPeriod").onclick = () => navigate(-1);
$("nextPeriod").onclick = () => navigate(1);

// Inställningar

for (let day = 1; day <= 31; day++) {
  const option = el("option", "Den " + day + ":e");
  option.value = day;
  $("payday").append(option);
}

$("settingsBtn").onclick = () => {
  const p = currentPeriod();

  $("income").value = p.income;
  $("payday").value = data.payday;
  $("periodStart").value = p.start;
  $("periodEnd").value = p.end;

  $("settingsDialog").showModal();
};

$("closeSettings").onclick = () => {
  $("settingsDialog").close();
};

$("saveSettings").onclick = () => {
  const income = Number($("income").value);
  const payday = Number($("payday").value);
  const start = $("periodStart").value;
  const end = $("periodEnd").value;

  if (!Number.isFinite(income) ||
      income < 0 ||
      !Number.isInteger(payday) ||
      payday < 1 ||
      payday > 31 ||
      !parseDate(start) ||
      !parseDate(end) ||
      end < start) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  const overlap = data.periods.some(p =>
    p.id !== selectedId &&
    start <= p.end &&
    end >= p.start
  );

  if (overlap) {
    alert("Datumen överlappar en annan period.");
    return;
  }

  const p = currentPeriod();
  const old = {
    income: p.income,
    start: p.start,
    end: p.end,
    payday: data.payday
  };

  p.income = income;
  p.start = start;
  p.end = end;
  data.payday = payday;

  data.periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  try {
    save();
  } catch (error) {
    p.income = old.income;
    p.start = old.start;
    p.end = old.end;
    data.payday = old.payday;
    data.periods.sort(
      (a, b) => a.start.localeCompare(b.start)
    );
    return;
  }

  $("settingsDialog").close();
  render();
};

$("deletePeriod").onclick = () => {
  if (data.periods.length <= 1) {
    alert("Du måste ha minst en löneperiod.");
    return;
  }

  if (!confirm(
    "Ta bort hela löneperioden och alla dess kostnader?"
  )) return;

  data.periods = data.periods.filter(
    p => p.id !== selectedId
  );

  selectedId = data.periods[
    data.periods.length - 1
  ].id;

  save();
  $("settingsDialog").close();
  render();
};

// Skapa ny löneperiod

function suggestNewDates(start) {
  if (!parseDate(start)) return;
  $("newEnd").value = addDays(
    nextPayday(start, data.payday), -1
  );
}

$("newPeriodBtn").onclick = () => {
  const source = currentPeriod();

  $("newStart").value = addDays(source.end, 1);
  suggestNewDates($("newStart").value);

  $("copyIncome").checked = true;
  $("copyList").replaceChildren();

  source.expenses.forEach(item => {
    const label = el("label", "", "check-row");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.checked =
      item.type === "fast" || item.type === "lan";

    label.append(
      checkbox,
      el("span", item.name + " – " + money(item.amount))
    );

    $("copyList").append(label);
  });

  $("periodDialog").showModal();
};

$("newStart").onchange = () => {
  suggestNewDates($("newStart").value);
};

$("cancelPeriod").onclick = () => {
  $("periodDialog").close();
};

$("confirmPeriod").onclick = () => {
  const start = $("newStart").value;
  const end = $("newEnd").value;

  if (!parseDate(start) ||
      !parseDate(end) ||
      end < start) {
    alert("Kontrollera datumen.");
    return;
  }

  const overlap = data.periods.some(p =>
    start <= p.end && end >= p.start
  );

  if (overlap) {
    alert(
      "Den nya perioden överlappar en befintlig. " +
      "Ändra datumen eller justera tidigare period."
    );
    return;
  }

  const selected = new Set(
    [...$("copyList").querySelectorAll(
      'input[type="checkbox"]:checked'
    )].map(input => input.value)
  );

  const source = currentPeriod();

  const copied = source.expenses
    .filter(item => selected.has(item.id))
    .map(item => ({
      ...item,
      id: uid(),
      paid: false,
      due: ""
    }));

  const next = makePeriod(
    start,
    end,
    $("copyIncome").checked ? source.income : 0,
    copied
  );

  data.periods.push(next);
  data.periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  selectedId = next.id;

  save();
  $("periodDialog").close();
  render();
};

// Säkerhetskopiering

$("exportBtn").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "minbudget-" + today() + ".json";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$("importFile").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const imported = validateData(
      JSON.parse(await file.text())
    );

    if (!imported.periods.length) {
      throw new Error("Tom säkerhetskopia");
    }

    if (!confirm(
      "Importen ersätter alla dina nuvarande uppgifter. " +
      "Vill du fortsätta?"
    )) return;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(imported)
    );

    data = imported;
    selectedId = data.periods[
      data.periods.length - 1
    ].id;

    $("settingsDialog").close();
    render();

    alert("Säkerhetskopian har återställts.");
  } catch (error) {
    console.error(error);
    alert("Kunde inte importera säkerhetskopian.");
  } finally {
    event.target.value = "";
  }
};

render();
