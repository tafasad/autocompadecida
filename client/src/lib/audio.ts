export function playSyntheticLaugh() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  const audioContext = new AudioContextClass();
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
  window.setTimeout(() => { audioContext.close(); }, 1400);
  return audioContext;
}

export function playFallbackBeep() {
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
  window.setTimeout(() => { audioContext.close(); }, 600);
  return audioContext;
}