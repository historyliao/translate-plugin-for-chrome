const EMPTY_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0
};
const numberFormatter = new Intl.NumberFormat("zh-CN");
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const tabButtons = Array.from(document.querySelectorAll(".tab"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const translationEnabledInput = document.querySelector("#translation-enabled");
const translationStatus = document.querySelector("#translation-status");
const openOptionsButton = document.querySelector("#open-options");
const resetTokenUsageButton = document.querySelector("#reset-token-usage");
const clearLogsButton = document.querySelector("#clear-logs");
const filterButtons = Array.from(document.querySelectorAll(".filter"));
const errorMessage = document.querySelector("#error");
const dailyChart = document.querySelector("#daily-chart");
const chartEmpty = document.querySelector("#chart-empty");
const modelUsageList = document.querySelector("#model-usage");
const modelsEmpty = document.querySelector("#models-empty");
const dailyUsageList = document.querySelector("#daily-usage");
const dailyEmpty = document.querySelector("#daily-empty");
const runtimeLogsList = document.querySelector("#runtime-logs");
const logsEmpty = document.querySelector("#logs-empty");
let translationEnabled = true;
let tokenUsage = null;
let runtimeLogs = [];
let logLevel = "all";

loadPopupData();

for (const button of tabButtons) {
  button.addEventListener("click", () => selectTab(button));
}

translationEnabledInput.addEventListener("change", async () => {
  const previousTranslationEnabled = translationEnabled;
  const nextTranslationEnabled = translationEnabledInput.checked;
  translationEnabledInput.disabled = true;
  errorMessage.textContent = "";

  try {
    await chrome.storage.local.set({ translationEnabled: nextTranslationEnabled });
    translationEnabled = nextTranslationEnabled;
    renderTranslationState();
  } catch (error) {
    console.error("Failed to save translation status", error);
    reportRuntimeLog("translation_state_write_failed");
    translationEnabled = previousTranslationEnabled;
    renderTranslationState();
    errorMessage.textContent = "无法保存翻译状态，请重试";
  } finally {
    translationEnabledInput.disabled = false;
  }
});

openOptionsButton.addEventListener("click", async () => {
  errorMessage.textContent = "";
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (error) {
    console.error("Failed to open options page", error);
    reportRuntimeLog("open_options_failed");
    errorMessage.textContent = "无法打开设置页，请重试";
  }
});

resetTokenUsageButton.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "将永久清除历史总量、模型统计和每日统计，此操作不会清除日志，是否继续？"
  );
  if (!confirmed) {
    return;
  }

  resetTokenUsageButton.disabled = true;
  errorMessage.textContent = "";
  try {
    await runMonitoringCommand("reset-token-usage");
    tokenUsage = null;
    renderTokenUsage();
  } catch (error) {
    console.error("Failed to reset token usage", error);
    errorMessage.textContent = "重置 Token 统计失败，请重试";
  } finally {
    resetTokenUsageButton.disabled = false;
  }
});

clearLogsButton.addEventListener("click", async () => {
  clearLogsButton.disabled = true;
  errorMessage.textContent = "";
  try {
    await runMonitoringCommand("clear-runtime-logs");
    runtimeLogs = [];
    renderLogs();
  } catch (error) {
    console.error("Failed to clear runtime logs", error);
    errorMessage.textContent = "清空日志失败，请重试";
  } finally {
    clearLogsButton.disabled = runtimeLogs.length === 0;
  }
});

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    logLevel = button.dataset.level;
    for (const filterButton of filterButtons) {
      filterButton.classList.toggle("active", filterButton === button);
    }
    renderLogs();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes.translationEnabled) {
    translationEnabled = changes.translationEnabled.newValue !== false;
    renderTranslationState();
  }
  if (changes.tokenUsage) {
    tokenUsage = changes.tokenUsage.newValue || null;
    renderTokenUsage();
  }
  if (changes.runtimeLogs) {
    runtimeLogs = Array.isArray(changes.runtimeLogs.newValue)
      ? changes.runtimeLogs.newValue
      : [];
    renderLogs();
  }
});

async function loadPopupData() {
  try {
    const settings = await chrome.storage.local.get([
      "translationEnabled",
      "tokenUsage",
      "runtimeLogs"
    ]);
    translationEnabled = settings.translationEnabled !== false;
    tokenUsage = settings.tokenUsage || null;
    runtimeLogs = Array.isArray(settings.runtimeLogs) ? settings.runtimeLogs : [];
  } catch (error) {
    console.error("Failed to read popup data", error);
    reportRuntimeLog("popup_data_read_failed");
    errorMessage.textContent = "无法读取控制面板数据，请重试";
  }
  renderTranslationState();
  renderTokenUsage();
  renderLogs();
  translationEnabledInput.disabled = false;
}

function selectTab(selectedButton) {
  for (const button of tabButtons) {
    const selected = button === selectedButton;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.id !== selectedButton.dataset.panel;
  }
  errorMessage.textContent = "";
}

function renderTranslationState() {
  translationEnabledInput.checked = translationEnabled;
  translationStatus.textContent = translationEnabled ? "已开启" : "已关闭";
  translationStatus.className = `translation-status ${translationEnabled ? "enabled" : "disabled"}`;
}

function renderTokenUsage() {
  const total = tokenUsage?.total || EMPTY_USAGE;
  const today = tokenUsage?.byDate?.[getLocalDateKey(new Date())] || EMPTY_USAGE;
  renderMetric("history", total);
  renderMetric("today", today);
  renderDailyChart();
  renderUsageList(
    modelUsageList,
    modelsEmpty,
    Object.entries(tokenUsage?.byModel || {})
      .sort((left, right) => right[1].totalTokens - left[1].totalTokens)
  );

  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - 89);
  const cutoffKey = getLocalDateKey(cutoff);
  const todayKey = getLocalDateKey(now);
  const dailyEntries = Object.entries(tokenUsage?.byDate || {})
    .filter(([dateKey]) => dateKey >= cutoffKey && dateKey <= todayKey)
    .sort((left, right) => right[0].localeCompare(left[0]));
  renderUsageList(dailyUsageList, dailyEmpty, dailyEntries);
}

function renderMetric(prefix, usage) {
  document.querySelector(`#${prefix}-total`).textContent = formatTokens(usage.totalTokens);
  document.querySelector(`#${prefix}-prompt`).textContent = formatTokens(usage.promptTokens);
  document.querySelector(`#${prefix}-completion`).textContent = formatTokens(usage.completionTokens);
}

function renderDailyChart() {
  const days = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const usage = tokenUsage?.byDate?.[getLocalDateKey(date)] || EMPTY_USAGE;
    days.push({ date, usage });
  }

  const maximum = Math.max(...days.map(({ usage }) => usage.totalTokens));
  dailyChart.replaceChildren();
  dailyChart.hidden = maximum === 0;
  chartEmpty.hidden = maximum !== 0;
  if (maximum === 0) {
    return;
  }

  for (const { date, usage } of days) {
    const column = document.createElement("div");
    column.className = "chart-column";
    column.title = `${date.toLocaleDateString("zh-CN")}：${formatTokens(usage.totalTokens)} Token`;

    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = formatTokens(usage.totalTokens);
    const barArea = document.createElement("div");
    barArea.className = "chart-bar-area";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.round((usage.totalTokens / maximum) * 100)}%`;
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = `${date.getMonth() + 1}/${date.getDate()}`;

    barArea.appendChild(bar);
    column.append(value, barArea, label);
    dailyChart.appendChild(column);
  }
}

function renderUsageList(list, emptyState, entries) {
  list.replaceChildren();
  emptyState.hidden = entries.length > 0;
  for (const [title, usage] of entries) {
    const item = document.createElement("li");
    item.className = "usage-item";
    const heading = document.createElement("p");
    heading.className = "usage-title";
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.className = "usage-detail";
    detail.textContent = `输入 ${formatTokens(usage.promptTokens)} · 输出 ${formatTokens(usage.completionTokens)} · 总计 ${formatTokens(usage.totalTokens)}`;
    item.append(heading, detail);
    list.appendChild(item);
  }
}

function renderLogs() {
  const visibleLogs = runtimeLogs
    .filter((log) => logLevel === "all" || log.level === logLevel)
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp);
  runtimeLogsList.replaceChildren();
  logsEmpty.hidden = visibleLogs.length > 0;
  clearLogsButton.disabled = runtimeLogs.length === 0;

  for (const log of visibleLogs) {
    const level = log.level === "error" ? "error" : "info";
    const item = document.createElement("li");
    item.className = `log-item ${level}-level`;
    const meta = document.createElement("div");
    meta.className = "log-meta";
    const levelLabel = document.createElement("span");
    levelLabel.textContent = level === "error" ? "错误" : "信息";
    const timestamp = document.createElement("time");
    timestamp.textContent = timeFormatter.format(new Date(log.timestamp));
    const message = document.createElement("p");
    message.className = "log-message";
    message.textContent = log.message;
    const model = document.createElement("p");
    model.className = "log-model";
    model.textContent = `模型：${log.model || "-"}`;

    meta.append(levelLabel, timestamp);
    item.append(meta, message, model);
    runtimeLogsList.appendChild(item);
  }
}

function formatTokens(value) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function runMonitoringCommand(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    throw new Error("MONITORING_COMMAND_FAILED");
  }
}

function reportRuntimeLog(event) {
  try {
    chrome.runtime.sendMessage({ type: "runtime-log", event })
      .catch((error) => console.error("Failed to report runtime log", error));
  } catch (error) {
    console.error("Failed to report runtime log", error);
  }
}
