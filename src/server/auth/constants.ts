/** Delas av proxy.ts och sessionskoden. Ingen server-only här så att proxy kan importera den. */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-golf_session" : "golf_session";

/** Absolut maxlängd för en session. */
export const SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;
/** Sessionen upphör om den inte använts på så här länge. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** lastSeenAt uppdateras högst så här ofta (sparar databasskrivningar). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
