const DEFAULTS = {
  enabled: true,
  allowedDomains: [],
  blockedToday: 0,
  blockedTodayDate: "",
  blockedLog: [],
};

const MAX_LOG = 50;
const RECENT_AUTH_MS = 2500;

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

async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    enabled: data.enabled !== false,
    allowedDomains: Array.isArray(data.allowedDomains)
      ? data.allowedDomains
      : [],
    blockedToday: Number(data.blockedToday) || 0,
    blockedTodayDate: data.blockedTodayDate || "",
    blockedLog: Array.isArray(data.blockedLog) ? data.blockedLog : [],
  };
}

async function ensureDailyCounter(settings) {
  const today = todayKey();
  if (settings.blockedTodayDate === today) return settings;
  const next = {
    ...settings,
    blockedToday: 0,
    blockedTodayDate: today,
  };
  await chrome.storage.local.set({
    blockedToday: 0,
    blockedTodayDate: today,
  });
  return next;
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

async function recordBlock(entry) {
  let settings = await getSettings();
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

  updateBadge(blockedToday, settings.enabled);
}

async function updateBadge(count, enabled) {
  try {
    if (!enabled) {
      await chrome.action.setBadgeText({ text: "OFF" });
      await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
      return;
    }
    const text = count > 0 ? String(Math.min(count, 999)) : "";
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: "#c2410c" });
  } catch {
    /* ignore */
  }
}

async function refreshBadge() {
  const settings = await ensureDailyCounter(await getSettings());
  await updateBadge(settings.blockedToday, settings.enabled);
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (existing[key] === undefined) toSet[key] = value;
  }
  if (Object.keys(toSet).length) {
    await chrome.storage.local.set(toSet);
  }
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.blockedToday) {
    refreshBadge();
  }
});

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
    });
    pruneAuthorizations();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_STATUS") {
    getSettings()
      .then((s) => ensureDailyCounter(s))
      .then((s) => sendResponse(s));
    return true;
  }

  return false;
});

function isBrowserInternalUrl(url) {
  return /^(chrome(-extension)?:|brave:|about:|edge:|devtools:|chrome-search:)/i.test(
    url || ""
  );
}

/**
 * Última línea de defensa para ventanas tipo popup y pestañas con opener
 * que no fueron autorizadas por gesto explícito ni whitelist.
 */
async function shouldCloseCreatedTab(tab, { onlyPopups = false } = {}) {
  const settings = await getSettings();
  if (!settings.enabled) return { close: false };

  if (authorizedTabIds.has(tab.id)) {
    authorizedTabIds.delete(tab.id);
    return { close: false };
  }

  // Sin opener: Nueva pestaña (Cmd+T), enlace desde UI del navegador, etc.
  if (tab.openerTabId == null) return { close: false };

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

  if (onlyPopups) {
    return { close: false };
  }

  return {
    close: true,
    domain: openerHost || hostnameFromUrl(pending),
    target: pending,
  };
}

chrome.windows.onCreated.addListener(async (win) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

    // Ventanas popup son casi siempre no deseadas cuando la protección está ON.
    if (win.type !== "popup") return;

    const tabs = await chrome.tabs.query({ windowId: win.id });
    const tab = tabs[0];
    if (!tab) {
      await chrome.windows.remove(win.id);
      await recordBlock({
        domain: "",
        target: "",
        type: "window.popup",
        timestamp: Date.now(),
      });
      return;
    }

    let openerHost = "";
    if (tab.openerTabId != null) {
      try {
        const opener = await chrome.tabs.get(tab.openerTabId);
        openerHost = hostnameFromUrl(opener.url || opener.pendingUrl || "");
      } catch {
        /* ignore */
      }
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

/**
 * Cierra destinos de navegación creados por la página (window.open / _blank)
 * salvo whitelist o autorización explícita (Cmd/Ctrl+clic).
 */
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

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

/** Refuerzo: pestañas hijas no autorizadas que escaparon a las otras capas. */
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    // Dar un instante a onCreatedNavigationTarget / AUTHORIZE_NEXT_TAB.
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

refreshBadge();
