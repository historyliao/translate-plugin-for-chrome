const form = document.querySelector("#settings-form");
const baseUrlInput = document.querySelector("#base-url");
const tokenInput = document.querySelector("#token");
const modelInput = document.querySelector("#model");
const status = document.querySelector("#status");
const toggleToken = document.querySelector("#toggle-token");
let tokenConfigured = false;

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";

  const baseUrl = baseUrlInput.value.trim();
  const model = modelInput.value.trim();
  const token = tokenInput.value.trim();

  if (!isValidBaseUrl(baseUrl)) {
    showStatus("Base URL 必须是有效的 http 或 https 地址", true);
    return;
  }
  if (!model) {
    showStatus("Model 不能为空", true);
    return;
  }

  if (!token && !tokenConfigured) {
    showStatus("Token 不能为空", true);
    return;
  }

  const values = { baseUrl, model };
  if (token) {
    values.token = token;
    values.tokenConfigured = true;
  }
  await chrome.storage.local.set(values);
  tokenConfigured = tokenConfigured || Boolean(token);
  tokenInput.value = "";
  showStatus("配置已保存", false);
});

toggleToken.addEventListener("click", () => {
  const isPassword = tokenInput.type === "password";
  tokenInput.type = isPassword ? "text" : "password";
  toggleToken.textContent = isPassword ? "隐藏" : "显示";
});

async function loadSettings() {
  const settings = await chrome.storage.local.get(["baseUrl", "model", "tokenConfigured"]);
  baseUrlInput.value = settings.baseUrl || "";
  modelInput.value = settings.model || "";
  tokenConfigured = settings.tokenConfigured === true;
}

function isValidBaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.search &&
      !url.hash &&
      !/\s/.test(value)
    );
  } catch {
    return false;
  }
}

function showStatus(message, isError) {
  status.textContent = message;
  status.className = `status${isError ? " error" : ""}`;
}
