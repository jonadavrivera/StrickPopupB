const enabledToggle = document.getElementById("enabledToggle");
const statusText = document.getElementById("statusText");
const powerSection = document.querySelector(".power");
const scopeHint = document.getElementById("scopeHint");
const layersSection = document.querySelector(".layers");
const currentHostEl = document.getElementById("currentHost");
const whitelistBtn = document.getElementById("whitelistBtn");
const blockedCountEl = document.getElementById("blockedCount");
const logCountEl = document.getElementById("logCount");
const blockLogEl = document.getElementById("blockLog");
const emptyLogEl = document.getElementById("emptyLog");

const layerInputs = {
  cookiesJs: document.getElementById("layerCookiesJs"),
  cookiesHttp: document.getElementById("layerCookiesHttp"),
  downloads: document.getElementById("layerDownloads"),
  storage: document.getElementById("layerStorage"),
  trackers: document.getElementById("layerTrackers"),
};

let currentHost = "";
let allowedDomains = [];
let currentWindowId = null;
let layers = {
  cookiesJs: false,
  cookiesHttp: false,
  downloads: false,
  storage: false,
  trackers: false,
};

function rootDomain(hostname) {
  if (!hostname) return "";
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function isAllowed(hostname, list) {
  if (!hostname) return false;
  return list.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function shortUrl(url) {
  if (!url) return "(sin URL)";
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname === "/" ? "" : u.pathname.slice(0, 28));
  } catch {
    return String(url).slice(0, 40);
  }
}

function renderPower(enabled) {
  enabledToggle.checked = enabled;
  enabledToggle.setAttribute("aria-checked", String(enabled));
  statusText.textContent = enabled ? "Activada" : "Desactivada";
  powerSection.classList.toggle("is-on", enabled);
  powerSection.classList.toggle("is-off", !enabled);
  if (scopeHint) {
    scopeHint.textContent = enabled
      ? "Solo popups externos · esta ventana"
      : "Apagada en esta ventana";
  }
  layersSection?.classList.toggle("is-disabled", !enabled);
  Object.values(layerInputs).forEach((input) => {
    if (input) input.disabled = !enabled;
  });
}

function renderLayers(next) {
  layers = { ...layers, ...next };
  for (const [key, input] of Object.entries(layerInputs)) {
    if (!input) continue;
    input.checked = layers[key] === true;
  }
}

function renderWhitelist() {
  if (!currentHost) {
    whitelistBtn.disabled = true;
    whitelistBtn.textContent = "Sin sitio activo";
    whitelistBtn.classList.remove("is-allowed");
    return;
  }

  whitelistBtn.disabled = false;
  const allowed = isAllowed(currentHost, allowedDomains);
  whitelistBtn.classList.toggle("is-allowed", allowed);
  whitelistBtn.textContent = allowed
    ? `Quitar excepciones a ${currentHost}`
    : `Permitir excepciones en ${currentHost}`;
}

function renderLog(log) {
  const entries = Array.isArray(log) ? log : [];
  logCountEl.textContent = String(entries.length);

  if (!entries.length) {
    blockLogEl.hidden = true;
    emptyLogEl.hidden = false;
    blockLogEl.innerHTML = "";
    return;
  }

  emptyLogEl.hidden = true;
  blockLogEl.hidden = false;
  blockLogEl.innerHTML = entries
    .slice(0, 8)
    .map((item) => {
      const from = item.domain || "—";
      const to = shortUrl(item.target);
      const type = item.type || "bloqueado";
      const time = formatTime(item.timestamp);
      return `<li>
        <div class="from">${from}</div>
        <div class="to">→ ${to}</div>
        <div class="meta">${type}${time ? ` · ${time}` : ""}</div>
      </li>`;
    })
    .join("");
}

async function loadCurrentTabHost() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = tab?.url || "";
    if (
      !url ||
      /^(chrome|brave|edge|about|devtools|chrome-extension):/i.test(url)
    ) {
      currentHost = "";
      currentHostEl.textContent = "Página interna del navegador";
      return;
    }
    currentHost = new URL(url).hostname;
    currentHostEl.textContent = currentHost;
  } catch {
    currentHost = "";
    currentHostEl.textContent = "No disponible";
  }
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_WINDOW_STATE" });
  currentWindowId = state?.windowId ?? null;
  allowedDomains = Array.isArray(state?.allowedDomains)
    ? state.allowedDomains
    : [];

  renderPower(state?.enabled === true);
  renderLayers(state?.layers || {});
  blockedCountEl.textContent = String(Number(state?.blockedToday) || 0);
  renderLog(state?.blockedLog);
  renderWhitelist();
}

async function persistLayers() {
  const next = {};
  for (const [key, input] of Object.entries(layerInputs)) {
    next[key] = Boolean(input?.checked);
  }
  layers = next;
  await chrome.runtime.sendMessage({ type: "SET_LAYERS", layers: next });
}

enabledToggle.addEventListener("change", async () => {
  const enabled = enabledToggle.checked;
  renderPower(enabled);
  await chrome.runtime.sendMessage({
    type: "SET_WINDOW_ENABLED",
    windowId: currentWindowId,
    enabled,
  });
});

Object.values(layerInputs).forEach((input) => {
  input?.addEventListener("change", () => {
    persistLayers();
  });
});

whitelistBtn.addEventListener("click", async () => {
  if (!currentHost) return;

  const domain = rootDomain(currentHost) || currentHost;
  const already = isAllowed(currentHost, allowedDomains);

  if (already) {
    allowedDomains = allowedDomains.filter(
      (d) =>
        currentHost !== d &&
        !currentHost.endsWith(`.${d}`) &&
        d !== domain
    );
  } else if (!allowedDomains.includes(domain)) {
    allowedDomains = [...allowedDomains, domain];
  }

  await chrome.storage.local.set({ allowedDomains });
  renderWhitelist();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.blockedToday ||
    changes.blockedLog ||
    changes.allowedDomains ||
    changes.layers
  ) {
    refresh();
  }
});

(async () => {
  await loadCurrentTabHost();
  await refresh();
})();
