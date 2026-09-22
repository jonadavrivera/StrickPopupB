const DEFAULT_LAYERS = {
  cookiesJs: false,
  cookiesHttp: false,
  downloads: false,
  storage: false,
  trackers: false,
};

const DEFAULTS = {
  allowedDomains: [],
  blockedToday: 0,
  blockedTodayDate: "",
  blockedLog: [],
  defaultWindowEnabled: false,
  layers: { ...DEFAULT_LAYERS },
};

const MAX_LOG = 50;
const RECENT_AUTH_MS = 2500;

/** windowId (number) -> boolean */
const windowEnabled = new Map();

/** Autorizaciones temporales por gesto explícito (Cmd/Ctrl+clic, clic medio). */
let pendingAuthorizations = [];
/** Tabs ya autorizadas (whitelist o gesto). */
const authorizedTabIds = new Set();

function pruneAuthorizations(now = Date.now()) {
  pendingAuthorizations = pendingAuthorizations.filter(
    (item) => now - item.at < RECENT_AUTH_MS
  );
}

function consumeAuthorization(hostname) {
  pruneAuthorizations();
  const idx = pendingAuthorizations.findIndex(
    (item) => !hostname || item.hostname === hostname || !item.hostname
  );
  if (idx === -1) return false;
  pendingAuthorizations.splice(idx, 1);
  return true;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

function normalizeLayers(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    cookiesJs: src.cookiesJs === true,
    cookiesHttp: src.cookiesHttp === true,
    downloads: src.downloads === true,
    storage: src.storage === true,
    trackers: src.trackers === true,
  };
}

async function getPersistedSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    allowedDomains: Array.isArray(data.allowedDomains)
      ? data.allowedDomains
      : [],
    blockedToday: Number(data.blockedToday) || 0,
    blockedTodayDate: data.blockedTodayDate || "",
    blockedLog: Array.isArray(data.blockedLog) ? data.blockedLog : [],
    defaultWindowEnabled: data.defaultWindowEnabled === true,
    layers: normalizeLayers(data.layers),
  };
}

async function ensureDailyCounter(settings) {
  const today = todayKey();
  if (settings.blockedTodayDate === today) return settings;
  await chrome.storage.local.set({
    blockedToday: 0,
    blockedTodayDate: today,
  });
  return {
    ...settings,
    blockedToday: 0,
    blockedTodayDate: today,
  };
}

function isAllowedHost(hostname, allowedDomains) {
  if (!hostname) return false;
  return allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isBrowserInternalUrl(url) {
  return /^(chrome(-extension)?:|brave:|about:|edge:|devtools:|chrome-search:)/i.test(
    url || ""
  );
}

/* ─── Estado por ventana ─────────────────────────────────────────── */

async function getDefaultWindowEnabled() {
  const { defaultWindowEnabled } = await getPersistedSettings();
  return defaultWindowEnabled === true;
}

async function isWindowEnabled(windowId) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
    return false;
  }
  if (windowEnabled.has(windowId)) {
    return windowEnabled.get(windowId) === true;
  }
  const fallback = await getDefaultWindowEnabled();
  windowEnabled.set(windowId, fallback);
  return fallback;
}

async function setWindowEnabled(windowId, enabled) {
  windowEnabled.set(windowId, Boolean(enabled));
  await persistWindowStates();
  await notifyWindowTabs(windowId, Boolean(enabled));
  await refreshBadgesForWindow(windowId);
  await refreshNetworkLockdownRules();
}

async function persistWindowStates() {
  const states = {};
  for (const [id, value] of windowEnabled.entries()) {
    states[String(id)] = value;
  }
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ windowEnabled: states });
    }
  } catch {
    /* session storage no disponible */
  }
}

async function restoreWindowStates() {
  try {
    if (!chrome.storage.session) return;
    const data = await chrome.storage.session.get("windowEnabled");
    const states = data.windowEnabled || {};
    for (const [id, value] of Object.entries(states)) {
      windowEnabled.set(Number(id), value === true);
    }
  } catch {
    /* ignore */
  }
}

async function notifyWindowTabs(windowId, enabled) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return;
  }
  const settings = await getPersistedSettings();
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "WINDOW_SETTINGS",
          payload: {
            enabled,
            allowedDomains: settings.allowedDomains,
            layers: settings.layers,
            windowId,
          },
        });
      } catch {
        /* pestaña sin content script */
      }
    })
  );
}

async function broadcastLayersToAllTabs() {
  const settings = await getPersistedSettings();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      const enabled = await isWindowEnabled(tab.windowId);
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "WINDOW_SETTINGS",
          payload: {
            enabled,
            allowedDomains: settings.allowedDomains,
            layers: settings.layers,
            windowId: tab.windowId,
          },
        });
      } catch {
        /* ignore */
      }
    })
  );
}

async function updateTabBadge(tabId, enabled, blockedToday) {
  try {
    if (!enabled) {
      await chrome.action.setBadgeText({ tabId, text: "OFF" });
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: "#6b7280",
      });
      return;
    }
    const text = blockedToday > 0 ? String(Math.min(blockedToday, 999)) : "ON";
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: "#c2410c",
    });
  } catch {
    /* ignore */
  }
}

async function refreshBadgesForWindow(windowId) {
  const settings = await ensureDailyCounter(await getPersistedSettings());
  const enabled = await isWindowEnabled(windowId);
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return;
  }
  await Promise.all(
    tabs.map((tab) =>
      tab.id != null
        ? updateTabBadge(tab.id, enabled, settings.blockedToday)
        : Promise.resolve()
    )
  );
}

async function refreshBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const settings = await ensureDailyCounter(await getPersistedSettings());
    const enabled = await isWindowEnabled(tab.windowId);
    await updateTabBadge(tabId, enabled, settings.blockedToday);
  } catch {
    /* ignore */
  }
}

async function refreshAllBadges() {
  const settings = await ensureDailyCounter(await getPersistedSettings());
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      const enabled = await isWindowEnabled(tab.windowId);
      await updateTabBadge(tab.id, enabled, settings.blockedToday);
    })
  );
}

async function recordBlock(entry) {
  let settings = await getPersistedSettings();
  settings = await ensureDailyCounter(settings);

  const blockedToday = settings.blockedToday + 1;
  const blockedLog = [
    {
      domain: entry.domain || "",
      target: entry.target || "",
      type: entry.type || "unknown",
      timestamp: entry.timestamp || Date.now(),
    },
    ...settings.blockedLog,
  ].slice(0, MAX_LOG);

  await chrome.storage.local.set({
    blockedToday,
    blockedTodayDate: todayKey(),
    blockedLog,
  });

  await refreshAllBadges();
}

async function getWindowIdFromTabId(tabId) {
  if (tabId == null) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.windowId;
  } catch {
    return null;
  }
}

/**
 * ¿La ventana de origen tiene el bloqueo activo?
 * Usamos el opener / source, no la ventana recién creada.
 */
async function isProtectionActiveForSourceTab(tabId) {
  const windowId = await getWindowIdFromTabId(tabId);
  if (windowId == null) return false;
  return isWindowEnabled(windowId);
}

/* ─── Lockdown de red: cookies HTTP en pestañas protegidas ───────── */

const DNR_COOKIE_RULE_ID = 9001;

async function getProtectedTabIds() {
  const settings = await getPersistedSettings();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return [];
  }
  const ids = [];
  for (const tab of tabs) {
    if (tab.id == null) continue;
    if (!(await isWindowEnabled(tab.windowId))) continue;
    const host = hostnameFromUrl(tab.url || tab.pendingUrl || "");
    if (host && isAllowedHost(host, settings.allowedDomains)) continue;
    ids.push(tab.id);
  }
  return ids;
}

async function refreshNetworkLockdownRules() {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;

  const settings = await getPersistedSettings();
  const removeRuleIds = [DNR_COOKIE_RULE_ID];
  const addRules = [];

  // Solo aplica si la capa HTTP está activa (evita romper logins por defecto).
  if (settings.layers.cookiesHttp) {
    const tabIds = await getProtectedTabIds();
    if (tabIds.length > 0) {
      addRules.push({
        id: DNR_COOKIE_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "cookie", operation: "remove" }],
          responseHeaders: [{ header: "set-cookie", operation: "remove" }],
        },
        condition: {
          tabIds,
          resourceTypes: [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "webtransport",
            "other",
          ],
        },
      });
    }
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules,
    });
  } catch (err) {
    console.warn("[Strict Popup Blocker] Reglas DNR:", err);
  }
}

async function downloadMatchesProtectedTab(item) {
  const settings = await getPersistedSettings();
  if (!settings.layers.downloads) return { match: false };

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return { match: false };
  }

  const referrer = item.referrer || "";
  const itemUrl = item.finalUrl || item.url || "";

  for (const tab of tabs) {
    if (tab.id == null) continue;
    if (!(await isWindowEnabled(tab.windowId))) continue;

    const tabUrl = tab.url || "";
    const host = hostnameFromUrl(tabUrl);
    if (host && isAllowedHost(host, settings.allowedDomains)) continue;

    try {
      if (referrer && tabUrl) {
        const refOrigin = new URL(referrer).origin;
        const tabOrigin = new URL(tabUrl).origin;
        if (refOrigin === tabOrigin) {
          return { match: true, domain: host, target: itemUrl };
        }
      }
    } catch {
      /* ignore */
    }
  }

  return { match: false };
}

/* ─── Ciclo de vida ──────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    ...Object.keys(DEFAULTS),
    "enabled",
  ]);
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (existing[key] === undefined) toSet[key] = value;
  }
  // Migración: el antiguo flag global ya no controla todo el navegador.
  if (existing.enabled !== undefined && existing.defaultWindowEnabled === undefined) {
    toSet.defaultWindowEnabled = false;
  }
  if (Object.keys(toSet).length) {
    await chrome.storage.local.set(toSet);
  }
  await restoreWindowStates();
  await refreshAllBadges();
  await refreshNetworkLockdownRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreWindowStates();
  await refreshAllBadges();
  await refreshNetworkLockdownRules();
});

chrome.windows.onCreated.addListener(async (win) => {
  if (win.id == null || win.type === "popup") return;
  if (!windowEnabled.has(win.id)) {
    windowEnabled.set(win.id, await getDefaultWindowEnabled());
    await persistWindowStates();
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  windowEnabled.delete(windowId);
  await persistWindowStates();
  await refreshNetworkLockdownRules();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refreshBadgeForTab(tabId);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id != null) await refreshBadgeForTab(tab.id);
  await refreshNetworkLockdownRules();
});

chrome.tabs.onRemoved.addListener(async () => {
  await refreshNetworkLockdownRules();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    await refreshNetworkLockdownRules();
    await refreshBadgeForTab(tabId);
  }
});

chrome.tabs.onAttached.addListener(async () => {
  await refreshNetworkLockdownRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.blockedToday || changes.allowedDomains) {
    refreshAllBadges();
  }
  if (changes.allowedDomains || changes.layers) {
    refreshNetworkLockdownRules();
  }
  if (changes.layers) {
    broadcastLayersToAllTabs();
  }
});

/* ─── Mensajes ───────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "POPUP_BLOCKED") {
    recordBlock(message.payload || {}).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "USER_GESTURE") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "AUTHORIZE_NEXT_TAB") {
    pendingAuthorizations.push({
      hostname: message.payload?.hostname || "",
      reason: message.payload?.reason || "",
      at: Date.now(),
      windowId: sender.tab?.windowId,
    });
    pruneAuthorizations();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_WINDOW_STATE") {
    (async () => {
      const windowId =
        message.windowId ??
        sender.tab?.windowId ??
        (
          await chrome.windows.getCurrent().catch(() => null)
        )?.id;
      const settings = await ensureDailyCounter(await getPersistedSettings());
      const enabled = await isWindowEnabled(windowId);
      sendResponse({
        windowId,
        enabled,
        allowedDomains: settings.allowedDomains,
        layers: settings.layers,
        blockedToday: settings.blockedToday,
        blockedLog: settings.blockedLog,
      });
    })();
    return true;
  }

  if (message.type === "SET_WINDOW_ENABLED") {
    (async () => {
      let windowId = message.windowId;
      if (windowId == null) {
        const win = await chrome.windows.getCurrent();
        windowId = win.id;
      }
      await setWindowEnabled(windowId, message.enabled === true);
      sendResponse({ ok: true, windowId, enabled: message.enabled === true });
    })();
    return true;
  }

  if (message.type === "SET_LAYERS") {
    (async () => {
      const layers = normalizeLayers(message.layers);
      await chrome.storage.local.set({ layers });
      await broadcastLayersToAllTabs();
      await refreshNetworkLockdownRules();
      sendResponse({ ok: true, layers });
    })();
    return true;
  }

  return false;
});

/* ─── Defensas de cierre (solo si la ventana origen está ON) ─────── */

async function shouldCloseCreatedTab(tab) {
  if (authorizedTabIds.has(tab.id)) {
    authorizedTabIds.delete(tab.id);
    return { close: false };
  }

  if (tab.openerTabId == null) return { close: false };

  const sourceActive = await isProtectionActiveForSourceTab(tab.openerTabId);
  if (!sourceActive) return { close: false };

  const settings = await getPersistedSettings();

  let openerHost = "";
  try {
    const opener = await chrome.tabs.get(tab.openerTabId);
    openerHost = hostnameFromUrl(opener.url || opener.pendingUrl || "");
  } catch {
    openerHost = "";
  }

  if (openerHost && isAllowedHost(openerHost, settings.allowedDomains)) {
    return { close: false };
  }

  if (consumeAuthorization(openerHost)) {
    return { close: false };
  }

  const pending = tab.pendingUrl || tab.url || "";
  if (isBrowserInternalUrl(pending)) return { close: false };

  // No cerrar navegaciones al mismo dominio (comportamiento web normal).
  try {
    if (openerHost && pending) {
      const targetHost = hostnameFromUrl(pending);
      if (targetHost && targetHost === openerHost) {
        return { close: false };
      }
    }
  } catch {
    /* ignore */
  }

  return {
    close: true,
    domain: openerHost || hostnameFromUrl(pending),
    target: pending,
  };
}

chrome.windows.onCreated.addListener(async (win) => {
  try {
    if (win.type !== "popup") return;

    const tabs = await chrome.tabs.query({ windowId: win.id });
    const tab = tabs[0];

    if (!tab) return;

    if (tab.openerTabId == null) return;

    const sourceActive = await isProtectionActiveForSourceTab(tab.openerTabId);
    if (!sourceActive) return;

    const settings = await getPersistedSettings();
    let openerHost = "";
    try {
      const opener = await chrome.tabs.get(tab.openerTabId);
      openerHost = hostnameFromUrl(opener.url || opener.pendingUrl || "");
    } catch {
      /* ignore */
    }

    if (openerHost && isAllowedHost(openerHost, settings.allowedDomains)) {
      return;
    }
    if (consumeAuthorization(openerHost)) return;

    await chrome.windows.remove(win.id);
    await recordBlock({
      domain: openerHost,
      target: tab.pendingUrl || tab.url || "",
      type: "window.popup",
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn("[Strict Popup Blocker] Error en windows.onCreated:", err);
  }
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  try {
    const sourceActive = await isProtectionActiveForSourceTab(
      details.sourceTabId
    );
    if (!sourceActive) return;

    const settings = await getPersistedSettings();
    let sourceHost = "";
    try {
      const sourceTab = await chrome.tabs.get(details.sourceTabId);
      sourceHost = hostnameFromUrl(sourceTab.url || "");
    } catch {
      /* ignore */
    }

    if (sourceHost && isAllowedHost(sourceHost, settings.allowedDomains)) {
      authorizedTabIds.add(details.tabId);
      setTimeout(() => authorizedTabIds.delete(details.tabId), RECENT_AUTH_MS);
      return;
    }

    if (consumeAuthorization(sourceHost)) {
      authorizedTabIds.add(details.tabId);
      setTimeout(() => authorizedTabIds.delete(details.tabId), RECENT_AUTH_MS);
      return;
    }

    if (isBrowserInternalUrl(details.url)) return;

    // Solo cerrar si el destino es de otro dominio.
    try {
      const targetHost = hostnameFromUrl(details.url || "");
      if (sourceHost && targetHost && sourceHost === targetHost) {
        authorizedTabIds.add(details.tabId);
        setTimeout(() => authorizedTabIds.delete(details.tabId), RECENT_AUTH_MS);
        return;
      }
    } catch {
      /* ignore */
    }

    await chrome.tabs.remove(details.tabId);
    await recordBlock({
      domain: sourceHost,
      target: details.url || "",
      type: "navigationTarget",
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn(
      "[Strict Popup Blocker] Error en onCreatedNavigationTarget:",
      err
    );
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    await new Promise((r) => setTimeout(r, 60));
    if (authorizedTabIds.has(tab.id)) return;

    const decision = await shouldCloseCreatedTab(tab);
    if (!decision.close) return;

    await chrome.tabs.remove(tab.id);
    await recordBlock({
      domain: decision.domain,
      target: decision.target,
      type: "tab.onCreated",
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn("[Strict Popup Blocker] Error al cerrar tab:", err);
  }
});

(async () => {
  await restoreWindowStates();
  await refreshAllBadges();
  await refreshNetworkLockdownRules();
})();

/* ─── Cancelar descargas desde ventanas protegidas ───────────────── */

if (chrome.downloads?.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    try {
      const decision = await downloadMatchesProtectedTab(item);
      if (!decision.match) return;

      await chrome.downloads.cancel(item.id);
      try {
        await chrome.downloads.erase({ id: item.id });
      } catch {
        /* ignore */
      }

      await recordBlock({
        domain: decision.domain || "",
        target: decision.target || item.url || "",
        type: "download",
        timestamp: Date.now(),
      });
      console.warn("[Strict Popup Blocker] Descarga cancelada:", item.url);
    } catch (err) {
      console.warn("[Strict Popup Blocker] Error al cancelar descarga:", err);
    }
  });
}
