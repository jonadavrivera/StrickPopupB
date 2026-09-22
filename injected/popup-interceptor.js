(() => {
  "use strict";

  const STATE_KEY = "__STRICT_POPUP_BLOCKER__";
  if (window[STATE_KEY]) return;
  window[STATE_KEY] = true;

  let enabled = false;
  let allowedDomains = [];
  let layers = {
    cookiesJs: false,
    cookiesHttp: false,
    downloads: false,
    storage: false,
    trackers: false,
  };

  const notifyBlocked = (url, type) => {
    try {
      if (
        type === "cookie.read" ||
        type.startsWith("storage.") ||
        type.startsWith("cookieStore.")
      ) {
        const key = `${type}:${String(url || "").slice(0, 80)}`;
        const now = Date.now();
        if (!notifyBlocked._last) notifyBlocked._last = new Map();
        const prev = notifyBlocked._last.get(key) || 0;
        if (now - prev < 2000) return;
        notifyBlocked._last.set(key, now);
      }
      window.dispatchEvent(
        new CustomEvent("STRICT_POPUP_BLOCKED", {
          detail: { url: String(url || ""), type },
        })
      );
    } catch {
      /* ignore */
    }
  };

  const isAllowedHost = (hostname) => {
    if (!hostname) return false;
    return allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  };

  const currentHostAllowed = () => isAllowedHost(window.location.hostname);

  /** Protección base activa (popups) en esta ventana. */
  const baseActive = () => enabled && !currentHostAllowed();

  const layerActive = (name) => baseActive() && layers[name] === true;

  const isExternalUrl = (url) => {
    if (url == null || url === "") return true; // popunder típico
    try {
      const target = new URL(String(url), window.location.href);
      return target.hostname !== window.location.hostname;
    } catch {
      return true;
    }
  };

  const NativeOpen = window.open.bind(window);

  const blockedOpen = function blockedOpen(url, target, features) {
    if (!baseActive()) {
      return Reflect.apply(NativeOpen, window, [url, target, features]);
    }

    // Misma página/dominio: permitir para no romper widgets legítimos.
    if (!isExternalUrl(url)) {
      return Reflect.apply(NativeOpen, window, [url, target, features]);
    }

    console.warn("[Strict Popup Blocker] window.open externo bloqueado:", url);
    notifyBlocked(url, "window.open");
    return null;
  };

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
            "[Strict Popup Blocker] Intento de reemplazar window.open"
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

  /* ── Cookies JS (capa opcional) ────────────────────────────────── */
  try {
    const cookieDesc =
      Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ||
      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      enumerable: true,
      get() {
        if (layerActive("cookiesJs")) {
          notifyBlocked(location.href, "cookie.read");
          return "";
        }
        return cookieDesc?.get ? cookieDesc.get.call(this) : "";
      },
      set(value) {
        if (layerActive("cookiesJs")) {
          notifyBlocked(String(value || ""), "cookie.write");
          return;
        }
        if (cookieDesc?.set) cookieDesc.set.call(this, value);
      },
    });
  } catch (err) {
    console.warn("[Strict Popup Blocker] document.cookie:", err);
  }

  try {
    if (window.cookieStore) {
      const store = window.cookieStore;
      const wrap = (method, type) => {
        if (typeof store[method] !== "function") return;
        const original = store[method].bind(store);
        store[method] = function (...args) {
          if (layerActive("cookiesJs")) {
            notifyBlocked("", type);
            if (method === "get" || method === "getAll") {
              return Promise.resolve(method === "get" ? null : []);
            }
            return Promise.resolve();
          }
          return original(...args);
        };
      };
      wrap("get", "cookieStore.get");
      wrap("getAll", "cookieStore.getAll");
      wrap("set", "cookieStore.set");
      wrap("delete", "cookieStore.delete");
    }
  } catch {
    /* ignore */
  }

  /* ── Storage (capa opcional) ───────────────────────────────────── */
  const sealStorage = (storageName) => {
    try {
      const storage = window[storageName];
      if (!storage) return;
      const proto = Object.getPrototypeOf(storage);
      ["getItem", "setItem", "removeItem", "clear", "key"].forEach((method) => {
        if (typeof proto[method] !== "function") return;
        const original = proto[method];
        proto[method] = function (...args) {
          if (layerActive("storage")) {
            notifyBlocked(
              String(args[0] || ""),
              `storage.${storageName}.${method}`
            );
            if (method === "getItem" || method === "key") return null;
            return undefined;
          }
          return original.apply(this, args);
        };
      });
    } catch {
      /* ignore */
    }
  };
  sealStorage("localStorage");
  sealStorage("sessionStorage");

  /* ── Trackers / APIs ruidosas (capa opcional) ──────────────────── */
  try {
    if (typeof Navigator.prototype.sendBeacon === "function") {
      const originalBeacon = Navigator.prototype.sendBeacon;
      Navigator.prototype.sendBeacon = function (...args) {
        if (layerActive("trackers")) {
          notifyBlocked(String(args[0] || ""), "sendBeacon");
          return false;
        }
        return originalBeacon.apply(this, args);
      };
    }
  } catch {
    /* ignore */
  }

  try {
    if (navigator.serviceWorker?.register) {
      const originalRegister = navigator.serviceWorker.register.bind(
        navigator.serviceWorker
      );
      navigator.serviceWorker.register = function (...args) {
        if (layerActive("trackers")) {
          notifyBlocked(String(args[0] || ""), "serviceWorker.register");
          return Promise.reject(
            new DOMException("Blocked by Strict Popup Blocker", "SecurityError")
          );
        }
        return originalRegister(...args);
      };
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof Notification !== "undefined" && Notification.requestPermission) {
      const originalPerm = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = function (...args) {
        if (layerActive("trackers")) {
          notifyBlocked("", "notification.permission");
          return Promise.resolve("denied");
        }
        return originalPerm(...args);
      };
    }
  } catch {
    /* ignore */
  }

  try {
    if (navigator.clipboard) {
      ["writeText", "write"].forEach((method) => {
        if (typeof navigator.clipboard[method] !== "function") return;
        const original = navigator.clipboard[method].bind(navigator.clipboard);
        navigator.clipboard[method] = function (...args) {
          if (layerActive("trackers")) {
            notifyBlocked("", `clipboard.${method}`);
            return Promise.reject(
              new DOMException(
                "Blocked by Strict Popup Blocker",
                "NotAllowedError"
              )
            );
          }
          return original(...args);
        };
      });
    }
  } catch {
    /* ignore */
  }

  /* ── Descargas programáticas (capa opcional) ───────────────────── */
  try {
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      if (layerActive("downloads") && this.hasAttribute("download")) {
        notifyBlocked(this.href || "", "download.click");
        return;
      }
      return originalClick.apply(this, args);
    };
  } catch {
    /* ignore */
  }

  try {
    if (typeof window.showModalDialog === "function") {
      Object.defineProperty(window, "showModalDialog", {
        configurable: false,
        writable: false,
        value: function () {
          if (!baseActive()) return undefined;
          notifyBlocked("", "showModalDialog");
          return undefined;
        },
      });
    }
  } catch {
    /* ignore */
  }

  let ticks = 0;
  const watchId = setInterval(() => {
    try {
      if (window.open !== blockedOpen) sealOpen();
    } catch {
      /* ignore */
    }
    ticks += 1;
    if (ticks > 40) clearInterval(watchId);
  }, 250);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "STRICT_POPUP_BLOCKER") return;

    if (data.type === "SETTINGS") {
      enabled = Boolean(data.enabled);
      allowedDomains = Array.isArray(data.allowedDomains)
        ? data.allowedDomains
        : [];
      if (data.layers && typeof data.layers === "object") {
        layers = { ...layers, ...data.layers };
      }
    }
  });

  window.dispatchEvent(new CustomEvent("STRICT_POPUP_BLOCKER_READY"));
  console.log("[Strict Popup Blocker] Capas listas");
})();
