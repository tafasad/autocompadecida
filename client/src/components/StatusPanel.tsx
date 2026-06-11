import type { ScriptLine } from "@/lib/types";

interface StatusPanelProps {
  status: string;
  error: string;
  transcript: string;
  bestPreview: number;
  lastMatch: { line: ScriptLine; score: number } | null;
}

export default function StatusPanel({ status, error, transcript, bestPreview, lastMatch }: StatusPanelProps) {
  return (
    <div className="space-y-4 p-5 pt-0">
      <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">Status</p>
        <p className="mt-2 text-xs leading-relaxed text-white/60">{status}</p>
        {error && (
          <p className="mt-2 rounded-xl border border-[#ff00aa]/30 bg-[#ff00aa]/10 p-3 text-xs text-[#ff00aa]">
            {error}
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">Último ouvido</p>
        <p className="mt-2 min-h-16 rounded-xl border border-[#00f0ff]/10 bg-black/40 p-3 text-xs leading-relaxed text-white/60">
          {transcript || "Ligue o microfone e fale uma frase."}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#00f0ff] to-[#7c3aed] transition-all"
            style={{ width: `${Math.min(100, bestPreview)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-white/30 font-mono">Similaridade: {bestPreview}%</p>
      </div>
      <div className="rounded-2xl border border-[#00f0ff]/10 bg-[#0d0d15] p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#00f0ff]/50 font-mono">Último gatilho</p>
        {lastMatch ? (
          <div className="mt-2 rounded-xl border border-[#00ff88]/30 bg-[#00ff88]/5 p-3">
            <p className="text-xs font-bold text-[#00ff88]">{lastMatch.score}% de similaridade</p>
            <p className="mt-1.5 text-xs text-white/60 leading-relaxed">"{lastMatch.line.text}"</p>
            <p className="mt-1 text-[10px] text-white/30 font-mono">Efeito: {lastMatch.line.effectName}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-white/30">Nenhum gatilho disparado ainda.</p>
        )}
      </div>
    </div>
  );
}
