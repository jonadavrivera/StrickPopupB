const enabledToggle = document.getElementById("enabledToggle");
const statusText = document.getElementById("statusText");
const powerSection = document.querySelector(".power");
const currentHostEl = document.getElementById("currentHost");
const whitelistBtn = document.getElementById("whitelistBtn");
const blockedCountEl = document.getElementById("blockedCount");
const logCountEl = document.getElementById("logCount");
const blockLogEl = document.getElementById("blockLog");
const emptyLogEl = document.getElementById("emptyLog");

let currentHost = "";
let allowedDomains = [];

function rootDomain(hostname) {
  if (!hostname) return "";
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  // Heurística simple: conservar últimos 2 segmentos.
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
    ? `Quitar permiso a ${currentHost}`
    : `Permitir popups en ${currentHost}`;
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
    if (!url || /^(chrome|brave|edge|about|devtools|chrome-extension):/i.test(url)) {
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
  const data = await chrome.storage.local.get([
    "enabled",
    "allowedDomains",
    "blockedToday",
    "blockedTodayDate",
    "blockedLog",
  ]);

  const enabled = data.enabled !== false;
  allowedDomains = Array.isArray(data.allowedDomains)
    ? data.allowedDomains
    : [];

  renderPower(enabled);
  blockedCountEl.textContent = String(Number(data.blockedToday) || 0);
  renderLog(data.blockedLog);
  renderWhitelist();
}

enabledToggle.addEventListener("change", async () => {
  const enabled = enabledToggle.checked;
  renderPower(enabled);
  await chrome.storage.local.set({ enabled });
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
  } else {
    if (!allowedDomains.includes(domain)) {
      allowedDomains = [...allowedDomains, domain];
    }
  }

  await chrome.storage.local.set({ allowedDomains });
  renderWhitelist();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  refresh();
});

(async () => {
  await loadCurrentTabHost();
  await refresh();
})();
