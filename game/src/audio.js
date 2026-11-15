// Sound, synthesized in the browser: no audio files, no network, nothing
// to load. A gunshot is filtered noise, a reload is two clicks, the bomb is a
// beep that quickens as the timer runs out.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') noiseBurst(0.22, 900, 0.9);
      else if (kind === 'shotgun') noiseBurst(0.18, 700, 0.9);
      else if (kind === 'smg') noiseBurst(0.07, 1600, 0.5);
      else noiseBurst(0.11, 1200, 0.7);
    },
    distantShot() { noiseBurst(0.09, 500, 0.25); },
    reload() {
      tone(1400, 0.05, 0.25, 'square');
      window.setTimeout(() => tone(900, 0.05, 0.25, 'square'), 160);
    },
    hit() { tone(2200, 0.05, 0.3, 'sine'); },
    kill() { tone(1800, 0.08, 0.35, 'sine'); window.setTimeout(() => tone(2400, 0.1, 0.35, 'sine'), 90); },
    hurt() { noiseBurst(0.12, 300, 0.5); },
    beep() { tone(1200, 0.07, 0.3, 'square'); },
    plant() { tone(880, 0.12, 0.3, 'square'); window.setTimeout(() => tone(880, 0.12, 0.3, 'square'), 150); },
    explosion() {
      noiseBurst(1.1, 180, 1.0);
      tone(55, 0.9, 0.7, 'sine');
    },
    roundWin() {
      tone(523, 0.14, 0.3, 'sine');
      window.setTimeout(() => tone(659, 0.14, 0.3, 'sine'), 140);
      window.setTimeout(() => tone(784, 0.22, 0.3, 'sine'), 280);
    },
    roundLose() {
      tone(392, 0.16, 0.3, 'sine');
      window.setTimeout(() => tone(311, 0.24, 0.3, 'sine'), 170);
    },
    buy() { tone(1568, 0.06, 0.25, 'sine'); },
  };
}
