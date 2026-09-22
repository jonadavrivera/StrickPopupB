export const STORAGE_KEYS = {
  ALLOWED_DOMAINS: "allowedDomains",
  BLOCKED_TODAY: "blockedToday",
  BLOCKED_TODAY_DATE: "blockedTodayDate",
  BLOCKED_LOG: "blockedLog",
  DEFAULT_WINDOW_ENABLED: "defaultWindowEnabled",
  LAYERS: "layers",
};

export const DEFAULT_LAYERS = {
  cookiesJs: false,
  cookiesHttp: false,
  downloads: false,
  storage: false,
  trackers: false,
};

export const DEFAULT_SETTINGS = {
  allowedDomains: [],
  blockedToday: 0,
  blockedTodayDate: "",
  blockedLog: [],
  defaultWindowEnabled: false,
  layers: { ...DEFAULT_LAYERS },
};

export const MAX_LOG_ENTRIES = 50;

export const USER_GESTURE_WINDOW_MS = 500;

export const AUTH_WINDOW_MS = 1500;
