/**
 * TURBO PARTY RACE - 100% Native Web Audio API Synthesizer
 * Zero external MP3 dependencies. Festive Arcade & Kart Racing sound engine.
 */

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.muted = false;
    this.unlocked = false;

    // Continuous engine hum nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineRunning = false;

    this._setupAutoUnlock();
  }

  _setupAutoUnlock() {
    const unlockHandler = () => {
      this.unlock();
    };
    window.addEventListener('pointerdown', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
  }

  initContext() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Master dynamics compressor to keep loud party sound effects crisp without clipping
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-16, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(24, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(8, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.2, this.ctx.currentTime);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.75, this.ctx.currentTime);

    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  unlock() {
    this.initContext();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    return true;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.75, now, 0.02);
    }
  }

  _canPlay() {
    this.unlock();
    return Boolean(this.ctx && !this.muted);
  }

  _createNoiseBuffer(durationSec = 1.0) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Joyful rising arpeggio when a player joins the lobby
   */
  playJoin() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.02, start + 0.14);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.24, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);

      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(start);
      osc.stop(start + 0.19);
    });
  }

  /**
   * Cartoon double horn ("Bip-Bip !")
   */
  playHonk(pitchMultiplier = 1.0) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const pitch = Math.max(0.7, Math.min(1.5, Number(pitchMultiplier) || 1.0));
    const baseFreqs = [440 * pitch, 554.37 * pitch]; // A4 + C#5 major third horn

    [0, 0.13].forEach((offset, pulseIdx) => {
      const start = now + offset;
      const dur = pulseIdx === 0 ? 0.095 : 0.16;

      baseFreqs.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = i === 0 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(freq * 0.96, start);
        osc.frequency.exponentialRampToValueAtTime(freq * (pulseIdx === 1 ? 1.04 : 1.0), start + dur);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1100 * pitch, start);
        filter.Q.setValueAtTime(2.5, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.compressor);

        osc.start(start);
        osc.stop(start + dur + 0.01);
      });
    });
  }

  /**
   * Countdown beep for 3, 2, 1 and energetic chord for GO!
   */
  playCountdownBeep(final = false) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;

    if (!final) {
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      sub.frequency.setValueAtTime(220, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      sub.connect(gain);
      gain.connect(this.compressor);

      osc.start(now);
      sub.start(now);
      osc.stop(now + 0.3);
      sub.stop(now + 0.3);
    } else {
      // Energetic high chord for GO!
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = i % 2 === 0 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(freq * 0.98, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.04);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        osc.connect(gain);
        gain.connect(this.compressor);
        osc.start(now);
        osc.stop(now + 0.67);
      });
    }
  }

  /**
   * Rising synthetic whoosh (filtered white noise + sawtooth upward glide) for Nitro & Drift Mini-Boost
   */
  playNitro(intensity = 1.0) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const dur = 0.55 * Math.max(0.65, Math.min(1.2, intensity));

    // 1. Filtered noise jet whoosh
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(dur + 0.1);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + dur * 0.7);
    filter.frequency.exponentialRampToValueAtTime(900, now + dur);
    filter.Q.setValueAtTime(1.8, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.32 * intensity, now + 0.05);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.compressor);
    noise.start(now);
    noise.stop(now + dur + 0.02);

    // 2. Sawtooth turbine pitch up
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + dur * 0.85);

    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.18 * intensity, now + 0.04);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(oscGain);
    oscGain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /**
   * Low impact thud + percussive metallic crunch on car collisions
   */
  playCollision(force = 1.0) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const power = Math.max(0.4, Math.min(1.3, force));

    // Low bass thud
    const osc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(135 * power, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);

    thudGain.gain.setValueAtTime(0.38 * power, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(thudGain);
    thudGain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.21);

    // Percussive crunch
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.15);
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(950, now);
    bandpass.Q.setValueAtTime(1.2, now);

    const crunchGain = this.ctx.createGain();
    crunchGain.gain.setValueAtTime(0.26 * power, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(bandpass);
    bandpass.connect(crunchGain);
    crunchGain.connect(this.compressor);
    noise.start(now);
    noise.stop(now + 0.15);
  }

  /**
   * Crystalline mystery-box jingle when picking up a bonus item
   */
  playPickup() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 739.99, 880, 1174.66, 1479.98]; // D5, F#5, A5, D6, F#6
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + i * 0.042;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.24, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);

      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(start);
      osc.stop(start + 0.19);
    });
  }

  /**
   * Comical descending wobbling siren when a car slips on oil / banana
   */
  playSpinout() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const dur = 0.75;

    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const mainGain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(860, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + dur);

    // Vibrato wobble
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(16, now);
    lfoGain.gain.setValueAtTime(75, now);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    mainGain.gain.setValueAtTime(0.001, now);
    mainGain.gain.linearRampToValueAtTime(0.25, now + 0.03);
    mainGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(mainGain);
    mainGain.connect(this.compressor);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.02);
    lfo.stop(now + dur + 0.02);
  }

  /**
   * Dramatic falling whistle descending into deep abyss / splash when falling into void
   */
  playFall() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const dur = 0.8;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(820, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + dur);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(this.compressor);

    osc.start(now);
    osc.stop(now + dur + 0.02);

    // Deep impact thud at bottom of chasm
    setTimeout(() => {
      if (!this._canPlay()) return;
      const t = this.ctx.currentTime;
      const thud = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(95, t);
      thud.frequency.exponentialRampToValueAtTime(28, t + 0.24);
      thudGain.gain.setValueAtTime(0.28, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      thud.connect(thudGain);
      thudGain.connect(this.compressor);
      thud.start(t);
      thud.stop(t + 0.25);
    }, 550);
  }

  /**
   * Explosive bass wave + electric resonance for Shockwave item
   */
  playShockwave() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const dur = 0.65;

    // 1. Sub bass drop
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(180, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + dur);

    subGain.gain.setValueAtTime(0.45, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    sub.connect(subGain);
    subGain.connect(this.compressor);
    sub.start(now);
    sub.stop(now + dur + 0.02);

    // 2. Electric zapping resonance
    const zap = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const zapGain = this.ctx.createGain();

    zap.type = 'sawtooth';
    zap.frequency.setValueAtTime(920, now);
    zap.frequency.exponentialRampToValueAtTime(140, now + 0.45);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.45);
    filter.Q.setValueAtTime(6, now);

    zapGain.gain.setValueAtTime(0.3, now);
    zapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    zap.connect(filter);
    filter.connect(zapGain);
    zapGain.connect(this.compressor);
    zap.start(now);
    zap.stop(now + 0.5);
  }

  /**
   * Short upbeat lap validation jingle
   */
  playLap() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 880, 1174.66]; // D5, A5, D6
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + idx * 0.065;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.26, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);

      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }

  /**
   * Triumphant major chord fanfare at race finish
   */
  playVictory() {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    const sequence = [
      { freqs: [523.25, 659.25, 783.99], time: 0.0, dur: 0.14 },
      { freqs: [523.25, 659.25, 783.99], time: 0.16, dur: 0.14 },
      { freqs: [523.25, 659.25, 783.99], time: 0.32, dur: 0.14 },
      { freqs: [659.25, 830.61, 987.77], time: 0.48, dur: 0.26 },
      { freqs: [587.33, 739.99, 880.0], time: 0.76, dur: 0.24 },
      { freqs: [523.25, 659.25, 783.99, 1046.5], time: 1.02, dur: 0.85 },
    ];

    sequence.forEach(({ freqs, time, dur }) => {
      const start = now + time;
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(f, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(this.compressor);
        osc.start(start);
        osc.stop(start + dur + 0.03);
      });
    });
  }

  /**
   * Starts subtle continuous engine purr during the race
   */
  startEngine() {
    if (!this.unlock() || !this.ctx || this.engineRunning) return;
    const now = this.ctx.currentTime;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2.type = 'triangle';
    this.engineOsc1.frequency.setValueAtTime(55, now);
    this.engineOsc2.frequency.setValueAtTime(110, now);

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(220, now);
    this.engineFilter.Q.setValueAtTime(2.0, now);

    this.engineGain.gain.setValueAtTime(0.001, now);
    this.engineGain.gain.linearRampToValueAtTime(0.055, now + 0.3);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.compressor);

    this.engineOsc1.start(now);
    this.engineOsc2.start(now);
    this.engineRunning = true;
  }

  /**
   * Modulates engine frequency and filter cutoff by average car speed (0..1+)
   */
  updateEngine(speedRatio = 0.5) {
    if (!this.engineRunning || !this.ctx) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1.5, speedRatio));
    const baseFreq = 52 + clamped * 68;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(190 + clamped * 360, now, 0.08);
    this.engineGain.gain.setTargetAtTime(0.035 + Math.min(0.055, clamped * 0.04), now, 0.1);
  }

  /**
   * Stops continuous engine sound
   */
  stopEngine() {
    if (!this.engineRunning || !this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      setTimeout(() => {
        try {
          if (this.engineOsc1) this.engineOsc1.stop();
          if (this.engineOsc2) this.engineOsc2.stop();
          if (this.engineOsc1) this.engineOsc1.disconnect();
          if (this.engineOsc2) this.engineOsc2.disconnect();
        } catch (_) {}
        this.engineOsc1 = null;
        this.engineOsc2 = null;
        this.engineRunning = false;
      }, 220);
    } catch (_) {
      this.engineRunning = false;
    }
  }
}

export const soundEngine = new SoundEngine();
export default SoundEngine;
