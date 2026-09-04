/** Synthesised horns: nothing is loaded, everything is an oscillator. */
let ctx = null;
function ac() {
  if (!ctx) { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; ctx = new Ctx(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Modern two-tone air horn. */
export function horn() {
  const c = ac(); if (!c) return;
  const now = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
  gain.gain.setValueAtTime(0.18, now + 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
  gain.connect(c.destination);
  for (const [f, g] of [[311, 1], [370, 0.8], [622, 0.25]]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const og = c.createGain(); og.gain.value = g * 0.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    o.connect(og); og.connect(lp); lp.connect(gain);
    o.start(now); o.stop(now + 1.3);
  }
}

/** Steam whistle: a chord with a little vibrato and breath. */
export function whistle() {
  const c = ac(); if (!c) return;
  const now = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.08);
  gain.gain.setValueAtTime(0.14, now + 1.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.7);
  gain.connect(c.destination);
  const lfo = c.createOscillator(); lfo.frequency.value = 5.5;
  const lfoG = c.createGain(); lfoG.gain.value = 6; lfo.connect(lfoG); lfo.start(now); lfo.stop(now + 1.8);
  for (const [f, g] of [[659, 1], [880, 0.7], [1109, 0.45]]) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; lfoG.connect(o.frequency);
    const og = c.createGain(); og.gain.value = g * 0.4;
    o.connect(og); og.connect(gain); o.start(now); o.stop(now + 1.8);
  }
  // breath of steam
  const len = c.sampleRate * 1.5, buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.35));
  const n = c.createBufferSource(); n.buffer = buf;
  const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.6;
  const ng = c.createGain(); ng.gain.value = 0.05;
  n.connect(nf); nf.connect(ng); ng.connect(gain); n.start(now);
}
