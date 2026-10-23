
"use strict";

const STORAGE_KEY = "minbudget_v4";
const $ = id => document.getElementById(id);

const categoryInfo = {
  behov: {
    name: "Behov",
    percent: 50,
    color: "#65b8af"
  },
  onskemal: {
    name: "Tänk efter",
    percent: 30,
    color: "#e5a267"
  },
  framtid: {
    name: "Framtid",
    percent: 20,
    color: "#80c99b"
  }
};

const typeNames = {
  fast: "Fast kostnad",
  rorlig: "Rörlig kostnad",
  lan: "Lån",
  sparande: "Sparande"
};

const money = value =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2
  }).format(value);

const uid = () =>
  typeof crypto !== "undefined" &&
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Date.now().toString(36) +
      Math.random().toString(36).slice(2);

function dateString(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function today() {
  return dateString(new Date());
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return null;
  }

  const date = new Date(value + "T12:00:00");

  return !Number.isNaN(date.getTime()) &&
    dateString(date) === value
      ? date
      : null;
}

function addDays(value, count) {
  const date = parseDate(value);
  if (!date) return null;

  date.setDate(date.getDate() + count);
  return dateString(date);
}

function daysBetween(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);

  if (!a || !b) return 0;

  return Math.round(
    (b.getTime() - a.getTime()) / 86400000
  );
}

function paydayInMonth(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate();

  return dateString(
    new Date(
      year,
      month - 1,
      Math.min(day, lastDay)
    )
  );
}

function nextPayday(start, payday) {
  const date = parseDate(start);

  const next = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    1
  );

  return paydayInMonth(
    next.getFullYear(),
    next.getMonth() + 1,
    payday
  );
}

function periodAround(date, payday) {
  const current = parseDate(date);

  let start = paydayInMonth(
    current.getFullYear(),
    current.getMonth() + 1,
    payday
  );

  if (start > date) {
    const previous = new Date(
      current.getFullYear(),
      current.getMonth() - 1,
      1
    );

    start = paydayInMonth(
      previous.getFullYear(),
      previous.getMonth() + 1,
      payday
    );
  }

  return {
    start,
    end: addDays(
      nextPayday(start, payday),
      -1
    )
  };
}

function makePeriod(
  start,
  end,
  income = 0,
  expenses = []
) {
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
    due: item.due || "",
    paidDate: item.paidDate || ""
  };
}

function validateData(raw) {
  if (
    !raw ||
    !Number.isInteger(raw.payday) ||
    raw.payday < 1 ||
    raw.payday > 31 ||
    !Array.isArray(raw.periods)
  ) {
    throw new Error("Ogiltigt dataformat");
  }

  const periods = raw.periods.map(period => {
    if (
      !period ||
      !parseDate(period.start) ||
      !parseDate(period.end) ||
      period.end < period.start ||
      !Number.isFinite(Number(period.income)) ||
      Number(period.income) < 0 ||
      !Array.isArray(period.expenses)
    ) {
      throw new Error("Ogiltig löneperiod");
    }

    const expenses = period.expenses.map(item => {
      const expense = normalizeExpense(item);

      if (
        !expense.name ||
        !Number.isFinite(expense.amount) ||
        expense.amount <= 0 ||
        !categoryInfo[expense.category] ||
        !typeNames[expense.type] ||
        (expense.due && !parseDate(expense.due)) ||
        (expense.paidDate &&
          !parseDate(expense.paidDate))
      ) {
        throw new Error("Ogiltig kostnad");
      }

      if (!expense.paid) {
        expense.paidDate = "";
      }

      return expense;
    });

    return {
      id: String(period.id || uid()),
      start: period.start,
      end: period.end,
      income: Number(period.income),
      expenses
    };
  });

  periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start <= periods[i - 1].end) {
      throw new Error("Löneperioder överlappar");
    }
  }

  const ids = periods.map(period => period.id);

  if (new Set(ids).size !== ids.length) {
    throw new Error("Dubbla period-ID");
  }

  return {
    payday: raw.payday,
    periods
  };
}

function migrateOldData() {
  const v3 = localStorage.getItem("minbudget_v3");

  if (v3) {
    return validateData(JSON.parse(v3));
  }

  const v2 = localStorage.getItem("minbudget_v2");

  if (v2) {
    const old = JSON.parse(v2);

    if (
      !old.months ||
      typeof old.months !== "object" ||
      Array.isArray(old.months)
    ) {
      throw new Error("Ogiltig version 2");
    }

    const periods = Object.entries(old.months).map(
      ([month, values]) => {
        if (
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          !values ||
          !Array.isArray(values.expenses)
        ) {
          throw new Error("Ogiltig gammal månad");
        }

        const [year, number] =
          month.split("-").map(Number);

        const end = dateString(
          new Date(year, number, 0)
        );

        return makePeriod(
          month + "-01",
          end,
          Number(values.income),
          values.expenses.map(item => ({
            ...item,
            paid: false,
            due: "",
            paidDate: ""
          }))
        );
      }
    );

    return validateData({
      payday: 20,
      periods
    });
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
          old.expenses.map(item => ({
            ...item,
            paid: false,
            due: "",
            paidDate: ""
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
    "Inga gamla uppgifter har raderats. " +
    "Kontrollera din säkerhetskopia."
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
  data.periods.find(period =>
    period.start <= today() &&
    period.end >= today()
  )?.id ||
  data.periods[data.periods.length - 1].id;

let editingId = null;

const expanded = {
  behov: false,
  onskemal: false,
  framtid: false
};

function currentPeriod() {
  return data.periods.find(
    period => period.id === selectedId
  );
}

function el(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;

  if (className) {
    element.className = className;
  }

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

function longDate(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parseDate(date));
}

function totals() {
  const period = currentPeriod();

  const total = period.expenses.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const paid = period.expenses
    .filter(item => item.paid)
    .reduce(
      (sum, item) => sum + item.amount,
      0
    );

  return {
    total,
    paid,
    unpaid: total - paid,
    available: period.income - total
  };
}

function renderOverview() {
  const period = currentPeriod();
  const amounts = totals();

  $("periodName").textContent =
    periodName(period.start);

  $("periodDates").textContent =
    formatDate(period.start) +
    " – " +
    formatDate(period.end) +
    " " +
    parseDate(period.end).getFullYear();

  $("available").textContent =
    money(amounts.available);

  $("available").classList.toggle(
    "negative",
    amounts.available < 0
  );

  $("paidTotal").textContent =
    money(amounts.paid);

  $("unpaidTotal").textContent =
    money(amounts.unpaid);

  const index = data.periods.findIndex(
    period => period.id === selectedId
  );

  $("prevPeriod").disabled = index <= 0;

  $("nextPeriod").disabled =
    index >= data.periods.length - 1;
}

function editExpense(id) {
  const item = currentPeriod().expenses.find(
    expense => expense.id === id
  );

  if (!item) return;

  editingId = id;

  $("expenseDialogTitle").textContent =
    "Redigera kostnad";

  $("expenseName").value = item.name;
  $("expenseAmount").value = item.amount;
  $("expenseCategory").value = item.category;
  $("expenseType").value = item.type;
  $("expenseDue").value = item.due;
  $("expensePaid").checked = item.paid;
  $("expensePaidDate").value = item.paidDate;

  $("deleteExpense").classList.remove("hidden");

  updatePaidDateField(false);
  $("expenseDialog").showModal();
}

function renderCategories() {
  const container = $("categories");
  container.replaceChildren();

  const period = currentPeriod();

  for (
    const [key, category]
    of Object.entries(categoryInfo)
  ) {
    const items = period.expenses.filter(
      item => item.category === key
    );

    const total = items.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    const spent = items
      .filter(item => item.paid)
      .reduce(
        (sum, item) => sum + item.amount,
        0
      );

    const unpaid = total - spent;

    const budget =
      period.income * category.percent / 100;

    const remaining = budget - total;

    const percentage = budget > 0
      ? Math.min(100, total / budget * 100)
      : total > 0 ? 100 : 0;

    const wrapper = el(
      "div", "", "category"
    );

    const toggle = el(
      "button", "", "category-toggle"
    );

    toggle.type = "button";
    toggle.setAttribute(
      "aria-expanded",
      String(expanded[key])
    );

    const title = el(
      "div", "", "category-title"
    );

    const dot = el("span", "", "dot");
    dot.style.background = category.color;

    title.append(
      dot,
      el("strong", category.name),
      el("small", category.percent + " %")
    );

    const value = el(
      "div", "", "category-value"
    );

    value.append(
      el(
        "span",
        expanded[key] ? "⌃" : "⌄",
        "chevron"
      )
    );

    toggle.append(title, value);

    toggle.onclick = () => {
      expanded[key] = !expanded[key];
      renderCategories();
    };

    const progress = el(
      "div", "", "progress"
    );

    const fill = el(
      "div", "", "progress-fill"
    );

    fill.style.width = percentage + "%";
    fill.style.background = category.color;

    progress.append(fill);

    const summary = el(
      "div", "", "category-summary"
    );

    const spentBox = el(
      "div", "", "category-number"
    );

    spentBox.append(
      el("small", "Spenderat"),
      el("strong", money(spent))
    );

    const remainingBox = el(
      "div",
      "",
      "category-number remaining"
    );

    remainingBox.append(
      el(
        "small",
        remaining < 0
          ? "Över budgeten"
          : "Kvar av budgeten"
      ),
      el("strong", money(Math.abs(remaining)))
    );

    if (remaining < 0) {
      remainingBox.classList.add(
        "over-budget"
      );
    }

    summary.append(
      spentBox,
      remainingBox
    );

    const budgetHint = el(
      "p",
      "Budget enligt " +
      category.percent +
      " % av lönen: " +
      money(budget),
      "category-budget-hint"
    );

    wrapper.append(
      toggle,
      progress,
      summary,
      budgetHint
    );

    if (key === "onskemal") {
      wrapper.append(
        el(
          "p",
          "Behöver jag verkligen köpa det här just nu?",
          "reflection"
        )
      );
    }

    if (expanded[key]) {
      const detail = el(
        "div", "", "category-detail"
      );

      if (unpaid > 0) {
        detail.append(
          el(
            "p",
            "Kvar att betala: " + money(unpaid),
            "category-unpaid"
          )
        );
      }

      if (items.length === 0) {
        detail.append(
          el(
            "p",
            "Inga kostnader ännu.",
            "empty"
          )
        );
      }

      items.forEach(item => {
        const row = el(
          "div", "", "category-item"
        );

        const info = el(
          "div", "", "item-info"
        );

        let description = typeNames[item.type];

        if (item.due) {
          description +=
            " • Förfaller " + formatDate(item.due);
        }

        if (item.paid && item.paidDate) {
          description +=
            " • Betald " + formatDate(item.paidDate);
        }

        info.append(
          el("strong", item.name),
          el("small", description)
        );

        const actions = el(
          "div", "", "item-actions"
        );

        const paidButton = el(
          "button",
          item.paid
            ? "✓ Betald"
            : "○ Obetald",
          "paid-toggle" +
          (item.paid ? " is-paid" : "")
        );

        paidButton.type = "button";

        paidButton.setAttribute(
          "aria-label",
          "Ändra betalningsstatus för " +
          item.name
        );

        paidButton.onclick = () => {
          if (item.paid) {
            item.paid = false;
            item.paidDate = "";
          } else {
            item.paid = true;
            item.paidDate = today();
          }

          save();
          render();
        };

        const editButton = el(
          "button", "✎", "edit-btn"
        );

        editButton.type = "button";

        editButton.setAttribute(
          "aria-label",
          "Redigera " + item.name
        );

        editButton.onclick = () =>
          editExpense(item.id);

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

function updatePaidDateField(fillToday = true) {
  const paid = $("expensePaid").checked;

  $("paidDateGroup").classList.toggle(
    "hidden",
    !paid
  );

  if (
    paid &&
    fillToday &&
    !$("expensePaidDate").value
  ) {
    $("expensePaidDate").value = today();
  }

  if (!paid) {
    $("expensePaidDate").value = "";
  }
}

$("expensePaid").onchange = () => {
  updatePaidDateField(true);
};

function closeExpense() {
  editingId = null;
  $("expenseForm").reset();

  $("deleteExpense").classList.add(
    "hidden"
  );

  $("paidDateGroup").classList.add(
    "hidden"
  );

  $("expenseDialog").close();
}

$("addBtn").onclick = () => {
  editingId = null;

  $("expenseForm").reset();

  $("expenseDialogTitle").textContent =
    "Lägg till kostnad";

  $("deleteExpense").classList.add(
    "hidden"
  );

  updatePaidDateField(false);
  $("expenseDialog").showModal();
};

$("cancelExpense").onclick = closeExpense;

$("expenseForm").onsubmit = event => {
  event.preventDefault();

  const name =
    $("expenseName").value.trim();

  const amount =
    Number($("expenseAmount").value);

  const category =
    $("expenseCategory").value;

  const type =
    $("expenseType").value;

  const due =
    $("expenseDue").value;

  const paid =
    $("expensePaid").checked;

  let paidDate = paid
    ? $("expensePaidDate").value
    : "";

  if (
    paid &&
    !paidDate &&
    !editingId
  ) {
    paidDate = today();
  }

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !categoryInfo[category] ||
    !typeNames[type] ||
    (due && !parseDate(due)) ||
    (paidDate && !parseDate(paidDate))
  ) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  const values = {
    name,
    amount,
    category,
    type,
    due,
    paid,
    paidDate
  };

  if (editingId) {
    const item = currentPeriod()
      .expenses.find(
        expense => expense.id === editingId
      );

    if (item) {
      Object.assign(item, values);
    }
  } else {
    currentPeriod().expenses.push({
      id: uid(),
      ...values
    });
  }

  save();
  closeExpense();
  render();
};

$("deleteExpense").onclick = () => {
  if (
    !editingId ||
    !confirm("Vill du ta bort kostnaden?")
  ) {
    return;
  }

  currentPeriod().expenses =
    currentPeriod().expenses.filter(
      item => item.id !== editingId
    );

  save();
  closeExpense();
  render();
};

function navigate(direction) {
  const index = data.periods.findIndex(
    period => period.id === selectedId
  );

  const next =
    data.periods[index + direction];

  if (!next) return;

  selectedId = next.id;
  render();
}

$("prevPeriod").onclick = () =>
  navigate(-1);

$("nextPeriod").onclick = () =>
  navigate(1);

for (let day = 1; day <= 31; day++) {
  const option = el(
    "option",
    "Den " + day + ":e"
  );

  option.value = day;
  $("payday").append(option);
}

$("settingsBtn").onclick = () => {
  const period = currentPeriod();

  $("income").value = period.income;
  $("payday").value = data.payday;
  $("periodStart").value = period.start;
  $("periodEnd").value = period.end;

  $("settingsDialog").showModal();
};

$("closeSettings").onclick = () => {
  $("settingsDialog").close();
};

$("saveSettings").onclick = () => {
  const income = Number(
    $("income").value
  );

  const payday = Number(
    $("payday").value
  );

  const start =
    $("periodStart").value;

  const end =
    $("periodEnd").value;

  if (
    !Number.isFinite(income) ||
    income < 0 ||
    !Number.isInteger(payday) ||
    payday < 1 ||
    payday > 31 ||
    !parseDate(start) ||
    !parseDate(end) ||
    end < start
  ) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  const overlap = data.periods.some(
    period =>
      period.id !== selectedId &&
      start <= period.end &&
      end >= period.start
  );

  if (overlap) {
    alert(
      "Datumen överlappar en annan löneperiod."
    );
    return;
  }

  const period = currentPeriod();

  const old = {
    income: period.income,
    start: period.start,
    end: period.end,
    payday: data.payday
  };

  period.income = income;
  period.start = start;
  period.end = end;
  data.payday = payday;

  data.periods.sort(
    (a, b) => a.start.localeCompare(b.start)
  );

  try {
    save();
  } catch (error) {
    period.income = old.income;
    period.start = old.start;
    period.end = old.end;
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
    alert(
      "Du måste ha minst en löneperiod."
    );
    return;
  }

  if (!confirm(
    "Ta bort hela löneperioden " +
    "och alla dess kostnader?"
  )) {
    return;
  }

  data.periods = data.periods.filter(
    period => period.id !== selectedId
  );

  selectedId =
    data.periods[
      data.periods.length - 1
    ].id;

  save();
  $("settingsDialog").close();
  render();
};

function suggestNewDates(start) {
  if (!parseDate(start)) return;

  $("newEnd").value = addDays(
    nextPayday(start, data.payday),
    -1
  );
}

$("newPeriodBtn").onclick = () => {
  const source = currentPeriod();

  $("newStart").value =
    addDays(source.end, 1);

  suggestNewDates(
    $("newStart").value
  );

  $("copyIncome").checked = true;
  $("copyList").replaceChildren();

  source.expenses.forEach(item => {
    const label = el(
      "label", "", "check-row"
    );

    const checkbox =
      document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = item.id;

    checkbox.checked =
      item.type === "fast" ||
      item.type === "lan";

    label.append(
      checkbox,
      el(
        "span",
        item.name + " – " +
        money(item.amount)
      )
    );

    $("copyList").append(label);
  });

  $("periodDialog").showModal();
};

$("newStart").onchange = () => {
  suggestNewDates(
    $("newStart").value
  );
};

$("cancelPeriod").onclick = () => {
  $("periodDialog").close();
};

$("confirmPeriod").onclick = () => {
  const start =
    $("newStart").value;

  const end =
    $("newEnd").value;

  if (
    !parseDate(start) ||
    !parseDate(end) ||
    end < start
  ) {
    alert("Kontrollera datumen.");
    return;
  }

  const overlap = data.periods.some(
    period =>
      start <= period.end &&
      end >= period.start
  );

  if (overlap) {
    alert(
      "Den nya perioden överlappar " +
      "en befintlig period. " +
      "Justera datumen först."
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
      paidDate: "",
      due: ""
    }));

  const next = makePeriod(
    start,
    end,
    $("copyIncome").checked
      ? source.income
      : 0,
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

$("exportBtn").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    {
      type: "application/json"
    }
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;

  link.download =
    "minbudget-" + today() + ".json";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
};

$("importFile").onchange = async event => {
  const file = event.target.files[0];

  if (!file) return;

  try {
    const imported = validateData(
      JSON.parse(await file.text())
    );

    if (!imported.periods.length) {
      throw new Error(
        "Tom säkerhetskopia"
      );
    }

    if (!confirm(
      "Importen ersätter dina nuvarande " +
      "uppgifter. Vill du fortsätta?"
    )) {
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(imported)
    );

    data = imported;

    selectedId =
      data.periods[
        data.periods.length - 1
      ].id;

    $("settingsDialog").close();
    render();

    alert(
      "Säkerhetskopian har återställts."
    );
  } catch (error) {
    console.error(error);

    alert(
      "Kunde inte importera säkerhetskopian."
    );
  } finally {
    event.target.value = "";
  }
};

/* DIAGRAM – NYTT I 4.4 */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(
    SVG_NS,
    tag
  );

  Object.entries(attributes).forEach(
    ([key, value]) => {
      element.setAttribute(key, String(value));
    }
  );

  return element;
}

function dailyExpenses() {
  const period = currentPeriod();

  const count =
    daysBetween(period.start, period.end) + 1;

  const days = Array.from(
    { length: count },
    (_, index) => ({
      date: addDays(period.start, index),
      amount: 0,
      items: []
    })
  );

  const byDate = new Map(
    days.map(day => [day.date, day])
  );

  const undated = [];
  const outside = [];

  period.expenses.forEach(item => {
    if (!item.paid) return;

    if (!item.paidDate) {
      undated.push(item);
      return;
    }

    const day = byDate.get(item.paidDate);

    if (!day) {
      outside.push(item);
      return;
    }

    day.amount += item.amount;
    day.items.push(item);
  });

  return {
    days,
    undated,
    outside
  };
}

function drawChart(svg, days, large = false) {
  svg.replaceChildren();

  const width = 340;
  const height = large ? 180 : 68;

  const left = large ? 12 : 3;
  const right = large ? 328 : 337;

  const top = large ? 15 : 5;
  const bottom = large ? 154 : 61;

  const max = Math.max(
    0,
    ...days.map(day => day.amount)
  );

  const usableWidth = right - left;
  const usableHeight = bottom - top;

  function position(index, amount) {
    const x = days.length <= 1
      ? left + usableWidth / 2
      : left +
        index / (days.length - 1) *
        usableWidth;

    const y = max > 0
      ? bottom -
        amount / max * usableHeight
      : bottom;

    return { x, y };
  }

  const gridLines = large ? 4 : 3;

  for (let i = 0; i < gridLines; i++) {
    const y = top +
      i / (gridLines - 1) *
      usableHeight;

    svg.append(
      svgElement("line", {
        x1: left,
        y1: y,
        x2: right,
        y2: y,
        stroke: "#405557",
        "stroke-width": 1,
        "stroke-dasharray": "3 5"
      })
    );
  }

  if (days.length === 0) {
    return;
  }

  const points = days.map(
    (day, index) =>
      position(index, day.amount)
  );

  const linePath = points.map(
    (point, index) =>
      (index === 0 ? "M" : "L") +
      point.x.toFixed(2) + " " +
      point.y.toFixed(2)
  ).join(" ");

  if (max === 0) {
    svg.append(
      svgElement("line", {
        x1: left,
        y1: bottom,
        x2: right,
        y2: bottom,
        stroke: "#718783",
        "stroke-width": 2,
        "stroke-linecap": "round"
      })
    );

    return;
  }

  const first = points[0];
  const last = points[points.length - 1];

  const areaPath =
    linePath +
    " L" + last.x + " " + bottom +
    " L" + first.x + " " + bottom +
    " Z";

  svg.append(
    svgElement("path", {
      d: areaPath,
      fill: "#e5a267",
      "fill-opacity": large ? 0.13 : 0.09
    })
  );

  svg.append(
    svgElement("path", {
      d: linePath,
      fill: "none",
      stroke: "#e5a267",
      "stroke-width": large ? 2.8 : 2.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    })
  );

  if (!large) {
    const peakDays = days
      .map((day, index) => ({
        ...day,
        index
      }))
      .filter(day => day.amount > 0)
      .sort(
        (a, b) => b.amount - a.amount
      )
      .slice(0, 4);

    peakDays.forEach(day => {
      const point = points[day.index];

      svg.append(
        svgElement("circle", {
          cx: point.x,
          cy: point.y,
          r: 3.5,
          fill: "#e5a267"
        })
      );
    });

    return;
  }

  days.forEach((day, index) => {
    if (day.amount <= 0) return;

    const point = points[index];

    const group = svgElement("g", {
      role: "button",
      tabindex: "0",
      "aria-label":
        longDate(day.date) +
        ", " +
        money(day.amount),
      style: "cursor:pointer"
    });

    const hitArea = svgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: 12,
      fill: "transparent"
    });

    const dot = svgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: 4,
      fill: "#e5a267",
      stroke: "#263438",
      "stroke-width": 1.5
    });

    group.append(hitArea, dot);

    group.addEventListener("click", () => {
      showChartDay(day);
    });

    group.addEventListener("keydown", event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        showChartDay(day);
      }
    });

    svg.append(group);
  });
}

function showChartDay(day) {
  const container = $("chartDetails");
  container.replaceChildren();

  const heading = el(
    "div", "", "chart-detail-heading"
  );

  heading.append(
    el("strong", longDate(day.date)),
    el("strong", money(day.amount))
  );

  container.append(heading);

  day.items.forEach(item => {
    const row = el(
      "div", "", "chart-detail-item"
    );

    row.append(
      el("span", item.name),
      el("span", money(item.amount))
    );

    container.append(row);
  });
}

function renderMiniChart() {
  const period = currentPeriod();
  const chart = dailyExpenses();

  $("miniStart").textContent =
    formatDate(period.start);

  $("miniEnd").textContent =
    formatDate(period.end);

  drawChart(
    $("miniChart"),
    chart.days,
    false
  );
}

function renderLargeChart() {
  const period = currentPeriod();
  const chart = dailyExpenses();

  const total = chart.days.reduce(
    (sum, day) => sum + day.amount,
    0
  );

  const biggest = Math.max(
    0,
    ...chart.days.map(day => day.amount)
  );

  $("chartPeriod").textContent =
    longDate(period.start) +
    " – " +
    longDate(period.end);

  $("chartStart").textContent =
    formatDate(period.start);

  $("chartEnd").textContent =
    formatDate(period.end);

  $("chartTotal").textContent =
    money(total);

  $("chartMax").textContent =
    money(biggest);

  drawChart(
    $("largeChart"),
    chart.days,
    true
  );

  const details = $("chartDetails");
  details.replaceChildren();

  const paidDays = chart.days.filter(
    day => day.amount > 0
  );

  if (paidDays.length === 0) {
    details.append(
      el(
        "p",
        "Inga daterade betalningar finns " +
        "för den här löneperioden ännu.",
        "empty"
      )
    );
  } else {
    const biggestDay = paidDays.reduce(
      (largest, day) =>
        day.amount > largest.amount
          ? day
          : largest
    );

    showChartDay(biggestDay);
  }

  const messages = [];

  if (chart.undated.length > 0) {
    const totalUndated =
      chart.undated.reduce(
        (sum, item) => sum + item.amount,
        0
      );

    messages.push(
      chart.undated.length +
      " äldre betalningar (" +
      money(totalUndated) +
      ") saknar betalningsdatum " +
      "och visas därför inte i diagrammet."
    );
  }

  if (chart.outside.length > 0) {
    messages.push(
      chart.outside.length +
      " betalningar har datum utanför " +
      "den valda löneperioden och visas " +
      "inte i det här diagrammet."
    );
  }

  if (messages.length > 0) {
    details.append(
      el(
        "div",
        messages.join(" "),
        "chart-no-date"
      )
    );
  }
}

$("chartOpenBtn").onclick = () => {
  renderLargeChart();
  $("chartDialog").showModal();
};

$("closeChart").onclick = () => {
  $("chartDialog").close();
};

$("closeChartBottom").onclick = () => {
  $("chartDialog").close();
};

function render() {
  renderOverview();
  renderCategories();
  renderMiniChart();
}

render();
