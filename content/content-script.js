(() => {
  let overlayHost = null;
  let shadowRoot = null;
  let requestId = 0;
  let anchorRange = null;

  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("scroll", repositionOverlay, true);
  window.addEventListener("resize", repositionOverlay);

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
    if (event.button !== 0 || (overlayHost && overlayHost.contains(event.target))) {
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
    const currentRequestId = ++requestId;
    showOverlay("翻译中…");

    chrome.runtime.sendMessage({ type: "translate", text }, (response) => {
      if (currentRequestId !== requestId || !overlayHost) {
        return;
      }
      if (chrome.runtime.lastError) {
        showOverlay("翻译服务请求失败，请稍后重试", true);
        return;
      }
      if (!response?.ok) {
        showOverlay(response?.error || "翻译服务请求失败，请稍后重试", true);
        return;
      }
      showOverlay(response.translation);
    });
  }

  function showOverlay(content, isError = false) {
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
      </style>
      <div class="translation ${isError ? "error" : content === "翻译中…" ? "loading" : ""}" role="status">${escapeHtml(content)}</div>
    `;
    repositionOverlay();
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
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
      anchorRange = null;
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
