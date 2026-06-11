import type { ScriptLine } from "@/lib/types";
import { Upload, Play, X } from "lucide-react";

interface LineEditorProps {
  line: ScriptLine | undefined;
  onUpdate: (patch: Partial<ScriptLine>) => void;
  onPlayEffect: () => void;
  onFileUpload: (file?: File) => void;
  onRemoveAudio?: () => void;
}

export default function LineEditor({ line, onUpdate, onPlayEffect, onFileUpload, onRemoveAudio }: LineEditorProps) {
  if (!line) {
    return (
      <div className="flex items-center justify-center h-full text-white/20 text-sm">
        Selecione ou crie uma fala
      </div>
    );
  }

  const hasAudio = Boolean(line.audioBlob || line.audioId || line.audioUrl);

  return (
    <div className="space-y-5 p-5">
      <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-5">
        <label className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">
          Texto da fala
        </label>
        <textarea
          value={line.text}
          onChange={e => onUpdate({ text: e.target.value })}
          placeholder="Ex.: E ande logo antes que mudem de ideia!"
          className="mt-3 min-h-36 w-full resize-y rounded-xl border border-[#00f0ff]/10 bg-black/60 p-4 text-xl font-semibold leading-relaxed text-white outline-none transition placeholder:text-white/20 focus:border-[#00f0ff]/40"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-5">
          <label className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">
            Nome do efeito
          </label>
          <input
            value={line.effectName}
            onChange={e => onUpdate({ effectName: e.target.value })}
            placeholder="Risada, aplauso, suspense..."
            className="mt-3 w-full rounded-xl border border-[#00f0ff]/10 bg-black/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#00f0ff]/40 placeholder:text-white/20"
          />
        </div>
        <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-5">
          <label className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">
            Áudio do efeito
          </label>
          {hasAudio ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-[#00ff88]/20 bg-[#00ff88]/5 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#00ff88] font-medium truncate">
                    {line.audioName || "Áudio anexado"}
                  </p>
                  <p className="text-[10px] text-white/30 font-mono mt-0.5">
                    {line.audioBlob ? `${(line.audioBlob.size / 1024).toFixed(1)} KB` : "Servidor"}
                  </p>
                </div>
                <button
                  onClick={onPlayEffect}
                  className="shrink-0 w-9 h-9 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] flex items-center justify-center hover:bg-[#00ff88]/20 transition"
                  title="Tocar efeito"
                >
                  <Play className="h-4 w-4" />
                </button>
                {onRemoveAudio && (
                  <button
                    onClick={onRemoveAudio}
                    className="shrink-0 w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition"
                    title="Remover áudio"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-white/30 font-mono">
                💡 Para trocar, envie um novo arquivo abaixo
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-[#00f0ff]/20 bg-black/30 p-6 text-center">
              <Upload className="h-6 w-6 text-[#00f0ff]/30 mx-auto mb-2" />
              <p className="text-xs text-white/40">Nenhum áudio anexado</p>
              <p className="text-[10px] text-white/20 mt-1">Envie um arquivo de áudio abaixo</p>
            </div>
          )}
          <label className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-[#00f0ff]/20 bg-[#00f0ff]/5 px-4 py-2.5 text-xs text-[#00f0ff] font-bold cursor-pointer hover:bg-[#00f0ff]/10 transition">
            <Upload className="h-3.5 w-3.5" />
            {hasAudio ? "Trocar áudio" : "Enviar áudio"}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onFileUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
