/* Barnyard Brawl — silly synthesized sound effects and a campy hoedown theme (Web Audio, no files) */
(() => {
  'use strict';
  let ac = null, master, musicBus, sfxBus, noiseBuf = null;
  const state = {
    music: localStorage.getItem('bb_music') !== '0',
    sfx: localStorage.getItem('bb_sfx') !== '0',
  };
  const listeners = [];

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.8;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ac.destination);
      musicBus = ac.createGain(); musicBus.gain.value = state.music ? 0.32 : 0; musicBus.connect(master);
      sfxBus = ac.createGain(); sfxBus.gain.value = state.sfx ? 0.9 : 0; sfxBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startMusic();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => ensure(), { capture: true }));

  // ---------------------------------------------------------------- primitives
  function env(g, t, a, peak, dur, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  // tone: {type, f: [freqs at evenly spaced times] or number, dur, vol, at, vib, vibDepth, filter, fq, q, a, rel, bus}
  function tone(o) {
    if (!ac) return;
    const t = ac.currentTime + (o.at || 0);
    const osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    const fs = Array.isArray(o.f) ? o.f : [o.f];
    osc.frequency.setValueAtTime(fs[0], t);
    for (let i = 1; i < fs.length; i++) osc.frequency.exponentialRampToValueAtTime(Math.max(20, fs[i]), t + (o.dur * i) / (fs.length - 1));
    if (o.vib) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.vibDepth || 10;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + o.dur + 0.05);
    }
    let node = osc;
    if (o.filter) {
      const f = ac.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.fq || 1000; f.Q.value = o.q || 1;
      if (o.fq2) f.frequency.exponentialRampToValueAtTime(o.fq2, t + o.dur);
      node.connect(f); node = f;
    }
    const g = ac.createGain();
    env(g, t, o.a || 0.01, o.vol || 0.3, o.dur, o.rel || Math.min(0.15, o.dur * 0.5));
    node.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }
  function noise(o) {
    if (!ac) return;
    const t = ac.currentTime + (o.at || 0);
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.value = o.fq || 1000; f.Q.value = o.q || 1;
    if (o.fq2) f.frequency.exponentialRampToValueAtTime(o.fq2, t + o.dur);
    const g = ac.createGain(); env(g, t, o.a || 0.005, o.vol || 0.3, o.dur, o.rel || o.dur * 0.6);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  }
  const N = (name) => { // note name -> Hz, e.g. 'C5', 'F#4'
    const m = /^([A-G])(#|b)?(\d)$/.exec(name);
    const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (idx + (+m[3] + 1) * 12 - 69) / 12);
  };

  // ---------------------------------------------------------------- sound effects
  const V = (v, s) => (v || 1) * (s || 1);
  const SFX = {
    // animal voices
    moo: (v) => { tone({ type: 'sawtooth', f: [170, 150, 110], dur: 1.1, vol: V(v, 0.35), vib: 5, vibDepth: 6, filter: 'lowpass', fq: 900, fq2: 400, a: 0.1 }); },
    oink: (v) => { for (let i = 0; i < 2; i++) tone({ type: 'square', f: [300, 380, 250], dur: 0.14, vol: V(v, 0.18), filter: 'bandpass', fq: 900, q: 3, at: i * 0.18 }); },
    squeal: (v) => tone({ type: 'square', f: [700, 1500, 1200, 600], dur: 0.7, vol: V(v, 0.16), vib: 14, vibDepth: 60, filter: 'bandpass', fq: 1500, q: 2 }),
    bawk: (v, at = 0) => { tone({ type: 'square', f: [700, 900], dur: 0.09, vol: V(v, 0.16), filter: 'bandpass', fq: 1400, q: 3, at }); tone({ type: 'square', f: [1100, 1400, 700], dur: 0.22, vol: V(v, 0.2), filter: 'bandpass', fq: 1600, q: 3, at: at + 0.11 }); },
    bawk3: (v) => { for (let i = 0; i < 3; i++) SFX.bawk(v, i * 0.27); },
    bleat: (v) => tone({ type: 'sawtooth', f: [520, 480, 430], dur: 0.7, vol: V(v, 0.22), vib: 9, vibDepth: 45, filter: 'bandpass', fq: 1100, q: 2, a: 0.03 }),
    baa: (v) => tone({ type: 'sawtooth', f: [380, 360, 320], dur: 0.8, vol: V(v, 0.24), vib: 7, vibDepth: 30, filter: 'bandpass', fq: 900, q: 2, a: 0.05 }),
    whinny: (v) => tone({ type: 'sawtooth', f: [900, 1300, 1100, 700, 400], dur: 1.0, vol: V(v, 0.2), vib: 13, vibDepth: 80, filter: 'bandpass', fq: 1400, q: 2 }),
    buzz: (v) => tone({ type: 'sawtooth', f: [210, 240, 200], dur: 0.6, vol: V(v, 0.12), vib: 30, vibDepth: 15, filter: 'lowpass', fq: 1800 }),
    quack: (v) => { for (let i = 0; i < 2; i++) tone({ type: 'square', f: [560, 480], dur: 0.13, vol: V(v, 0.2), filter: 'bandpass', fq: 1100, q: 4, at: i * 0.16 }); },
    quack3: (v) => { for (let i = 0; i < 4; i++) tone({ type: 'square', f: [600 - i * 30, 480 - i * 30], dur: 0.13, vol: V(v, 0.2), filter: 'bandpass', fq: 1100, q: 4, at: i * 0.15 }); },
    // actions
    squirt: (v) => { noise({ filter: 'bandpass', fq: 2500, fq2: 900, q: 1.5, dur: 0.45, vol: V(v, 0.35) }); tone({ type: 'sine', f: [900, 500], dur: 0.25, vol: V(v, 0.1) }); },
    munch: (v) => { for (let i = 0; i < 3; i++) noise({ filter: 'lowpass', fq: 900, dur: 0.07, vol: V(v, 0.4), at: i * 0.13 }); },
    whoosh: (v) => noise({ filter: 'bandpass', fq: 400, fq2: 2400, q: 1.2, dur: 0.35, vol: V(v, 0.35), a: 0.08 }),
    swish: (v) => noise({ filter: 'bandpass', fq: 1200, fq2: 3000, q: 2, dur: 0.12, vol: V(v, 0.18), a: 0.02 }),
    pew: (v) => tone({ type: 'square', f: [1400, 500], dur: 0.1, vol: V(v, 0.07), filter: 'lowpass', fq: 3000 }),
    thwack: (v) => { noise({ filter: 'lowpass', fq: 1600, dur: 0.07, vol: V(v, 0.35) }); tone({ type: 'sine', f: [180, 70], dur: 0.1, vol: V(v, 0.3) }); },
    thud: (v) => { tone({ type: 'sine', f: [120, 40], dur: 0.35, vol: V(v, 0.6) }); noise({ filter: 'lowpass', fq: 500, dur: 0.25, vol: V(v, 0.35) }); },
    splat: (v) => { noise({ filter: 'lowpass', fq: 1400, fq2: 300, dur: 0.3, vol: V(v, 0.5) }); tone({ type: 'sine', f: [300, 80], dur: 0.15, vol: V(v, 0.3) }); },
    squelch: (v) => { noise({ filter: 'bandpass', fq: 500, fq2: 200, q: 3, dur: 0.4, vol: V(v, 0.5) }); tone({ type: 'sine', f: [220, 120, 260], dur: 0.35, vol: V(v, 0.15) }); },
    splash: (v) => { noise({ filter: 'highpass', fq: 1500, dur: 0.6, vol: V(v, 0.35) }); noise({ filter: 'lowpass', fq: 600, dur: 0.3, vol: V(v, 0.4) }); },
    boing: (v) => tone({ type: 'sine', f: [160, 520, 300], dur: 0.45, vol: V(v, 0.3), vib: 18, vibDepth: 40 }),
    pop: (v) => tone({ type: 'sine', f: [900, 150], dur: 0.12, vol: V(v, 0.35) }),
    zap: (v) => { tone({ type: 'square', f: [1800, 300], dur: 0.2, vol: V(v, 0.12) }); noise({ filter: 'highpass', fq: 3000, dur: 0.18, vol: V(v, 0.2) }); },
    zzz: (v) => { [784, 659, 523, 392].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.3, vol: V(v, 0.15), at: i * 0.14 })); },
    chime: (v) => { [1047, 1319, 1568, 2093].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.5, vol: V(v, 0.12), at: i * 0.07 })); },
    ding: (v) => { tone({ type: 'triangle', f: 1319, dur: 0.4, vol: V(v, 0.2) }); tone({ type: 'triangle', f: 1760, dur: 0.5, vol: V(v, 0.15), at: 0.08 }); },
    coin: (v) => { tone({ type: 'square', f: 988, dur: 0.08, vol: V(v, 0.1) }); tone({ type: 'square', f: 1319, dur: 0.25, vol: V(v, 0.1), at: 0.08 }); },
    chop: (v) => { noise({ filter: 'bandpass', fq: 1800, q: 2, dur: 0.06, vol: V(v, 0.4) }); tone({ type: 'triangle', f: [500, 300], dur: 0.08, vol: V(v, 0.15) }); },
    sparkle: (v) => { for (let i = 0; i < 6; i++) tone({ type: 'sine', f: 1400 + i * 260, dur: 0.18, vol: V(v, 0.1), at: i * 0.06 }); },
    powerup: (v) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'square', f, dur: 0.12, vol: V(v, 0.09), at: i * 0.07, filter: 'lowpass', fq: 3000 })); },
    levelup: (v) => { [392, 523, 659, 784].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.18, vol: V(v, 0.18), at: i * 0.08 })); tone({ type: 'triangle', f: 1047, dur: 0.5, vol: V(v, 0.18), at: 0.32 }); },
    fire: (v) => noise({ filter: 'lowpass', fq: 800, fq2: 2500, dur: 0.6, vol: V(v, 0.3), a: 0.1 }),
    alarm: (v) => { for (let i = 0; i < 3; i++) tone({ type: 'square', f: [600, 950, 600], dur: 0.4, vol: V(v, 0.09), at: i * 0.42, filter: 'lowpass', fq: 2500 }); },
    fanfare: (v) => {
      const seq = [[523, 0.12], [523, 0.12], [523, 0.12], [698, 0.4], [880, 0.25], [784, 0.12], [880, 0.6]];
      let t = 0; for (const [f, d] of seq) { tone({ type: 'sawtooth', f, dur: d, vol: V(v, 0.12), at: t, filter: 'lowpass', fq: 2500 }); tone({ type: 'square', f: f / 2, dur: d, vol: V(v, 0.06), at: t }); t += d + 0.02; }
    },
    sadhorn: (v) => sadTrombone(v),
    crash: (v) => { noise({ filter: 'lowpass', fq: 2000, fq2: 200, dur: 1.2, vol: V(v, 0.6) }); tone({ type: 'sine', f: [90, 30], dur: 0.9, vol: V(v, 0.5) }); },
    lullaby: (v) => { [1047, 1319, 1568, 1319, 1047].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.25, vol: V(v, 0.08), at: i * 0.12 })); },
    gallop: (v) => { for (let i = 0; i < 6; i++) tone({ type: 'sine', f: [260, 120], dur: 0.06, vol: V(v, 0.3), at: i * 0.11 + (i % 2) * 0.04 }); },
    slide: (v) => tone({ type: 'sine', f: [1800, 300], dur: 0.9, vol: V(v, 0.2), vib: 6, vibDepth: 12, a: 0.02 }),
  };
  function sadTrombone(v, at = 0) {
    const notes = [[N('G3'), 0.35], [N('F#3'), 0.35], [N('F3'), 0.35], [N('E3'), 1.1]];
    let t = at;
    for (let i = 0; i < notes.length; i++) {
      const [f, d] = notes[i];
      tone({ type: 'sawtooth', f: i === 3 ? [f, f * 0.97, f * 0.9] : [f, f * 0.99], dur: d, vol: V(v, 0.2), at: t, vib: i === 3 ? 6 : 0, vibDepth: 6, filter: 'lowpass', fq: 1200, fq2: 500, a: 0.03 });
      t += d;
    }
  }
  // Over-the-top death: an exaggerated animal wail + slide whistle + sad trombone + a cartoon splat.
  const CRY = {
    cow: (v) => tone({ type: 'sawtooth', f: [190, 170, 120, 70], dur: 1.6, vol: V(v, 0.38), vib: 6, vibDepth: 10, filter: 'lowpass', fq: 1000, fq2: 300, a: 0.06 }),
    pig: (v) => tone({ type: 'square', f: [900, 1800, 1500, 300], dur: 1.1, vol: V(v, 0.16), vib: 16, vibDepth: 90, filter: 'bandpass', fq: 1500, q: 2 }),
    chicken: (v) => { SFX.bawk(v * 1.2); tone({ type: 'square', f: [1200, 1600, 400], dur: 0.9, vol: V(v, 0.16), at: 0.3, vib: 12, vibDepth: 80, filter: 'bandpass', fq: 1500, q: 2 }); },
    goat: (v) => tone({ type: 'sawtooth', f: [620, 700, 500, 250], dur: 1.4, vol: V(v, 0.24), vib: 10, vibDepth: 70, filter: 'bandpass', fq: 1100, q: 2 }),
    horse: (v) => tone({ type: 'sawtooth', f: [1100, 1500, 1200, 600, 250], dur: 1.4, vol: V(v, 0.2), vib: 14, vibDepth: 110, filter: 'bandpass', fq: 1400, q: 2 }),
    sheep: (v) => tone({ type: 'sawtooth', f: [420, 450, 330, 180], dur: 1.5, vol: V(v, 0.26), vib: 8, vibDepth: 40, filter: 'bandpass', fq: 900, q: 2 }),
    bee: (v) => tone({ type: 'sawtooth', f: [400, 260, 90], dur: 1.3, vol: V(v, 0.16), vib: 32, vibDepth: 25, filter: 'lowpass', fq: 2000, fq2: 400 }),
    duck: (v) => { for (let i = 0; i < 5; i++) tone({ type: 'square', f: [620 - i * 70, 500 - i * 80], dur: 0.15 + i * 0.03, vol: V(v, 0.2), filter: 'bandpass', fq: 1100, q: 4, at: i * 0.17 }); },
  };
  function death(champ, v) {
    if (!ac || !state.sfx) return;
    v = v || 1;
    (CRY[champ] || CRY.cow)(v);
    const pick = Math.floor(Math.random() * 3);
    if (pick === 0) { tone({ type: 'sine', f: [2000, 250], dur: 1.1, vol: V(v, 0.16), vib: 7, vibDepth: 15, at: 0.5 }); sadTrombone(v, 1.4); }
    else if (pick === 1) { sadTrombone(v, 0.9); tone({ type: 'sine', f: [120, 500, 200], dur: 0.6, vol: V(v, 0.25), vib: 16, vibDepth: 40, at: 2.6 }); }
    else { tone({ type: 'sine', f: [300, 2200], dur: 0.6, vol: V(v, 0.14), at: 0.4 }); tone({ type: 'sine', f: [2200, 200], dur: 0.9, vol: V(v, 0.14), at: 1.0 }); sadTrombone(v, 1.6); }
    setTimeout(() => { noise({ filter: 'lowpass', fq: 1200, fq2: 200, dur: 0.35, vol: 0.5 * v }); tone({ type: 'sine', f: [260, 60], dur: 0.25, vol: 0.4 * v }); }, 3500);
  }
  let lastHit = 0;
  function play(name, vol) {
    if (!ac || !state.sfx || !(vol > 0.03)) return;
    if (name === 'thwack' || name === 'chop' || name === 'pew' || name === 'swish') {
      const n = performance.now(); if (n - lastHit < 55) return; lastHit = n;
    }
    const f = SFX[name];
    if (f) f(Math.min(1.2, vol));
  }

  // ---------------------------------------------------------------- campy hoedown theme
  const BPM = 132, BEAT = 60 / BPM;
  const MEL = [
    // bar by bar: [note, beats]; '-' is a rest
    [['C5', .5], ['D5', .5], ['E5', 1], ['E5', .5], ['D5', .5], ['C5', 1]],
    [['G4', .5], ['A4', .5], ['C5', 1], ['A4', .5], ['G4', .5], ['E4', 1]],
    [['F4', .5], ['A4', .5], ['C5', 1], ['D5', .5], ['C5', .5], ['A4', 1]],
    [['G4', .5], ['E4', .5], ['G4', .5], ['A4', .5], ['G4', 2]],
    [['C5', .5], ['D5', .5], ['E5', 1], ['G5', .5], ['E5', .5], ['C5', 1]],
    [['D5', .5], ['D5', .5], ['B4', 1], ['G4', 1], ['-', 1]],
    [['A4', .5], ['B4', .5], ['C5', .5], ['D5', .5], ['E5', .5], ['F5', .5], ['G5', 1]],
    [['G5', .5], ['F5', .5], ['E5', .5], ['D5', .5], ['C5', 2]],
    [['F5', 1], ['E5', .5], ['D5', .5], ['C5', 1], ['A4', 1]],
    [['F4', .5], ['G4', .5], ['A4', .5], ['C5', .5], ['A4', 2]],
    [['G4', .5], ['A4', .5], ['C5', 1], ['E5', 1], ['C5', 1]],
    [['E5', .5], ['D5', .5], ['C5', .5], ['D5', .5], ['E5', 2]],
    [['D5', 1], ['B4', .5], ['G4', .5], ['D5', 1], ['B4', 1]],
    [['C5', .5], ['B4', .5], ['A4', .5], ['B4', .5], ['G4', 2]],
    [['C5', .5], ['E5', .5], ['G5', .5], ['E5', .5], ['C5', .5], ['E5', .5], ['G5', 1]],
    [['B4', .5], ['C5', .5], ['D5', .5], ['B4', .5], ['G4', 1], ['-', 1]],
  ];
  const CHORDS = ['C', 'C', 'F', 'C', 'C', 'G', 'F', 'C', 'F', 'F', 'C', 'C', 'G', 'G', 'C', 'G'];
  const CH = { C: ['C3', 'G2', ['C4', 'E4', 'G4']], F: ['F2', 'C3', ['F4', 'A4', 'C5']], G: ['G2', 'D3', ['G3', 'B3', 'D4']] };
  let nextBar = 0, barIdx = 0, timer = null;
  function kazoo(f, t, d, vol) {
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 0.97, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.5; lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(osc.frequency);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.4;
    const g = ac.createGain(); env(g, t, 0.025, vol, d * 0.92, 0.05);
    osc.connect(bp); bp.connect(g); g.connect(musicBus);
    osc.start(t); lfo.start(t); osc.stop(t + d); lfo.stop(t + d);
  }
  function pluck(f, t, vol, type) {
    const osc = ac.createOscillator(); osc.type = type || 'triangle'; osc.frequency.value = f;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g); g.connect(musicBus); osc.start(t); osc.stop(t + 0.25);
  }
  function drum(t, kind) {
    if (kind === 'k') {
      const o = ac.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ac.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.16);
    } else {
      const src = ac.createBufferSource(); src.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 's' ? 1800 : 6000;
      const g = ac.createGain(); g.gain.setValueAtTime(kind === 's' ? 0.22 : 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 's' ? 0.12 : 0.04));
      src.connect(f); f.connect(g); g.connect(musicBus); src.start(t, Math.random()); src.stop(t + 0.13);
    }
  }
  function scheduleBar(t, i) {
    const [root, fifth, triad] = CH[CHORDS[i]];
    // oom-pah bass + banjo-ish chord plucks
    pluck(N(root), t, 0.32, 'triangle'); pluck(N(fifth), t + 2 * BEAT, 0.3, 'triangle');
    for (const b of [1, 3]) for (const n of triad) pluck(N(n), t + b * BEAT, 0.07, 'square');
    for (const b of [1.5, 3.5]) for (const n of triad) pluck(N(n) * 2, t + b * BEAT, 0.035, 'square');
    drum(t, 'k'); drum(t + 2 * BEAT, 'k'); drum(t + BEAT, 's'); drum(t + 3 * BEAT, 's');
    for (let b = 0; b < 4; b += 0.5) drum(t + b * BEAT, 'h');
    // kazoo melody
    let bt = 0;
    for (const [n, d] of MEL[i]) { if (n !== '-') kazoo(N(n), t + bt * BEAT, d * BEAT, 0.16); bt += d; }
    // slide-whistle flourish at the end of the loop
    if (i === 15) tone({ type: 'sine', f: [600, 1800], dur: BEAT * 1.2, vol: 0.12, at: t - ac.currentTime + 2.6 * BEAT, vib: 8, vibDepth: 15, bus: musicBus });
  }
  function startMusic() {
    if (timer) return;
    nextBar = ac.currentTime + 0.2; barIdx = 0;
    timer = setInterval(() => {
      if (!ac || ac.state !== 'running') return;
      while (nextBar < ac.currentTime + 0.6) { scheduleBar(nextBar, barIdx); nextBar += 4 * BEAT; barIdx = (barIdx + 1) % 16; }
    }, 120);
  }

  function setMusic(on) { state.music = on; localStorage.setItem('bb_music', on ? '1' : '0'); if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.32 : 0, ac.currentTime, 0.1); listeners.forEach((f) => f()); }
  function setSfx(on) { state.sfx = on; localStorage.setItem('bb_sfx', on ? '1' : '0'); if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05); listeners.forEach((f) => f()); }
  function musicLevel(game) { if (musicBus && state.music) musicBus.gain.setTargetAtTime(game ? 0.18 : 0.32, ac.currentTime, 0.5); }

  window.Sound = { play, death, setMusic, setSfx, musicLevel, state, onChange: (f) => listeners.push(f), ensure };
})();
