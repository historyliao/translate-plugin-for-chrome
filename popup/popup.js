const translationEnabledInput = document.querySelector("#translation-enabled");
const translationStatus = document.querySelector("#translation-status");
const openOptionsButton = document.querySelector("#open-options");
const errorMessage = document.querySelector("#error");
let translationEnabled = true;

loadTranslationState();

translationEnabledInput.addEventListener("change", async () => {
  const previousTranslationEnabled = translationEnabled;
  const nextTranslationEnabled = translationEnabledInput.checked;
  translationEnabledInput.disabled = true;
  errorMessage.textContent = "";

  try {
    await chrome.storage.local.set({ translationEnabled: nextTranslationEnabled });
    translationEnabled = nextTranslationEnabled;
    renderTranslationState();
  } catch {
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
  } catch {
    errorMessage.textContent = "无法打开设置页，请重试";
  }
});

async function loadTranslationState() {
  try {
    const settings = await chrome.storage.local.get("translationEnabled");
    translationEnabled = settings.translationEnabled !== false;
  } catch {
    errorMessage.textContent = "无法读取翻译状态，已按开启处理";
  }
  renderTranslationState();
  translationEnabledInput.disabled = false;
}

function renderTranslationState() {
  translationEnabledInput.checked = translationEnabled;
  translationStatus.textContent = translationEnabled ? "已开启" : "已关闭";
  translationStatus.className = `translation-status ${translationEnabled ? "enabled" : "disabled"}`;
}
