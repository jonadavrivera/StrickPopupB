(() => {
  "use strict";

  let enabled = false;
  let allowedDomains = [];
  let layers = {
    cookiesJs: false,
    cookiesHttp: false,
    downloads: false,
    storage: false,
    trackers: false,
  };
  let windowId = null;
  let userGestureAt = 0;
  let lastClickHref = "";
  let lastClickAt = 0;

  const isAllowedHost = (hostname) => {
    if (!hostname) return false;
    return allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  };

  const currentAllowed = () => isAllowedHost(location.hostname);
  const baseActive = () => enabled && !currentAllowed();
  const layerActive = (name) => baseActive() && layers[name] === true;

  const isExternalHref = (href) => {
    try {
      const target = new URL(href, location.href);
      return target.hostname !== location.hostname;
    } catch {
      return false;
    }
  };

  const pushSettingsToPage = () => {
    window.postMessage(
      {
        source: "STRICT_POPUP_BLOCKER",
        type: "SETTINGS",
        enabled,
        allowedDomains,
        layers,
      },
      "*"
    );
  };

  const applySettings = (next) => {
    if (typeof next.enabled === "boolean") enabled = next.enabled;
    if (Array.isArray(next.allowedDomains)) {
      allowedDomains = next.allowedDomains;
    }
    if (next.layers && typeof next.layers === "object") {
      layers = { ...layers, ...next.layers };
    }
    if (next.windowId != null) windowId = next.windowId;
    pushSettingsToPage();
  };

  const injectInterceptor = () => {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected/popup-interceptor.js");
      script.async = false;
      script.onload = () => script.remove();
      (document.documentElement || document.head || document).appendChild(
        script
      );
    } catch (err) {
      console.warn("[Strict Popup Blocker] No se pudo inyectar:", err);
    }
  };

  const recordBlock = (url, type) => {
    try {
      chrome.runtime.sendMessage({
        type: "POPUP_BLOCKED",
        payload: {
          domain: location.hostname,
          target: String(url || ""),
          type,
          timestamp: Date.now(),
        },
      });
    } catch {
      /* ignore */
    }
  };

  const loadSettings = async () => {
    try {
      const state = await chrome.runtime.sendMessage({
        type: "GET_WINDOW_STATE",
      });
      if (state) {
        applySettings({
          enabled: state.enabled === true,
          allowedDomains: state.allowedDomains,
          layers: state.layers,
          windowId: state.windowId,
        });
      }
    } catch {
      /* ignore */
    }
  };

  injectInterceptor();
  loadSettings();

  window.addEventListener("STRICT_POPUP_BLOCKER_READY", () => {
    pushSettingsToPage();
  });

  window.addEventListener("STRICT_POPUP_BLOCKED", (event) => {
    const detail = event.detail || {};
    recordBlock(detail.url, detail.type || "window.open");
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "WINDOW_SETTINGS") return;
    applySettings(message.payload || {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.allowedDomains) {
      allowedDomains = Array.isArray(changes.allowedDomains.newValue)
        ? changes.allowedDomains.newValue
        : [];
      pushSettingsToPage();
    }
    if (changes.layers) {
      layers = { ...layers, ...(changes.layers.newValue || {}) };
      pushSettingsToPage();
    }
  });

  const markGesture = () => {
    userGestureAt = Date.now();
  };

  document.addEventListener("pointerdown", markGesture, true);
  document.addEventListener("keydown", markGesture, true);

  const authorizeNextTab = (reason) => {
    try {
      chrome.runtime.sendMessage({
        type: "AUTHORIZE_NEXT_TAB",
        payload: {
          hostname: location.hostname,
          reason,
          at: Date.now(),
        },
      });
    } catch {
      /* ignore */
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      if (!baseActive()) return;
      if (event.defaultPrevented) return;

      const link = event.target?.closest?.("a[href]");
      if (!link) return;

      const target = (link.getAttribute("target") || "").toLowerCase();
      const href = link.href || link.getAttribute("href") || "";

      lastClickHref = href;
      lastClickAt = Date.now();

      const explicitNewTab =
        event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;

      if (explicitNewTab) {
        authorizeNextTab("modifier-click");
        return;
      }

      // Solo bloquear _blank hacia dominios externos (menos rotura en la web).
      if (
        (target === "_blank" || target === "_new") &&
        isExternalHref(href)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        recordBlock(href, "target=_blank");
        return;
      }

      // Descargas: solo con la capa activa, y solo atributo download
      // (no adivinar por extensión de archivo).
      if (layerActive("downloads") && link.hasAttribute("download")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        recordBlock(href, "download.link");
        return;
      }

      if (/^\s*javascript:/i.test(href) && /open\s*\(/i.test(href)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        recordBlock(href, "javascript:open");
      }
    },
    true
  );

  document.addEventListener(
    "auxclick",
    (event) => {
      if (!baseActive()) return;
      if (event.button !== 1) return;
      authorizeNextTab("auxclick");
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    () => {
      if (!enabled) return;
      try {
        chrome.runtime.sendMessage({
          type: "USER_GESTURE",
          payload: {
            hostname: location.hostname,
            allowed: currentAllowed(),
            href: location.href,
            at: Date.now(),
          },
        });
      } catch {
        /* ignore */
      }
    },
    true
  );

  window.__strictPopupBlockerContent = {
    get enabled() {
      return enabled;
    },
    get layers() {
      return { ...layers };
    },
    get allowed() {
      return currentAllowed();
    },
    get windowId() {
      return windowId;
    },
    get lastClick() {
      return { href: lastClickHref, at: lastClickAt, gestureAt: userGestureAt };
    },
  };
})();
