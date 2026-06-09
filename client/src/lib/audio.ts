// Global AudioContext singleton — must be resumed after user gesture on mobile
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContextClass();
  }

  // On mobile, AudioContext starts "suspended" — resume it
  if (sharedCtx.state === "suspended") {
    sharedCtx.resume().catch(() => {});
  }

  return sharedCtx;
}

// Call this once on first user interaction to unlock audio on mobile
export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  // Also play a silent buffer to fully unlock on iOS
  if (ctx) {
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      /* ignore */
    }
  }
}

export function playSyntheticLaugh(): AudioContext | null {
  const audioContext = getAudioContext();
  if (!audioContext) return null;

  // Ensure context is running
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  const master = audioContext.createGain();
  master.gain.value = 0.14;
  master.connect(audioContext.destination);
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
  return audioContext;
}

export function playFallbackBeep(): AudioContext | null {
  const audioContext = getAudioContext();
  if (!audioContext) return null;

  // Ensure context is running
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 740;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.35);
  return audioContext;
}
