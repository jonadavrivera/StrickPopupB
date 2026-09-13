export const STORAGE_KEYS = {
  ALLOWED_DOMAINS: "allowedDomains",
  BLOCKED_TODAY: "blockedToday",
  BLOCKED_TODAY_DATE: "blockedTodayDate",
  BLOCKED_LOG: "blockedLog",
  DEFAULT_WINDOW_ENABLED: "defaultWindowEnabled",
};

export const DEFAULT_SETTINGS = {
  allowedDomains: [],
  blockedToday: 0,
  blockedTodayDate: "",
  blockedLog: [],
  /** Las ventanas nuevas arrancan en OFF. */
  defaultWindowEnabled: false,
};

export const MAX_LOG_ENTRIES = 50;

/** Ventana de gesto de usuario (ms). En modo estricto no se usa para permitir popups. */
export const USER_GESTURE_WINDOW_MS = 500;

/** Tiempo en que una apertura autorizada por whitelist permanece marcada (ms). */
export const AUTH_WINDOW_MS = 1500;
