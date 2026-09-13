(() => {
  "use strict";

  const STATE_KEY = "__STRICT_POPUP_BLOCKER__";
  if (window[STATE_KEY]) return;
  window[STATE_KEY] = true;

  // OFF hasta recibir el estado de la ventana actual.
  let enabled = false;
  let allowedDomains = [];

  const notifyBlocked = (url, type) => {
    try {
      window.dispatchEvent(
        new CustomEvent("STRICT_POPUP_BLOCKED", {
          detail: { url: String(url || ""), type },
        })
      );
    } catch {
      /* ignore */
    }
  };

  const hostnameOf = (url) => {
    try {
      return new URL(String(url || ""), window.location.href).hostname;
    } catch {
      return "";
    }
  };

  const isAllowedHost = (hostname) => {
    if (!hostname) return false;
    return allowedDomains.some(
      (domain) =>
        hostname === domain || hostname.endsWith(`.${domain}`)
    );
  };

  const currentHostAllowed = () => isAllowedHost(window.location.hostname);

  const blockedOpen = function blockedOpen(url, target, features) {
    if (!enabled) {
      return Reflect.apply(NativeOpen, window, [url, target, features]);
    }

    // Solo permite si el sitio actual está en la whitelist.
    if (currentHostAllowed()) {
      return Reflect.apply(NativeOpen, window, [url, target, features]);
    }

    console.warn("[Strict Popup Blocker] window.open bloqueado:", url);
    notifyBlocked(url, "window.open");
    return null;
  };

  // Guardamos una referencia nativa antes de sellar la propiedad.
  const NativeOpen = window.open.bind(window);

  const sealOpen = () => {
    try {
      Object.defineProperty(window, "open", {
        configurable: false,
        enumerable: true,
        get() {
          return blockedOpen;
        },
        set() {
          console.warn(
            "[Strict Popup Blocker] Intento de reemplazar window.open bloqueado"
          );
        },
      });
    } catch {
      try {
        window.open = blockedOpen;
      } catch {
        /* ignore */
      }
    }
  };

  sealOpen();

  // Re-aplicar por si algún script temprano lo altera antes de que configuremos.
  const reassert = () => {
    try {
      if (window.open !== blockedOpen) {
        sealOpen();
      }
    } catch {
      /* ignore */
    }
  };

  // Vigilar redefiniciones periódicas durante los primeros segundos.
  let ticks = 0;
  const watchId = setInterval(() => {
    reassert();
    ticks += 1;
    if (ticks > 40) clearInterval(watchId);
  }, 250);

  // showModalDialog / openDialog legacy (si existen)
  try {
    if (typeof window.showModalDialog === "function") {
      Object.defineProperty(window, "showModalDialog", {
        configurable: false,
        writable: false,
        value: function () {
          if (!enabled || currentHostAllowed()) return undefined;
          notifyBlocked("", "showModalDialog");
          return undefined;
        },
      });
    }
  } catch {
    /* ignore */
  }

  // Interceptar window.open vía Proxy de window no es viable; sellamos open.

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "STRICT_POPUP_BLOCKER") return;

    if (data.type === "SETTINGS") {
      enabled = Boolean(data.enabled);
      allowedDomains = Array.isArray(data.allowedDomains)
        ? data.allowedDomains
        : [];
    }
  });

  // Pedir estado inicial al content script.
  window.dispatchEvent(new CustomEvent("STRICT_POPUP_BLOCKER_READY"));

  console.log("[Strict Popup Blocker] Protección inyectada");
})();
