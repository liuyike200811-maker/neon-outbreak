/* NEON OUTBREAK - procedural Web Audio sound design */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});

  const Sound = {
    ctx: null,
    master: null,
    compressor: null,
    noiseBuffer: null,
    enabled: true,
    volume: 0.7,
    ready: false,
    failed: false,
    activeSources: 0,
    lastPlayed: Object.create(null),

    init: function () {
      if (this.ctx || this.failed) return this.ready;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return false;
      }
      try {
        this.ctx = new Ctor();
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 22;
        this.compressor.ratio.value = 9;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.22;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume * 0.48 : 0;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise();
        this.ready = true;
        return true;
      } catch (error) {
        this.failed = true;
        this.ready = false;
        return false;
      }
    },

    makeNoise: function () {
      const length = Math.floor(this.ctx.sampleRate * 0.55);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        channel[i] = last;
      }
      return buffer;
    },

    unlock: function () {
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        const promise = this.ctx.resume();
        if (promise && promise.catch) promise.catch(function () {});
      }
    },

    applyVolume: function () {
      if (!this.master || !this.ctx) return;
      const target = this.enabled ? this.volume * 0.48 : 0;
      try {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.025);
      } catch (error) {
        this.master.gain.value = target;
      }
    },

    setEnabled: function (on) {
      this.enabled = Boolean(on);
      this.applyVolume();
      if (this.enabled) this.unlock();
    },

    setVolume: function (value) {
      this.volume = Math.max(0, Math.min(1, Number(value) || 0));
      this.applyVolume();
    },

    _throttle: function (name, ms) {
      const now = this.ctx ? this.ctx.currentTime * 1000 : 0;
      const last = this.lastPlayed[name] || 0;
      if (now - last < ms) return false;
      this.lastPlayed[name] = now;
      return true;
    },

    _canPlay: function (name, minGap) {
      if (!this.enabled) return false;
      if (!this.ctx) {
        this.init();
        if (!this.ctx) return false;
        this.unlock();
      }
      if (this.ctx.state !== 'running') {
        this.unlock();
      }
      if (this.activeSources > 34) return false;
      if (minGap && !this._throttle(name, minGap)) return false;
      return true;
    },

    tone: function (options) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime + (options.delay || 0);
      const attack = options.attack || 0.005;
      const release = options.release || 0.04;
      const duration = options.duration || 0.12;
      const frequency = Math.max(20, options.frequency || 440);
      const targetFrequency = Math.max(20, options.target || frequency);
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = options.type || 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      if (options.target && options.target !== frequency) {
        oscillator.frequency.exponentialRampToValueAtTime(targetFrequency, now + duration);
      }
      const peak = Math.max(0.0001, options.gain === undefined ? 0.12 : options.gain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, duration + release));
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + release + 0.03);
      this.activeSources += 1;
      const self = this;
      oscillator.onended = function () {
        self.activeSources = Math.max(0, self.activeSources - 1);
        try {
          oscillator.disconnect();
          gain.disconnect();
        } catch (error) { /* already disconnected */ }
      };
    },

    noise: function (options) {
      if (!this.ctx || !this.noiseBuffer) return;
      const ctx = this.ctx;
      const now = ctx.currentTime + (options.delay || 0);
      const duration = options.duration || 0.2;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = options.rate || 1;
      const filter = ctx.createBiquadFilter();
      filter.type = options.filterType || 'bandpass';
      filter.frequency.setValueAtTime(options.frequency || 900, now);
      if (options.target) filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.target), now + duration);
      filter.Q.value = options.q === undefined ? 1.1 : options.q;
      const gain = ctx.createGain();
      const peak = Math.max(0.0001, options.gain === undefined ? 0.1 : options.gain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(now);
      source.stop(now + duration + 0.02);
      this.activeSources += 1;
      const self = this;
      source.onended = function () {
        self.activeSources = Math.max(0, self.activeSources - 1);
        try {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch (error) { /* already disconnected */ }
      };
    },

    play: function (name) {
      if (!this.enabled) return;
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.unlock();
      const gaps = {
        shoot: 42, hit: 30, pickup: 32, kill: 34, click: 25, enemyShoot: 45, explode: 45
      };
      if (gaps[name] && !this._throttle(name, gaps[name])) return;
      if (this.activeSources > 40) return;

      try {
        switch (name) {
          case 'click':
            this.tone({ frequency: 760, target: 1180, duration: 0.045, type: 'triangle', gain: 0.08 });
            this.tone({ frequency: 380, duration: 0.03, type: 'square', gain: 0.025 });
            break;
          case 'shoot':
            this.tone({ frequency: 940, target: 260, duration: 0.075, type: 'sawtooth', gain: 0.055 });
            this.tone({ frequency: 1760, target: 1120, duration: 0.04, type: 'square', gain: 0.022 });
            break;
          case 'hit':
            this.tone({ frequency: 280, target: 110, duration: 0.045, type: 'square', gain: 0.055 });
            this.noise({ duration: 0.035, frequency: 1700, target: 700, gain: 0.032 });
            break;
          case 'crit':
            this.tone({ frequency: 1460, target: 840, duration: 0.08, type: 'triangle', gain: 0.065 });
            this.tone({ frequency: 620, target: 330, duration: 0.06, type: 'square', gain: 0.03 });
            break;
          case 'kill':
            this.tone({ frequency: 240, target: 68, duration: 0.14, type: 'sawtooth', gain: 0.075 });
            this.noise({ duration: 0.13, frequency: 1100, target: 220, gain: 0.065, filterType: 'lowpass' });
            break;
          case 'explode':
            this.tone({ frequency: 120, target: 32, duration: 0.38, type: 'sawtooth', gain: 0.16 });
            this.noise({ duration: 0.42, frequency: 700, target: 95, gain: 0.18, filterType: 'lowpass', q: 0.7 });
            break;
          case 'hurt':
            this.tone({ frequency: 145, target: 42, duration: 0.26, type: 'sawtooth', gain: 0.16 });
            this.noise({ duration: 0.22, frequency: 440, target: 110, gain: 0.12, filterType: 'lowpass' });
            break;
          case 'pickup':
            this.tone({ frequency: 980, target: 1540, duration: 0.07, type: 'sine', gain: 0.06 });
            this.tone({ frequency: 1960, target: 2380, duration: 0.04, type: 'triangle', gain: 0.018 });
            break;
          case 'levelup':
            this.tone({ frequency: 523.25, duration: 0.16, type: 'triangle', gain: 0.1, delay: 0 });
            this.tone({ frequency: 659.25, duration: 0.16, type: 'triangle', gain: 0.1, delay: 0.075 });
            this.tone({ frequency: 783.99, duration: 0.18, type: 'triangle', gain: 0.1, delay: 0.15 });
            this.tone({ frequency: 1046.5, duration: 0.32, type: 'sine', gain: 0.12, delay: 0.235 });
            this.noise({ duration: 0.38, frequency: 4000, target: 1400, gain: 0.03, filterType: 'highpass' });
            break;
          case 'dash':
            this.noise({ duration: 0.17, frequency: 1300, target: 340, gain: 0.1, q: 1.7 });
            this.tone({ frequency: 180, target: 780, duration: 0.14, type: 'sawtooth', gain: 0.055 });
            break;
          case 'enemyShoot':
            this.tone({ frequency: 360, target: 150, duration: 0.1, type: 'sawtooth', gain: 0.045 });
            break;
          case 'boss':
            this.tone({ frequency: 58, target: 34, duration: 0.9, type: 'sawtooth', gain: 0.2 });
            this.tone({ frequency: 82, target: 52, duration: 0.75, type: 'square', gain: 0.08, delay: 0.07 });
            this.noise({ duration: 0.9, frequency: 240, target: 70, gain: 0.14, filterType: 'lowpass' });
            break;
          case 'warning':
            this.tone({ frequency: 880, duration: 0.08, type: 'square', gain: 0.06 });
            this.tone({ frequency: 660, duration: 0.08, type: 'square', gain: 0.06, delay: 0.13 });
            break;
          case 'gameover':
            this.tone({ frequency: 320, target: 300, duration: 0.3, type: 'sawtooth', gain: 0.1, delay: 0 });
            this.tone({ frequency: 247, target: 225, duration: 0.3, type: 'sawtooth', gain: 0.1, delay: 0.2 });
            this.tone({ frequency: 196, target: 172, duration: 0.34, type: 'sawtooth', gain: 0.1, delay: 0.4 });
            this.tone({ frequency: 123, target: 48, duration: 0.9, type: 'triangle', gain: 0.16, delay: 0.62 });
            break;
          case 'victory':
            this.tone({ frequency: 392, duration: 0.22, type: 'triangle', gain: 0.11, delay: 0 });
            this.tone({ frequency: 523.25, duration: 0.22, type: 'triangle', gain: 0.11, delay: 0.13 });
            this.tone({ frequency: 659.25, duration: 0.24, type: 'triangle', gain: 0.11, delay: 0.26 });
            this.tone({ frequency: 783.99, duration: 0.28, type: 'triangle', gain: 0.12, delay: 0.39 });
            this.tone({ frequency: 1046.5, duration: 0.9, type: 'sine', gain: 0.13, delay: 0.56 });
            this.tone({ frequency: 261.63, duration: 1.3, type: 'sine', gain: 0.08, delay: 0.55 });
            break;
          default:
            break;
        }
      } catch (error) {
        /* Audio must never interrupt gameplay. */
      }
    }
  };

  document.addEventListener('pointerdown', function () { Sound.unlock(); }, { passive: true });
  document.addEventListener('keydown', function () { Sound.unlock(); }, { passive: true });
  document.addEventListener('touchstart', function () { Sound.unlock(); }, { passive: true });

  NO.GameAudio = Sound;
})();
