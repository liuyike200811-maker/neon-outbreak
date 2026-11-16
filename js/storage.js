/* NEON OUTBREAK - persistent records and preferences */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const KEY = 'neonOutbreakSave.v1';

  const defaults = Object.freeze({
    highScore: 0,
    longestTime: 0,
    totalKills: 0,
    gamesPlayed: 0,
    soundOn: true,
    volume: 0.7,
    shake: true,
    tutorialSeen: false
  });

  let data = Object.assign({}, defaults);
  let available = true;
  let storage = null;

  function numberIn(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return Object.assign({}, defaults);
    return {
      highScore: Math.floor(numberIn(raw.highScore, 0, 0, 999999999)),
      longestTime: numberIn(raw.longestTime, 0, 0, 86400),
      totalKills: Math.floor(numberIn(raw.totalKills, 0, 0, 999999999)),
      gamesPlayed: Math.floor(numberIn(raw.gamesPlayed, 0, 0, 999999)),
      soundOn: raw.soundOn !== false,
      volume: numberIn(raw.volume, 0.7, 0, 1),
      shake: raw.shake !== false,
      tutorialSeen: raw.tutorialSeen === true
    };
  }

  function detectStorage() {
    try {
      const testKey = '__neon_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      storage = window.localStorage;
      available = true;
    } catch (error) {
      storage = null;
      available = false;
    }
  }

  function load() {
    detectStorage();
    if (!storage) {
      data = Object.assign({}, defaults);
      return data;
    }
    try {
      const encoded = storage.getItem(KEY);
      if (encoded) {
        data = sanitize(JSON.parse(encoded));
      } else {
        data = Object.assign({}, defaults);
      }
    } catch (error) {
      data = Object.assign({}, defaults);
      available = false;
    }
    return data;
  }

  function save() {
    if (!available || !storage) return false;
    try {
      storage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      available = false;
      storage = null;
      return false;
    }
  }

  function set(key, value) {
    if (!(key in defaults)) return false;
    data[key] = sanitize(Object.assign({}, data, { [key]: value }))[key];
    save();
    return data[key];
  }

  function recordRun(run) {
    const score = Math.max(0, Math.floor(Number(run.score) || 0));
    const time = Math.max(0, Number(run.time) || 0);
    const kills = Math.max(0, Math.floor(Number(run.kills) || 0));
    const previousBest = data.highScore;
    const newRecord = score > previousBest;
    data.highScore = Math.max(previousBest, score);
    data.longestTime = Math.max(data.longestTime, time);
    data.totalKills += kills;
    data.gamesPlayed += 1;
    save();
    return {
      newRecord,
      previousBest,
      highScore: data.highScore,
      longestTime: data.longestTime,
      totalKills: data.totalKills,
      gamesPlayed: data.gamesPlayed
    };
  }

  function reset() {
    data = Object.assign({}, defaults);
    save();
  }

  NO.Storage = {
    load,
    save,
    get: function (key) { return data[key]; },
    getAll: function () { return Object.assign({}, data); },
    set,
    recordRun,
    reset,
    isAvailable: function () { return available; },
    defaults
  };
})();
