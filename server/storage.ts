import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.resolve(__dirname, "..", "audio");
const MANIFEST_PATH = path.join(AUDIO_DIR, "manifest.json");

type AudioMeta = {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  uploadedAt: string;
};

function ensureDir() {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
}

function readManifest(): Record<string, AudioMeta> {
  ensureDir();
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
    }
  } catch { }
  return {};
}

function writeManifest(manifest: Record<string, AudioMeta>) {
  ensureDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

export function saveAudio(id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
  ensureDir();
  const ext = path.extname(file.originalname) || ".bin";
  const filename = `${id}${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, filename), file.buffer);

  const manifest = readManifest();
  manifest[id] = {
    id,
    name: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
  writeManifest(manifest);
  return manifest[id];
}

export function getAudio(id: string): { meta: AudioMeta; filePath: string } | null {
  const manifest = readManifest();
  const meta = manifest[id];
  if (!meta) return null;

  const ext = path.extname(meta.name) || ".bin";
  const filePath = path.join(AUDIO_DIR, `${id}${ext}`);
  if (!fs.existsSync(filePath)) {
    const alt = fs.readdirSync(AUDIO_DIR).find(f => f.startsWith(id));
    if (alt) {
      return { meta, filePath: path.join(AUDIO_DIR, alt) };
    }
    return null;
  }
  return { meta, filePath };
}

export function deleteAudio(id: string): boolean {
  const manifest = readManifest();
  const meta = manifest[id];
  if (!meta) return false;

  delete manifest[id];
  writeManifest(manifest);

  const dir = fs.readdirSync(AUDIO_DIR);
  dir.forEach(f => {
    if (f.startsWith(id)) {
      fs.unlinkSync(path.join(AUDIO_DIR, f));
    }
  });
  return true;
}

export function listAudio(): AudioMeta[] {
  const manifest = readManifest();
  return Object.values(manifest).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}
