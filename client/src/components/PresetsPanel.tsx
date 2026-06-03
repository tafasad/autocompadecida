import { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Download, Upload, Trash2 } from "lucide-react";

interface PresetItem {
  id: string;
  name: string;
  effectName: string;
  audioName?: string;
}

interface PresetsPanelProps {
  presets: PresetItem[];
  presetName: string;
  onPresetNameChange: (name: string) => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  linesCount: number;
}

export default function PresetsPanel({
  presets, presetName, onPresetNameChange, onSave, onLoad, onDelete, onExport, onImport, linesCount,
}: PresetsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onImport(file);
      e.target.value = "";
    },
    [onImport]
  );

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold tracking-widest text-[#00f0ff] uppercase">Presets</h3>

      <div className="flex gap-2">
        <Input
          value={presetName}
          onChange={(e) => onPresetNameChange(e.target.value)}
          placeholder="Nome do preset..."
          className="flex-1 h-8 text-xs bg-[#0a0a0f] border-[#00f0ff]/30 text-white placeholder:text-white/30"
          onKeyDown={(e) => e.key === "Enter" && onSave()}
        />
        <Button
          size="icon"
          onClick={onSave}
          className="h-8 w-8 bg-[#00f0ff]/20 hover:bg-[#00f0ff]/40 border border-[#00f0ff]/50 text-[#00f0ff]"
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-2">
        <input type="file" accept=".json" ref={fileInputRef} className="hidden" onChange={handleImport} />
        <Button
          variant="ghost" size="sm" onClick={onExport}
          className="flex-1 h-7 text-[10px] text-[#00f0ff]/70 hover:text-[#00f0ff] border border-[#00f0ff]/20"
        >
          <Download className="h-3 w-3 mr-1" /> Export
        </Button>
        <Button
          variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}
          className="flex-1 h-7 text-[10px] text-[#00f0ff]/70 hover:text-[#00f0ff] border border-[#00f0ff]/20"
        >
          <Upload className="h-3 w-3 mr-1" /> Import
        </Button>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto">
        {presets.length === 0 && (
          <p className="text-[10px] text-white/30 font-mono">Nenhum preset salvo.</p>
        )}
        {presets.map((preset) => (
          <div key={preset.id} className="flex items-center justify-between rounded-xl border border-[#00f0ff]/10 bg-[#0a0a0f] px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-white/80">{preset.name}</p>
              <p className="truncate text-[10px] text-white/40 font-mono">{preset.effectName}</p>
            </div>
            <div className="flex gap-1 ml-2 shrink-0">
              <Button
                variant="ghost" size="sm"
                onClick={() => onLoad(preset.id)}
                className="h-6 px-2 text-[10px] text-[#00f0ff]/70 hover:text-[#00f0ff]"
              >
                Usar
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => onDelete(preset.id)}
                className="h-6 px-2 text-[10px] text-red-400/70 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-white/20 font-mono">{linesCount} falas no roteiro</p>
    </div>
  );
}