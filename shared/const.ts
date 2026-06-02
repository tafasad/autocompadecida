export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

export const WS_EVENTS = {
  TOKEN_REQUEST: "TOKEN_REQUEST",
  TOKEN_ACQUIRED: "TOKEN_ACQUIRED",
  TOKEN_BUSY: "TOKEN_BUSY",
  TOKEN_RELEASE: "TOKEN_RELEASE",
  TOKEN_RELEASED: "TOKEN_RELEASED",
  KILL_AUDIO: "KILL_AUDIO",
  KILL_AUDIO_BROADCAST: "KILL_AUDIO_BROADCAST",
  UNAUTHORIZED: "UNAUTHORIZED",
  ERROR: "ERROR",
  TOKEN_HOLDER: "TOKEN_HOLDER",
} as const;

export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export type WsMessage = {
  type: WsEventType;
  clientId?: string;
  holderId?: string;
  role?: string;
  message?: string;
};

export const ADMIN_PASSWORD = "admin123";

export function getWsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}
