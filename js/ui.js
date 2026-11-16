/* NEON OUTBREAK - DOM interface: HUD, menus, cards, settings, results */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;

  const GRADE_TEXT = {
    S: '传说级作战 · LEGENDARY',
    A: '精英战力 · ELITE',
    B: '合格特工 · QUALIFIED',
    C: '见习生还 · ROOKIE',
    D: '防线溃败 · COLLAPSED'
  };

  function pad(value, length) {
    return String(value).padStart(length, '0');
  }

  class UI {
    constructor(game) {
      this.game = game;
      this.el = Object.create(null);
      this.hudCache = Object.create(null);
      this.moduleSignature = '';
      this.toastTimer = 0;
      this.comboTimer = 0;
      this.hintTimer = 0;
      this.volumeSaveTimer = 0;
      this.choosing = false;
      this.settingsReturn = 'menu';

      const ids = [
        'screen-menu', 'screen-hud', 'screen-pause', 'screen-levelup', 'screen-result',
        'screen-settings', 'screen-instructions', 'screen-boss-intro',
        'menu-high-score', 'menu-longest', 'menu-total-kills', 'menu-audio-glyph', 'menu-audio-label',
        'btn-menu-sound',
        'hp-fill', 'hp-text', 'level-text', 'armor-readout', 'timer', 'stage-label',
        'kill-count', 'score-value', 'btn-pause', 'boss-panel', 'boss-name', 'boss-phase',
        'boss-fill', 'boss-percent', 'xp-fill', 'xp-text', 'dash-fill', 'dash-state',
        'module-strip', 'tutorial-hint', 'combo-callout', 'toast', 'touch-dash-label',
        'btn-touch-dash', 'pause-level', 'pause-kills', 'pause-time', 'upgrade-cards',
        'upgrade-level-label', 'result-kicker', 'result-title', 'result-sub', 'result-grade',
        'result-grade-text', 'res-time', 'res-kills', 'res-level', 'res-score', 'res-best',
        'result-newrecord', 'toggle-sound', 'volume-slider', 'volume-value', 'toggle-shake',
        'storage-status', 'fx-flash', 'boss-intro-name', 'boss-intro-sub', 'boss-intro-phase'
      ];
      for (let i = 0; i < ids.length; i += 1) {
        this.el[ids[i]] = document.getElementById(ids[i]);
      }
      this.bind();
      this.syncSettings();
      this.refreshMenu();
    }

    /* ---------------- screen helpers ---------------- */

    activate(id, on) {
      const node = this.el[id] || document.getElementById(id);
      if (node) node.classList.toggle('is-active', on !== false);
    }

    hide(id) {
      this.activate(id, false);
    }

    show(id) {
      this.activate(id, true);
    }

    /* ---------------- wiring ---------------- */

    bind() {
      const self = this;
      const g = this.game;

      function onClick(id, handler) {
        const node = document.getElementById(id);
        if (!node) return;
        node.addEventListener('click', function (event) {
          event.preventDefault();
          handler(event);
        });
      }

      onClick('btn-start', function () { g.start(); });
      onClick('btn-instructions', function () { self.showInstructions(); });
      onClick('btn-instructions-close', function () { self.hide('screen-instructions'); });
      onClick('btn-settings', function () { self.openSettings('menu'); });
      onClick('btn-settings-close', function () { self.closeSettings(); });
      onClick('btn-menu-sound', function () { self.toggleSound(); });
      onClick('btn-pause', function () { g.pause(); });
      onClick('btn-resume', function () { g.resume(); });
      onClick('btn-pause-settings', function () { self.openSettings('pause'); });
      onClick('btn-pause-restart', function () { g.start(); });
      onClick('btn-pause-menu', function () { g.backToMenu(); });
      onClick('btn-result-restart', function () { g.start(); });
      onClick('btn-result-menu', function () { g.backToMenu(); });

      const bossIntro = document.getElementById('screen-boss-intro');
      if (bossIntro) {
        bossIntro.addEventListener('click', function () { g.skipBossIntro(); });
      }

      const cards = document.getElementById('upgrade-cards');
      if (cards) {
        cards.addEventListener('click', function (event) {
          const card = event.target.closest('.upgrade-card');
          if (!card) return;
          const index = Number(card.getAttribute('data-index'));
          if (!Number.isNaN(index)) self.chooseIndex(index);
        });
      }

      const soundToggle = document.getElementById('toggle-sound');
      if (soundToggle) {
        soundToggle.addEventListener('change', function () {
          const enabled = soundToggle.checked;
          NO.GameAudio.setEnabled(enabled);
          NO.Storage.set('soundOn', enabled);
          self.updateAudioButton();
          NO.GameAudio.play('click');
        });
      }

      const shakeToggle = document.getElementById('toggle-shake');
      if (shakeToggle) {
        shakeToggle.addEventListener('change', function () {
          NO.Storage.set('shake', shakeToggle.checked);
          NO.GameAudio.play('click');
        });
      }

      const slider = document.getElementById('volume-slider');
      if (slider) {
        const apply = function (save) {
          const value = U.clamp(Number(slider.value) / 100, 0, 1);
          NO.GameAudio.setVolume(value);
          if (self.el['volume-value']) self.el['volume-value'].textContent = Math.round(value * 100) + '%';
          if (save) NO.Storage.set('volume', value);
        };
        slider.addEventListener('input', function () { apply(false); });
        slider.addEventListener('change', function () { apply(true); });
        slider.addEventListener('input', function () {
          clearTimeout(self.volumeSaveTimer);
          self.volumeSaveTimer = setTimeout(function () {
            NO.Storage.set('volume', U.clamp(Number(slider.value) / 100, 0, 1));
          }, 180);
        });
      }

      // Soft click for every button, then unlock audio on first interaction.
      document.addEventListener('click', function (event) {
        const button = event.target.closest('button');
        if (!button) return;
        NO.GameAudio.unlock();
        if (button.classList.contains('upgrade-card') || button.id === 'btn-menu-sound') return;
        NO.GameAudio.play('click');
      }, { passive: true });

      // Keep audio alive when the tab returns in a suspended state.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) NO.GameAudio.unlock();
      });
    }

    /* ---------------- menu / HUD visibility ---------------- */

    showMenu() {
      this.activate('screen-menu', true);
      this.activate('screen-hud', false);
      this.hide('screen-pause');
      this.hide('screen-levelup');
      this.hide('screen-result');
      this.hide('screen-settings');
      this.hide('screen-instructions');
      this.hide('screen-boss-intro');
      this.hideBossBar();
      this.refreshMenu();
    }

    showHud() {
      this.activate('screen-menu', false);
      this.activate('screen-hud', true);
      this.hide('screen-pause');
      this.hide('screen-levelup');
      this.hide('screen-result');
      this.hide('screen-settings');
      this.hide('screen-instructions');
      this.hide('screen-boss-intro');
      this.setTutorial(false);
      this.setCombo('');
    }

    showPause() {
      const p = this.game.player;
      if (this.el['pause-level']) this.el['pause-level'].textContent = p ? p.level : 1;
      if (this.el['pause-kills']) this.el['pause-kills'].textContent = this.game.kills;
      if (this.el['pause-time']) this.el['pause-time'].textContent = U.formatTime(this.game.elapsed);
      this.activate('screen-pause', true);
      NO.GameAudio.play('click');
    }

    hidePause() {
      this.activate('screen-pause', false);
    }

    showLevelUp(choices, level) {
      this.choosing = false;
      if (this.el['upgrade-level-label']) {
        this.el['upgrade-level-label'].textContent = 'LEVEL ' + pad(level, 2);
      }
      const container = this.el['upgrade-cards'];
      if (!container) return;
      const player = this.game.player;
      let html = '';
      for (let i = 0; i < choices.length; i += 1) {
        const def = choices[i];
        const levelNow = NO.Upgrades.getLevel(player, def.id);
        const rarity = NO.Upgrades.rarity[def.rarity] || NO.Upgrades.rarity.common;
        const maxLabel = def.maxLevel > 20 ? '∞' : def.maxLevel;
        const pips = Math.min(5, def.maxLevel);
        let pipHtml = '';
        for (let p = 0; p < pips; p += 1) {
          pipHtml += '<i class="' + (p <= levelNow ? 'on' : '') + '"></i>';
        }
        html +=
          '<button type="button" class="upgrade-card rarity-' + def.rarity + '" data-index="' + i + '">' +
          '<div class="upgrade-card-top">' +
          '<span class="upgrade-icon">' + NO.Upgrades.iconMarkup(def.id) + '</span>' +
          '<span class="rarity-badge">' + rarity.label + ' · ' + def.rarity.toUpperCase() + '</span>' +
          '</div>' +
          '<h3>' + def.name + '</h3>' +
          '<p class="upgrade-en">' + def.en + '</p>' +
          '<p class="upgrade-desc">' + def.desc(player) + '</p>' +
          '<div class="upgrade-levels">' +
          '<div class="level-pips">' + pipHtml + '</div>' +
          '<div class="upgrade-level-text"><span>MODULE LEVEL</span><strong>' + levelNow + ' / ' + maxLabel + '</strong></div>' +
          '</div>' +
          '<div class="install-cue"><span>INSTALL MODULE</span><span>▸</span></div>' +
          '</button>';
      }
      container.innerHTML = html;
      this.activate('screen-levelup', true);
    }

    hideLevelUp() {
      this.activate('screen-levelup', false);
      const container = this.el['upgrade-cards'];
      if (container) container.innerHTML = '';
    }

    chooseIndex(index) {
      if (this.choosing || this.game.state !== 'LEVEL_UP') return;
      this.choosing = true;
      const container = this.el['upgrade-cards'];
      const card = container ? container.querySelector('[data-index="' + index + '"]') : null;
      if (card) card.classList.add('selected');
      const self = this;
      window.setTimeout(function () {
        self.game.chooseUpgrade(index);
        self.choosing = false;
      }, 130);
    }

    /* ---------------- boss presentation ---------------- */

    showBossIntro(boss) {
      if (!boss) return;
      if (this.el['boss-intro-name']) this.el['boss-intro-name'].textContent = boss.name;
      if (this.el['boss-intro-sub']) this.el['boss-intro-sub'].textContent = boss.subtitle;
      if (this.el['boss-intro-phase']) {
        this.el['boss-intro-phase'].textContent = boss.isFinal
          ? 'FINAL PROTOCOL // ALL SYSTEMS LOST'
          : 'THE JUDGEMENT HAS BEGUN';
      }
      this.activate('screen-boss-intro', true);
    }

    hideBossIntro() {
      this.activate('screen-boss-intro', false);
    }

    showBossBar(boss) {
      const panel = this.el['boss-panel'];
      if (!panel) return;
      panel.classList.remove('hidden');
      if (boss) {
        if (this.el['boss-name']) this.el['boss-name'].textContent = boss.name;
        if (this.el['boss-phase']) this.el['boss-phase'].textContent = 'PHASE ' + boss.phase;
      }
    }

    hideBossBar() {
      const panel = this.el['boss-panel'];
      if (panel) panel.classList.add('hidden');
    }

    /* ---------------- feedback ---------------- */

    flash() {
      const node = this.el['fx-flash'];
      if (!node) return;
      node.classList.remove('active');
      void node.offsetWidth;
      node.classList.add('active');
    }

    showToast(text, tone) {
      const node = this.el['toast'];
      if (!node) return;
      node.textContent = text;
      node.className = 'toast show' + (tone === 'danger' ? ' toast-danger' : tone === 'gold' ? ' toast-gold' : '');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () {
        node.className = 'toast';
      }, 2400);
    }

    showCombo(text, big) {
      const node = this.el['combo-callout'];
      if (!node) return;
      node.textContent = text;
      node.classList.remove('show', 'combo-big');
      void node.offsetWidth;
      node.classList.add('show');
      if (big) node.classList.add('combo-big');
      clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(function () {
        node.classList.remove('show', 'combo-big');
        node.textContent = '';
      }, 1500);
    }

    setCombo(text) {
      const node = this.el['combo-callout'];
      if (node) {
        node.textContent = text || '';
        node.classList.remove('show', 'combo-big');
      }
    }

    setTutorial(show) {
      const node = this.el['tutorial-hint'];
      if (!node) return;
      clearTimeout(this.hintTimer);
      if (!show) {
        node.classList.add('hidden');
        node.classList.remove('fading');
        return;
      }
      node.classList.remove('hidden', 'fading');
      this.hintTimer = setTimeout(function () {
        node.classList.add('fading');
        this.hintTimer = setTimeout(function () { node.classList.add('hidden'); }, 700);
      }.bind(this), 9000);
    }

    /* ---------------- settings ---------------- */

    syncSettings() {
      const s = NO.Storage.getAll();
      const sound = document.getElementById('toggle-sound');
      const shake = document.getElementById('toggle-shake');
      const slider = document.getElementById('volume-slider');
      if (sound) sound.checked = s.soundOn !== false;
      if (shake) shake.checked = s.shake !== false;
      if (slider) slider.value = String(Math.round((s.volume === undefined ? 0.7 : s.volume) * 100));
      if (this.el['volume-value']) this.el['volume-value'].textContent = Math.round((s.volume === undefined ? 0.7 : s.volume) * 100) + '%';
      const status = this.el['storage-status'];
      if (status) {
        status.textContent = NO.Storage.isAvailable()
          ? '设置与纪录已保存在本机浏览器（' + s.gamesPlayed + ' 次作战记录）。'
          : '浏览器已禁用本地存储：游戏可正常进行，但纪录不会保留。';
      }
      this.updateAudioButton();
    }

    updateAudioButton() {
      const enabled = NO.GameAudio.enabled && NO.Storage.get('soundOn') !== false;
      if (this.el['menu-audio-glyph']) this.el['menu-audio-glyph'].textContent = enabled ? '◖' : '◗';
      if (this.el['menu-audio-label']) this.el['menu-audio-label'].textContent = enabled ? 'AUDIO ON' : 'MUTED';
      if (this.el['btn-menu-sound']) this.el['btn-menu-sound'].classList.toggle('is-muted', !enabled);
    }

    toggleSound() {
      const enabled = !(NO.GameAudio.enabled && NO.Storage.get('soundOn') !== false);
      NO.GameAudio.setEnabled(enabled);
      NO.Storage.set('soundOn', enabled);
      const toggle = document.getElementById('toggle-sound');
      if (toggle) toggle.checked = enabled;
      this.updateAudioButton();
      if (enabled) NO.GameAudio.play('click');
      this.showToast(enabled ? '音频系统在线' : '音频系统静默', enabled ? 'gold' : 'danger');
    }

    openSettings(origin) {
      this.settingsReturn = origin || 'menu';
      this.syncSettings();
      this.activate('screen-settings', true);
      NO.GameAudio.play('click');
    }

    closeSettings() {
      this.activate('screen-settings', false);
      this.syncSettings();
      NO.GameAudio.play('click');
    }

    showInstructions() {
      this.activate('screen-instructions', true);
      NO.GameAudio.play('click');
    }

    /* ---------------- records ---------------- */

    refreshMenu() {
      const s = NO.Storage.getAll();
      if (this.el['menu-high-score']) this.el['menu-high-score'].textContent = U.formatScore(s.highScore || 0);
      if (this.el['menu-longest']) this.el['menu-longest'].textContent = U.formatTime(s.longestTime);
      if (this.el['menu-total-kills']) this.el['menu-total-kills'].textContent = U.formatScore(s.totalKills);
      this.updateAudioButton();
    }

    /* ---------------- results ---------------- */

    showResult(result) {
      this.hideLevelUp();
      this.hidePause();
      this.hideBossBar();
      this.activate('screen-boss-intro', false);
      const screen = document.getElementById('screen-result');
      if (screen) screen.classList.toggle('victory', Boolean(result.victory));

      if (this.el['result-kicker']) this.el['result-kicker'].textContent = result.victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
      if (this.el['result-title']) this.el['result-title'].textContent = result.victory ? '撤离成功' : '防线失守';
      if (this.el['result-sub']) {
        this.el['result-sub'].textContent = result.victory
          ? 'OMEGA 核心已被摧毁。NEON-07 的夜空第一次安静下来。'
          : '连接中断。NEON-07 被机械潮彻底吞没。';
      }
      if (this.el['result-grade']) this.el['result-grade'].textContent = result.grade;
      if (this.el['result-grade-text']) this.el['result-grade-text'].textContent = GRADE_TEXT[result.grade] || '战术评级';
      if (this.el['res-time']) this.el['res-time'].textContent = U.formatTime(result.time);
      if (this.el['res-kills']) this.el['res-kills'].textContent = U.formatScore(result.kills);
      if (this.el['res-level']) this.el['res-level'].textContent = 'LV ' + result.level;
      if (this.el['res-score']) this.el['res-score'].textContent = U.formatScore(result.score);
      if (this.el['res-best']) this.el['res-best'].textContent = U.formatScore(result.best);
      if (this.el['result-newrecord']) this.el['result-newrecord'].classList.toggle('hidden', !result.newRecord);

      this.activate('screen-hud', false);
      this.activate('screen-result', true);
    }

    /* ---------------- HUD ---------------- */

    updateHud() {
      const g = this.game;
      const p = g.player;
      if (!p || !this.el['hp-fill']) return;
      const cache = this.hudCache;

      const hpPercent = Math.round((p.hp / p.maxHp) * 1000) / 10;
      if (cache.hp !== hpPercent) {
        cache.hp = hpPercent;
        this.el['hp-fill'].style.width = hpPercent + '%';
      }
      const hpText = Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
      if (cache.hpText !== hpText && this.el['hp-text']) {
        cache.hpText = hpText;
        this.el['hp-text'].textContent = hpText;
      }
      const levelText = 'LV.' + pad(p.level || 1, 2);
      if (cache.level !== levelText && this.el['level-text']) {
        cache.level = levelText;
        this.el['level-text'].textContent = levelText;
      }
      const armor = p.maxHp > 100 ? 'ARMOR +' + Math.round(p.maxHp - 100) : 'ONLINE';
      if (cache.armor !== armor && this.el['armor-readout']) {
        cache.armor = armor;
        this.el['armor-readout'].textContent = armor;
      }
      const timer = U.formatTime(g.elapsed);
      if (cache.timer !== timer && this.el['timer']) {
        cache.timer = timer;
        this.el['timer'].textContent = timer;
      }
      const stage = g.getStageInfo();
      if (cache.stage !== stage.label && this.el['stage-label']) {
        cache.stage = stage.label;
        this.el['stage-label'].textContent = stage.label;
      }
      const kills = pad(Math.min(9999, g.kills), 3);
      if (cache.kills !== kills && this.el['kill-count']) {
        cache.kills = kills;
        this.el['kill-count'].textContent = kills;
      }
      const score = pad(Math.min(9999999, Math.floor(g.score)), 6);
      if (cache.score !== score && this.el['score-value']) {
        cache.score = score;
        this.el['score-value'].textContent = score;
      }
      const xpPercent = Math.round(U.clamp(g.xp / g.xpNeeded, 0, 1) * 1000) / 10;
      if (cache.xp !== xpPercent && this.el['xp-fill']) {
        cache.xp = xpPercent;
        this.el['xp-fill'].style.width = xpPercent + '%';
      }
      const xpText = Math.floor(g.xp) + ' / ' + g.xpNeeded;
      if (cache.xpText !== xpText && this.el['xp-text']) {
        cache.xpText = xpText;
        this.el['xp-text'].textContent = xpText;
      }

      const dashReady = p.dashCooldownTimer <= 0;
      const dashPercent = dashReady ? 100 : Math.round((1 - p.dashCooldownTimer / p.dashCooldown) * 100);
      if (cache.dash !== dashPercent && this.el['dash-fill']) {
        cache.dash = dashPercent;
        this.el['dash-fill'].style.width = dashPercent + '%';
        this.el['dash-fill'].style.opacity = dashReady ? '1' : '0.55';
      }
      const dashState = dashReady ? 'READY' : p.dashCooldownTimer.toFixed(1) + 's';
      if (cache.dashState !== dashState && this.el['dash-state']) {
        cache.dashState = dashState;
        this.el['dash-state'].textContent = dashState;
      }
      if (this.el['touch-dash-label'] && cache.dashState !== undefined && this.el['touch-dash-label'].textContent !== dashState) {
        this.el['touch-dash-label'].textContent = dashReady ? 'READY' : Math.ceil(p.dashCooldownTimer) + 's';
      }
      const dashButton = this.el['btn-touch-dash'];
      if (dashButton) dashButton.classList.toggle('cooling', !dashReady);

      this.updateModules();
      this.updateBossBar();
    }

    updateModules() {
      const player = this.game.player;
      const strip = this.el['module-strip'];
      if (!strip || !player) return;
      const levels = player.upgradeLevels || {};
      const ids = Object.keys(levels).filter(function (id) { return levels[id] > 0; });
      ids.sort();
      let signature = '';
      for (let i = 0; i < ids.length; i += 1) signature += ids[i] + levels[ids[i]] + '|';
      if (signature === this.moduleSignature) return;
      this.moduleSignature = signature;
      if (ids.length === 0) {
        strip.innerHTML = '<span class="module-chip module-empty">NO MODULES</span>';
        return;
      }
      let html = '';
      const limit = Math.min(ids.length, 6);
      for (let i = 0; i < limit; i += 1) {
        const def = NO.Upgrades.get(ids[i]);
        const level = levels[ids[i]];
        if (!def) continue;
        html += '<span class="module-chip module-' + def.rarity + '" title="' + def.name + ' LV' + level + '">' +
          NO.Upgrades.iconMarkup(def.id) +
          '<span class="module-lv">' + level + '</span></span>';
      }
      if (ids.length > limit) html += '<span class="module-chip module-empty">+' + (ids.length - limit) + '</span>';
      strip.innerHTML = html;
    }

    updateBossBar() {
      const boss = this.game.boss;
      if (!boss || boss.dead) {
        const panel = this.el['boss-panel'];
        if (panel && !panel.classList.contains('hidden')) this.hideBossBar();
        return;
      }
      const panel = this.el['boss-panel'];
      if (panel && panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (this.el['boss-name']) this.el['boss-name'].textContent = boss.name;
      }
      const percent = Math.max(0, Math.round(boss.hpRatio * 1000) / 10);
      const cache = this.hudCache;
      if (cache.bossPercent !== percent && this.el['boss-fill']) {
        cache.bossPercent = percent;
        this.el['boss-fill'].style.width = percent + '%';
        if (this.el['boss-percent']) this.el['boss-percent'].textContent = percent + '%';
      }
      if (cache.bossPhase !== boss.phase && this.el['boss-phase']) {
        cache.bossPhase = boss.phase;
        this.el['boss-phase'].textContent = 'PHASE ' + boss.phase;
      }
    }

    resetHudCache() {
      this.hudCache = Object.create(null);
      this.moduleSignature = '';
      const fill = this.el['hp-fill'];
      if (fill) fill.style.width = '100%';
    }
  }

  NO.UI = UI;
})();
