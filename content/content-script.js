(() => {
  const activationEventName = "english-to-chinese-translator:activate";
  const overlayAttribute = "data-english-to-chinese-translator";
  const pageTranslationExcludedSelector = "script, style, noscript, input, textarea, select, option, code, pre, kbd, samp, svg, canvas";
  const pageTranslationScanDelay = 300;
  const pageTranslationMaxItems = 50;
  const pageTranslationMaxCharacters = 3000;
  const defaultTranslationMode = "selection";
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let active = true;
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
  let translationMode = defaultTranslationMode;
  let pageTranslationEnabled = false;
  let pageTranslationSessionId = 0;
  let pageTranslationItemId = 0;
  let pageTranslationPort = null;
  let pageTranslationScanTimer = null;
  let pageTranslationObserver = null;
  let pageTranslationProcessing = false;
  let pageTranslationFailureShown = false;
  let pageTranslationFeedback = null;
  let pageTranslationFeedbackTimer = null;
  let pageTranslationHighlightFrame = null;
  let pageTranslationHighlightedRecords = [];
  const pageTranslationRecords = new Map();
  const pageTranslationQueue = [];
  const staleOverlayObserver = new MutationObserver(handleOverlayMutations);

  document.addEventListener(activationEventName, handleContentScriptActivate, true);
  document.dispatchEvent(new CustomEvent(activationEventName, { detail: instanceId }));
  removeStaleOverlayHosts();
  staleOverlayObserver.observe(document.documentElement, { childList: true });
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("pagehide", handlePageHide);
  chrome.storage.onChanged.addListener(handleStorageChange);

  loadTranslationSettings();

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
      translationMode !== "selection" ||
      event.button !== 0 ||
      (overlayHost && overlayHost.contains(event.target))
    ) {
      return;
    }

    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (!text || !/\p{L}/u.test(text) || !selection?.rangeCount) {
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
        disconnectPort(port);
      } else if (message?.type === "error") {
        const error = message.error || "翻译服务请求失败，请稍后重试";
        translationPort = null;
        disconnectPort(port);
        showTranslationError(error);
      }
    });

    port.onDisconnect.addListener(() => {
      try {
        void chrome.runtime.lastError;
      } catch (error) {
        console.debug("Failed to read translation disconnect error", error);
      }
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
      disconnectPort(port);
      showTranslationError("翻译服务请求失败，请重新加载插件和当前页面");
    }
  }

  function startPageTranslation() {
    if (pageTranslationEnabled) {
      return;
    }

    pageTranslationEnabled = true;
    pageTranslationSessionId += 1;
    pageTranslationItemId = 0;
    pageTranslationFailureShown = false;
    closeOverlay();
    removePageTranslationFeedback();
    pageTranslationObserver = new MutationObserver(handlePageTranslationMutations);
    pageTranslationObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    schedulePageTranslationScan(0);
  }

  function stopPageTranslation() {
    if (
      !pageTranslationEnabled &&
      pageTranslationRecords.size === 0 &&
      !pageTranslationFeedback
    ) {
      return;
    }

    pageTranslationEnabled = false;
    pageTranslationSessionId += 1;
    pageTranslationProcessing = false;
    clearTimeout(pageTranslationScanTimer);
    pageTranslationScanTimer = null;
    if (pageTranslationObserver) {
      pageTranslationObserver.disconnect();
      pageTranslationObserver = null;
    }
    if (pageTranslationPort) {
      const port = pageTranslationPort;
      pageTranslationPort = null;
      disconnectPort(port);
    }
    pageTranslationQueue.length = 0;
    for (const [node, record] of pageTranslationRecords) {
      if (
        node.isConnected &&
        typeof record.translatedValue === "string" &&
        node.nodeValue === record.translatedValue
      ) {
        node.nodeValue = record.originalValue;
      }
    }
    pageTranslationRecords.clear();
    removePageTranslationFeedback();
  }

  function handleViewportChange() {
    repositionOverlay();
    if (pageTranslationFeedback && pageTranslationHighlightFrame === null) {
      pageTranslationHighlightFrame = requestAnimationFrame(() => {
        pageTranslationHighlightFrame = null;
        updatePageTranslationHighlights();
      });
    }
    schedulePageTranslationScan();
  }

  function handlePageHide() {
    cancelTranslation();
    stopPageTranslation();
  }

  function schedulePageTranslationScan(delay = pageTranslationScanDelay) {
    if (!pageTranslationEnabled) {
      return;
    }
    clearTimeout(pageTranslationScanTimer);
    pageTranslationScanTimer = setTimeout(scanVisibleText, delay);
  }

  function scanVisibleText() {
    pageTranslationScanTimer = null;
    if (!pageTranslationEnabled) {
      return;
    }

    for (const node of pageTranslationRecords.keys()) {
      if (!node.isConnected) {
        pageTranslationRecords.delete(node);
      }
    }

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT
    );
    let node;
    while ((node = walker.nextNode())) {
      if (pageTranslationRecords.has(node) || !isVisibleTranslatableNode(node)) {
        continue;
      }

      const originalValue = node.nodeValue;
      const sourceText = originalValue.trim();
      const record = {
        id: String(++pageTranslationItemId),
        node,
        originalValue,
        sourceText,
        status: sourceText.length > pageTranslationMaxCharacters ? "failed" : "waiting"
      };
      pageTranslationRecords.set(node, record);
      if (record.status === "waiting") {
        pageTranslationQueue.push(record);
      }
    }
    processPageTranslationQueue();
  }

  function isVisibleTranslatableNode(node) {
    const parent = node.parentElement;
    const text = node.nodeValue.trim();
    if (
      !parent ||
      !text ||
      !/\p{L}/u.test(text) ||
      parent.closest(pageTranslationExcludedSelector) ||
      parent.closest(`[${overlayAttribute}]`) ||
      parent.closest('[aria-hidden="true"]') ||
      parent.isContentEditable
    ) {
      return false;
    }

    const style = getComputedStyle(parent);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).some((rect) => (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    ));
  }

  function handlePageTranslationMutations(mutations) {
    if (!pageTranslationEnabled) {
      return;
    }
    for (const mutation of mutations) {
      if (mutation.type !== "characterData") {
        continue;
      }
      const record = pageTranslationRecords.get(mutation.target);
      if (record && mutation.target.nodeValue !== record.translatedValue) {
        pageTranslationRecords.delete(mutation.target);
      }
    }
    schedulePageTranslationScan();
  }

  async function processPageTranslationQueue() {
    if (pageTranslationProcessing || !pageTranslationEnabled) {
      return;
    }

    pageTranslationProcessing = true;
    const sessionId = pageTranslationSessionId;
    const startedAt = performance.now();
    let translatedCount = 0;
    let totalCount = pageTranslationQueue.length;
    let translationFailed = false;
    try {
      while (pageTranslationEnabled && sessionId === pageTranslationSessionId) {
        const batch = takePageTranslationBatch();
        if (batch.length === 0) {
          break;
        }
        for (const record of batch) {
          record.status = "translating";
        }
        totalCount = Math.max(
          totalCount,
          translatedCount + batch.length + pageTranslationQueue.length
        );
        showPageTranslationFeedback(
          "translating",
          `正在翻译当前区域 · 已完成 ${translatedCount}/${totalCount} 段`,
          batch
        );

        try {
          const translations = await requestPageTranslationBatch(batch, sessionId);
          if (!pageTranslationEnabled || sessionId !== pageTranslationSessionId) {
            return;
          }
          translatedCount += applyPageTranslations(batch, translations);
        } catch (error) {
          if (!pageTranslationEnabled || sessionId !== pageTranslationSessionId) {
            return;
          }
          translationFailed = true;
          console.error("Failed to translate visible page content", error);
          for (const record of batch) {
            if (pageTranslationRecords.get(record.node) === record) {
              record.status = "failed";
            }
          }
        }
      }
    } finally {
      if (sessionId === pageTranslationSessionId) {
        pageTranslationProcessing = false;
        if (translationFailed) {
          showPageTranslationFailureNotice(translatedCount);
        } else if (translatedCount > 0) {
          const elapsedSeconds = Math.max(
            0.1,
            (performance.now() - startedAt) / 1000
          ).toFixed(1);
          showPageTranslationFeedback(
            "completed",
            `当前区域翻译完成 · ${translatedCount} 段 · ${elapsedSeconds} 秒`
          );
        }
      }
    }
  }

  function takePageTranslationBatch() {
    const batch = [];
    let characterCount = 0;
    while (pageTranslationQueue.length > 0 && batch.length < pageTranslationMaxItems) {
      const record = pageTranslationQueue[0];
      if (
        pageTranslationRecords.get(record.node) !== record ||
        record.status !== "waiting" ||
        record.node.nodeValue !== record.originalValue ||
        !isVisibleTranslatableNode(record.node)
      ) {
        pageTranslationQueue.shift();
        if (pageTranslationRecords.get(record.node) === record) {
          pageTranslationRecords.delete(record.node);
        }
        continue;
      }
      if (
        batch.length > 0 &&
        characterCount + record.sourceText.length > pageTranslationMaxCharacters
      ) {
        break;
      }
      pageTranslationQueue.shift();
      batch.push(record);
      characterCount += record.sourceText.length;
    }
    return batch;
  }

  function requestPageTranslationBatch(batch, sessionId) {
    return new Promise((resolve, reject) => {
      let port;
      let responseItems = null;
      let settled = false;

      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (pageTranslationPort === port) {
          pageTranslationPort = null;
        }
        disconnectPort(port);
        if (error) {
          reject(error);
        } else {
          resolve(responseItems);
        }
      };

      try {
        port = chrome.runtime.connect({ name: "translation" });
      } catch (error) {
        reportRuntimeLog("service_connection_error");
        reject(error);
        return;
      }
      pageTranslationPort = port;

      port.onMessage.addListener((message) => {
        if (settled || sessionId !== pageTranslationSessionId) {
          return;
        }
        if (message?.type === "batch" && Array.isArray(message.items)) {
          responseItems = message.items;
        } else if (message?.type === "done") {
          finish(responseItems ? null : new Error("INVALID_RESPONSE"));
        } else if (message?.type === "error") {
          finish(new Error(message.error || "翻译服务请求失败"));
        }
      });

      port.onDisconnect.addListener(() => {
        try {
          void chrome.runtime.lastError;
        } catch (error) {
          console.debug("Failed to read page translation disconnect error", error);
        }
        if (!settled) {
          finish(new Error("翻译服务连接已中断"));
        }
      });

      try {
        port.postMessage({
          type: "translate-batch",
          items: batch.map((record) => ({ id: record.id, text: record.sourceText }))
        });
      } catch (error) {
        reportRuntimeLog("service_connection_error");
        finish(error);
      }
    });
  }

  function applyPageTranslations(batch, items) {
    if (!Array.isArray(items) || items.length !== batch.length) {
      throw new Error("INVALID_RESPONSE");
    }

    const translations = new Map();
    const requestedIds = new Set(batch.map((record) => record.id));
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !requestedIds.has(item.id) ||
        translations.has(item.id) ||
        typeof item.translation !== "string" ||
        !item.translation.trim()
      ) {
        throw new Error("INVALID_RESPONSE");
      }
      translations.set(item.id, item.translation.trim());
    }

    let translatedCount = 0;
    for (const record of batch) {
      if (pageTranslationRecords.get(record.node) !== record) {
        continue;
      }
      if (record.node.nodeValue !== record.originalValue) {
        pageTranslationRecords.delete(record.node);
        continue;
      }
      const textStart = record.originalValue.indexOf(record.sourceText);
      record.translatedValue = `${record.originalValue.slice(0, textStart)}${translations.get(record.id)}${record.originalValue.slice(textStart + record.sourceText.length)}`;
      record.status = "translated";
      record.node.nodeValue = record.translatedValue;
      translatedCount += 1;
    }
    return translatedCount;
  }

  function showPageTranslationFailureNotice(translatedCount) {
    if (pageTranslationFailureShown) {
      removePageTranslationFeedback();
      return;
    }
    pageTranslationFailureShown = true;
    const completedText = translatedCount > 0
      ? ` · 已翻译 ${translatedCount} 段`
      : "";
    showPageTranslationFeedback(
      "error",
      `部分内容翻译失败${completedText}，可关闭后重试`
    );
  }

  function showPageTranslationFeedback(state, message, records = []) {
    clearTimeout(pageTranslationFeedbackTimer);
    pageTranslationFeedbackTimer = null;
    pageTranslationHighlightedRecords = records;

    if (!pageTranslationFeedback) {
      const host = document.createElement("div");
      host.setAttribute(overlayAttribute, instanceId);
      host.style.position = "fixed";
      host.style.inset = "0";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "none";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .highlights {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .highlight {
          position: absolute;
          border: 1px solid rgba(37, 99, 235, 0.34);
          border-radius: 3px;
          background: rgba(59, 130, 246, 0.15);
          animation: translator-highlight-pulse 1.2s ease-in-out infinite alternate;
        }
        .feedback {
          position: fixed;
          right: 16px;
          bottom: 16px;
          display: flex;
          align-items: center;
          gap: 9px;
          max-width: min(320px, calc(100vw - 32px));
          padding: 10px 12px;
          border: 1px solid rgba(147, 197, 253, 0.8);
          border-radius: 10px;
          background: rgba(239, 246, 255, 0.96);
          color: #1e3a8a;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          backdrop-filter: blur(8px);
        }
        .feedback[data-state="completed"] {
          border-color: rgba(134, 239, 172, 0.8);
          background: rgba(240, 253, 244, 0.96);
          color: #166534;
        }
        .feedback[data-state="error"] {
          border-color: #fecaca;
          background: rgba(254, 242, 242, 0.96);
          color: #b91c1c;
        }
        .spinner {
          width: 14px;
          height: 14px;
          flex: 0 0 auto;
          border: 2px solid rgba(37, 99, 235, 0.2);
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: translator-feedback-spin 750ms linear infinite;
        }
        .status-icon {
          width: 16px;
          flex: 0 0 auto;
          text-align: center;
          font-weight: 700;
        }
        @keyframes translator-feedback-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes translator-highlight-pulse {
          from { opacity: 0.55; }
          to { opacity: 1; }
        }
        @media (prefers-color-scheme: dark) {
          .highlight {
            border-color: rgba(96, 165, 250, 0.5);
            background: rgba(59, 130, 246, 0.24);
          }
          .feedback {
            border-color: rgba(96, 165, 250, 0.52);
            background: rgba(30, 58, 95, 0.96);
            color: #bfdbfe;
          }
          .feedback[data-state="completed"] {
            border-color: rgba(74, 222, 128, 0.52);
            background: rgba(20, 83, 45, 0.96);
            color: #bbf7d0;
          }
          .feedback[data-state="error"] {
            border-color: rgba(248, 113, 113, 0.52);
            background: rgba(127, 29, 29, 0.96);
            color: #fecaca;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .highlight,
          .spinner { animation: none; }
        }
      </style>
      <div class="highlights" aria-hidden="true"></div>
      <div class="feedback" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span class="status-icon" aria-hidden="true" hidden></span>
        <span class="status-text"></span>
      </div>
    `;
      pageTranslationFeedback = {
        host,
        highlights: root.querySelector(".highlights"),
        panel: root.querySelector(".feedback"),
        spinner: root.querySelector(".spinner"),
        icon: root.querySelector(".status-icon"),
        text: root.querySelector(".status-text")
      };
      document.documentElement.appendChild(host);
    }

    pageTranslationFeedback.panel.dataset.state = state;
    pageTranslationFeedback.spinner.hidden = state !== "translating";
    pageTranslationFeedback.icon.hidden = state === "translating";
    pageTranslationFeedback.icon.textContent = state === "completed" ? "✓" : "!";
    pageTranslationFeedback.text.textContent = message;
    updatePageTranslationHighlights();

    const hideDelay = state === "completed" ? 1500 : state === "error" ? 5000 : 0;
    if (hideDelay > 0) {
      pageTranslationFeedbackTimer = setTimeout(
        removePageTranslationFeedback,
        hideDelay
      );
    }
  }

  function updatePageTranslationHighlights() {
    if (!pageTranslationFeedback) {
      return;
    }

    pageTranslationFeedback.highlights.replaceChildren();
    for (const record of pageTranslationHighlightedRecords) {
      if (
        pageTranslationRecords.get(record.node) !== record ||
        !record.node.isConnected ||
        record.node.nodeValue !== record.originalValue
      ) {
        continue;
      }

      const range = document.createRange();
      range.selectNodeContents(record.node);
      for (const rect of range.getClientRects()) {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) {
          continue;
        }

        const highlight = document.createElement("span");
        highlight.className = "highlight";
        highlight.style.left = `${left}px`;
        highlight.style.top = `${top}px`;
        highlight.style.width = `${right - left}px`;
        highlight.style.height = `${bottom - top}px`;
        pageTranslationFeedback.highlights.appendChild(highlight);
      }
    }
  }

  function removePageTranslationFeedback() {
    clearTimeout(pageTranslationFeedbackTimer);
    pageTranslationFeedbackTimer = null;
    if (pageTranslationHighlightFrame !== null) {
      cancelAnimationFrame(pageTranslationHighlightFrame);
      pageTranslationHighlightFrame = null;
    }
    pageTranslationHighlightedRecords = [];
    if (pageTranslationFeedback) {
      pageTranslationFeedback.host.remove();
      pageTranslationFeedback = null;
    }
  }

  function showOverlay(content, isError = false, interruption = "") {
    if (!overlayHost) {
      overlayHost = document.createElement("div");
      overlayHost.setAttribute(overlayAttribute, instanceId);
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
      disconnectPort(port);
    }
    translationContent = "";
  }

  function disconnectPort(port) {
    try {
      port.disconnect();
    } catch (error) {
      console.debug("Failed to disconnect translation service", error);
    }
  }

  function handleContentScriptActivate(event) {
    if (event.detail !== instanceId) {
      teardown();
    }
  }

  function handleOverlayMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === 1 &&
          node.hasAttribute(overlayAttribute) &&
          node.getAttribute(overlayAttribute) !== instanceId
        ) {
          node.remove();
        }
      }
    }
  }

  function removeStaleOverlayHosts() {
    for (const child of document.documentElement.children) {
      if (
        child.hasAttribute(overlayAttribute) &&
        child.getAttribute(overlayAttribute) !== instanceId
      ) {
        child.remove();
      }
    }
  }

  function teardown() {
    if (!active) {
      return;
    }
    active = false;
    document.removeEventListener(activationEventName, handleContentScriptActivate, true);
    document.removeEventListener("mousedown", handleMouseDown, true);
    document.removeEventListener("mouseup", handleMouseUp, true);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("pagehide", handlePageHide);
    staleOverlayObserver.disconnect();
    try {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    } catch (error) {
      console.debug("Failed to remove translation storage listener", error);
    }
    stopPageTranslation();
    closeOverlay();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (changes.translationEnabled) {
      translationEnabled = changes.translationEnabled.newValue !== false;
    }
    if (changes.translationMode) {
      translationMode = getTranslationMode(changes.translationMode.newValue);
    }

    if (changes.translationEnabled || changes.translationMode) {
      syncTranslationBehavior();
    } else if (changes.targetLanguage && pageTranslationEnabled) {
      stopPageTranslation();
      startPageTranslation();
    }
  }

  async function loadTranslationSettings() {
    try {
      const settings = await chrome.storage.local.get([
        "translationEnabled",
        "translationMode"
      ]);
      translationEnabled = settings.translationEnabled !== false;
      translationMode = getTranslationMode(settings.translationMode);
      syncTranslationBehavior();
    } catch (error) {
      translationEnabled = true;
      translationMode = defaultTranslationMode;
      console.error("Failed to read translation status", error);
      reportRuntimeLog("translation_state_read_failed");
    }
  }

  function syncTranslationBehavior() {
    if (!translationEnabled) {
      closeOverlay();
      stopPageTranslation();
    } else if (translationMode === "viewport") {
      closeOverlay();
      startPageTranslation();
    } else {
      stopPageTranslation();
    }
  }

  function getTranslationMode(value) {
    return value === "viewport" ? value : defaultTranslationMode;
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
