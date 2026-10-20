
const STORAGE_KEY = "minbudget_v1";

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

function loadData() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY)
    );

    if (saved && Array.isArray(saved.expenses)) {
      return saved;
    }
  } catch (error) {
    console.warn("Kunde inte läsa sparade data", error);
  }

  return { income: 0, expenses: [] };
}

let data = loadData();

const incomeInput = document.getElementById("income");
const form = document.getElementById("expenseForm");
const expenseList = document.getElementById("expenseList");
const categoryContainer = document.getElementById("categories");

incomeInput.value = data.income || "";

function formatMoney(amount) {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2
  }).format(amount);
}

function saveData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(data)
  );
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
  const income = Number(data.income) || 0;

  const total = data.expenses.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );

  const remaining = income - total;

  document.getElementById("totalIncome")
    .textContent = formatMoney(income);

  document.getElementById("totalExpenses")
    .textContent = formatMoney(total);

  const remainingElement =
    document.getElementById("remaining");

  remainingElement.textContent = formatMoney(remaining);
  remainingElement.classList.toggle(
    "negative", remaining < 0
  );
}

function renderCategories() {
  categoryContainer.replaceChildren();

  Object.entries(categories).forEach(([key, category]) => {
    const budget = data.income * category.percent / 100;

    const spent = data.expenses
      .filter(item => item.category === key)
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const usage = budget > 0
      ? spent / budget * 100
      : spent > 0 ? 100 : 0;

    const wrapper = createElement("div", "", "category");
    const top = createElement("div", "", "category-top");

    top.append(
      createElement(
        "span",
        `${category.percent}% – ${category.name}`
      ),
      createElement("span", formatMoney(spent))
    );

    const description = createElement(
      "small",
      `Riktmärke: ${formatMoney(budget)} • ` +
      `Kvar: ${formatMoney(budget - spent)}`
    );

    const progress = createElement("div", "", "progress");
    const fill = createElement("div", "", "progress-fill");

    fill.style.width = `${Math.min(usage, 100)}%`;
    fill.style.background = category.color;

    progress.appendChild(fill);
    wrapper.append(top, description, progress);
    categoryContainer.appendChild(wrapper);
  });
}

function renderExpenses() {
  expenseList.replaceChildren();

  if (data.expenses.length === 0) {
    expenseList.appendChild(
      createElement(
        "p",
        "Du har inte lagt till några poster ännu.",
        "empty"
      )
    );
    return;
  }

  data.expenses.forEach(item => {
    const row = createElement("div", "", "expense");
    const info = createElement("div");

    const name = createElement("strong", item.name);

    const categoryName =
      categories[item.category]?.name || "Övrigt";

    const typeName =
      typeNames[item.type] || "Kostnad";

    const description = createElement(
      "small",
      `${categoryName} • ${typeName}`
    );

    info.append(name, description);

    const right = createElement("div", "", "expense-right");

    const amount = createElement(
      "strong",
      formatMoney(item.amount)
    );

    const deleteButton = createElement(
      "button",
      "✕",
      "delete-btn"
    );

    deleteButton.type = "button";
    deleteButton.setAttribute(
      "aria-label",
      `Ta bort ${item.name}`
    );

    deleteButton.addEventListener("click", () => {
      if (confirm(`Ta bort "${item.name}"?`)) {
        data.expenses = data.expenses.filter(
          expense => expense.id !== item.id
        );
        saveData();
        render();
      }
    });

    right.append(amount, deleteButton);
    row.append(info, right);
    expenseList.appendChild(row);
  });
}

function render() {
  renderSummary();
  renderCategories();
  renderExpenses();
}

incomeInput.addEventListener("input", event => {
  const value = Number(event.target.value);
  data.income = Number.isFinite(value)
    ? Math.max(0, value)
    : 0;

  saveData();
  render();
});

form.addEventListener("submit", event => {
  event.preventDefault();

  const name = document
    .getElementById("expenseName")
    .value.trim();

  const amount = Number(
    document.getElementById("expenseAmount").value
  );

  const category = document
    .getElementById("expenseCategory").value;

  const type = document
    .getElementById("expenseType").value;

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !categories[category] ||
    !typeNames[type]
  ) {
    alert("Kontrollera uppgifterna.");
    return;
  }

  data.expenses.push({
    id: crypto.randomUUID(),
    name,
    amount,
    category,
    type
  });

  saveData();
  form.reset();
  render();
});

render();
