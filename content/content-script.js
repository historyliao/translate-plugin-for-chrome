(() => {
  let overlayHost = null;
  let shadowRoot = null;
  let translationCard = null;
  let brandIcon = null;
  let translationTitle = null;
  let loadingIndicator = null;
  let translationText = null;
  let interruptionMessage = null;
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

    let port;
    try {
      port = chrome.runtime.connect({ name: "translation" });
    } catch (error) {
      console.error("Failed to connect to translation service", error);
      reportRuntimeLog("service_connection_error");
      showTranslationError("翻译服务请求失败，请重新加载插件和当前页面");
      return;
    }
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
      reportRuntimeLog("service_connection_error");
      showTranslationError("翻译服务连接已中断");
    });

    try {
      port.postMessage({ type: "translate", text });
    } catch (error) {
      console.error("Failed to request translation", error);
      reportRuntimeLog("service_connection_error");
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
      shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
            --translator-background: rgba(255, 255, 255, 0.98);
            --translator-header-background: #f8fafc;
            --translator-border: rgba(148, 163, 184, 0.38);
            --translator-divider: rgba(226, 232, 240, 0.9);
            --translator-text: #172033;
            --translator-muted: #64748b;
            --translator-accent: #2563eb;
            --translator-accent-soft: #dbeafe;
            --translator-error: #b91c1c;
            --translator-error-background: #fef2f2;
            --translator-error-border: #fecaca;
            --translator-shadow: 0 16px 40px rgba(15, 23, 42, 0.16), 0 3px 10px rgba(15, 23, 42, 0.08);
          }
          * { box-sizing: border-box; }
          [hidden] { display: none !important; }
          .translation-card {
            max-width: min(440px, calc(100vw - 24px));
            max-height: min(340px, calc(100vh - 24px));
            overflow: hidden;
            border: 1px solid var(--translator-border);
            border-radius: 12px;
            background: var(--translator-background);
            color: var(--translator-text);
            box-shadow: var(--translator-shadow);
            font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            animation: translator-enter 140ms ease-out;
            backdrop-filter: blur(8px);
          }
          .translation-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--translator-divider);
            background: linear-gradient(135deg, var(--translator-header-background), transparent);
          }
          .brand-icon {
            display: inline-flex;
            width: 22px;
            height: 22px;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            border-radius: 7px;
            background: var(--translator-accent-soft);
            color: var(--translator-accent);
            font-size: 12px;
            font-weight: 700;
          }
          .translation-title {
            color: var(--translator-text);
            font-size: 13px;
            font-weight: 650;
            letter-spacing: 0.01em;
          }
          .translation-body {
            max-height: min(294px, calc(100vh - 70px));
            overflow: auto;
            padding: 12px 14px 14px;
            scrollbar-color: var(--translator-border) transparent;
            scrollbar-width: thin;
          }
          .translation-content {
            color: var(--translator-text);
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .loading-indicator {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 3px 0;
            color: var(--translator-muted);
          }
          .loading-spinner {
            width: 15px;
            height: 15px;
            flex: 0 0 auto;
            border: 2px solid var(--translator-accent-soft);
            border-top-color: var(--translator-accent);
            border-radius: 50%;
            animation: translator-spin 750ms linear infinite;
          }
          .translation-card[data-state="error"] .brand-icon {
            background: var(--translator-error-background);
            color: var(--translator-error);
          }
          .translation-card[data-state="error"] .translation-title {
            color: var(--translator-error);
          }
          .translation-card[data-state="error"] .translation-content {
            padding: 9px 10px;
            border: 1px solid var(--translator-error-border);
            border-radius: 8px;
            background: var(--translator-error-background);
            color: var(--translator-error);
          }
          .interruption {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--translator-error-border);
            color: var(--translator-error);
            font-size: 13px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          @keyframes translator-enter {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes translator-spin {
            to { transform: rotate(360deg); }
          }
          @media (prefers-color-scheme: dark) {
            :host {
              --translator-background: rgba(17, 24, 39, 0.98);
              --translator-header-background: #1f2937;
              --translator-border: rgba(100, 116, 139, 0.58);
              --translator-divider: rgba(71, 85, 105, 0.7);
              --translator-text: #f1f5f9;
              --translator-muted: #a8b3c5;
              --translator-accent: #60a5fa;
              --translator-accent-soft: #1e3a5f;
              --translator-error: #fca5a5;
              --translator-error-background: rgba(127, 29, 29, 0.3);
              --translator-error-border: rgba(248, 113, 113, 0.45);
              --translator-shadow: 0 18px 44px rgba(0, 0, 0, 0.42), 0 3px 12px rgba(0, 0, 0, 0.28);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .translation-card,
            .loading-spinner { animation: none; }
          }
        </style>
        <section class="translation-card" data-state="loading" role="status" aria-live="polite">
          <header class="translation-header">
            <span class="brand-icon" aria-hidden="true">译</span>
            <span class="translation-title">AI 翻译</span>
          </header>
          <div class="translation-body">
            <div class="loading-indicator">
              <span class="loading-spinner" aria-hidden="true"></span>
              <span>正在翻译…</span>
            </div>
            <div class="translation-content" hidden></div>
            <div class="interruption" hidden></div>
          </div>
        </section>
      `;
      translationCard = shadowRoot.querySelector(".translation-card");
      brandIcon = shadowRoot.querySelector(".brand-icon");
      translationTitle = shadowRoot.querySelector(".translation-title");
      loadingIndicator = shadowRoot.querySelector(".loading-indicator");
      translationText = shadowRoot.querySelector(".translation-content");
      interruptionMessage = shadowRoot.querySelector(".interruption");
      document.documentElement.appendChild(overlayHost);
    }

    const isLoading = !isError && !interruption && content === "翻译中…";
    translationCard.dataset.state = isError
      ? "error"
      : interruption
        ? "interrupted"
        : isLoading
          ? "loading"
          : "result";
    brandIcon.textContent = isError ? "!" : "译";
    translationTitle.textContent = isError ? "翻译失败" : "AI 翻译";
    loadingIndicator.hidden = !isLoading;
    translationText.hidden = isLoading;
    translationText.textContent = isLoading ? "" : content;
    interruptionMessage.hidden = !interruption;
    interruptionMessage.textContent = interruption ? `翻译中断：${interruption}` : "";
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

    const panel = translationCard;
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
      translationCard = null;
      brandIcon = null;
      translationTitle = null;
      loadingIndicator = null;
      translationText = null;
      interruptionMessage = null;
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
      reportRuntimeLog("translation_state_read_failed");
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

})();
