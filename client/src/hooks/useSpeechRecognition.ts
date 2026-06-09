import { useEffect, useRef, useState, useCallback } from "react";

interface UseSpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: "idle" | "listening" | "error") => void;
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

type Status = "idle" | "listening" | "error";

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
) {
  const {
    language = "pt-BR",
    continuous = true,
    interimResults = true,
    onResult,
    onError,
    onStatusChange,
  } = options;

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const isStoppingRef = useRef(false);
  const isStartingRef = useRef(false);
  const restartTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 10;
  const isMobile = useRef(isMobileDevice());

  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearTimers = useCallback(() => {
    if (restartTimeoutRef.current !== null) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  }, []);

  const notifyStatus = useCallback((s: Status) => {
    onStatusChangeRef.current?.(s);
  }, []);

  // --- Create a fresh SpeechRecognition instance ---
  const createInstance = useCallback((): any => {
    const Ctor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!Ctor) return null;

    const rec = new Ctor();
    // Mobile doesn't handle continuous well — use single-shot + manual restart
    rec.continuous = isMobile.current ? false : continuous;
    rec.interimResults = isMobile.current ? false : interimResults;
    rec.lang = language;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      console.log("✓ recognition started");
      isStartingRef.current = false;
      retryCountRef.current = 0;
      setError(null);
      notifyStatus("listening");
    };

    rec.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t + " ";
        else interimText += t;
      }
      const out = (finalText || interimText).trim();
      if (out) onResultRef.current?.(out, !!finalText);

      // Mobile: continuous=false, so restart after a final result
      if (isMobile.current && finalText.trim()) {
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) freshStart();
        }, 300);
      }
    };

    rec.onend = () => {
      console.log("✓ recognition ended");
      // Desktop auto-restart (handles edge drops)
      if (
        isListeningRef.current &&
        !isStoppingRef.current &&
        !isStartingRef.current &&
        !isMobile.current
      ) {
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) doRestart();
        }, 500);
      }
    };

    rec.onerror = (event: any) => {
      const err = event.error as string;
      console.error("speech error:", err);
      if (isStoppingRef.current) return;

      isStartingRef.current = false;

      if (err === "aborted") {
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) doRestart();
        }, 400);
        return;
      }

      if (err === "no-speech") return;

      if (err === "audio-capture") {
        setError("Microfone perdido. Reconectando...");
        notifyStatus("error");
        onErrorRef.current?.("Microfone desconectado");
        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          clearTimers();
          restartTimeoutRef.current = window.setTimeout(() => {
            if (isListeningRef.current && !isStoppingRef.current) freshStart();
          }, 1500);
        } else {
          setError("Microfone indisponível. Recarregue.");
          isListeningRef.current = false;
          setIsListening(false);
        }
        return;
      }

      if (err === "network") {
        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          const delay = isMobile.current
            ? Math.min(1000 * retryCountRef.current, 5000)
            : Math.min(1500 * Math.pow(2, retryCountRef.current - 1), 15000);
          setError(`Rede instável. Tentando em ${Math.round(delay / 1000)}s…`);
          clearTimers();
          restartTimeoutRef.current = window.setTimeout(() => {
            if (isListeningRef.current && !isStoppingRef.current) freshStart();
          }, delay);
        } else {
          setError("Sem conexão. Verifique a internet e recarregue.");
          isListeningRef.current = false;
          setIsListening(false);
          notifyStatus("error");
        }
        return;
      }

      if (err === "not-allowed") {
        const msg = "Permissão de microfone negada. Veja as configurações do navegador.";
        setError(msg);
        onErrorRef.current?.(msg);
        notifyStatus("error");
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }

      // Any other error — try to recover
      const msg = `Erro: ${err}`;
      setError(msg);
      onErrorRef.current?.(msg);
      notifyStatus("error");
      retryCountRef.current += 1;
      if (retryCountRef.current <= MAX_RETRIES) {
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) freshStart();
        }, 1000);
      }
    };

    return rec;
  }, [
    language, continuous, interimResults,
    clearTimers, notifyStatus,
    isListeningRef, isStoppingRef, isStartingRef,
  ]);

  // --- Stop old + create new + start ---
  const freshStart = useCallback(() => {
    const old = recognitionRef.current;
    if (old) {
      try {
        old.onresult = old.onerror = old.onstart = old.onend = null;
        old.abort();
      } catch { /* ignore */ }
    }
    const rec = createInstance();
    if (!rec) {
      setError("Reconhecimento não suportado.");
      isListeningRef.current = false;
      setIsListening(false);
      return;
    }
    recognitionRef.current = rec;
    if (isListeningRef.current && !isStoppingRef.current && !isStartingRef.current) {
      isStartingRef.current = true;
      try {
        rec.start();
      } catch (e: any) {
        console.warn("freshStart failed:", e?.message);
        isStartingRef.current = false;
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) freshStart();
        }, 800);
      }
    }
  }, [createInstance, clearTimers]);

  // --- Restart the same instance ---
  const doRestart = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) { freshStart(); return; }
    try {
      rec.stop();
      setTimeout(() => {
        if (isListeningRef.current && !isStoppingRef.current) {
          try { rec.start(); } catch { freshStart(); }
        }
      }, 100);
    } catch { freshStart(); }
  }, [freshStart]);

  // --- Mount: detect support + create initial instance ---
  // `freshStart` is declared above via useCallback, so it's usable here
  // through closure. Add missing deps.
  // `isListening`` — not a dep
  void isListening; // suppress unused warning

  useEffect(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setIsSupported(false);
      setError("Use Chrome ou Edge para reconhecimento de voz.");
      notifyStatus("error");
      return;
    }
    setIsSupported(true);
    isMobile.current = isMobileDevice();
    console.log("speech init, mobile:", isMobile.current);
    const rec = createInstance();
    if (rec) recognitionRef.current = rec;

    return () => {
      isStoppingRef.current = true;
      isListeningRef.current = false;
      clearTimers();
      try {
        const r = recognitionRef.current;
        if (r) { r.onresult = r.onerror = r.onstart = r.onend = null; r.abort(); }
      } catch { /* ignore */ }
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Public API ---
  const start = useCallback(() => {
    if (!recognitionRef.current) {
      const rec = createInstance();
      if (!rec) {
        setError("Reconhecimento de voz não suportado.");
        notifyStatus("error");
        return;
      }
      recognitionRef.current = rec;
    }
    if (isStartingRef.current) return;
    clearTimers();
    isStoppingRef.current = false;
    isStartingRef.current = true;
    isListeningRef.current = true;
    retryCountRef.current = 0;
    setIsListening(true);
    setError(null);
    notifyStatus("listening");
    try {
      recognitionRef.current.start();
    } catch (e: any) {
      if (e.name === "InvalidStateError" || e.message?.includes("already started")) {
        isStartingRef.current = false;
      } else {
        console.error("start error:", e);
        isStartingRef.current = false;
        clearTimers();
        restartTimeoutRef.current = window.setTimeout(() => {
          freshStart();
        }, 500);
      }
    }
  }, [createInstance, clearTimers, freshStart, notifyStatus]);

  const stop = useCallback(() => {
    isStoppingRef.current = true;
    isListeningRef.current = false;
    isStartingRef.current = false;
    clearTimers();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setIsListening(false);
    notifyStatus("idle");
    setTimeout(() => { isStoppingRef.current = false; }, 500);
  }, [clearTimers, notifyStatus]);

  const abort = useCallback(() => {
    isStoppingRef.current = true;
    isListeningRef.current = false;
    isStartingRef.current = false;
    clearTimers();
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    setIsListening(false);
    notifyStatus("idle");
    setTimeout(() => { isStoppingRef.current = false; }, 500);
  }, [clearTimers, notifyStatus]);

  return { isListening, isSupported, error, setError, start, stop, abort };
}
