/**
 * Relaxing music, generated in code: a low drone, slow major-seventh pads
 * that change every dozen seconds, and a sparse pentatonic melody of soft
 * bells, all washed through a generated reverb. Nothing is loaded from disk.
 * Browsers only let sound start after a click, so start() is called from the
 * opening overlay.
 */
const A4 = 440;
const hz = (semi) => A4 * Math.pow(2, (semi - 69) / 12);       // MIDI note number -> Hz
const D3 = 50;
// calm progression in D major: Dmaj7, Bm7, Gmaj7, A(add9), F#m7, Gmaj7, Em7, A(add9)
const CHORDS = [
  [0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 9],
  [-8, -5, 0, 4], [-7, -3, 0, 6], [-10, -6, -3, 2], [-5, -1, 2, 7],
].map((c) => c.map((s) => D3 + 12 + s));
const PENTA = [0, 2, 4, 7, 9].flatMap((s) => [D3 + 24 + s, D3 + 36 + s]);   // D E F# A B, two octaves

export function createMusic() {
  let ctx = null, master = null, wet = null, on = false, timer = null;
  let chordAt = 0, chordIdx = 0, bellAt = 0, level = 0.5;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const reverb = () => {
    const len = Math.floor(ctx.sampleRate * 2.8), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const c = ctx.createConvolver(); c.buffer = buf; return c;
  };

  const setup = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    wet = ctx.createGain(); wet.gain.value = 0.45;
    wet.connect(reverb()).connect(master);
    // the drone: a low D that never stops
    for (const [semi, g] of [[D3, 0.05], [D3 + 7, 0.02]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(semi);
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(master); o.start();
    }
  };

  const pad = (notes, t, dur) => {
    for (const n of notes) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n); o.detune.value = det;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + 3.5);
        g.gain.setValueAtTime(0.035, t + dur - 4);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(f).connect(g); g.connect(master); g.connect(wet);
        o.start(t); o.stop(t + dur + 0.1);
      }
    }
  };

  const bell = (n, t) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz(n) * 2.01;   // a faint octave shimmer
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0008, t + 3.2);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.02, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = rnd(-0.6, 0.6);
    const out = pan || master;
    o.connect(g).connect(out); o2.connect(g2).connect(out);
    if (pan) { pan.connect(master); pan.connect(wet); }
    o.start(t); o2.start(t); o.stop(t + 3.4); o2.stop(t + 1.6);
  };

  // schedule a little ahead of the clock
  const tick = () => {
    const now = ctx.currentTime;
    while (chordAt < now + 2) {
      const dur = rnd(11, 15);
      pad(CHORDS[chordIdx % CHORDS.length], Math.max(chordAt, now + 0.05), dur);
      chordIdx++; chordAt += dur - 3.5;                       // overlap the fades
    }
    while (bellAt < now + 2) {
      if (Math.random() < 0.8) bell(PENTA[Math.floor(Math.random() * PENTA.length)], Math.max(bellAt, now + 0.05));
      bellAt += rnd(1.6, 4.5);
    }
  };

  const api = {
    get playing() { return on; },
    /** must be called from a user gesture */
    start() {
      if (!ctx) setup();
      if (ctx.state === 'suspended') ctx.resume();
      if (on) return;
      on = true;
      chordAt = bellAt = ctx.currentTime + 0.2; chordIdx = Math.floor(Math.random() * CHORDS.length);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(level, ctx.currentTime, 2.5);
      tick(); timer = setInterval(tick, 800);
    },
    stop() {
      if (!on) return;
      on = false; clearInterval(timer); timer = null;
      master.gain.setTargetAtTime(0, ctx.currentTime, 1.2);
    },
    toggle() { if (on) api.stop(); else api.start(); return on; },
    setVolume(v) { level = Math.max(0, Math.min(1, v)); if (on) master.gain.setTargetAtTime(level, ctx.currentTime, 0.5); },
  };
  return api;
}
