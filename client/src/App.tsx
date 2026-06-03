// Imports do React e dos tipos/constantes compartilhadas
import { useEffect, useMemo, useRef, useState } from "react";
import { WS_EVENTS, getWsUrl, type WsMessage } from "@shared/const";

// Tipo que representa uma fala do roteiro
type ScriptLine = {
  id: string;
  text: string;
  effectName: string;
  audioName?: string;
  audioBlob?: Blob;
  createdAt: number;
  updatedAt: number;
};

// Tipo do estado persistido no IndexedDB
type PersistedState = {
  version: 1;
  threshold: number;
  lines: ScriptLine[];
};

// Interface que descreve a API de reconhecimento de fala do navegador
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

// Declaração global para a API de reconhecimento de voz (Chrome/Edge)
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// Configuração do banco IndexedDB para salvar o roteiro no navegador
const DB_NAME = "teatro-teleprompter-db";
const DB_VERSION = 1;
const STORE_NAME = "app";
const STATE_KEY = "state";

// Frase padrão que dispara a risada sintética automática
const DEFAULT_TRIGGER = "E ande logo antes que mudem de ideia!";

// Gera um ID único para cada fala (UUID ou fallback)
const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `fala-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const now = () => Date.now();

// Cria a lista inicial padrão com a fala da risada
const defaultLines = (): ScriptLine[] => [
  {
    id: makeId(),
    text: DEFAULT_TRIGGER,
    effectName: "Risada",
    audioName: "Risada sintética automática",
    createdAt: now(),
    updatedAt: now(),
  },
];

// Abre conexão com o banco IndexedDB (cria o store se não existir)
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Carrega o estado salvo (linhas + threshold) do IndexedDB
async function loadState(): Promise<PersistedState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);

    request.onsuccess = () => resolve((request.result as PersistedState | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

// Salva o estado atual (linhas + threshold) no IndexedDB
async function saveState(state: PersistedState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(state, STATE_KEY);

    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// Normaliza texto: remove acentos, converte pra minúsculas, remove pontuação
const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Gera bigramas (pares de caracteres consecutivos) para comparação de similaridade
const bigrams = (value: string) => {
  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact.length < 2) return compact ? [compact] : [];
  const result: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.push(compact.slice(index, index + 2));
  }
  return result;
};

// Coeficiente de Dice: mede similaridade entre dois textos por bigramas
function diceSimilarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return 0;

  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);

  let intersection = 0;
  for (const item of b) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(item, count - 1);
    }
  }

  return (2 * intersection) / (a.length + b.length);
}

// Mede sobreposição de palavras entre dois textos
function wordOverlap(left: string, right: string) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  Array.from(a).forEach((word) => {
    if (b.has(word)) intersection += 1;
  });

  return intersection / Math.max(a.size, b.size);
}

// Calcula percentual de similaridade combinando inclusão, Dice e sobreposição de palavras
function similarityPercent(spoken: string, target: string) {
  const spokenNormalized = normalizeText(spoken);
  const targetNormalized = normalizeText(target);
  if (!spokenNormalized || !targetNormalized) return 0;
  if (spokenNormalized === targetNormalized) return 100;

  const containsScore = spokenNormalized.includes(targetNormalized) || targetNormalized.includes(spokenNormalized) ? 92 : 0;
  const diceScore = diceSimilarity(spokenNormalized, targetNormalized) * 100;
  const wordScore = wordOverlap(spokenNormalized, targetNormalized) * 100;

  return Math.round(Math.max(containsScore, diceScore, wordScore));
}

// Toca uma risada sintética usando Web Audio API (osciladores sawtooth)
// Retorna o AudioContext para poder pará-lo externamente via stopAllAudio()
function playSyntheticLaugh() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  const audioContext = new AudioContextClass();
  const master = audioContext.createGain();
  master.gain.value = 0.14;
  master.connect(audioContext.destination);

  // 5 sílabas de risada com frequências crescentes
  const syllables = [0, 0.18, 0.36, 0.56, 0.76];
  syllables.forEach((offset, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(360 + index * 35, audioContext.currentTime + offset);
    oscillator.frequency.exponentialRampToValueAtTime(190 + index * 20, audioContext.currentTime + offset + 0.13);
    gain.gain.setValueAtTime(0.001, audioContext.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.55, audioContext.currentTime + offset + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + offset + 0.16);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.18);
  });

  // Fecha o AudioContext após a risada terminar
  window.setTimeout(() => {
    audioContext.close();
  }, 1400);

  return audioContext;
}

// Toca um beep simples (triângulo 740Hz) como fallback quando não há áudio personalizado
function playFallbackBeep() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 740;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.35);
  window.setTimeout(() => {
    audioContext.close();
  }, 600);

  return audioContext;
}

function App() {
  // === Estados do roteiro e reconhecimento de voz ===
  const [lines, setLines] = useState<ScriptLine[]>(defaultLines);
  const [selectedLineId, setSelectedLineId] = useState<string>("");
  const [threshold, setThreshold] = useState(60); // % mínima de similaridade para disparar
  const [transcript, setTranscript] = useState(""); // última frase reconhecida pelo microfone
  const [status, setStatus] = useState("Carregando roteiro salvo...");
  const [isLoaded, setIsLoaded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastMatch, setLastMatch] = useState<{ line: ScriptLine; score: number } | null>(null);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);

  // === Estados de admin e WebSocket ===
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isPttHolding, setIsPttHolding] = useState(false); // se o PTT está ativo
  const [isTokenBusy, setIsTokenBusy] = useState(false); // se outro cliente tem o token
  const [wsStatus, setWsStatus] = useState("desconectado"); // status da conexão WebSocket

  // === Refs para controle de áudio e conexão ===
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null); // instância do SpeechRecognition
  const manualStopRef = useRef(false); // se o usuário parou manualmente o microfone
  const cooldownRef = useRef<Record<string, number>>({}); // controle de cooldown entre disparos
  const lastTranscriptRef = useRef(""); // última transcrição processada para evitar repetição
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // áudio em reprodução (arquivo)
  const audioContextRef = useRef<AudioContext | null>(null); // contexto de áudio (sons sintéticos)
  const pttStreamRef = useRef<MediaStream | null>(null); // stream do microfone para PTT
  const wsRef = useRef<WebSocket | null>(null); // conexão WebSocket
  const wsReconnectTimerRef = useRef<number | null>(null); // timer para reconexão
  const wsReconnectDelayRef = useRef(1000); // delay inicial de reconexão (backoff exponencial)

  // Para todo áudio em reprodução: arquivo, sintético, mídia no DOM e PTT
  const stopAllAudio = () => {
    // Para áudio baseado em arquivo (HTMLAudioElement)
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    // Para som sintético (Web Audio API)
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // Para todos os elementos <audio> e <video> do DOM
    const allMedia = document.querySelectorAll("audio, video");
    allMedia.forEach((el) => {
      const media = el as HTMLMediaElement;
      media.pause();
      media.srcObject = null;
      media.src = "";
      media.load();
    });
    // Para o PTT (microfone)
    if (pttStreamRef.current) {
      pttStreamRef.current.getTracks().forEach((t) => t.stop());
      pttStreamRef.current = null;
    }
    setIsPttHolding(false);
    setIsTokenBusy(false);
  };

  // Linha selecionada atualmente (para edição)
  const selectedLine = useMemo(
    () => lines.find((line) => line.id === selectedLineId) ?? lines[0],
    [lines, selectedLineId],
  );

  // Ao montar: carrega o roteiro salvo do IndexedDB
  useEffect(() => {
    let cancelled = false;

    loadState()
      .then((stored) => {
        if (cancelled) return;
        if (stored?.lines?.length) {
          setLines(stored.lines);
          setThreshold(stored.threshold ?? 60);
          setSelectedLineId(stored.lines[0].id);
          setStatus("Roteiro salvo carregado do navegador.");
        } else {
          const initial = defaultLines();
          setLines(initial);
          setSelectedLineId(initial[0].id);
          setStatus("Roteiro inicial criado. A frase da risada já está pronta.");
        }
      })
      .catch(() => {
        const initial = defaultLines();
        setLines(initial);
        setSelectedLineId(initial[0].id);
        setError("Não foi possível abrir o armazenamento local. O site ainda funciona, mas talvez não salve neste navegador.");
      })
      .finally(() => {
        if (!cancelled) {
          try {
            const saved = JSON.parse(localStorage.getItem("teatro-soundEnabled") ?? "true");
            if (typeof saved === "boolean") setSoundEnabled(saved);
          } catch {}
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save: salva no IndexedDB após 350ms de inatividade (debounce)
  useEffect(() => {
    if (!isLoaded) return;

    const timer = window.setTimeout(() => {
      saveState({ version: 1, threshold, lines })
        .then(() => setStatus("Tudo salvo automaticamente neste navegador."))
        .catch(() => setError("Falha ao salvar. Tente usar arquivos menores ou liberar espaço do navegador."));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isLoaded, lines, threshold]);

  // Salva preferência de som no localStorage
  useEffect(() => {
    if (!isLoaded) return;
    try { localStorage.setItem("teatro-soundEnabled", JSON.stringify(soundEnabled)); } catch {}
  }, [isLoaded, soundEnabled]);

  // Conexão WebSocket com reconexão automática (backoff exponencial)
  useEffect(() => {
    let reconnectAttempts = 0;

    function connectWs() {
      wsRef.current?.close();
      const url = getWsUrl();
      setWsStatus("conectando...");
      const ws = new WebSocket(`${url}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus("conectado");
        reconnectAttempts = 0;
        wsReconnectDelayRef.current = 1000;
      };

      // Processa mensagens recebidas do servidor via WebSocket
      ws.onmessage = (event) => {
        let data: WsMessage;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (data.type) {
          case WS_EVENTS.TOKEN_ACQUIRED: // Token de áudio concedido a este cliente
            setIsTokenBusy(true);
            setIsPttHolding(true);
            break;
          case WS_EVENTS.TOKEN_BUSY: // Token ocupado por outro cliente
            setIsTokenBusy(true);
            setError(`Token ocupado por outro cliente.`);
            break;
          case WS_EVENTS.TOKEN_RELEASED: // Token liberado
            setIsTokenBusy(false);
            setIsPttHolding(false);
            break;
          case WS_EVENTS.TOKEN_HOLDER: // Status atual do token ao conectar
            setIsTokenBusy(data.holderId != null);
            break;
          case WS_EVENTS.KILL_AUDIO_BROADCAST: // Kill Switch acionado por alguém
            stopAllAudio();
            setStatus("Kill Switch acionado: toda a mídia foi parada.");
            break;
          case WS_EVENTS.UNAUTHORIZED: // Acesso negado (admin)
            setError(`Acesso negado: ${data.message}`);
            break;
        }
      };

      // Reconexão automática com backoff exponencial (1s, 2s, 4s, ... até 30s)
      ws.onclose = () => {
        setWsStatus("desconectado");
        setIsPttHolding(false);
        setIsTokenBusy(false);
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        wsReconnectDelayRef.current = delay;
        wsReconnectTimerRef.current = window.setTimeout(connectWs, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    return () => {
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Cleanup ao desmontar: para áudio, microfone e libera URLs de blob
  useEffect(() => {
    return () => {
      currentAudioRef.current?.pause();
      recognitionRef.current?.abort();
      pttStreamRef.current?.getTracks().forEach((t) => t.stop());
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, []);

  // === Funções do WebSocket / Token de Áudio (Mutex) ===

  // Solicita o token de áudio ao servidor (apenas admin pode usar)
  const acquireToken = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Sem conexão com o servidor.");
      return false;
    }
    wsRef.current.send(JSON.stringify({ type: WS_EVENTS.TOKEN_REQUEST, role: "admin" }));
    return true;
  };

  // Libera o token de áudio
  const releaseToken = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: WS_EVENTS.TOKEN_RELEASE }));
    }
    setIsPttHolding(false);
  };

  // Inicia Push-to-Talk: adquire token e captura microfone
  const startPtt = async () => {
    if (!isAdmin) return;
    setError("");

    const ok = await acquireToken();
    if (!ok) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
      });
      pttStreamRef.current = stream;
      setIsPttHolding(true);
    } catch {
      setError("Não foi possível acessar o microfone para PTT.");
      releaseToken();
    }
  };

  // Para o PTT: libera token e para o microfone
  const stopPtt = () => {
    if (pttStreamRef.current) {
      pttStreamRef.current.getTracks().forEach((t) => t.stop());
      pttStreamRef.current = null;
    }
    releaseToken();
  };

  // Kill Switch público: envia comando para parar todo áudio em todos os clientes
  const triggerKillSwitch = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: WS_EVENTS.KILL_AUDIO }));
  };

  // Login de administrador (para acessar o PTT)
  const handleAdminLogin = async () => {
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      if (res.ok) {
        setIsAdmin(true);
        setShowAdminLogin(false);
        setAdminPassword("");
        setStatus("Autenticado como administrador.");
      } else {
        setError("Senha de administrador incorreta.");
      }
    } catch {
      setError("Erro ao conectar com o servidor para autenticação.");
    }
  };

  // === CRUD de falas ===

  // Atualiza parcialmente a fala selecionada
  const updateSelectedLine = (patch: Partial<ScriptLine>) => {
    if (!selectedLine) return;
    setLines((current) =>
      current.map((line) => (line.id === selectedLine.id ? { ...line, ...patch, updatedAt: now() } : line)),
    );
  };

  // Adiciona nova fala no início da lista
  const addLine = () => {
    const line: ScriptLine = {
      id: makeId(),
      text: "",
      effectName: "Novo efeito",
      createdAt: now(),
      updatedAt: now(),
    };
    setLines((current) => [line, ...current]);
    setSelectedLineId(line.id);
  };

  // Apaga a fala selecionada (mantém no mínimo 1)
  const deleteSelectedLine = () => {
    if (!selectedLine || lines.length === 1) return;
    const next = lines.filter((line) => line.id !== selectedLine.id);
    setLines(next);
    setSelectedLineId(next[0]?.id ?? "");
    delete cooldownRef.current[selectedLine.id];
  };

  // Reinicia o roteiro com apenas a fala padrão da risada
  const clearAll = () => {
    const initial = defaultLines();
    setLines(initial);
    setSelectedLineId(initial[0].id);
    setTranscript("");
    setLastMatch(null);
    setStatus("Roteiro reiniciado com a fala padrão da risada.");
  };

  // === Reprodução de áudio ===

  const blobUrlsRef = useRef<string[]>([]); // URLs de blob criadas para evitar vazamento

  const revokeBlobUrl = (url: string) => {
    URL.revokeObjectURL(url);
    blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== url);
  };

  // Toca o efeito sonoro de uma fala, parando qualquer áudio anterior primeiro
  const playEffect = (line: ScriptLine) => {
    if (!soundEnabled) return;
    stopAllAudio(); // Garante que só UM áudio toque por vez

    if (line.audioBlob) {
      const url = URL.createObjectURL(line.audioBlob);
      blobUrlsRef.current.push(url);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        revokeBlobUrl(url);
        currentAudioRef.current = null;
      };
      audio.onerror = () => {
        revokeBlobUrl(url);
        currentAudioRef.current = null;
        setError("Não consegui tocar esse arquivo de áudio. Tente outro arquivo de efeito sonoro.");
      };
      audio.play().catch(() => setError("O navegador bloqueou o áudio. Clique em testar efeito ou ligue o microfone novamente."));
      return;
    }

    // Sem arquivo: toca risada sintética ou beep de fallback
    const normalizedEffect = normalizeText(line.effectName);
    const normalizedText = normalizeText(line.text);
    if (normalizedEffect.includes("risada") || normalizedText === normalizeText(DEFAULT_TRIGGER)) {
      const ctx = playSyntheticLaugh();
      if (ctx) audioContextRef.current = ctx;
    } else {
      const ctx = playFallbackBeep();
      if (ctx) audioContextRef.current = ctx;
    }
  };

  // Compara o que foi falado com as falas cadastradas e dispara o efeito se bater
  const checkTranscript = (spoken: string) => {
    if (!soundEnabled) return;
    if (!spoken || spoken === lastTranscriptRef.current) return;
    lastTranscriptRef.current = spoken;

    const candidates = lines
      .filter((line) => line.text.trim())
      .map((line) => ({
        line,
        score: similarityPercent(spoken, line.text),
        wordScore: wordOverlap(spoken, line.text),
      }))
      .sort((a, b) => b.score - a.score || b.wordScore - a.wordScore);

    const best = candidates[0];
    if (!best || best.score < threshold) return; // abaixo do limite

    // Cooldown de 3.5s para evitar disparos repetidos
    const lastPlayed = cooldownRef.current[best.line.id] ?? 0;
    if (Date.now() - lastPlayed < 3500) return;

    cooldownRef.current[best.line.id] = Date.now();
    setLastMatch(best);
    setSelectedLineId(best.line.id);
    setStatus(`Detectei “${best.line.text}” com ${best.score}% de parecido. Tocando: ${best.line.effectName}.`);
    playEffect(best.line);
  };

  // === Reconhecimento de voz ===

  // Inicia a escuta contínua do microfone (Web Speech API)
  const startListening = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Este navegador não suporta reconhecimento de voz. Use Chrome, Edge ou outro navegador compatível.");
      return;
    }

    setError("");
    manualStopRef.current = false;
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Processa o resultado do reconhecimento de fala
    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) finalText += ` ${value}`;
        else interimText += ` ${value}`;
      }

      const visibleText = `${finalText} ${interimText}`.trim();
      if (visibleText) setTranscript(visibleText);
      if (finalText.trim()) {
        lastTranscriptRef.current = "";
        checkTranscript(finalText.trim());
      }
    };

    recognition.onerror = (event: any) => {
      setError(`Erro no microfone/reconhecimento: ${event.error ?? "desconhecido"}.`);
      setIsListening(false);
    };

    // Reconecta automaticamente se o reconhecimento cair (a menos que parado manualmente)
    recognition.onend = () => {
      setIsListening(false);
      if (!manualStopRef.current) {
        try {
          recognition.start();
          setIsListening(true);
        } catch {
          // Alguns navegadores impedem reinício imediato; o usuário pode clicar de novo.
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
      setStatus("Microfone ligado. Fale uma frase cadastrada para disparar o efeito sonoro.");
    } catch {
      setError("Não consegui ligar o microfone. Confira a permissão do navegador e tente novamente.");
    }
  };

  // Para o reconhecimento de voz manualmente
  const stopListening = () => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    setIsListening(false);
    setStatus("Microfone desligado.");
  };

  // === Upload e exportação ===

  // Anexa um arquivo de áudio/vídeo à fala selecionada
  const handleFileUpload = (file?: File) => {
    if (!file || !selectedLine) return;
    updateSelectedLine({
      audioBlob: file,
      audioName: file.name,
      effectName: selectedLine.effectName || file.name.replace(/\.[^/.]+$/, ""),
    });
    setStatus(`Arquivo "${file.name}" anexado à fala selecionada.`);
  };

  // Exporta o roteiro como JSON (sem os blobs de áudio)
  const exportBackup = () => {
    const payload = JSON.stringify(
      {
        version: 1,
        threshold,
        lines: lines.map(({ audioBlob, ...line }) => ({ ...line, hasAudio: Boolean(audioBlob) })),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roteiro-teatro-teleprompter.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Similaridade da transcrição atual com a fala selecionada (para a barra de progresso)
  const bestPreview = transcript && selectedLine ? similarityPercent(transcript, selectedLine.text) : 0;

  // === Renderização da Interface ===

  return (
    <main className="min-h-screen bg-[#070707] text-zinc-100">
      <section className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 border-zinc-800 lg:grid-cols-[420px_1fr] lg:border-x">
        {/* Painel lateral esquerdo: lista de falas e controles */}
        <aside className="border-b border-zinc-800 bg-zinc-950/95 lg:border-b-0 lg:border-r">
          <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Falas do script</p>
              <h1 className="mt-1 text-xl font-semibold text-white">Teatro Teleprompter</h1>
            </div>
            {/* Botão para adicionar nova fala */}
            <button onClick={addLine} className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-100 transition hover:border-emerald-400 hover:text-emerald-300">
              + Nova fala
            </button>
          </header>

          <div className="space-y-3 p-4">
            {/* Painel de reconhecimento de voz: ligar/desligar microfone e ajuste de sensibilidade */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Reconhecimento por voz</p>
                  <p className="text-xs text-zinc-400">Dispara o áudio quando bater pelo menos {threshold}%.</p>
                </div>
                <button onClick={isListening ? stopListening : startListening} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${isListening ? "bg-red-500 text-white hover:bg-red-400" : "bg-emerald-500 text-black hover:bg-emerald-400"}`}>
                  {isListening ? "Parar" : "Ligar mic"}
                </button>
              </div>
              {/* Slider para ajustar o percentual mínimo de similaridade */}
              <label className="mt-4 block text-xs uppercase tracking-[0.2em] text-zinc-500">Similaridade: {threshold}%</label>
              <input className="mt-2 w-full accent-emerald-400" type="range" min="40" max="95" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
            </div>

            {/* Painel público de parar áudio: STOP (local) e KILL (todos os clientes) */}
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-[0.2em] text-red-400">Parar áudio</p>
                <button onClick={() => { setSoundEnabled((v) => !v); if (soundEnabled) stopAllAudio(); }} className={`rounded-full px-3 py-1 text-xs font-bold transition ${soundEnabled ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600" : "bg-red-500 text-white hover:bg-red-400"}`}>
                  {soundEnabled ? "Som ligado" : "Som mudo"}
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={stopAllAudio} className="flex-1 rounded-full border border-zinc-600 px-4 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800 active:scale-95">
                  STOP {/* Para áudio apenas neste navegador */}
                </button>
                <button onClick={triggerKillSwitch} className="flex-1 rounded-full border border-red-500/40 px-4 py-3 text-sm font-bold text-red-300 transition hover:bg-red-500/20 active:scale-95">
                  KILL {/* Para áudio em TODOS os clientes conectados via WebSocket */}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-zinc-500">WS: {wsStatus} {isTokenBusy ? "| token ocupado" : ""}</p>
            </div>

            {/* Botão de login admin (oculto quando já logado) */}
            {!isAdmin && (
              <button onClick={() => setShowAdminLogin(true)} className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/50 p-3 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
                Admin: entrar
              </button>
            )}

            {/* Painel admin: Push-to-Talk (visível apenas para admin) */}
            {isAdmin && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-400 mb-3">Admin: Push-to-Talk</p>
                <button
                  onMouseDown={startPtt}
                  onMouseUp={stopPtt}
                  onMouseLeave={stopPtt}
                  onTouchStart={startPtt}
                  onTouchEnd={stopPtt}
                  className={`w-full rounded-full px-4 py-3 text-sm font-bold transition active:scale-95 ${isPttHolding ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : "bg-emerald-400 text-black hover:bg-emerald-300"}`}
                >
                  {isPttHolding ? "FALANDO..." : "PTT"}
                </button>
              </div>
            )}

            {/* Modal de login administrador */}
            {showAdminLogin && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowAdminLogin(false)}>
                <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <p className="text-sm font-semibold text-white mb-4">Login Administrador</p>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Senha"
                    className="w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-amber-400 mb-3"
                    onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setShowAdminLogin(false)} className="flex-1 rounded-full border border-zinc-700 px-4 py-2 text-xs text-zinc-400 hover:border-zinc-500">Cancelar</button>
                    <button onClick={handleAdminLogin} className="flex-1 rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300">Entrar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Lista de falas cadastradas */}
            <div className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1">
              {lines.map((line, index) => {
                const active = line.id === selectedLine?.id;
                return (
                  <button key={line.id} onClick={() => setSelectedLineId(line.id)} className={`w-full rounded-2xl border p-4 text-left transition ${active ? "border-emerald-400 bg-emerald-400/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Fala {index + 1}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] ${line.audioBlob ? "bg-emerald-400/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                        {line.audioBlob ? "áudio" : "sem arquivo"}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-100">{line.text || "Fala vazia: clique para editar"}</p>
                    <p className="mt-3 text-xs text-zinc-500">Efeito: {line.effectName || "sem nome"}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Painel direito: edição da fala selecionada */}
        <section className="bg-[#0b0b0b]">
          <header className="border-b border-zinc-800 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Editar fala</p>
            <p className="mt-1 text-sm text-zinc-400">As alterações e os arquivos de áudio ficam salvos automaticamente no navegador.</p>
          </header>

          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              {/* Editor de texto da fala */}
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
                <label className="text-xs uppercase tracking-[0.24em] text-zinc-500">Texto da fala que será reconhecida</label>
                <textarea
                  value={selectedLine?.text ?? ""}
                  onChange={(event) => updateSelectedLine({ text: event.target.value })}
                  placeholder="Ex.: E ande logo antes que mudem de ideia!"
                  className="mt-3 min-h-44 w-full resize-y rounded-2xl border border-zinc-800 bg-black p-4 text-2xl font-semibold leading-relaxed text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400"
                />
              </div>

              {/* Nome do efeito e upload de arquivo */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                  <label className="text-xs uppercase tracking-[0.24em] text-zinc-500">Nome do efeito</label>
                  <input
                    value={selectedLine?.effectName ?? ""}
                    onChange={(event) => updateSelectedLine({ effectName: event.target.value })}
                    placeholder="Risada, aplauso, suspense..."
                    className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                  />
                </div>

                {/* Upload de arquivo de áudio/vídeo para usar como efeito */}
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                  <label className="text-xs uppercase tracking-[0.24em] text-zinc-500">Arquivo de som do efeito</label>
                  <input type="file" accept="audio/*,video/*" onChange={(event) => handleFileUpload(event.target.files?.[0])} className="mt-3 w-full rounded-2xl border border-dashed border-zinc-700 bg-black px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded-full file:border-0 file:bg-emerald-400 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black" />
                  <p className="mt-2 text-xs text-zinc-500">{selectedLine?.audioName ?? "Sem arquivo: o site usa risada sintética ou beep como reserva."}</p>
                </div>
              </div>

              {/* Botões de ação: testar, exportar, apagar, reiniciar */}
              <div className="flex flex-wrap gap-3">
                <button onClick={() => selectedLine && playEffect(selectedLine)} className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">Testar efeito</button>
                <button onClick={exportBackup} className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500">Exportar roteiro</button>
                <button onClick={deleteSelectedLine} disabled={lines.length === 1} className="rounded-full border border-red-500/40 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">Apagar fala</button>
                <button onClick={clearAll} className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-400 transition hover:border-red-400 hover:text-red-300">Reiniciar tudo</button>
              </div>
            </div>

            {/* Painéis laterais de status, transcrição e último gatilho */}
            <div className="space-y-4">
              {/* Status e mensagens de erro */}
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Status</p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">{status}</p>
                {error && <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
              </div>

              {/* Transcrição do que foi ouvido e barra de similaridade */}
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Último ouvido</p>
                <p className="mt-3 min-h-20 rounded-2xl border border-zinc-800 bg-black p-4 text-sm leading-relaxed text-zinc-300">{transcript || "Ligue o microfone e fale uma frase do roteiro."}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, bestPreview)}%` }} />
                </div>
                <p className="mt-2 text-xs text-zinc-500">Parecido com a fala selecionada: {bestPreview}%</p>
              </div>

              {/* Último gatilho disparado com sucesso */}
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Último gatilho</p>
                {lastMatch ? (
                  <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                    <p className="text-sm font-semibold text-emerald-200">{lastMatch.score}% de similaridade</p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-200">{lastMatch.line.text}</p>
                    <p className="mt-2 text-xs text-zinc-500">Efeito tocado: {lastMatch.line.effectName}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">Nenhuma fala reconhecida ainda.</p>
                )}
              </div>

              {/* Aviso sobre armazenamento no navegador */}
              <blockquote className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm leading-relaxed text-amber-100">
                GitHub Pages não tem servidor próprio. Por isso, o &ldquo;storage&rdquo; foi feito no navegador com IndexedDB: se fechar e abrir de novo no mesmo navegador, o roteiro e os áudios continuam salvos.
              </blockquote>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
