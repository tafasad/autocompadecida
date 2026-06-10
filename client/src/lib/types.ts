export type ScriptLine = {
  id: string;
  text: string;
  effectName: string;
  audioName?: string;
  audioBlob?: Blob;
  audioId?: string;
  audioUrl?: string;
  createdAt: number;
  updatedAt: number;
};

export type PersistedState = {
  version: 1;
  threshold: number;
  lines: ScriptLine[];
};

export const DEFAULT_TRIGGER = "E ande logo antes que mudem de ideia!";

export const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `fala-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const now = () => Date.now();

export const defaultLines = (): ScriptLine[] => [
  {
    id: makeId(),
    text: DEFAULT_TRIGGER,
    effectName: "Risada",
    audioName: "Risada sintética automática",
    createdAt: now(),
    updatedAt: now(),
  },
];

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}