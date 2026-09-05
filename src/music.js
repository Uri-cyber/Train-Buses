/**
 * Quiet music in a Japanese garden mood, generated in code: soft koto-like
 * plucks in the hirajoshi scale, a few notes at a time with long silences
 * between them, now and then a distant breathy flute note and a water drop,
 * over a barely-there low drone, all washed through a long generated reverb.
 * Nothing is loaded from disk. Browsers only let sound start after a click,
 * so start() is called from the opening overlay.
 */
const A4 = 440;
const hz = (semi) => A4 * Math.pow(2, (semi - 69) / 12);       // MIDI note number -> Hz
const ROOT = 62;                                                // D4
const HIRAJOSHI = [0, 1, 5, 7, 10];                             // D Eb G A Bb
const SCALE = [-12, 0, 12].flatMap((o) => HIRAJOSHI.map((s) => ROOT + o + s));

export function createMusic() {
  let ctx = null, master = null, wet = null, on = false, timer = null;
  let phraseAt = 0, fluteAt = 0, dropAt = 0, level = 0.32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const reverb = () => {
    const len = Math.floor(ctx.sampleRate * 4.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const c = ctx.createConvolver(); c.buffer = buf; return c;
  };

  const setup = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 2.5;
    master.connect(comp).connect(ctx.destination);
    wet = ctx.createGain(); wet.gain.value = 0.6;
    wet.connect(reverb()).connect(master);
    // a drone you feel more than hear
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(ROOT - 24);
    const g = ctx.createGain(); g.gain.value = 0.018;
    o.connect(g).connect(master); o.start();
  };

  const out = (node, pan) => {
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(master); p.connect(wet); }
    else { node.connect(master); node.connect(wet); }
  };

  // a plucked string: bright for an instant, then dull and long
  const pluck = (n, t, vol = 0.05, pan = 0) => {
    const f = hz(n);
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = 6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0004, t + rnd(2.2, 3.4));
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g);
    out(g, pan);
    o1.start(t); o2.start(t); o1.stop(t + 3.6); o2.stop(t + 3.6);
  };

  // a distant breathy flute: slow swell, a little vibrato, a whisper of air
  const flute = (n, t) => {
    const dur = rnd(3.5, 6);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n);
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6;
    const vg = ctx.createGain(); vg.gain.value = 3.5; vib.connect(vg).connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.028, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    const noise = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz(n) * 2; bp.Q.value = 12;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.012, t + dur * 0.4); ng.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); noise.connect(bp).connect(ng);
    out(g, rnd(-0.4, 0.4)); out(ng, 0);
    o.start(t); vib.start(t); noise.start(t); o.stop(t + dur); vib.stop(t + dur); noise.stop(t + dur);
  };

  // a drop of water into a stone basin
  const drop = (t) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rnd(1400, 2200), t); o.frequency.exponentialRampToValueAtTime(rnd(500, 800), t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.5);
    out(g, rnd(-0.7, 0.7));
    o.start(t); o.stop(t + 0.6);
  };

  // a phrase: two to five notes that mostly step down the scale, then silence
  const phrase = (t) => {
    let idx = Math.floor(rnd(4, SCALE.length - 1));
    const n = Math.floor(rnd(2, 6));
    const pan = rnd(-0.5, 0.5);
    for (let i = 0; i < n; i++) {
      pluck(SCALE[idx], t, rnd(0.035, 0.055), pan + rnd(-0.15, 0.15));
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + (Math.random() < 0.72 ? -pick([1, 1, 2]) : pick([1, 2, 3]))));
      t += rnd(0.45, 1.4);
    }
    return t;
  };

  // schedule a little ahead of the clock
  const tick = () => {
    const now = ctx.currentTime;
    while (phraseAt < now + 2) {
      const end = phrase(Math.max(phraseAt, now + 0.05));
      phraseAt = end + rnd(6, 16);                         // then let it ring, and wait
    }
    while (fluteAt < now + 2) { flute(pick(SCALE.slice(5, 10)), Math.max(fluteAt, now + 0.05)); fluteAt += rnd(28, 60); }
    while (dropAt < now + 2) { drop(Math.max(dropAt, now + 0.05)); dropAt += rnd(9, 25); }
  };

  const api = {
    get playing() { return on; },
    /** must be called from a user gesture */
    start() {
      if (!ctx) setup();
      if (ctx.state === 'suspended') ctx.resume();
      if (on) return;
      on = true;
      const t = ctx.currentTime;
      phraseAt = t + 2.5; fluteAt = t + rnd(12, 25); dropAt = t + rnd(4, 9);
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(level, t, 2.5);
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
