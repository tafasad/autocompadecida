import { useEffect, useMemo, useRef, useState } from "react";
import { WS_EVENTS, getWsUrl, type WsMessage } from "@shared/const";
import { useAuth } from "./contexts/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { saveAppState, loadAppState, savePreset, getPresets, deletePreset, type Preset } from "./lib/db";
import { uploadAudio, deleteAudio as deleteServerAudio, listAudio, isServerAvailable, getAudioUrl } from "./lib/api";
import type { ScriptLine } from "@/lib/types";
import { defaultLines, makeId, now, DEFAULT_TRIGGER } from "@/lib/types";
import { similarityPercent, wordOverlap, normalizeText } from "@/lib/similarity";
import { playSyntheticLaugh, playFallbackBeep, unlockAudio } from "@/lib/audio";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import LineList from "@/components/LineList";
import LineEditor from "@/components/LineEditor";
import StatusPanel from "@/components/StatusPanel";
import ToggleSidebar from "@/components/ToggleSidebar";

function App() {
  const { user, isAdmin, logout, loading } = useAuth();

  // Enquanto carrega a autenticação, mostra tela de loading
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070707]">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <p className="mt-4 text-sm text-zinc-400">Carregando...</p>
        </div>
      </main>
    );
  }

  // Se não está logado, mostra a tela de login
  if (!user) return <LoginPage />;

  // === Estados do roteiro e reconhecimento de voz ===
  const [lines, setLines] = useState<ScriptLine[]>(defaultLines);
  const [selectedLineId, setSelectedLineId] = useState<string>("");
  const [threshold, setThreshold] = useState(60); // % mínima de similaridade para disparar
  const [transcript, setTranscript] = useState(""); // última frase reconhecida pelo microfone
  const [status, setStatus] = useState("Carregando roteiro salvo...");
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastMatch, setLastMatch] = useState<{ line: ScriptLine; score: number } | null>(null);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [muted, setMuted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // === Estados de admin e WebSocket ===
  const [isAdminLogin, setIsAdminLogin] = useState(isAdmin);
  const [isPttHolding, setIsPttHolding] = useState(false); // se o PTT está ativo
  const [isTokenBusy, setIsTokenBusy] = useState(false); // se outro cliente tem o token
  const [wsStatus, setWsStatus] = useState("desconectado"); // status da conexão WebSocket

  // === Refs para controle de áudio e conexão ===
  const cooldownRef = useRef<Record<string, number>>({}); // controle de cooldown entre disparos
  const lastTranscriptRef = useRef(""); // última transcrição processada para evitar repetição
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // áudio em reprodução (arquivo)
  const audioContextRef = useRef<AudioContext | null>(null); // contexto de áudio (sons sintéticos)
  const pttStreamRef = useRef<MediaStream | null>(null); // stream do microfone para PTT
  const wsRef = useRef<WebSocket | null>(null); // conexão WebSocket
  const wsReconnectTimerRef = useRef<number | null>(null); // timer para reconexão
  const wsReconnectDelayRef = useRef(1000); // delay inicial de reconexão (backoff exponencial)

  // === Hook de reconhecimento de voz (trata retry, network, etc.) ===
  const micTranscriptRef = useRef("");
  const {
    isListening,
    isSupported: isMicSupported,
    error: micError,
    setError: setMicError,
    start: startMic,
    stop: stopMic,
  } = useSpeechRecognition({
    language: "pt-BR",
    continuous: true,
    interimResults: true,
    onResult: (text: string, isFinal: boolean) => {
      const visibleText = text.trim();
      if (visibleText) {
        micTranscriptRef.current = visibleText;
        setTranscript(visibleText);
      }
      if (isFinal) {
        lastTranscriptRef.current = "";
        checkTranscript(visibleText);
      }
    },
    onError: (err: string) => {
      setError(`Microfone: ${err}`);
    },
    onStatusChange: (micStatus: "idle" | "listening" | "error") => {
      if (micStatus === "listening") {
        setStatus("Microfone ligado. Fale uma frase cadastrada para disparar o efeito sonoro.");
      } else if (micStatus === "error") {
        // Error already handled by onError
      }
    },
  });

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

    loadAppState(user.username)
      .then((stored: any) => {
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
            const mutedSaved = localStorage.getItem("teatro-muted");
            if (mutedSaved === "true") setMuted(true);
          } catch {}
          getPresets(user.username).then(setPresets).catch(() => {});
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user.username]);

  // Unlock audio on first user interaction (required by mobile browsers)
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("click", unlock);
    };
    document.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.addEventListener("click", unlock, { once: true });
  }, []);

  // Auto-save: salva no IndexedDB após 350ms de inatividade (debounce)
  useEffect(() => {
    if (!isLoaded) return;

    const timer = window.setTimeout(() => {
      saveAppState(user.username, { version: 1, threshold, lines })
        .then(() => setStatus("Tudo salvo automaticamente neste navegador."))
        .catch(() => setError("Falha ao salvar. Tente usar arquivos menores ou liberar espaço do navegador."));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isLoaded, lines, threshold, user.username]);

  // Salva preferência de som no localStorage
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem("teatro-soundEnabled", JSON.stringify(soundEnabled));
      if (muted) localStorage.setItem("teatro-muted", "true");
      else localStorage.removeItem("teatro-muted");
    } catch {}
  }, [isLoaded, soundEnabled, muted]);

  // Conexão WebSocket com reconexão automática (backoff exponencial)
  // Desabilitado quando não há servidor backend (ex: GitHub Pages estático)
  useEffect(() => {
    let reconnectAttempts = 0;
    const MAX_WS_RECONNECT = 3; // Stop after 3 attempts to avoid spamming errors

    // Detect if we're on a static host (GitHub Pages, etc.) — no WS backend available
    const isStaticHost = location.hostname.includes("github.io") ||
      location.hostname.includes("pages.dev") ||
      location.hostname.includes("netlify.app") ||
      location.hostname.includes("vercel.app");

    if (isStaticHost) {
      setWsStatus("offline");
      return;
    }

    function connectWs() {
      if (reconnectAttempts >= MAX_WS_RECONNECT) {
        setWsStatus("offline");
        return;
      }
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
        if (reconnectAttempts >= MAX_WS_RECONNECT) {
          setWsStatus("offline");
          return;
        }
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        wsReconnectDelayRef.current = delay;
        wsReconnectTimerRef.current = window.setTimeout(connectWs, delay);
      };

      ws.onerror = () => {
        // Don't call ws.close() here — onclose will fire and handle reconnect
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

  // Cleanup ao desmontar: para áudio e libera URLs de blob
  useEffect(() => {
    return () => {
      currentAudioRef.current?.pause();
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

  // Salva preset atual como predefinição
  const saveCurrentAsPreset = async () => {
    if (!presetName.trim() || !selectedLine) return;
    const preset: Preset = {
      id: makeId(),
      username: user.username,
      name: presetName.trim(),
      type: "audio",
      effectName: selectedLine.effectName,
      audioBlob: selectedLine.audioBlob,
      audioName: selectedLine.audioName,
      createdAt: now(),
      updatedAt: now(),
    };
    await savePreset(preset);
    setPresets((p) => [preset, ...p]);
    setPresetName("");
    setStatus(`Preset "${preset.name}" salvo.`);
  };

  // Carrega um preset na fala selecionada
  const loadPreset = (preset: Preset) => {
    if (!selectedLine) return;
    updateSelectedLine({
      effectName: preset.effectName,
      audioBlob: preset.audioBlob,
      audioName: preset.audioName,
    });
    setStatus(`Preset "${preset.name}" carregado.`);
  };

  // Apaga um preset
  const removePreset = async (id: string) => {
    await deletePreset(id);
    setPresets((p) => p.filter((pr) => pr.id !== id));
  };

  // Mute global do admin: silencia todos os áudios
  const toggleMute = () => {
    if (muted) {
      setMuted(false);
      setStatus("Áudio reativado.");
    } else {
      setMuted(true);
      stopAllAudio();
      triggerKillSwitch();
      setStatus("MUTE ATIVADO: todo áudio foi silenciado em todos os sites.");
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
    if (selectedLine.audioId && isServerAvailable()) {
      deleteServerAudio(selectedLine.audioId).catch(() => {});
    }
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
  const playEffect = async (line: ScriptLine) => {
    if (!soundEnabled || muted) return;
    stopAllAudio(); // Garante que só UM áudio toque por vez

    // Unlock audio on mobile — must happen inside user gesture
    unlockAudio();

    let audioSource: string | null = null;

    if (line.audioUrl && isServerAvailable()) {
      audioSource = line.audioUrl;
    } else if (line.audioId && isServerAvailable()) {
      audioSource = getAudioUrl(line.audioId);
    } else if (line.audioBlob) {
      const url = URL.createObjectURL(line.audioBlob);
      blobUrlsRef.current.push(url);
      audioSource = url;
    }

    if (audioSource) {
      const audio = new Audio(audioSource);
      currentAudioRef.current = audio;
      audio.onended = () => {
        if (line.audioBlob && audioSource.startsWith("blob:")) {
          revokeBlobUrl(audioSource);
        }
        currentAudioRef.current = null;
      };
      audio.onerror = () => {
        if (line.audioBlob && audioSource?.startsWith("blob:")) {
          revokeBlobUrl(audioSource);
        }
        currentAudioRef.current = null;
        setError("Não consegui tocar esse arquivo de áudio. Tente outro arquivo de efeito sonoro.");
      };
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch((err: any) => {
          if (err?.name === "NotAllowedError") {
            setError("O navegador bloqueou o áudio. Toque na tela ou clique em 'Testar efeito' novamente.");
          } else {
            setError("O navegador bloqueou o áudio. Clique em testar efeito ou ligue o microfone novamente.");
          }
        });
      }
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
    if (!soundEnabled || muted) return;
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

  // === Upload e exportação ===

  // Anexa um arquivo de áudio/vídeo à fala selecionada
  const handleFileUpload = async (file?: File) => {
    if (!file || !selectedLine) return;

    const patch: Partial<ScriptLine> = {
      audioBlob: file,
      audioName: file.name,
      effectName: selectedLine.effectName || file.name.replace(/\.[^/.]+$/, ""),
    };

    if (isServerAvailable()) {
      try {
        const uploaded = await uploadAudio(file, file.name);
        patch.audioId = uploaded.id;
        patch.audioUrl = uploaded.url;
        setStatus(`Arquivo "${file.name}" enviado para o servidor.`);
      } catch (err: any) {
        setStatus(`Arquivo "${file.name}" salvo localmente (servidor indisponível: ${err.message}).`);
      }
    } else {
      setStatus(`Arquivo "${file.name}" anexado à fala selecionada (apenas local).`);
    }

    updateSelectedLine(patch);
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
      <section className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 border-zinc-800 lg:grid-cols-[420px_1fr] lg:border-x relative">

        {/* Sidebar */}
        <LineList
          lines={lines}
          selectedLineId={selectedLineId}
          onSelect={setSelectedLineId}
          onAdd={addLine}
          onDelete={deleteSelectedLine}
          canDelete={lines.length > 1}
        />

        {/* Painel direito */}
        <section className="bg-[#0b0b0b] relative">
          <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Editar fala</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {user.username} {isAdmin && <span className="text-amber-400">(admin)</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={logout} className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-red-400 hover:text-red-300">
                Sair
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-[#ff00aa] hover:text-[#ff00aa]"
              >
                Extras
              </button>
            </div>
          </header>

          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <LineEditor
                line={selectedLine}
                onUpdate={updateSelectedLine}
                onPlayEffect={() => selectedLine && playEffect(selectedLine)}
                onFileUpload={handleFileUpload}
              />

              {/* Botões de ação: testar, exportar, apagar, reiniciar */}
              <div className="flex flex-wrap gap-3">
                <button onClick={() => selectedLine && playEffect(selectedLine)} className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">Testar efeito</button>
                <button onClick={exportBackup} className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500">Exportar roteiro</button>
                <button onClick={deleteSelectedLine} disabled={lines.length === 1} className="rounded-full border border-red-500/40 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">Apagar fala</button>
                <button onClick={clearAll} className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-400 transition hover:border-red-400 hover:text-red-300">Reiniciar tudo</button>
              </div>
            </div>

            <StatusPanel
              status={status}
              error={error}
              transcript={transcript}
              bestPreview={bestPreview}
              lastMatch={lastMatch}
            />
          </div>
        </section>
      </section>

      {/* Sidebar de Extras (presets, mic, audio controls) */}
      <ToggleSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        threshold={threshold}
        onThresholdChange={setThreshold}
        isListening={isListening}
        onToggleMic={isListening ? stopMic : startMic}
        soundEnabled={soundEnabled}
        onToggleSound={() => { setSoundEnabled((v) => !v); if (soundEnabled) stopAllAudio(); }}
        presets={presets}
        presetName={presetName}
        onPresetNameChange={setPresetName}
        onSavePreset={saveCurrentAsPreset}
        onLoadPreset={loadPreset}
        onDeletePreset={removePreset}
        linesCount={lines.length}
        isAdmin={isAdmin}
        isPttHolding={isPttHolding}
        onStartPtt={startPtt}
        onStopPtt={stopPtt}
        muted={muted}
        onToggleMute={toggleMute}
        onStopAllAudio={stopAllAudio}
        onKillSwitch={triggerKillSwitch}
        wsStatus={wsStatus}
        isTokenBusy={isTokenBusy}
      />
    </main>
  );
}

export default App;
