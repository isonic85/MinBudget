
const STORAGE_KEY = "minbudget_v2";
const OLD_STORAGE_KEY = "minbudget_v1";

const categories = {
  behov: {
    name: "Behov",
    percent: 50,
    color: "#167c80"
  },
  onskemal: {
    name: "Önskemål",
    percent: 30,
    color: "#e88b43"
  },
  framtid: {
    name: "Framtid",
    percent: 20,
    color: "#3e956a"
  }
};

const typeNames = {
  fast: "Fast kostnad",
  rorlig: "Rörlig kostnad",
  lan: "Lån",
  sparande: "Sparande"
};

const $ = id => document.getElementById(id);

const money = amount => new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(amount);

function currentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0");
}

function validMonth(value) {
  return typeof value === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function shiftMonth(month, offset) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + offset, 1);

  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0");
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);

  const label = new Intl.DateTimeFormat("sv-SE", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, number - 1, 1));

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeExpense(item) {
  return {
    id: String(item.id || crypto.randomUUID()),
    name: String(item.name || "Namnlös post"),
    amount: Number(item.amount),
    category: categories[item.category]
      ? item.category : "behov",
    type: typeNames[item.type]
      ? item.type : "rorlig"
  };
}

function validateDatabase(value) {
  if (!value || typeof value !== "object" ||
      !value.months || typeof value.months !== "object" ||
      Array.isArray(value.months)) {
    throw new Error("Ogiltig säkerhetskopia.");
  }

  const months = {};

  for (const [key, month] of Object.entries(value.months)) {
    if (!validMonth(key) ||
        !month || !Array.isArray(month.expenses) ||
        !Number.isFinite(Number(month.income)) ||
        Number(month.income) < 0) {
      throw new Error("Ogiltiga månadsuppgifter.");
    }

    const expenses = month.expenses.map(item => {
      if (!item || typeof item.name !== "string" ||
          !item.name.trim() ||
          !Number.isFinite(Number(item.amount)) ||
          Number(item.amount) <= 0 ||
          !categories[item.category] ||
          !typeNames[item.type]) {
        throw new Error("Ogiltig kostnad i säkerhetskopian.");
      }

      return normalizeExpense(item);
    });

    months[key] = {
      income: Number(month.income),
      expenses
    };
  }

  return { months };
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      return validateDatabase(JSON.parse(saved));
    }
  } catch (error) {
    console.error("Kunde inte läsa version 2:", error);
    alert("Sparade uppgifter kunde inte läsas. " +
          "Ingenting har skrivits över.");
    throw error;
  }

  // Migrera tidigare MinBudget version 1.
  const old = localStorage.getItem(OLD_STORAGE_KEY);

  if (old) {
    try {
      const parsed = JSON.parse(old);

      if (!Array.isArray(parsed.expenses)) {
        throw new Error("Ogiltigt äldre format");
      }

      const migrated = {
        months: {
          [currentMonth()]: {
            income: Number(parsed.income) || 0,
            expenses: parsed.expenses.map(normalizeExpense)
          }
        }
      };

      const checked = validateDatabase(migrated);

      // Gamla uppgifter lämnas orörda.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(checked)
      );

      return checked;
    } catch (error) {
      console.error("Migrering misslyckades:", error);
      alert("Kunde inte föra över gamla uppgifter. " +
            "De gamla uppgifterna har inte raderats.");
      throw error;
    }
  }

  return { months: {} };
}

let data = loadData();
let selectedMonth = currentMonth();
let editingId = null;

const expanded = {
  behov: true,
  onskemal: true,
  framtid: true
};

function saveData() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(data)
    );
  } catch (error) {
    alert("Kunde inte spara. Kontrollera webbläsarens lagring.");
    throw error;
  }
}

function ensureMonth(month) {
  if (!data.months[month]) {
    data.months[month] = {
      income: 0,
      expenses: []
    };
  }
  return data.months[month];
}

function getMonth() {
  return ensureMonth(selectedMonth);
}

function createElement(tag, text, className) {
  const element = document.createElement(tag);

  if (text !== undefined) {
    element.textContent = text;
  }

  if (className) {
    element.className = className;
  }

  return element;
}

function renderSummary() {
  const month = getMonth();

  const total = month.expenses.reduce(
    (sum, item) => sum + item.amount, 0
  );

  const remaining = month.income - total;

  $("totalIncome").textContent = money(month.income);
  $("totalExpenses").textContent = money(total);
  $("remaining").textContent = money(remaining);

  $("remaining").classList.toggle(
    "negative", remaining < 0
  );
}

function renderCategories() {
  const month = getMonth();
  const container = $("categories");

  container.replaceChildren();

  for (const [key, category] of Object.entries(categories)) {
    const items = month.expenses.filter(
      item => item.category === key
    );

    const spent = items.reduce(
      (sum, item) => sum + item.amount, 0
    );

    const target = month.income * category.percent / 100;

    const usage = target > 0
      ? spent / target * 100
      : spent > 0 ? 100 : 0;

    const wrapper = createElement("div", "", "category");
    const heading = createElement(
      "button", "", "category-heading"
    );

    heading.type = "button";
    heading.setAttribute("aria-expanded", expanded[key]);

    heading.append(
      createElement(
        "span",
        `${category.percent}% – ${category.name}`
      ),
      createElement(
        "strong",
        `${money(spent)} ${expanded[key] ? "⌃" : "⌄"}`
      )
    );

    heading.addEventListener("click", () => {
      expanded[key] = !expanded[key];
      renderCategories();
    });

    const description = createElement(
      "small",
      `Riktmärke: ${money(target)} • ` +
      `Kvar: ${money(target - spent)}`
    );

    const progress = createElement("div", "", "progress");
    const fill = createElement("div", "", "progress-fill");

    fill.style.width = `${Math.min(100, usage)}%`;
    fill.style.background = category.color;

    progress.append(fill);
    wrapper.append(heading, description, progress);

    if (expanded[key]) {
      const list = createElement(
        "div", "", "category-items"
      );

      if (items.length === 0) {
        list.append(
          createElement(
            "p",
            "Inga poster i denna kategori ännu.",
            "muted small-text"
          )
        );
      }

      items.forEach(item => {
        const row = createElement(
          "div", "", "category-item"
        );

        row.append(
          createElement("span", item.name),
          createElement("strong", money(item.amount))
        );

        list.append(row);
      });

      wrapper.append(list);
    }

    container.append(wrapper);
  }
}

function startEdit(id) {
  const item = getMonth().expenses.find(
    expense => expense.id === id
  );

  if (!item) return;

  editingId = id;

  $("expenseName").value = item.name;
  $("expenseAmount").value = item.amount;
  $("expenseCategory").value = item.category;
  $("expenseType").value = item.type;

  $("formTitle").textContent = "✏️ Redigera post";
  $("saveExpense").textContent = "Spara ändringar";
  $("cancelEdit").classList.remove("hidden");

  $("expenseForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function resetForm() {
  editingId = null;
  $("expenseForm").reset();
  $("formTitle").textContent = "➕ Lägg till en post";
  $("saveExpense").textContent = "+ Lägg till";
  $("cancelEdit").classList.add("hidden");
}

function renderExpenses() {
  const list = $("expenseList");
  const expenses = getMonth().expenses;

  list.replaceChildren();

  if (expenses.length === 0) {
    list.append(
      createElement(
        "p",
        "Inga poster registrerade denna månad.",
        "empty"
      )
    );
    return;
  }

  expenses.forEach(item => {
    const row = createElement("div", "", "expense");
    const info = createElement("div");

    info.append(
      createElement("strong", item.name),
      createElement(
        "small",
        `${categories[item.category].name} • ` +
        typeNames[item.type]
      )
    );

    const right = createElement(
      "div", "", "expense-right"
    );

    const edit = createElement(
      "button", "✎", "edit-btn"
    );

    edit.type = "button";
    edit.setAttribute("aria-label", "Redigera " + item.name);
    edit.onclick = () => startEdit(item.id);

    const remove = createElement(
      "button", "✕", "delete-btn"
    );

    remove.type = "button";
    remove.setAttribute("aria-label", "Ta bort " + item.name);

    remove.onclick = () => {
      if (!confirm(`Ta bort "${item.name}"?`)) return;

      getMonth().expenses = getMonth().expenses.filter(
        expense => expense.id !== item.id
      );

      saveData();
      resetForm();
      render();
    };

    right.append(
      createElement("strong", money(item.amount)),
      edit,
      remove
    );

    row.append(info, right);
    list.append(row);
  });
}

function render() {
  $("monthTitle").textContent = monthLabel(selectedMonth);
  $("income").value = getMonth().income || "";

  renderSummary();
  renderCategories();
  renderExpenses();
}

function changeMonth(offset) {
  resetForm();
  selectedMonth = shiftMonth(selectedMonth, offset);
  render();
}

// Inkomst

$("income").addEventListener("change", event => {
  const amount = Number(event.target.value);

  if (!Number.isFinite(amount) || amount < 0) {
    alert("Ange en giltig inkomst.");
    render();
    return;
  }

  getMonth().income = amount;
  saveData();
  render();
});

// Kostnader

$("expenseForm").addEventListener("submit", event => {
  event.preventDefault();

  const name = $("expenseName").value.trim();
  const amount = Number($("expenseAmount").value);
  const category = $("expenseCategory").value;
  const type = $("expenseType").value;

  if (!name ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !categories[category] ||
      !typeNames[type]) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  const month = getMonth();

  if (editingId) {
    const item = month.expenses.find(
      expense => expense.id === editingId
    );

    if (item) {
      Object.assign(item, {
        name, amount, category, type
      });
    }
  } else {
    month.expenses.push({
      id: crypto.randomUUID(),
      name,
      amount,
      category,
      type
    });
  }

  saveData();
  resetForm();
  render();
});

$("cancelEdit").onclick = resetForm;

$("prevMonth").onclick = () => changeMonth(-1);
$("nextMonth").onclick = () => changeMonth(1);

// Kopiera månad manuellt

$("createMonth").onclick = () => {
  const source = getMonth();
  const list = $("copyList");

  list.replaceChildren();

  $("targetMonth").value = shiftMonth(selectedMonth, 1);
  $("copyIncome").checked = true;

  if (source.expenses.length === 0) {
    list.append(
      createElement("p", "Inga poster att kopiera.", "muted")
    );
  }

  source.expenses.forEach(item => {
    const label = createElement(
      "label", "", "check-row"
    );

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.id;

    // Fasta kostnader och lån förvalda.
    checkbox.checked =
      item.type === "fast" || item.type === "lan";

    label.append(
      checkbox,
      createElement(
        "span",
        `${item.name} – ${money(item.amount)}`
      )
    );

    list.append(label);
  });

  $("copyDialog").showModal();
};

$("cancelCopy").onclick = () => {
  $("copyDialog").close();
};

$("confirmCopy").onclick = () => {
  const target = $("targetMonth").value;

  if (!validMonth(target)) {
    alert("Välj en giltig månad.");
    return;
  }

  if (target === selectedMonth) {
    alert("Välj en annan månad.");
    return;
  }

  if (data.months[target]) {
    alert("Månaden finns redan. Välj en annan månad.");
    return;
  }

  const source = getMonth();

  const selectedIds = new Set(
    [...$("copyList").querySelectorAll(
      'input[type="checkbox"]:checked'
    )].map(input => input.value)
  );

  const expenses = source.expenses
    .filter(item => selectedIds.has(item.id))
    .map(item => ({
      ...item,
      id: crypto.randomUUID()
    }));

  data.months[target] = {
    income: $("copyIncome").checked
      ? source.income : 0,
    expenses
  };

  saveData();
  selectedMonth = target;
  resetForm();

  $("copyDialog").close();
  render();
};

// Exportera säkerhetskopia

$("exportData").onclick = () => {
  const content = JSON.stringify({
    app: "MinBudget",
    version: 2,
    exportedAt: new Date().toISOString(),
    months: data.months
  }, null, 2);

  const blob = new Blob([content], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "minbudget-backup-" +
    currentMonth() + ".json";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Importera säkerhetskopia

$("importFile").addEventListener("change", async event => {
  const file = event.target.files[0];

  if (!file) return;

  try {
    const content = await file.text();
    const imported = validateDatabase(
      JSON.parse(content)
    );

    const confirmed = confirm(
      "Importen ersätter alla dina nuvarande " +
      "månader. Vill du fortsätta?"
    );

    if (!confirmed) return;

    // Spara först, byt därefter aktiv data.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(imported)
    );

    data = imported;
    selectedMonth = currentMonth();
    resetForm();
    render();

    alert("Säkerhetskopian har återställts.");
  } catch (error) {
    console.error(error);
    alert("Kunde inte importera filen.");
  } finally {
    event.target.value = "";
  }
});

// Starta appen

render();
