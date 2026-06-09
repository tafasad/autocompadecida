import { useEffect, useRef, useState, useCallback } from "react";
import type { SpeechRecognitionLike } from "@/lib/types";
import { unlockAudio } from "@/lib/audio";

interface UseSpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: "idle" | "listening" | "error") => void;
}

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
  const hasNetworkErrorRef = useRef(false);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const isStartingRef = useRef(false);
  const MAX_RETRIES = 5; // Reduced for mobile — aggressive retries cause hangs
  const isReconnectingRef = useRef(false);

  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper: create a fresh recognition instance with all handlers wired up
  const createRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = language;

    recognition.onstart = () => {
      console.log("✓ Reconhecimento iniciado");
      hasNetworkErrorRef.current = false;
      isReconnectingRef.current = false;
      isStartingRef.current = false;
      retryCountRef.current = 0;
      setError(null);
      onStatusChangeRef.current?.("listening");
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text + " ";
        } else {
          interimTranscript += text;
        }
      }

      const current = (finalTranscript || interimTranscript).trim();
      if (current) {
        onResultRef.current?.(current, !!finalTranscript);
      }
    };

    recognition.onend = () => {
      console.log("✓ Reconhecimento finalizado");

      // Only auto-restart if we're still supposed to be listening
      // and this wasn't caused by an abort/stop
      if (
        isListeningRef.current &&
        !isStoppingRef.current &&
        !hasNetworkErrorRef.current &&
        !isReconnectingRef.current
      ) {
        setTimeout(() => {
          if (isListeningRef.current && !isStoppingRef.current) {
            try {
              recognition.start();
            } catch (err: any) {
              console.warn("Falha ao reiniciar recognition:", err?.message);
              // If start fails, try abort + fresh start after a longer delay
              try { recognition.abort(); } catch { /* ignorar */ }
              setTimeout(() => {
                if (isListeningRef.current && !isStoppingRef.current) {
                  try { recognition.start(); } catch { /* ignorar */ }
                }
              }, 500);
            }
          }
        }, 800);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "aborted") return;
      if (isStoppingRef.current) return;

      console.error("Erro de reconhecimento:", event.error);

      // "no-speech" é comum quando o usuário fica em silêncio — não tratar como erro
      if (event.error === "no-speech") {
        console.log("Nenhuma fala detectada, mantendo escuta...");
        return;
      }

      // "audio-capture" significa que o microfone foi desconectado ou bloqueado
      // BUG FIX: recriar o recognition do zero em vez de reutilizar a instância corrompida
      if (event.error === "audio-capture") {
        console.error("Microfone perdido, recriando recognition e tentando reconectar...");
        isListeningRef.current = false;
        setIsListening(false);
        onStatusChangeRef.current?.("error");
        setError("Microfone desconectado ou bloqueado. Tentando reconectar...");
        onErrorRef.current?.("Microfone desconectado");

        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          // Abort e descarta a instância atual
          try { recognition.abort(); } catch { /* ignorar */ }
          recognitionRef.current = null;

          isReconnectingRef.current = true;
          retryTimeoutRef.current = window.setTimeout(() => {
            hasNetworkErrorRef.current = false;
            if (!isStoppingRef.current) {
              // Cria uma nova instância do recognition
              const newRecog = createRecognition();
              if (newRecog) {
                recognitionRef.current = newRecog;
                isListeningRef.current = true;
                setIsListening(true);
                setError(null);
                onStatusChangeRef.current?.("listening");
                isReconnectingRef.current = false;
                try { newRecog.start(); } catch { /* ignorar */ }
              } else {
                isReconnectingRef.current = false;
                setError("Não foi possível recriar o reconhecimento de voz.");
                onStatusChangeRef.current?.("error");
              }
            } else {
              isReconnectingRef.current = false;
            }
          }, 2000);
        } else {
          setError("Microfone indisponível após várias tentativas. Recarregue a página.");
          onStatusChangeRef.current?.("error");
        }
        return;
      }

      if (event.error === "network") {
        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          // Exponential backoff: 2s, 4s, 8s... up to 30s
          const delay = Math.min(2000 * Math.pow(2, retryCountRef.current - 1), 30000);
          setError(`Rede instável. Reconectando em ${Math.round(delay / 1000)}s... (${retryCountRef.current}/${MAX_RETRIES})`);
          try { recognition.abort(); } catch { /* ignorar */ }
          isListeningRef.current = false;
          setIsListening(false);
          onStatusChangeRef.current?.("idle");
          isReconnectingRef.current = true;
          retryTimeoutRef.current = window.setTimeout(() => {
            hasNetworkErrorRef.current = false;
            isReconnectingRef.current = false;
            if (!isStoppingRef.current) {
              // Create a fresh recognition instance for network retries
              try { recognition.abort(); } catch { /* ignorar */ }
              const newRecog = createRecognition();
              if (newRecog) {
                recognitionRef.current = newRecog;
                isListeningRef.current = true;
                setIsListening(true);
                setError(null);
                onStatusChangeRef.current?.("listening");
                try { newRecog.start(); } catch { /* ignorar */ }
              } else {
                setError("Não foi possível reconectar o reconhecimento de voz.");
                onStatusChangeRef.current?.("error");
              }
            }
          }, delay);
        } else {
          hasNetworkErrorRef.current = true;
          setError("Reconhecimento de voz indisponível após várias tentativas. Verifique sua conexão e recarregue a página.");
          onErrorRef.current?.("Reconhecimento de voz indisponível");
          onStatusChangeRef.current?.("error");
          isListeningRef.current = false;
          setIsListening(false);
        }
        return;
      }

      const messages: Record<string, string> = {
        "not-allowed":
          "Permissão de microfone negada. Verifique as configurações do navegador.",
        "service-not-allowed": "Serviço de reconhecimento não disponível.",
      };

      const msg = messages[event.error] ?? `Erro: ${event.error}`;
      setError(msg);
      onErrorRef.current?.(msg);
      onStatusChangeRef.current?.("error");
      isListeningRef.current = false;
      setIsListening(false);
    };

    return recognition;
  }, [language, continuous, interimResults]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      setError(
        "Seu navegador não suporta reconhecimento de voz. Use Chrome, Edge ou Safari."
      );
      onStatusChangeRef.current?.("error");
      return;
    }

    setIsSupported(true);

    try {
      const recognition = createRecognition();
      if (recognition) {
        recognitionRef.current = recognition;
      }
    } catch (err) {
      console.error("Erro ao inicializar Speech Recognition:", err);
      setIsSupported(false);
      setError("Erro ao inicializar reconhecimento de voz");
      onStatusChangeRef.current?.("error");
    }

    return () => {
      isStoppingRef.current = true;
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignorar */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    if (!recognitionRef.current) {
      // Tenta recriar se não existir
      const newRecog = createRecognition();
      if (!newRecog) {
        setError("Reconhecimento de voz não suportado");
        onStatusChangeRef.current?.("error");
        return;
      }
      recognitionRef.current = newRecog;
    }

    // Prevent double-start which causes "aborted" error
    if (isStartingRef.current) {
      console.log("Start já em progresso, ignorando...");
      return;
    }

    // Unlock audio on mobile when user activates mic (inside user gesture)
    unlockAudio();

    try {
      isStoppingRef.current = false;
      hasNetworkErrorRef.current = false;
      isReconnectingRef.current = false;
      isStartingRef.current = true;
      retryCountRef.current = 0;

      isListeningRef.current = true;
      setIsListening(true);
      setError(null);
      onStatusChangeRef.current?.("listening");

      try {
        recognitionRef.current.start();
      } catch (err: any) {
        if (
          err.message?.includes("already started") ||
          err.name === "InvalidStateError"
        ) {
          console.log("Reconhecimento já está ativo");
          isStartingRef.current = false;
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("Erro ao iniciar reconhecimento:", err);
      isStartingRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);

      const msg =
        err.name === "NotAllowedError"
          ? "Permissão de microfone negada. Clique no ícone de microfone na barra de endereço."
          : err.name === "NotFoundError"
            ? "Nenhum microfone encontrado no seu dispositivo."
            : "Erro ao acessar o microfone";

      setError(msg);
      onStatusChangeRef.current?.("error");
    }
  }, [createRecognition]);

  const stop = useCallback(() => {
    isStoppingRef.current = true;
    isListeningRef.current = false;
    isReconnectingRef.current = false;
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignorar */
    }

    setIsListening(false);
    onStatusChangeRef.current?.("idle");

    setTimeout(() => {
      isStoppingRef.current = false;
    }, 500);
  }, []);

  const abort = useCallback(() => {
    isStoppingRef.current = true;
    isListeningRef.current = false;
    isReconnectingRef.current = false;
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignorar */
    }

    setIsListening(false);
    onStatusChangeRef.current?.("idle");

    setTimeout(() => {
      isStoppingRef.current = false;
    }, 500);
  }, []);

  return { isListening, isSupported, error, setError, start, stop, abort };
}
