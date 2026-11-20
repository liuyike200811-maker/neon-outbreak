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
    endlessHighScore: 0,
    endlessBestTime: 0,
    endlessBestWave: 0,
    soundOn: true,
    volume: 0.7,
    shake: true,
    difficulty: 1,
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
      endlessHighScore: Math.floor(numberIn(raw.endlessHighScore, 0, 0, 999999999)),
      endlessBestTime: numberIn(raw.endlessBestTime, 0, 0, 864000),
      endlessBestWave: Math.floor(numberIn(raw.endlessBestWave, 0, 0, 9999)),
      soundOn: raw.soundOn !== false,
      volume: numberIn(raw.volume, 0.7, 0, 1),
      shake: raw.shake !== false,
      difficulty: Math.round(numberIn(raw.difficulty, 1, 1, 6)),
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
    const endless = run.mode === 'endless';
    const wave = Math.max(0, Math.floor(Number(run.wave) || 0));

    // 无尽模式的成绩单独归档：它的时长与分数没有上界，混进标准任务的纪录里
    // 会让「六分钟通达」的历史最高分永久不可超越。
    const previousBest = endless ? data.endlessHighScore : data.highScore;
    const newRecord = score > previousBest;
    if (endless) {
      data.endlessHighScore = Math.max(previousBest, score);
      data.endlessBestTime = Math.max(data.endlessBestTime, time);
      data.endlessBestWave = Math.max(data.endlessBestWave, wave);
    } else {
      data.highScore = Math.max(previousBest, score);
      data.longestTime = Math.max(data.longestTime, time);
    }
    data.totalKills += kills;
    data.gamesPlayed += 1;
    save();
    return {
      newRecord,
      previousBest,
      highScore: endless ? data.endlessHighScore : data.highScore,
      longestTime: endless ? data.endlessBestTime : data.longestTime,
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
