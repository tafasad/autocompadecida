import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import PresetsPanel from "@/components/PresetsPanel";
import type { ScriptLine } from "@/lib/types";
import type { Preset } from "../lib/db";

interface ToggleSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  threshold: number;
  onThresholdChange: (value: number) => void;
  isListening: boolean;
  onToggleMic: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;

  presets: Preset[];
  presetName: string;
  onPresetNameChange: (name: string) => void;
  onSavePreset: () => void;
  onLoadPreset: (preset: Preset) => void;
  onDeletePreset: (id: string) => void;
  linesCount: number;

  isAdmin: boolean;
  isPttHolding: boolean;
  onStartPtt: () => void;
  onStopPtt: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onStopAllAudio: () => void;
  onKillSwitch: () => void;
  wsStatus: string;
  isTokenBusy: boolean;
}

export default function ToggleSidebar({
  isOpen, onToggle, threshold, onThresholdChange,
  isListening, onToggleMic, soundEnabled, onToggleSound,
  presets, presetName, onPresetNameChange, onSavePreset, onLoadPreset, onDeletePreset, linesCount,
  isAdmin, isPttHolding, onStartPtt, onStopPtt,
  muted, onToggleMute, onStopAllAudio, onKillSwitch, wsStatus, isTokenBusy,
}: ToggleSidebarProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-72 bg-[#050508] border-l border-[#ff00aa]/20 shadow-[-4px_0_30px_rgba(255,0,170,0.1)] flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-[#ff00aa]/10">
        <span className="text-xs font-bold tracking-widest text-[#ff00aa] uppercase">Extras</span>
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7 text-[#ff00aa]/60 hover:text-[#ff00aa]">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-6">

          {/* Presets Panel */}
          <PresetsPanel
            presets={presets.map((p) => ({
              id: p.id,
              name: p.name,
              effectName: p.effectName,
              audioName: p.audioName,
            }))}
            presetName={presetName}
            onPresetNameChange={onPresetNameChange}
            onSave={onSavePreset}
            onLoad={(id) => {
              const p = presets.find((pr) => pr.id === id);
              if (p) onLoadPreset(p);
            }}
            onDelete={onDeletePreset}
            onExport={() => {}}
            onImport={() => {}}
            linesCount={linesCount}
          />

          {/* Mic / Threshold */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold tracking-widest text-[#00f0ff] uppercase">Microfone</h3>
            <Button
              onClick={onToggleMic}
              className={`w-full h-9 text-sm font-bold rounded-xl ${
                isListening
                  ? "bg-red-500/20 text-red-400 border border-red-500/40"
                  : "bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30"
              }`}
            >
              {isListening ? "Parar mic" : "Ligar mic"}
            </Button>
            <div>
              <label className="text-[10px] text-white/40 font-mono">Sensibilidade: {threshold}%</label>
              <input
                type="range" min={40} max={95} value={threshold}
                onChange={(e) => onThresholdChange(Number(e.target.value))}
                className="w-full mt-1 accent-[#00f0ff]"
              />
            </div>
          </div>

          {/* Audio Controls */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold tracking-widest text-[#ff00aa] uppercase">├üudio</h3>
            <div className="flex gap-2">
              <Button
                onClick={onToggleSound}
                className={`flex-1 h-8 text-xs font-bold rounded-xl ${
                  soundEnabled
                    ? "bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30"
                    : "bg-red-500/20 text-red-400 border border-red-500/40"
                }`}
              >
                {soundEnabled ? "Som ligado" : "Som mudo"}
              </Button>
              <Button onClick={onStopAllAudio} className="h-8 w-8 bg-white/5 border border-white/10 text-white/60 rounded-xl p-0">
                STOP
              </Button>
            </div>

            {isAdmin && (
              <Button
                onClick={onToggleMute}
                className={`w-full h-9 text-sm font-bold rounded-xl ${
                  muted
                    ? "bg-red-500/30 text-red-300 border border-red-500/50 animate-pulse"
                    : "bg-[#ff00aa]/10 text-[#ff00aa] border border-[#ff00aa]/30"
                }`}
              >
                {muted ? "MUTE ATIVO" : "MUTE GLOBAL"}
              </Button>
            )}

            {isAdmin && (
              <Button
                onMouseDown={onStartPtt}
                onMouseUp={onStopPtt}
                onMouseLeave={onStopPtt}
                onTouchStart={onStartPtt}
                onTouchEnd={onStopPtt}
                className={`w-full h-9 text-sm font-bold rounded-xl ${
                  isPttHolding
                    ? "bg-red-500/30 text-red-300 border border-red-500/50"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                }`}
              >
                {isPttHolding ? "FALANDO..." : "PTT (segurar)"}
              </Button>
            )}

            <div className="flex gap-2">
              <Button onClick={onKillSwitch} className="flex-1 h-8 text-xs font-bold rounded-xl bg-red-500/10 text-red-400 border border-red-500/30">
                KILL
              </Button>
            </div>
            <p className="text-[10px] text-white/30 font-mono">
              WS: {wsStatus} {isTokenBusy ? "| token ocupado" : ""}
            </p>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}

export function ToggleButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className="fixed top-3 right-3 z-40 h-8 w-8 bg-[#ff00aa]/10 border border-[#ff00aa]/30 text-[#ff00aa] hover:bg-[#ff00aa]/20 rounded-xl"
    >
      {isOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
    </Button>
  );
}