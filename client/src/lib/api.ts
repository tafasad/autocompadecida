const BASE_URL = import.meta.env.PROD ? "" : "";

export type AudioItem = {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  uploadedAt: string;
  url: string;
};

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res;
}

export async function listAudio(): Promise<AudioItem[]> {
  const res = await apiFetch("/api/audio");
  return res.json();
}

export async function uploadAudio(blob: Blob, filename: string): Promise<AudioItem> {
  const form = new FormData();
  form.append("audio", blob, filename);
  const res = await apiFetch("/api/audio/upload", { method: "POST", body: form });
  return res.json();
}

export async function deleteAudio(id: string): Promise<void> {
  await apiFetch(`/api/audio/${id}`, { method: "DELETE" });
}

export function getAudioUrl(id: string): string {
  return `${BASE_URL}/api/audio/${id}`;
}

export function isServerAvailable(): boolean {
  return !location.hostname.includes("github.io") &&
    !location.hostname.includes("pages.dev") &&
    !location.hostname.includes("netlify.app") &&
    !location.hostname.includes("vercel.app");
}
