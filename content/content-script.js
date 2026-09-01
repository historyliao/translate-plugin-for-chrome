(() => {
  let overlayHost = null;
  let shadowRoot = null;
  let requestId = 0;
  let anchorRange = null;
  let translationPort = null;
  let translationContent = "";
  let translationEnabled;

  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("scroll", repositionOverlay, true);
  window.addEventListener("resize", repositionOverlay);
  window.addEventListener("pagehide", cancelTranslation);
  chrome.storage.onChanged.addListener(handleStorageChange);

  loadTranslationState();

  function handleMouseDown(event) {
    if (!overlayHost || overlayHost.contains(event.target)) {
      return;
    }

    const selection = window.getSelection();
    if (selection?.rangeCount && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      const inSelection = Array.from(range.getClientRects()).some((rect) => (
        event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom
      ));
      if (inSelection) {
        return;
      }
    }
    closeOverlay();
  }

  function handleMouseUp(event) {
    if (
      translationEnabled !== true ||
      event.button !== 0 ||
      (overlayHost && overlayHost.contains(event.target))
    ) {
      return;
    }

    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (!text || !/[A-Za-z]/.test(text) || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return;
    }

    anchorRange = range.cloneRange();
    cancelTranslation();
    translationContent = "";
    const currentRequestId = ++requestId;
    showOverlay("翻译中…");

    const port = chrome.runtime.connect({ name: "translation" });
    translationPort = port;

    port.onMessage.addListener((message) => {
      if (
        currentRequestId !== requestId ||
        translationPort !== port ||
        !overlayHost
      ) {
        return;
      }

      if (message?.type === "chunk" && typeof message.content === "string") {
        translationContent += message.content;
        showOverlay(translationContent);
      } else if (message?.type === "done") {
        translationPort = null;
        port.disconnect();
      } else if (message?.type === "error") {
        const error = message.error || "翻译服务请求失败，请稍后重试";
        translationPort = null;
        port.disconnect();
        showTranslationError(error);
      }
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (currentRequestId !== requestId || translationPort !== port) {
        return;
      }
      translationPort = null;
      showTranslationError("翻译服务连接已中断");
    });

    try {
      port.postMessage({ type: "translate", text });
    } catch {
      translationPort = null;
      port.disconnect();
      showTranslationError("翻译服务请求失败，请重新加载插件和当前页面");
    }
  }

  function showOverlay(content, isError = false, interruption = "") {
    if (!overlayHost) {
      overlayHost = document.createElement("div");
      overlayHost.setAttribute("data-english-to-chinese-translator", "");
      overlayHost.style.position = "fixed";
      overlayHost.style.zIndex = "2147483647";
      overlayHost.style.pointerEvents = "auto";
      shadowRoot = overlayHost.attachShadow({ mode: "closed" });
      document.documentElement.appendChild(overlayHost);
    }

    shadowRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .translation {
          box-sizing: border-box;
          max-width: min(420px, calc(100vw - 24px));
          max-height: min(320px, calc(100vh - 24px));
          overflow: auto;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #ffffff;
          color: #111827;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
          font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .loading { color: #4b5563; }
        .error { color: #b91c1c; }
        .interruption {
          display: block;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #fecaca;
          color: #b91c1c;
        }
      </style>
      <div class="translation ${isError ? "error" : content === "翻译中…" ? "loading" : ""}" role="status">
        <span>${escapeHtml(content)}</span>
        ${interruption ? `<span class="interruption">翻译中断：${escapeHtml(interruption)}</span>` : ""}
      </div>
    `;
    repositionOverlay();
  }

  function showTranslationError(error) {
    if (translationContent) {
      showOverlay(translationContent, false, error);
    } else {
      showOverlay(error, true);
    }
  }

  function repositionOverlay() {
    if (!overlayHost || !anchorRange) {
      return;
    }

    const panel = shadowRoot.querySelector(".translation");
    if (!panel) {
      return;
    }

    const anchorRect = anchorRange.getBoundingClientRect();
    if (!anchorRect.width && !anchorRect.height) {
      closeOverlay();
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(
      12,
      Math.min(anchorRect.left, window.innerWidth - panelRect.width - 12)
    );
    let top = anchorRect.bottom + gap;
    if (top + panelRect.height > window.innerHeight - 12) {
      top = anchorRect.top - panelRect.height - gap;
    }
    overlayHost.style.left = `${Math.round(left)}px`;
    overlayHost.style.top = `${Math.max(12, Math.round(top))}px`;
  }

  function closeOverlay() {
    requestId += 1;
    cancelTranslation();
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
      anchorRange = null;
    }
  }

  function cancelTranslation() {
    if (translationPort) {
      const port = translationPort;
      translationPort = null;
      port.disconnect();
    }
    translationContent = "";
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes.translationEnabled) {
      return;
    }

    translationEnabled = changes.translationEnabled.newValue !== false;
    if (!translationEnabled) {
      closeOverlay();
    }
  }

  async function loadTranslationState() {
    try {
      const settings = await chrome.storage.local.get("translationEnabled");
      translationEnabled = settings.translationEnabled !== false;
    } catch (error) {
      translationEnabled = true;
      console.error("Failed to read translation status", error);
    }
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;"
    }[character]));
  }
})();
