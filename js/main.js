/* NEON OUTBREAK - bootstrap: single rAF loop, global keys, test harness */
(function () {
  'use strict';

  const NO = window.NO = window.NO || {};
  const U = NO.Utils;

  const MAX_DELTA = 1 / 20; // cap at 50ms so tab-switches never teleport the world
  let game = null;
  let ui = null;
  let lastTime = 0;
  let accumulator = 0;
  let loopHandle = 0;
  let started = false;
  let pausedByVisibility = false;

  function boot() {
    if (started) return;
    started = true;

    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
      console.error('[NEON OUTBREAK] canvas #game-canvas missing');
      return;
    }

    NO.Storage.load();
    NO.Input.init();

    game = new NO.Game(canvas);
    ui = new NO.UI(game);
    game.attachUI(ui);
    NO.game = game;
    NO.ui = ui;

    const cfg = NO.Storage.getAll();
    NO.GameAudio.init();
    NO.GameAudio.setEnabled(cfg.soundOn !== false);
    NO.GameAudio.setVolume(typeof cfg.volume === 'number' ? cfg.volume : 0.7);

    bindKeys();
    bindVisibility();
    bindFirstInteraction();
    installTestHarness();

    lastTime = performance.now();
    loopHandle = window.requestAnimationFrame(loop);
    document.body.classList.add('is-ready');
    if (ui.syncSettings) ui.syncSettings();
    if (ui.updateAudioButton) ui.updateAudioButton();
    if (ui.refreshMenu) ui.refreshMenu();
  }

  function bindKeys() {
    window.addEventListener('keydown', function (event) {
      if (event.repeat) {
        if (isGameKey(event.code)) event.preventDefault();
        return;
      }
      const state = game.state;

      if (event.code === 'KeyM') {
        if (!isTyping(event.target)) {
          event.preventDefault();
          ui.toggleSound();
        }
        return;
      }

      if (event.code === 'Escape') {
        event.preventDefault();
        if (state === 'PLAYING') game.pause();
        else if (state === 'PAUSED') game.resume();
        else if (state === 'SETTINGS') ui.closeSettings();
        else if (state === 'LEVEL_UP') {
          // Cannot skip the choice: surface a nudge instead of silently ignoring.
          ui.showToast('必须选择一项强化模块', 'danger');
        }
        return;
      }

      if (state === 'MENU') {
        if (event.code === 'Enter' && !isTyping(event.target)) {
          event.preventDefault();
          game.start();
        }
        return;
      }

      if (state === 'LEVEL_UP') {
        if (event.code === 'Digit1' || event.code === 'Numpad1') { event.preventDefault(); ui.chooseIndex(0); }
        else if (event.code === 'Digit2' || event.code === 'Numpad2') { event.preventDefault(); ui.chooseIndex(1); }
        else if (event.code === 'Digit3' || event.code === 'Numpad3') { event.preventDefault(); ui.chooseIndex(2); }
        return;
      }

      if (state === 'GAME_OVER' || state === 'VICTORY') {
        if (event.code === 'Enter' && !isTyping(event.target)) {
          event.preventDefault();
          game.start();
        }
        return;
      }

      if (state === 'BOSS_INTRO') {
        if (event.code === 'Enter' || event.code === 'Space') {
          event.preventDefault();
          game.skipBossIntro();
        }
        return;
      }

      if (isGameKey(event.code)) event.preventDefault();
    }, { passive: false });
  }

  function isGameKey(code) {
    return code === 'Space' || code === 'KeyW' || code === 'KeyA' || code === 'KeyS' ||
      code === 'KeyD' || code === 'ArrowUp' || code === 'ArrowDown' ||
      code === 'ArrowLeft' || code === 'ArrowRight';
  }

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function bindVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (game.state === 'PLAYING') {
          pausedByVisibility = true;
          game.pause();
        }
      } else {
        lastTime = performance.now();
        NO.GameAudio.unlock();
        if (pausedByVisibility) {
          pausedByVisibility = false;
        }
      }
    });
    window.addEventListener('blur', function () {
      if (game.state === 'PLAYING') {
        pausedByVisibility = true;
        game.pause();
      }
    });
  }

  function bindFirstInteraction() {
    const unlock = function () {
      NO.GameAudio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  /* ---------------- main loop ---------------- */

  function loop(now) {
    loopHandle = window.requestAnimationFrame(loop);
    if (!game) return;

    let delta = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(delta) || delta < 0) delta = 0;
    if (delta > MAX_DELTA) delta = MAX_DELTA;

    // Fixed-ish stepping keeps physics stable on high refresh displays.
    accumulator += delta;
    const step = 1 / 120;
    let guard = 0;
    while (accumulator >= step && guard < 8) {
      game.update(step);
      accumulator -= step;
      guard += 1;
    }
    if (guard >= 8) accumulator = 0;

    game.render();
    NO.Input.endFrame();
  }

  /* ---------------- optional deterministic test harness ---------------- */

  function installTestHarness() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('test')) return;
    NO.test = {
      game: game,
      ui: ui,
      start: function () { game.start(); return game.state; },
      skipIntro: function () { game.skipBossIntro(); return game.state; },
      advance: function (seconds, dt) {
        const delta = dt || 1 / 60;
        const frames = Math.max(1, Math.round(seconds / delta));
        for (let i = 0; i < frames; i += 1) game.update(delta);
        return { state: game.state, elapsed: game.elapsed, enemies: game.enemies.length, hp: game.player ? game.player.hp : 0 };
      },
      chooseOption: function (index) {
        if (game.state !== 'LEVEL_UP') return 'not-levelup';
        ui.chooseIndex(index);
        return 'chosen';
      },
      forceBoss: function (final) {
        game.spawnBoss(Boolean(final));
        game.finishBossIntro();
        return game.boss ? game.boss.name : null;
      },
      damageBoss: function (amount) {
        if (!game.boss) return 0;
        const before = game.boss.hp;
        game.boss.damage(amount, 0, {});
        return before - game.boss.hp;
      },
      spawn: function (kind) {
        const e = game.spawnEnemyAt(kind, game.player.x + 120, game.player.y);
        return e ? e.kind : null;
      },
      state: function () {
        return {
          state: game.state,
          elapsed: Number(game.elapsed.toFixed(2)),
          hp: game.player ? Number(game.player.hp.toFixed(2)) : 0,
          maxHp: game.player ? game.player.maxHp : 0,
          level: game.player ? game.player.level : 0,
          xp: game.xp,
          xpNeeded: game.xpNeeded,
          kills: game.kills,
          score: game.score,
          enemies: game.enemies.length,
          bullets: game.bullets.length,
          enemyBullets: game.enemyBullets.length,
          orbs: game.orbs.length,
          boss: game.boss ? { name: game.boss.name, hp: game.boss.hp, maxHp: game.boss.maxHp, phase: game.boss.phase } : null,
          firstBossSpawned: game.firstBossSpawned,
          finalBossSpawned: game.finalBossSpawned
        };
      }
    };
    document.body.classList.add('test-mode');
    console.info('[NEON OUTBREAK] test harness active:', 'NO.test');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
