(() => {
  "use strict";

  let enabled = true;
  let allowedDomains = [];
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

  const pushSettingsToPage = () => {
    window.postMessage(
      {
        source: "STRICT_POPUP_BLOCKER",
        type: "SETTINGS",
        enabled,
        allowedDomains,
      },
      "*"
    );
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
      /* extension context invalidated */
    }
  };

  const loadSettings = async () => {
    try {
      const data = await chrome.storage.local.get([
        "enabled",
        "allowedDomains",
      ]);
      enabled = data.enabled !== false;
      allowedDomains = Array.isArray(data.allowedDomains)
        ? data.allowedDomains
        : [];
      pushSettingsToPage();
    } catch {
      /* ignore */
    }
  };

  // Inyectar lo antes posible.
  injectInterceptor();
  loadSettings();

  window.addEventListener("STRICT_POPUP_BLOCKER_READY", () => {
    pushSettingsToPage();
  });

  window.addEventListener("STRICT_POPUP_BLOCKED", (event) => {
    const detail = event.detail || {};
    recordBlock(detail.url, detail.type || "window.open");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
    }
    if (changes.allowedDomains) {
      allowedDomains = Array.isArray(changes.allowedDomains.newValue)
        ? changes.allowedDomains.newValue
        : [];
    }
    pushSettingsToPage();
  });

  // Registrar gestos (para telemetría / futuras heurísticas).
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

  /**
   * target="_blank" sin modificadores → bloquear (patrón típico de popup).
   * Cmd/Ctrl/Shift/clic medio → autorizar pestaña (intención explícita del usuario).
   */
  document.addEventListener(
    "click",
    (event) => {
      if (!enabled || currentAllowed()) return;
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

      if (target === "_blank" || target === "_new") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        console.warn(
          "[Strict Popup Blocker] Enlace target=_blank bloqueado:",
          href
        );
        recordBlock(href, "target=_blank");
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
      if (!enabled || currentAllowed()) return;
      if (event.button !== 1) return;
      // Clic medio = abrir en nueva pestaña de forma deliberada.
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

  // Exponer estado para depuración.
  window.__strictPopupBlockerContent = {
    get enabled() {
      return enabled;
    },
    get allowed() {
      return currentAllowed();
    },
    get lastClick() {
      return { href: lastClickHref, at: lastClickAt, gestureAt: userGestureAt };
    },
  };
})();
