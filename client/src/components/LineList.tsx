import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { ScriptLine } from "@/lib/types";

interface LineListProps {
  lines: ScriptLine[];
  selectedLineId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

export default function LineList({ lines, selectedLineId, onSelect, onAdd, onDelete, canDelete }: LineListProps) {
  return (
    <aside className="border-b border-[#00f0ff]/10 lg:border-b-0 lg:border-r lg:min-h-screen flex flex-col bg-[#0a0a0f]/80">
      <header className="flex items-center justify-between border-b border-[#00f0ff]/10 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#00f0ff]/50">Falas do script</p>
          <h1 className="mt-0.5 text-base font-bold text-white" style={{ fontFamily: "Orbitron, sans-serif" }}>
            Teleprompter
          </h1>
        </div>
        <Button onClick={onAdd} className="h-8 px-3 text-[11px] bg-[#00f0ff]/20 hover:bg-[#00f0ff]/40 text-[#00f0ff] border border-[#00f0ff]/40 font-bold rounded-full">
          <Plus className="h-3.5 w-3.5 mr-1" /> Nova
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {lines.map((line, index) => {
          const active = line.id === selectedLineId;
          return (
            <div
              key={line.id}
              className={`group rounded-xl border p-3 transition-all cursor-pointer ${
                active
                  ? "border-[#00f0ff] bg-[#00f0ff]/5 shadow-[0_0_15px_rgba(0,240,255,0.1)]"
                  : "border-[#00f0ff]/10 bg-[#0d0d15] hover:border-[#00f0ff]/30"
              }`}
              onClick={() => onSelect(line.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#00f0ff]/40 font-mono">
                  Fala {index + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono ${line.audioBlob ? "bg-[#00ff88]/10 text-[#00ff88]" : "bg-white/5 text-white/30"}`}>
                    {line.audioBlob ? "audio" : "sem"}
                  </span>
                  {canDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/70">
                {line.text || "Fala vazia: clique para editar"}
              </p>
              <p className="mt-2 text-[10px] text-white/30 font-mono">
                Efeito: {line.effectName || "sem nome"}
              </p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}