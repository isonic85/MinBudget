
"use strict";

/* ==========================================
   MINBUDGET 4.9
   Komplett JavaScript
   Med extra inkomster / försäljningar
   ========================================== */

const STORAGE_KEY = "minbudget_v4";
const SORT_KEY = "minbudget_sort_v48";
const $ = id => document.getElementById(id);

const categories = {
  behov: { name: "Behov", color: "#65b8af" },
  onskemal: { name: "Tänk efter", color: "#e5a267" },
  framtid: { name: "Framtid", color: "#80c99b" }
};

const types = {
  fast: "Fast kostnad",
  rorlig: "Rörlig kostnad",
  lan: "Lån",
  sparande: "Sparande"
};

const models = {
  "50/30/20": [50, 30, 20],
  "60/20/20": [60, 20, 20],
  "50/20/30": [50, 20, 30],
  "70/20/10": [70, 20, 10],
  "80/20": [80, 0, 20]
};

const modelLabels = {
  "50/30/20": "50/30/20 – Balanserad",
  "60/20/20": "60/20/20 – Mer till behov",
  "50/20/30": "50/20/30 – Mer sparande",
  "70/20/10": "70/20/10 – Lägre sparmål",
  "80/20": "80/20 – Enklare budget",
  custom: "Egen fördelning"
};

const defaultBudget = {
  model: "50/30/20",
  needs: 50,
  wants: 30,
  future: 20
};

const sortOptions = {
  amountDesc: "Störst belopp först",
  amountAsc: "Minst belopp först",
  nameAsc: "Namn A–Ö",
  nameDesc: "Namn Ö–A"
};

const money = n => new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 2
}).format(Number(n) || 0);

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) +
      Math.random().toString(36).slice(2);

const el = (tag, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

const sum = items =>
  items.reduce((total, item) => total + Number(item.amount || 0), 0);

function dateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

const today = () => dateString(new Date());

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(value + "T12:00:00");
  return !Number.isNaN(date.getTime()) &&
    dateString(date) === value ? date : null;
}

function addDays(value, count) {
  const date = parseDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + count);
  return dateString(date);
}

function daysBetween(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  return a && b ? Math.round((b - a) / 86400000) : 0;
}

function paydayInMonth(year, month, day) {
  const last = new Date(year, month, 0).getDate();
  return dateString(new Date(year, month - 1, Math.min(day, last)));
}

function nextPayday(start, payday) {
  const date = parseDate(start);
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return paydayInMonth(
    next.getFullYear(),
    next.getMonth() + 1,
    payday
  );
}

function periodAround(value, payday) {
  const date = parseDate(value);
  let start = paydayInMonth(
    date.getFullYear(),
    date.getMonth() + 1,
    payday
  );

  if (start > value) {
    const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    start = paydayInMonth(
      prev.getFullYear(),
      prev.getMonth() + 1,
      payday
    );
  }

  return {
    start,
    end: addDays(nextPayday(start, payday), -1)
  };
}

function formatDate(value) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "short"
      }).format(date)
    : "–";
}

function longDate(value) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(date)
    : "–";
}

function periodName(value) {
  return new Intl.DateTimeFormat("sv-SE", {
    month: "long",
    year: "numeric"
  }).format(parseDate(value));
}

/* ==========================================
   DATA OCH LAGRING
   ========================================== */

function makePeriod(
  start,
  end,
  income = 0,
  expenses = [],
  budget = defaultBudget
) {
  return {
    id: uid(),
    start,
    end,
    income,
    expenses,
    withdrawals: [],
    sales: [],
    budget: { ...budget }
  };
}

function normalizeBudget(value) {
  if (!value) return { ...defaultBudget };

  const model = modelLabels[value.model]
    ? value.model
    : "custom";

  const numbers = [
    Number(value.needs),
    Number(value.wants),
    Number(value.future)
  ];

  if (
    numbers.some(n => !Number.isFinite(n) || n < 0 || n > 100) ||
    Math.abs(numbers.reduce((a, b) => a + b, 0) - 100) > 0.001
  ) {
    return { ...defaultBudget };
  }

  return {
    model,
    needs: numbers[0],
    wants: numbers[1],
    future: numbers[2]
  };
}

function validateData(raw) {
  if (
    !raw ||
    !Array.isArray(raw.periods) ||
    !Number.isInteger(Number(raw.payday)) ||
    Number(raw.payday) < 1 ||
    Number(raw.payday) > 31
  ) {
    throw new Error("Ogiltig säkerhetskopia");
  }

  const periods = raw.periods.map(p => {
    if (
      !parseDate(p.start) ||
      !parseDate(p.end) ||
      p.end < p.start ||
      !Number.isFinite(Number(p.income)) ||
      Number(p.income) < 0 ||
      !Array.isArray(p.expenses)
    ) {
      throw new Error("Ogiltig löneperiod");
    }

    const expenses = p.expenses.map(e => {
      const item = {
        id: String(e.id || uid()),
        name: String(e.name || "").trim(),
        amount: Number(e.amount),
        category: e.category,
        type: e.type,
        paid: e.paid === true,
        due: e.due || "",
        paidDate: e.paid ? e.paidDate || "" : ""
      };

      if (
        !item.name ||
        !Number.isFinite(item.amount) ||
        item.amount <= 0 ||
        !categories[item.category] ||
        !types[item.type] ||
        (item.due && !parseDate(item.due)) ||
        (item.paidDate && !parseDate(item.paidDate))
      ) {
        throw new Error("Ogiltig kostnad");
      }

      return item;
    });

    function normalizeTransactions(items, kind) {
      if (!Array.isArray(items)) {
        throw new Error("Ogiltig transaktionslista");
      }

      return items.map(item => {
        const result = {
          id: String(item.id || uid()),
          name: String(item.name || "").trim(),
          amount: Number(item.amount),
          date: item.date || ""
        };

        if (
          !result.name ||
          !Number.isFinite(result.amount) ||
          result.amount <= 0 ||
          !parseDate(result.date)
        ) {
          throw new Error("Ogiltig " + kind);
        }

        return result;
      });
    }

    const withdrawals = normalizeTransactions(
      p.withdrawals === undefined ? [] : p.withdrawals,
      "uttag"
    );

    const sales = normalizeTransactions(
      p.sales === undefined ? [] : p.sales,
      "försäljning"
    );

    const ids = [
      ...expenses,
      ...withdrawals,
      ...sales
    ].map(item => item.id);

    if (new Set(ids).size !== ids.length) {
      throw new Error("Dubbla transaktions-ID");
    }

    return {
      id: String(p.id || uid()),
      start: p.start,
      end: p.end,
      income: Number(p.income),
      expenses,
      withdrawals,
      sales,
      budget: normalizeBudget(p.budget)
    };
  });

  periods.sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start <= periods[i - 1].end) {
      throw new Error("Överlappande löneperioder");
    }
  }

  if (new Set(periods.map(p => p.id)).size !== periods.length) {
    throw new Error("Dubbla period-ID");
  }

  return {
    payday: Number(raw.payday),
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

    if (!old.months || typeof old.months !== "object") {
      throw new Error("Ogiltig äldre data");
    }

    const periods = Object.entries(old.months).map(([month, values]) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Ogiltig månad");
      }

      const [year, number] = month.split("-").map(Number);

      return makePeriod(
        month + "-01",
        dateString(new Date(year, number, 0)),
        Number(values.income || 0),
        (values.expenses || []).map(e => ({
          ...e,
          paid: false,
          due: "",
          paidDate: ""
        }))
      );
    });

    return validateData({ payday: 20, periods });
  }

  const v1 = localStorage.getItem("minbudget_v1");

  if (v1) {
    const old = JSON.parse(v1);
    const dates = periodAround(today(), 20);

    return validateData({
      payday: 20,
      periods: [
        makePeriod(
          dates.start,
          dates.end,
          Number(old.income || 0),
          (old.expenses || []).map(e => ({
            ...e,
            paid: false,
            due: "",
            paidDate: ""
          }))
        )
      ]
    });
  }

  return { payday: 20, periods: [] };
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved) {
    return validateData(JSON.parse(saved));
  }

  return migrateOldData();
}

let data;

try {
  data = loadData();
} catch (error) {
  console.error(error);
  alert(
    "Kunde inte läsa sparad budgetdata. " +
    "Din gamla data har inte raderats."
  );
  throw error;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error(error);
    alert("Kunde inte spara budgeten.");
    throw error;
  }
}

if (!data.periods.length) {
  const dates = periodAround(today(), data.payday);
  data.periods.push(makePeriod(dates.start, dates.end));
  save();
}

let selectedId =
  data.periods.find(p => p.start <= today() && p.end >= today())?.id ||
  data.periods[data.periods.length - 1].id;

let editingExpenseId = null;
let editingSaleId = null;
let editingWithdrawalId = null;

const expanded = {
  behov: false,
  onskemal: false,
  framtid: false
};

let sortPreferences = {
  behov: "amountDesc",
  onskemal: "amountDesc",
  framtid: "amountDesc"
};

try {
  const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "{}");

  Object.keys(sortPreferences).forEach(key => {
    if (sortOptions[saved[key]]) {
      sortPreferences[key] = saved[key];
    }
  });
} catch (error) {
  console.warn("Kunde inte läsa sortering", error);
}

const currentPeriod = () =>
  data.periods.find(p => p.id === selectedId);

const isSaving = item => item.type === "sparande";

/* ==========================================
   BERÄKNINGAR
   ========================================== */

function totals() {
  const p = currentPeriod();

  const ordinary = p.expenses.filter(e => !isSaving(e));
  const savings = p.expenses.filter(isSaving);

  const ordinaryTotal = sum(ordinary);
  const ordinaryPaid = sum(ordinary.filter(e => e.paid));

  const savingsTotal = sum(savings);
  const savingsPaid = sum(savings.filter(e => e.paid));

  const withdrawals = sum(p.withdrawals);
  const extraIncome = sum(p.sales);

  return {
    total: ordinaryTotal + savingsTotal,
    paid: ordinaryPaid,
    unpaid: ordinaryTotal - ordinaryPaid,
    savingsTotal,
    savingsPaid,
    savingsUnpaid: savingsTotal - savingsPaid,
    savedNet: savingsPaid - withdrawals,
    withdrawals,
    extraIncome,

    account:
      p.income +
      extraIncome -
      ordinaryPaid -
      savingsPaid +
      withdrawals,

    afterBills:
      p.income +
      extraIncome -
      ordinaryTotal -
      savingsTotal +
      withdrawals
  };
}

function dailyBudget() {
  const p = currentPeriod();
  const now = today();

  if (now < p.start) {
    return {
      active: false,
      amount: 0,
      message: "Den här löneperioden har inte börjat ännu."
    };
  }

  if (now > p.end) {
    return {
      active: false,
      amount: 0,
      message: "Den här löneperioden är avslutad."
    };
  }

  const days = daysBetween(now, p.end) + 1;
  const remaining = totals().afterBills;

  return {
    active: true,
    amount: remaining / days,
    days,
    message:
      money(remaining) +
      " kvar efter planerade kostnader och sparande. " +
      days +
      (days === 1 ? " dag kvar." : " dagar kvar.")
  };
}

/* ==========================================
   ÖVERSIKT
   ========================================== */

function renderOverview() {
  const p = currentPeriod();
  const t = totals();
  const daily = dailyBudget();

  $("periodName").textContent = periodName(p.start);
  $("periodDates").textContent =
    formatDate(p.start) + " – " + longDate(p.end);

  $("available").textContent = money(t.account);
  $("afterBills").textContent = money(t.afterBills);

  $("available").classList.toggle("negative", t.account < 0);
  $("afterBills").classList.toggle("negative", t.afterBills < 0);

  $("extraIncomeTotal").textContent = money(t.extraIncome);
  $("paidTotal").textContent = money(t.paid);
  $("unpaidTotal").textContent = money(t.unpaid);
  $("savedTotal").textContent = money(t.savedNet);

  $("savedTotal").classList.toggle("negative", t.savedNet < 0);

  $("withdrawalSummary").classList.toggle(
    "hidden",
    t.withdrawals === 0
  );

  $("withdrawalTotal").textContent = "−" + money(t.withdrawals);

  $("dailyAllowance").textContent = daily.active
    ? money(daily.amount) + "/dag"
    : "–";

  $("dailyAllowance").classList.toggle(
    "negative",
    daily.active && daily.amount < 0
  );

  $("dailyAllowanceHint").textContent = daily.message;

  $("budgetModelLabel").textContent = [
    p.budget.needs,
    p.budget.wants,
    p.budget.future
  ].join(" / ");

  const index = data.periods.findIndex(p => p.id === selectedId);

  $("prevPeriod").disabled = index === 0;
  $("nextPeriod").disabled = index === data.periods.length - 1;
}

function button(text, className, label, callback) {
  const node = el("button", text, className);
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.onclick = callback;
  return node;
}

function sortedItems(items, mode) {
  return [...items].sort((a, b) => {
    if (mode === "amountAsc") {
      return a.amount - b.amount ||
        a.name.localeCompare(b.name, "sv");
    }

    if (mode === "nameAsc") {
      return a.name.localeCompare(b.name, "sv");
    }

    if (mode === "nameDesc") {
      return b.name.localeCompare(a.name, "sv");
    }

    return b.amount - a.amount ||
      a.name.localeCompare(b.name, "sv");
  });
}

/* ==========================================
   KATEGORIER OCH KOSTNADSLISTA
   ========================================== */

function renderCategories() {
  const p = currentPeriod();
  const container = $("categories");
  container.replaceChildren();

  const withdrawalTotal = sum(p.withdrawals);

  Object.entries(categories).forEach(([key, category]) => {
    const items = p.expenses.filter(e => e.category === key);
    const total = sum(items);
    const paid = sum(items.filter(e => e.paid));
    const unpaid = total - paid;
    const future = key === "framtid";

    const percent =
      key === "behov" ? p.budget.needs :
      key === "onskemal" ? p.budget.wants :
      p.budget.future;

    const budget = p.income * percent / 100;
    const actual = future ? paid - withdrawalTotal : paid;
    const planned = future ? total - withdrawalTotal : total;
    const difference = future
      ? actual - budget
      : budget - planned;

    const progressValue = future ? actual : planned;
    const progress = budget > 0
      ? Math.min(100, Math.max(0, progressValue / budget * 100))
      : progressValue > 0 ? 100 : 0;

    const wrapper = el("div", "", "category");
    const toggle = el("button", "", "category-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded[key]));

    const title = el("div", "", "category-title");
    const dot = el("span", "", "dot");
    dot.style.background = category.color;

    title.append(
      dot,
      el("strong", category.name),
      el("small", percent + " %")
    );

    toggle.append(
      title,
      el("span", expanded[key] ? "⌃" : "⌄", "chevron")
    );

    toggle.onclick = () => {
      expanded[key] = !expanded[key];
      renderCategories();
    };

    const bar = el("div", "", "progress");
    const fill = el("div", "", "progress-fill");
    fill.style.width = progress + "%";
    fill.style.background = category.color;
    bar.append(fill);

    const summary = el("div", "", "category-summary");
    const left = el("div", "", "category-number");
    const right = el("div", "", "category-number remaining");

    left.append(
      el("small", future ? "Faktiskt sparat" : "Betalt"),
      el("strong", money(actual))
    );

    if (future && actual < 0) {
      left.querySelector("strong").classList.add("savings-negative");
    }

    if (future) {
      right.append(
        el(
          "small",
          difference > 0 ? "Extra sparat" :
          difference === 0 ? "Sparmålet uppnått" :
          "Kvar till sparmålet"
        ),
        el(
          "strong",
          difference > 0
            ? "+" + money(difference)
            : money(Math.abs(difference))
        )
      );

      if (difference > 0) {
        right.querySelector("strong").classList.add("savings-positive");
      }
    } else {
      right.append(
        el(
          "small",
          difference < 0 ? "Över budgeten" : "Kvar av budgeten"
        ),
        el("strong", money(Math.abs(difference)))
      );

      if (difference < 0) right.classList.add("over-budget");
    }

    summary.append(left, right);

    wrapper.append(
      toggle,
      bar,
      summary,
      el(
        "p",
        (future ? "Sparmål" : "Budget") +
          " enligt " + percent + " % av lönen: " +
          money(budget),
        "category-budget-hint"
      )
    );

    if (future) {
      wrapper.append(
        el(
          "p",
          "Planerat netto efter uttag: " +
            money(planned) +
            " • Ej överfört: " + money(unpaid),
          "savings-note"
        )
      );

      if (withdrawalTotal > 0) {
        wrapper.append(
          el(
            "p",
            "Uttag från sparandet: −" + money(withdrawalTotal),
            "savings-note savings-negative"
          )
        );
      }
    }

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
      const detail = el("div", "", "category-detail");
      const sortRow = el("div", "", "sort-row");
      const label = el("label", "Sortera köp");
      const select = el("select");

      select.id = "sort-" + key;
      label.htmlFor = select.id;

      Object.entries(sortOptions).forEach(([value, text]) => {
        const option = el("option", text);
        option.value = value;
        select.append(option);
      });

      select.value = sortPreferences[key];

      select.onchange = () => {
        sortPreferences[key] = select.value;
        try {
          localStorage.setItem(
            SORT_KEY,
            JSON.stringify(sortPreferences)
          );
        } catch (error) {
          console.warn(error);
        }
        renderCategories();
      };

      sortRow.append(label, select);
      detail.append(sortRow);

      if (unpaid > 0) {
        detail.append(
          el(
            "p",
            (future ? "Kvar att överföra: " : "Kvar att betala: ") +
              money(unpaid),
            "category-unpaid"
          )
        );
      }

      const entries = [
        ...items.map(item => ({ ...item, kind: "expense" })),
        ...(future
          ? p.withdrawals.map(item => ({
              ...item,
              kind: "withdrawal"
            }))
          : [])
      ];

      if (!entries.length) {
        detail.append(el("p", "Inga poster ännu.", "empty"));
      }

      sortedItems(entries, sortPreferences[key]).forEach(item => {
        const row = el(
          "div",
          "",
          "category-item" +
            (item.kind === "withdrawal" ? " withdrawal-item" : "")
        );

        const info = el("div", "", "item-info");
        const actions = el("div", "", "item-actions");

        if (item.kind === "withdrawal") {
          info.append(
            el("strong", "Uttag: " + item.name),
            el("small", formatDate(item.date))
          );

          actions.append(
            el("strong", "−" + money(item.amount)),
            button(
              "✎",
              "edit-btn",
              "Redigera uttag",
              () => editWithdrawal(item.id)
            )
          );
        } else {
          let description = types[item.type];

          if (item.due) {
            description += " • Förfaller " + formatDate(item.due);
          }

          if (item.paid && item.paidDate) {
            description += " • Betald " + formatDate(item.paidDate);
          }

          info.append(
            el("strong", item.name),
            el("small", description)
          );

          actions.append(
            el("strong", money(item.amount)),
            button(
              item.paid ? "✓ Betald" : "○ Obetald",
              "paid-toggle" + (item.paid ? " is-paid" : ""),
              "Ändra betalningsstatus",
              () => {
                const original = p.expenses.find(e => e.id === item.id);
                if (!original) return;

                original.paid = !original.paid;
                original.paidDate = original.paid ? today() : "";

                save();
                render();
              }
            ),
            button(
              "✎",
              "edit-btn",
              "Redigera kostnad",
              () => editExpense(item.id)
            )
          );
        }

        row.append(info, actions);
        detail.append(row);
      });

      wrapper.append(detail);
    }

    container.append(wrapper);
  });
}

/* ==========================================
   KOSTNADER
   ========================================== */

function updatePaidField(fill = true) {
  const paid = $("expensePaid").checked;

  $("paidDateGroup").classList.toggle("hidden", !paid);

  if (paid && fill && !$("expensePaidDate").value) {
    $("expensePaidDate").value = today();
  }

  if (!paid) $("expensePaidDate").value = "";
}

$("expensePaid").onchange = () => updatePaidField();

function closeExpense() {
  editingExpenseId = null;
  $("expenseForm").reset();
  $("deleteExpense").classList.add("hidden");
  $("expenseDialog").close();
}

$("addBtn").onclick = () => {
  editingExpenseId = null;
  $("expenseForm").reset();
  $("expenseDialogTitle").textContent = "Lägg till kostnad";
  $("deleteExpense").classList.add("hidden");
  updatePaidField(false);
  $("expenseDialog").showModal();
};

function editExpense(id) {
  const item = currentPeriod().expenses.find(e => e.id === id);
  if (!item) return;

  editingExpenseId = id;

  $("expenseDialogTitle").textContent = "Redigera kostnad";
  $("expenseName").value = item.name;
  $("expenseAmount").value = item.amount;
  $("expenseCategory").value = item.category;
  $("expenseType").value = item.type;
  $("expenseDue").value = item.due;
  $("expensePaid").checked = item.paid;
  $("expensePaidDate").value = item.paidDate;

  $("deleteExpense").classList.remove("hidden");
  updatePaidField(false);
  $("expenseDialog").showModal();
}

$("cancelExpense").onclick = closeExpense;

$("expenseForm").onsubmit = event => {
  event.preventDefault();

  const name = $("expenseName").value.trim();
  const amount = Number($("expenseAmount").value);
  const category = $("expenseCategory").value;
  const type = $("expenseType").value;
  const due = $("expenseDue").value;
  const paid = $("expensePaid").checked;
  const paidDate = paid
    ? $("expensePaidDate").value || today()
    : "";

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !categories[category] ||
    !types[type] ||
    (due && !parseDate(due)) ||
    (paidDate && !parseDate(paidDate))
  ) {
    alert("Kontrollera kostnaden.");
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

  if (editingExpenseId) {
    const item = currentPeriod().expenses.find(
      e => e.id === editingExpenseId
    );
    if (item) Object.assign(item, values);
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
    !editingExpenseId ||
    !confirm("Ta bort kostnaden?")
  ) return;

  currentPeriod().expenses = currentPeriod().expenses.filter(
    e => e.id !== editingExpenseId
  );

  save();
  closeExpense();
  render();
};

/* ==========================================
   EXTRA INKOMSTER / FÖRSÄLJNINGAR
   ========================================== */

function closeSale() {
  editingSaleId = null;
  $("saleForm").reset();
  $("deleteSale").classList.add("hidden");
  $("saleDialog").close();
}

$("saleBtn").onclick = () => {
  editingSaleId = null;

  $("saleForm").reset();
  $("saleTitle").textContent = "Lägg till pengar";
  $("saleDate").value = today();
  $("deleteSale").classList.add("hidden");

  $("saleDialog").showModal();
};

function editSale(id) {
  const sale = currentPeriod().sales.find(s => s.id === id);
  if (!sale) return;

  editingSaleId = id;

  $("saleTitle").textContent = "Redigera inkomst";
  $("saleName").value = sale.name;
  $("saleAmount").value = sale.amount;
  $("saleDate").value = sale.date;

  $("deleteSale").classList.remove("hidden");
  $("saleDialog").showModal();
}

$("cancelSale").onclick = closeSale;

$("saleForm").onsubmit = event => {
  event.preventDefault();

  const name = $("saleName").value.trim();
  const amount = Number($("saleAmount").value);
  const date = $("saleDate").value;

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !parseDate(date)
  ) {
    alert("Kontrollera inkomsten.");
    return;
  }

  const p = currentPeriod();

  if (editingSaleId) {
    const sale = p.sales.find(s => s.id === editingSaleId);

    if (sale) {
      Object.assign(sale, { name, amount, date });
    }
  } else {
    p.sales.push({
      id: uid(),
      name,
      amount,
      date
    });
  }

  save();
  closeSale();
  render();
};

$("deleteSale").onclick = () => {
  if (
    !editingSaleId ||
    !confirm("Ta bort inkomsten?")
  ) return;

  const p = currentPeriod();

  p.sales = p.sales.filter(s => s.id !== editingSaleId);

  save();
  closeSale();
  render();
};

function renderSales() {
  const container = $("saleList");
  container.replaceChildren();

  const sales = currentPeriod().sales;

  if (!sales.length) {
    container.append(
      el("p", "Inga extra inkomster registrerade.", "empty")
    );
    return;
  }

  [...sales]
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach(sale => {
      const row = el("div", "", "category-item sale-item");
      const info = el("div", "", "item-info");
      const actions = el("div", "", "item-actions");

      info.append(
        el("strong", sale.name),
        el("small", formatDate(sale.date))
      );

      actions.append(
        el("strong", "+" + money(sale.amount)),
        button(
          "✎",
          "edit-btn",
          "Redigera inkomst",
          () => editSale(sale.id)
        )
      );

      row.append(info, actions);
      container.append(row);
    });
}

/* ==========================================
   UTTAG FRÅN SPARANDE
   ========================================== */

function closeWithdraw() {
  editingWithdrawalId = null;
  $("withdrawForm").reset();
  $("deleteWithdraw").classList.add("hidden");
  $("withdrawDialog").close();
}

$("withdrawBtn").onclick = () => {
  editingWithdrawalId = null;

  $("withdrawForm").reset();
  $("withdrawTitle").textContent = "Ta från sparandet";
  $("withdrawDate").value = today();
  $("deleteWithdraw").classList.add("hidden");

  $("withdrawDialog").showModal();
};

function editWithdrawal(id) {
  const item = currentPeriod().withdrawals.find(w => w.id === id);
  if (!item) return;

  editingWithdrawalId = id;

  $("withdrawTitle").textContent = "Redigera uttag";
  $("withdrawName").value = item.name;
  $("withdrawAmount").value = item.amount;
  $("withdrawDate").value = item.date;

  $("deleteWithdraw").classList.remove("hidden");
  $("withdrawDialog").showModal();
}

$("cancelWithdraw").onclick = closeWithdraw;

$("withdrawForm").onsubmit = event => {
  event.preventDefault();

  const name = $("withdrawName").value.trim();
  const amount = Number($("withdrawAmount").value);
  const date = $("withdrawDate").value;

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !parseDate(date)
  ) {
    alert("Kontrollera uttaget.");
    return;
  }

  const p = currentPeriod();

  if (editingWithdrawalId) {
    const item = p.withdrawals.find(
      w => w.id === editingWithdrawalId
    );

    if (item) Object.assign(item, { name, amount, date });
  } else {
    p.withdrawals.push({
      id: uid(),
      name,
      amount,
      date
    });
  }

  save();
  closeWithdraw();
  render();
};

$("deleteWithdraw").onclick = () => {
  if (
    !editingWithdrawalId ||
    !confirm("Ta bort uttaget?")
  ) return;

  const p = currentPeriod();

  p.withdrawals = p.withdrawals.filter(
    w => w.id !== editingWithdrawalId
  );

  save();
  closeWithdraw();
  render();
};

/* ==========================================
   BUDGETMODELLER
   ========================================== */

function populateModelSelect(id) {
  const select = $(id);
  select.replaceChildren();

  Object.entries(modelLabels).forEach(([value, label]) => {
    const option = el("option", label);
    option.value = value;
    select.append(option);
  });
}

populateModelSelect("settingsBudgetModel");
populateModelSelect("newBudgetModel");

function formValues(prefix) {
  return ["Needs", "Wants", "Future"].map(suffix => {
    const raw = $(prefix + suffix).value.trim();
    return raw === "" ? NaN : Number(raw);
  });
}

function setBudgetForm(prefix, budget) {
  $(prefix + "BudgetModel").value = budget.model;
  $(prefix + "Needs").value = budget.needs;
  $(prefix + "Wants").value = budget.wants;
  $(prefix + "Future").value = budget.future;

  updateBudgetForm(prefix);
}

function updateBudgetForm(prefix) {
  const model = $(prefix + "BudgetModel").value;
  const custom = model === "custom";

  $(prefix + "CustomBudget").classList.toggle("hidden", !custom);

  if (!custom) {
    const values = models[model] || models["50/30/20"];

    $(prefix + "Needs").value = values[0];
    $(prefix + "Wants").value = values[1];
    $(prefix + "Future").value = values[2];
  }

  const values = formValues(prefix);
  const total = values.reduce((a, b) => a + b, 0);

  const valid =
    values.every(n => Number.isInteger(n) && n >= 0 && n <= 100) &&
    total === 100;

  const sumNode = $(prefix + "BudgetSum");

  sumNode.textContent = valid
    ? "Totalt: 100 % ✓"
    : "Totalt: " +
      (Number.isFinite(total) ? total : "–") +
      " % – måste bli 100 %";

  sumNode.classList.toggle("invalid", !valid);

  if (prefix === "new") {
    const safe = valid ? values : [0, 0, 0];

    $("previewNeeds").style.width = safe[0] + "%";
    $("previewWants").style.width = safe[1] + "%";
    $("previewFuture").style.width = safe[2] + "%";

    $("budgetPreviewText").replaceChildren(
      el("span", "Behov " + values[0] + " %"),
      el("span", "Tänk efter " + values[1] + " %"),
      el("span", "Framtid " + values[2] + " %")
    );
  }
}

function readBudgetForm(prefix) {
  const model = $(prefix + "BudgetModel").value;
  const values = formValues(prefix);

  if (
    values.some(n => !Number.isInteger(n) || n < 0 || n > 100) ||
    values.reduce((a, b) => a + b, 0) !== 100
  ) {
    throw new Error("Budgetfördelningen måste bli 100 %");
  }

  return {
    model,
    needs: values[0],
    wants: values[1],
    future: values[2]
  };
}

["settings", "new"].forEach(prefix => {
  $(prefix + "BudgetModel").onchange = () =>
    updateBudgetForm(prefix);

  ["Needs", "Wants", "Future"].forEach(suffix => {
    $(prefix + suffix).oninput = () =>
      updateBudgetForm(prefix);
  });
});

/* ==========================================
   LÖNEPERIODER
   ========================================== */

function navigate(direction) {
  const index = data.periods.findIndex(p => p.id === selectedId);
  const next = data.periods[index + direction];

  if (!next) return;

  selectedId = next.id;
  render();
}

$("prevPeriod").onclick = () => navigate(-1);
$("nextPeriod").onclick = () => navigate(1);

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

  setBudgetForm("settings", p.budget);
  $("settingsDialog").showModal();
};

$("closeSettings").onclick = () =>
  $("settingsDialog").close();

$("saveSettings").onclick = () => {
  const income = Number($("income").value);
  const payday = Number($("payday").value);
  const start = $("periodStart").value;
  const end = $("periodEnd").value;

  let budget;

  try {
    budget = readBudgetForm("settings");
  } catch (error) {
    alert(error.message);
    return;
  }

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
    alert("Kontrollera inställningarna.");
    return;
  }

  if (
    data.periods.some(p =>
      p.id !== selectedId &&
      start <= p.end &&
      end >= p.start
    )
  ) {
    alert("Löneperioderna får inte överlappa.");
    return;
  }

  const p = currentPeriod();

  p.income = income;
  p.start = start;
  p.end = end;
  p.budget = budget;
  data.payday = payday;

  data.periods.sort((a, b) => a.start.localeCompare(b.start));

  save();
  $("settingsDialog").close();
  render();
};

$("deletePeriod").onclick = () => {
  if (data.periods.length <= 1) {
    alert("Du måste ha minst en löneperiod.");
    return;
  }

  if (
    !confirm(
      "Ta bort hela perioden, inklusive kostnader, " +
      "försäljningar och uttag?"
    )
  ) return;

  data.periods = data.periods.filter(p => p.id !== selectedId);
  selectedId = data.periods[data.periods.length - 1].id;

  save();
  $("settingsDialog").close();
  render();
};

function suggestNewEnd(start) {
  if (!parseDate(start)) return;

  $("newEnd").value = addDays(
    nextPayday(start, data.payday),
    -1
  );
}

$("newPeriodBtn").onclick = () => {
  const source = currentPeriod();

  $("newStart").value = addDays(source.end, 1);
  suggestNewEnd($("newStart").value);

  $("copyIncome").checked = true;
  $("copyList").replaceChildren();

  setBudgetForm("new", source.budget);

  source.expenses.forEach(item => {
    const label = el("label", "", "check-row");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.checked =
      item.type === "fast" ||
      item.type === "lan";

    label.append(
      checkbox,
      el("span", item.name + " – " + money(item.amount))
    );

    $("copyList").append(label);
  });

  $("periodDialog").showModal();
};

$("newStart").onchange = () =>
  suggestNewEnd($("newStart").value);

$("cancelPeriod").onclick = () =>
  $("periodDialog").close();

$("confirmPeriod").onclick = () => {
  const start = $("newStart").value;
  const end = $("newEnd").value;

  let budget;

  try {
    budget = readBudgetForm("new");
  } catch (error) {
    alert(error.message);
    return;
  }

  if (!parseDate(start) || !parseDate(end) || end < start) {
    alert("Kontrollera datumen.");
    return;
  }

  if (
    data.periods.some(p =>
      start <= p.end && end >= p.start
    )
  ) {
    alert("Den nya perioden överlappar en befintlig period.");
    return;
  }

  const selected = new Set(
    [...$("copyList").querySelectorAll("input:checked")]
      .map(input => input.value)
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
    $("copyIncome").checked ? source.income : 0,
    copied,
    budget
  );

  // Försäljningar kopieras inte till nästa period.
  // De är engångsinkomster.
  next.sales = [];

  data.periods.push(next);
  data.periods.sort((a, b) => a.start.localeCompare(b.start));

  selectedId = next.id;

  save();
  $("periodDialog").close();
  render();
};

/* ==========================================
   SÄKERHETSKOPIERING
   ========================================== */

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

    if (
      !confirm(
        "Importen ersätter dina nuvarande uppgifter. Fortsätta?"
      )
    ) return;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(imported)
    );

    data = imported;
    selectedId = data.periods[data.periods.length - 1].id;

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

/* ==========================================
   DIAGRAM
   ========================================== */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);

  Object.entries(attrs).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });

  return node;
}

function dailyExpenses() {
  const p = currentPeriod();
  const count = daysBetween(p.start, p.end) + 1;

  const days = Array.from({ length: count }, (_, index) => ({
    date: addDays(p.start, index),
    amount: 0,
    items: []
  }));

  const byDate = new Map(days.map(day => [day.date, day]));

  const undated = [];
  const outside = [];

  p.expenses.forEach(item => {
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

  return { days, undated, outside };
}

function drawChart(svg, days, large = false) {
  svg.replaceChildren();

  const left = large ? 12 : 3;
  const right = large ? 328 : 337;
  const top = large ? 15 : 5;
  const bottom = large ? 154 : 61;

  const width = right - left;
  const height = bottom - top;

  const max = Math.max(0, ...days.map(day => day.amount));

  const lines = large ? 4 : 3;

  for (let i = 0; i < lines; i++) {
    const y = top + i / (lines - 1) * height;

    svg.append(
      svgNode("line", {
        x1: left,
        y1: y,
        x2: right,
        y2: y,
        stroke: "#405557",
        "stroke-dasharray": "3 5"
      })
    );
  }

  if (!days.length) return;

  const points = days.map((day, index) => ({
    x: days.length === 1
      ? left + width / 2
      : left + index / (days.length - 1) * width,

    y: max > 0
      ? bottom - day.amount / max * height
      : bottom
  }));

  if (max === 0) {
    svg.append(
      svgNode("line", {
        x1: left,
        y1: bottom,
        x2: right,
        y2: bottom,
        stroke: "#718783",
        "stroke-width": 2
      })
    );
    return;
  }

  const path = points.map((point, index) =>
    (index ? "L" : "M") +
    point.x.toFixed(2) + " " +
    point.y.toFixed(2)
  ).join(" ");

  svg.append(
    svgNode("path", {
      d:
        path +
        " L" + points[points.length - 1].x + " " + bottom +
        " L" + points[0].x + " " + bottom +
        " Z",
      fill: "#e5a267",
      "fill-opacity": ".13"
    }),

    svgNode("path", {
      d: path,
      fill: "none",
      stroke: "#e5a267",
      "stroke-width": large ? 2.8 : 2.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    })
  );

  const candidates = days
    .map((day, index) => ({ ...day, index }))
    .filter(day => day.amount > 0);

  const visible = large
    ? candidates
    : candidates
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 4);

  visible.forEach(day => {
    const point = points[day.index];

    if (!large) {
      svg.append(
        svgNode("circle", {
          cx: point.x,
          cy: point.y,
          r: 3.5,
          fill: "#e5a267"
        })
      );
      return;
    }

    const group = svgNode("g", {
      role: "button",
      tabindex: "0",
      "aria-label": longDate(day.date) + ", " + money(day.amount),
      style: "cursor:pointer"
    });

    group.append(
      svgNode("circle", {
        cx: point.x,
        cy: point.y,
        r: 12,
        fill: "transparent"
      }),
      svgNode("circle", {
        cx: point.x,
        cy: point.y,
        r: 4,
        fill: "#e5a267",
        stroke: "#263438",
        "stroke-width": 1.5
      })
    );

    group.onclick = () => showChartDay(day);

    group.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showChartDay(day);
      }
    };

    svg.append(group);
  });
}

function showChartDay(day) {
  const container = $("chartDetails");
  container.replaceChildren();

  const heading = el("div", "", "chart-detail-heading");

  heading.append(
    el("strong", longDate(day.date)),
    el("strong", money(day.amount))
  );

  container.append(heading);

  day.items.forEach(item => {
    const row = el("div", "", "chart-detail-item");

    row.append(
      el("span", item.name),
      el("span", money(item.amount))
    );

    container.append(row);
  });
}

function renderMiniChart() {
  const p = currentPeriod();
  const chart = dailyExpenses();

  $("miniStart").textContent = formatDate(p.start);
  $("miniEnd").textContent = formatDate(p.end);

  drawChart($("miniChart"), chart.days);
}

function renderLargeChart() {
  const p = currentPeriod();
  const chart = dailyExpenses();

  const total = sum(chart.days);
  const biggest = Math.max(
    0,
    ...chart.days.map(day => day.amount)
  );

  $("chartPeriod").textContent =
    longDate(p.start) + " – " + longDate(p.end);

  $("chartStart").textContent = formatDate(p.start);
  $("chartEnd").textContent = formatDate(p.end);
  $("chartTotal").textContent = money(total);
  $("chartMax").textContent = money(biggest);

  drawChart($("largeChart"), chart.days, true);

  const paidDays = chart.days.filter(day => day.amount > 0);
  const details = $("chartDetails");

  details.replaceChildren();

  if (!paidDays.length) {
    details.append(
      el("p", "Inga daterade betalningar ännu.", "empty")
    );
  } else {
    const biggestDay = paidDays.reduce(
      (a, b) => a.amount >= b.amount ? a : b
    );

    showChartDay(biggestDay);
  }

  if (chart.undated.length || chart.outside.length) {
    const note = el("p", "", "chart-note");

    const parts = [];

    if (chart.undated.length) {
      parts.push(
        chart.undated.length +
        " betalningar saknar betalningsdatum"
      );
    }

    if (chart.outside.length) {
      parts.push(
        chart.outside.length +
        " betalningar ligger utanför perioden"
      );
    }

    note.textContent = parts.join(" • ");
    details.append(note);
  }
}

$("chartOpenBtn").onclick = () => {
  renderLargeChart();
  $("chartDialog").showModal();
};

$("closeChart").onclick = () =>
  $("chartDialog").close();

$("closeChartBottom").onclick = () =>
  $("chartDialog").close();

/* ==========================================
   HUVUDRENDERING
   ========================================== */

function render() {
  renderOverview();
  renderCategories();
  renderSales();
  renderMiniChart();

  if ($("chartDialog").open) {
    renderLargeChart();
  }
}

/* ==========================================
   STARTA APPEN
   ========================================== */

render();
