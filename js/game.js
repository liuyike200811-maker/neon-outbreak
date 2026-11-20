/* NEON OUTBREAK - core simulation, rendering, director and run state machine */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;
  const TAU = Math.PI * 2;

  const STATE = Object.freeze({
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    LEVEL_UP: 'LEVEL_UP',
    BOSS_INTRO: 'BOSS_INTRO',
    GAME_OVER: 'GAME_OVER',
    VICTORY: 'VICTORY',
    SETTINGS: 'SETTINGS'
  });

  const RUN_DURATION = 360;
  const BOSS_ONE_TIME = 180;
  const BOSS_TWO_TIME = 360;

  const MODE = Object.freeze({ STANDARD: 'standard', ENDLESS: 'endless' });

  /* ------------------------------------------------------------------
     难度档位：默认 1 档。玩家初始能力完全不变，只有敌人与刷怪节奏变凶。
     spawn  = 刷怪频率倍率（越大越密）
     hp     = 敌人生命倍率
     speed  = 敌人移动倍率
     contact= 接触伤害倍率
     cap    = 场上敌人数上限倍率
     score  = 得分倍率（难度越高，分数含金量越高）
     ------------------------------------------------------------------ */
  const DIFFICULTY = Object.freeze([
    { id: 1, name: '新兵', en: 'RECRUIT', spawn: 1.0, hp: 1.0, speed: 1.0, contact: 1.0, cap: 1.0, score: 1.0 },
    { id: 2, name: '标准', en: 'STANDARD', spawn: 1.22, hp: 1.14, speed: 1.04, contact: 1.08, cap: 1.08, score: 1.15 },
    { id: 3, name: '老兵', en: 'VETERAN', spawn: 1.48, hp: 1.32, speed: 1.08, contact: 1.18, cap: 1.18, score: 1.35 },
    { id: 4, name: '精英', en: 'ELITE', spawn: 1.78, hp: 1.54, speed: 1.12, contact: 1.30, cap: 1.28, score: 1.6 },
    { id: 5, name: '噩梦', en: 'NIGHTMARE', spawn: 2.12, hp: 1.82, speed: 1.17, contact: 1.45, cap: 1.4, score: 1.9 },
    { id: 6, name: '地狱', en: 'INFERNO', spawn: 2.5, hp: 2.15, speed: 1.22, contact: 1.62, cap: 1.55, score: 2.3 }
  ]);

  function difficultyAt(level) {
    const index = Math.max(0, Math.min(DIFFICULTY.length - 1, Math.round(level || 1) - 1));
    return DIFFICULTY[index];
  }

  /* ------------------------------------------------------------------
     Player projectile - real travel, arcade collision, pierce support
     ------------------------------------------------------------------ */
  class Bullet {
    constructor(game, config) {
      this.game = game;
      this.x = config.x;
      this.y = config.y;
      this.angle = config.angle;
      const speed = config.speed === undefined ? 700 : config.speed;
      this.vx = Math.cos(config.angle) * speed;
      this.vy = Math.sin(config.angle) * speed;
      this.radius = 4.2;
      this.damage = config.damage;
      this.crit = Boolean(config.crit);
      this.pierce = config.pierce || 0;
      this.frostChance = config.frostChance || 0;
      this.homing = config.homing || 0;
      this.ricochet = config.ricochet || 0;
      this.executeBonus = config.executeBonus || 0;
      this.color = config.color || '#9dfbff';
      this.life = 1.35;
      this.dead = false;
      this.hitIds = null;
      this.trailTimer = 0;
      this.target = null;
      this.retargetTimer = 0;
    }

    update(dt) {
      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
        return;
      }
      // 追踪弹道：轻微修正航向，不改变速度大小，所以不会因此「瞬移」。
      if (this.homing > 0) {
        this.retargetTimer -= dt;
        if (this.retargetTimer <= 0 || !this.target || !this.target.alive || this.target.dead) {
          this.retargetTimer = 0.16;
          this.target = this.game.getNearestTarget(this.x, this.y, 460);
        }
        const target = this.target;
        if (target && target.alive && !target.dead) {
          const desired = Math.atan2(target.y - this.y, target.x - this.x);
          const diff = U.shortestAngle(this.angle, desired);
          const maxStep = this.homing * dt * 0.9;
          this.angle += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
          const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
          this.vx = Math.cos(this.angle) * speed;
          this.vy = Math.sin(this.angle) * speed;
        }
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.022;
        this.game.particles.emit({
          x: this.x,
          y: this.y,
          vx: -this.vx * 0.035 + U.rand(-14, 14),
          vy: -this.vy * 0.035 + U.rand(-14, 14),
          color: this.color,
          life: 0.24,
          size: this.crit ? 3.4 : 2.6,
          endSize: 0,
          type: 'glow'
        });
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.ellipse(-6, 0, 9, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(1, 0, 5.4, 1.9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, this.crit ? 6.4 : 5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    hit(enemy) {
      if (!this.hitIds) this.hitIds = [];
      if (this.hitIds.indexOf(enemy) !== -1) return false;
      this.hitIds.push(enemy);
      return true;
    }
  }

  /* ------------------------------------------------------------------
     Experience crystal - random scatter, magnet pull, collect feedback
     ------------------------------------------------------------------ */
  class XPOrb {
    constructor(x, y, value, color, heal) {
      const angle = Math.random() * TAU;
      const speed = U.rand(40, 130);
      this.x = x;
      this.y = y;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.value = value;
      this.heal = heal || 0;
      this.color = color || '#5cffb2';
      this.radius = 4.5;
      this.life = 40;
      this.rotation = Math.random() * TAU;
      this.dead = false;
      this.birth = 0;
      this.magnet = false;
    }

    update(dt, player) {
      this.birth += dt;
      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
        return;
      }
      this.rotation += dt * 2.6;
      const damping = Math.max(0, 1 - 4.2 * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= damping;
      this.vy *= damping;

      if (player && player.hp > 0) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const magnetRange = player.pickupRange + (this.magnet ? 60 : 0);
        if (distance < magnetRange) {
          this.magnet = true;
          const pull = 320 + (magnetRange - distance) * 5.4;
          this.vx += (dx / distance) * pull * dt;
          this.vy += (dy / distance) * pull * dt;
        } else if (distance < 620) {
          // 远场弱吸引：掉落点常在射程边缘，没有这层牵引的话大量经验会永久遗落。
          const drift = 26 + (620 - distance) * 0.12;
          this.vx += (dx / distance) * drift * dt;
          this.vy += (dy / distance) * drift * dt;
        }
      }
    }

    draw(ctx) {
      const pulse = 0.62 + Math.sin(this.birth * 7 + this.rotation) * 0.24;
      const scale = Math.min(1, this.birth * 6);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(this.rotation);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.3 * pulse;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = this.color;
      if (this.heal > 0) {
        // 维修包：十字形轮廓，和菱形经验晶体一眼可分。
        const s = this.radius * 1.15;
        ctx.fillRect(-s, -this.radius * 0.5, s * 2, this.radius);
        ctx.fillRect(-this.radius * 0.5, -s, this.radius, s * 2);
        ctx.restore();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(0, -this.radius * 1.7);
      ctx.lineTo(this.radius, 0);
      ctx.lineTo(0, this.radius * 1.7);
      ctx.lineTo(-this.radius, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -this.radius * 0.8);
      ctx.lineTo(this.radius * 0.5, 0);
      ctx.lineTo(0, this.radius * 0.8);
      ctx.lineTo(-this.radius * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------
     Game
     ------------------------------------------------------------------ */
  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.ui = null;
      this.audio = NO.GameAudio;
      this.particles = new NO.Particles(520, 44);
      this.state = STATE.MENU;

      this.viewW = 1280;
      this.viewH = 720;
      this.dpr = 1;
      this.isMobile = U.isTouchDevice();
      this.maxEnemies = this.isMobile ? 70 : 110;
      this.maxBullets = this.isMobile ? 110 : 200;
      this.maxEnemyBullets = this.isMobile ? 150 : 260;

      this.player = null;
      this.enemies = [];
      this.bullets = [];
      this.enemyBullets = [];
      this.orbs = [];
      this.boss = null;

      this.elapsed = 0;
      this.timerFrozen = false;
      this.score = 0;
      this.kills = 0;
      this.xp = 0;
      this.xpNeeded = 12;
      this.pendingLevelUps = 0;
      this.levelChoices = null;
      this.pendingLevelDelay = 0;
      this.perfectDodgeCount = 0;
      this.rerollsLeft = 3;

      // 模式：标准任务是 6 分钟定点剧本，无尽模式越过 360 秒后继续加压，
      // BOSS 按周期重生并逐轮变强，直到玩家阵亡。
      this.mode = MODE.STANDARD;
      this.endlessCycle = 0;
      this.nextBossAt = 0;
      this.omegaUnlocked = false;
      this.difficulty = 1;
      this.difficultyProfile = difficultyAt(1);

      this.camera = { x: 0, y: 0 };
      this.shakeMagnitude = 0;
      this.shakeTime = 0;
      this.shakeX = 0;
      this.shakeY = 0;

      this.spawnTimer = 1.4;
      this.survivalTick = 0;
      this.comboCount = 0;
      this.comboTimer = 0;
      this.introTimer = 0;
      this.firstBossSpawned = false;
      this.finalBossSpawned = false;
      this.bossDefeated = false;

      this.decorSeed = 0;
      this.gradient = null;
      this.runActive = false;
      this.lastStageLabel = '';

      this.handleResize();
      this.bindWindow();
    }

    attachUI(ui) {
      this.ui = ui;
      this.ui.showMenu();
    }

    /* ---------------- layout ---------------- */

    bindWindow() {
      const self = this;
      window.addEventListener('resize', function () { self.handleResize(); });
      window.addEventListener('orientationchange', function () {
        window.setTimeout(function () { self.handleResize(); }, 120);
      });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { self.handleResize(); }).catch(function () {});
      }
    }

    handleResize() {
      const w = window.innerWidth || document.documentElement.clientWidth || 1280;
      const h = window.innerHeight || document.documentElement.clientHeight || 720;
      const rawDpr = window.devicePixelRatio || 1;
      const dpr = Math.min(rawDpr, this.isMobile ? 2 : 2);
      this.viewW = w;
      this.viewH = h;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.isMobile = U.isTouchDevice();
      this.maxEnemies = this.isMobile ? 92 : 160;
      this.gradient = null;
    }

    spawnRadius() {
      return Math.max(this.viewW, this.viewH) * 0.5 + 140;
    }

    /* ---------------- run lifecycle ---------------- */

    start(mode, difficulty) {
      // 未显式传入时从存档读：这样「重新开始」也会沿用玩家在设置里选的档位。
      const level = typeof difficulty === 'number' && isFinite(difficulty)
        ? difficulty
        : (NO.Storage ? NO.Storage.get('difficulty') : 1);
      this.difficulty = Math.max(1, Math.min(DIFFICULTY.length, Math.round(level || 1)));
      this.resetRun();
      this.mode = mode === MODE.ENDLESS ? MODE.ENDLESS : MODE.STANDARD;
      this.state = STATE.PLAYING;
      this.runActive = true;
      if (this.ui) {
        this.ui.showHud();
        this.ui.resetHudCache();
        this.ui.showBossBar(null);
        this.ui.hideBossBar();
        const seen = NO.Storage.get('tutorialSeen');
        this.ui.setTutorial(!seen);
        if (!seen) NO.Storage.set('tutorialSeen', true);
        this.ui.updateHud();
      }
      NO.Input.clearKeys();
      NO.Input.clearPressed();
      NO.Input.resetJoystick();
      this.audio.play('click');
    }

    resetRun() {
      this.enemies.length = 0;
      this.bullets.length = 0;
      this.enemyBullets.length = 0;
      this.orbs.length = 0;
      this.particles.clear();
      this.boss = null;

      this.elapsed = 0;
      this.timerFrozen = false;
      this.score = 0;
      this.kills = 0;
      this.xp = 0;
      this.xpNeeded = this.xpForLevel(1);
      this.pendingLevelUps = 0;
      this.levelChoices = null;
      this.pendingLevelDelay = 0;
      this.perfectDodgeCount = 0;
      // 重抽：每局 3 次。够用，但不至于让「三选一」变成「随便换到满意为止」。
      this.rerollsLeft = 3;
      this.comboCount = 0;
      this.comboTimer = 0;
      this.spawnTimer = 1.3;
      this.survivalTick = 0;
      this.introTimer = 0;
      this.firstBossSpawned = false;
      this.finalBossSpawned = false;
      this.bossDefeated = false;
      this.shakeMagnitude = 0;
      this.shakeTime = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.lastStageLabel = '';
      this.mode = MODE.STANDARD;
      this.endlessCycle = 0;
      this.nextBossAt = 0;
      this.omegaUnlocked = false;
      this.overclockCount = 0;
      this.difficultyProfile = difficultyAt(this.difficulty);

      this.player = new NO.Player(this, 0, 0);
      this.player.level = 1;
      this.camera.x = 0;
      this.camera.y = 0;
    }

    pause() {
      if (this.state !== STATE.PLAYING) return;
      this.state = STATE.PAUSED;
      NO.Input.clearKeys();
      NO.Input.resetJoystick();
      if (this.ui) this.ui.showPause();
    }

    resume() {
      if (this.state !== STATE.PAUSED) return;
      this.state = STATE.PLAYING;
      if (this.ui) this.ui.hidePause();
      NO.Input.clearPressed();
    }

    backToMenu() {
      const leftLevelUp = this.state === STATE.LEVEL_UP;
      this.state = STATE.MENU;
      this.runActive = false;
      this.boss = null;
      this.enemies.length = 0;
      this.bullets.length = 0;
      this.enemyBullets.length = 0;
      this.orbs.length = 0;
      this.particles.clear();
      this.player = null;
      if (leftLevelUp && this.ui) this.ui.hideLevelUp();
      if (this.ui) {
        this.ui.hidePause();
        this.ui.hideBossBar();
        this.ui.hide('screen-result');
        this.ui.hide('screen-settings');
        this.ui.showMenu();
      }
      NO.Input.clearKeys();
      NO.Input.clearPressed();
      NO.Input.resetJoystick();
    }

    togglePause() {
      if (this.state === STATE.PLAYING) this.pause();
      else if (this.state === STATE.PAUSED) this.resume();
    }

    /* ---------------- scoring / xp ---------------- */

    addScore(amount) {
      const profile = this.difficultyProfile || difficultyAt(1);
      this.score += Math.max(0, amount) * profile.score;
    }

    // 完美闪避的奖励：立刻升一级（不走经验条，直接进升级队列）。
    // 不在这里开面板：战斗正激烈，突然弹三张卡会打断玩家的走位节奏。
    // 升级面板会在下一次自然升级时一起结算（pendingLevelUps 累加）。
    onPerfectDodge() {
      if (!this.player || this.state !== STATE.PLAYING) return;
      this.perfectDodgeCount = (this.perfectDodgeCount || 0) + 1;
      this.player.level += 1;
      this.pendingLevelUps += 1;
      const chassis = 6;
      this.player.maxHp += chassis;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + chassis);
      this.xpNeeded = this.xpForLevel(this.player.level);
      this.addScore(400);
      this.particles.label(this.player.x, this.player.y - 58, 'LV ' + this.player.level, '#5cffb2', 15);
      if (this.ui) {
        this.ui.showToast('完美闪避 · 立即升级 LV ' + this.player.level, 'gold');
        this.ui.updateHud();
      }
      this.audio.play('levelup');
      // 升级面板稍后开：给玩家 0.35 秒看到闪避特效，再进入三选一。
      this.pendingLevelDelay = 0.35;
    }

    // 无尽模式的玩家成长：每击破一波 BOSS 叠一层超频。
    grantOverclock() {
      if (!this.player) return;
      this.overclockCount = (this.overclockCount || 0) + 1;
      const p = this.player;
      p.overclock = this.overclockCount;
      p.bonusDamageMult *= 1.12;
      p.bonusSpeedMult = Math.min(1.3, p.bonusSpeedMult * 1.03);
      p.bonusMaxHp += 10;
      p.maxHp += 10;
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.25));
      p.recalculateStats();
      this.particles.ring(p.x, p.y, '#ffd166', 22, 190, 0.8, 3.5);
      this.particles.burst(p.x, p.y, '#ffd166', 22, 200, 3, 0.7, 'spark');
      this.particles.label(p.x, p.y - 46, 'OVERCLOCK ×' + this.overclockCount, '#ffd166', 15);
      if (this.ui) this.ui.updateHud();
    }

    xpForLevel(level) {
      return Math.floor(10 + (level - 1) * 6.2 + Math.pow(level, 1.2) * 1.15);
    }

    gainXp(amount) {
      if (this.state !== STATE.PLAYING) return;
      const mult = this.player ? this.player.xpMult : 1;
      this.xp += amount * mult;
      while (this.xp >= this.xpNeeded) {
        this.xp -= this.xpNeeded;
        this.player.level += 1;
        this.xpNeeded = this.xpForLevel(this.player.level);
        this.pendingLevelUps += 1;
        // 每次升级同时强化装甲底盘：生命上限随等级自动成长，而不是完全依赖
        // 抽到「能量护甲」。否则一整局没抽到护甲卡时，十几级的角色仍然只有
        // 100 点血，被 BOSS 一发弹幕连击直接秒杀，成长感与容错都不成立。
        const chassis = 6;
        this.player.maxHp += chassis;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + chassis);
        // 每次升级都修复一小部分装甲：这是唯一的无条件续航来源，保证长局不会
        // 因为零星擦碰而慢性失血致死（升级本身也要玩家主动去捡晶体才拿得到）。
        const repair = Math.max(10, Math.round(this.player.maxHp * 0.12));
        this.player.heal(repair);
        this.particles.label(this.player.x, this.player.y - 34, 'LV ' + this.player.level, '#5cffb2', 14);
      }
      if (this.pendingLevelUps > 0) this.openLevelUp();
    }

    openLevelUp() {
      if (this.state !== STATE.PLAYING) return;
      this.state = STATE.LEVEL_UP;
      this.audio.play('levelup');
      this.particles.ring(this.player.x, this.player.y, '#5cffb2', 20, 150, 0.7, 3);
      this.particles.burst(this.player.x, this.player.y, '#5cffb2', 24, 220, 3.4, 0.7, 'spark');
      // 每 5 级给一次稀有保底，让升级有期待感而不是纯数值灌水。
      const guarantee = this.player.level % 5 === 0;
      const choices = NO.Upgrades.pickChoices(this.player, 3, guarantee);
      this.levelChoices = choices;
      if (this.ui) this.ui.showLevelUp(choices, this.player.level, this.rerollsLeft);
      NO.Input.clearKeys();
    }

    // 重抽当前三张卡（消耗一次机会）。
    rerollChoices() {
      if (this.state !== STATE.LEVEL_UP) return false;
      if (this.rerollsLeft <= 0) return false;
      this.rerollsLeft -= 1;
      const guarantee = this.player.level % 5 === 0;
      const choices = NO.Upgrades.pickChoices(this.player, 3, guarantee);
      this.levelChoices = choices;
      if (this.ui) this.ui.showLevelUp(choices, this.player.level, this.rerollsLeft);
      this.particles.ring(this.player.x, this.player.y, '#ffd166', 12, 90, 0.45, 2);
      this.audio.play('click');
      return true;
    }

    // 跳过：不要这三张卡，换 250 分 + 15 点生命。
    // 这是给「三张都不想要」的玩家一条出路，而不是逼他选一个垃圾模块。
    skipChoices() {
      if (this.state !== STATE.LEVEL_UP) return false;
      this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
      this.levelChoices = null;
      this.state = STATE.PLAYING;
      this.addScore(250);
      if (this.player) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
      }
      this.particles.ring(this.player.x, this.player.y, '#ffd166', 12, 80, 0.45, 2);
      this.particles.label(this.player.x, this.player.y - 30, '+250', '#ffd166', 13);
      if (this.ui) {
        this.ui.hideLevelUp();
        this.ui.updateHud();
        this.ui.resetHudCache();
        this.ui.updateHud();
      }
      this.audio.play('click');
      NO.Input.clearPressed();
      NO.Input.clearKeys();
      const self = this;
      if (this.pendingLevelUps > 0) {
        window.setTimeout(function () {
          if (self.state === STATE.PLAYING) self.openLevelUp();
        }, 260);
      }
      return true;
    }

    chooseUpgrade(index) {
      if (this.state !== STATE.LEVEL_UP) return;
      const def = this.levelChoices ? this.levelChoices[index] : null;
      if (!def) return;
      const levels = this.player.upgradeLevels;
      levels[def.id] = (levels[def.id] || 0) + 1;
      def.apply(this.player, this);
      this.player.recalculateStats();
      this.player.hp = Math.min(this.player.maxHp, this.player.hp);
      this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
      this.levelChoices = null;
      this.state = STATE.PLAYING;
      if (this.ui) {
        this.ui.hideLevelUp();
        this.ui.updateHud();
        this.ui.resetHudCache();
        this.ui.updateHud();
      }
      this.audio.play('levelup');
      this.particles.ring(this.player.x, this.player.y, '#00e5ff', 16, 120, 0.55, 2.5);
      NO.Input.clearPressed();
      NO.Input.clearKeys();
      const self = this;
      if (this.pendingLevelUps > 0) {
        window.setTimeout(function () {
          if (self.state === STATE.PLAYING) self.openLevelUp();
        }, 260);
      }
    }

    /* ---------------- world helpers ---------------- */

    spawnPlayerBullet(config) {
      if (this.state !== STATE.PLAYING) return;
      if (this.bullets.length >= this.maxBullets) this.bullets.shift();
      this.bullets.push(new Bullet(this, config));
    }

    spawnEnemyBullet(config) {
      if (this.state !== STATE.PLAYING) return;
      if (this.enemyBullets.length >= this.maxEnemyBullets) this.enemyBullets.shift();
      this.enemyBullets.push(new NO.EnemyBullet(this, config));
    }

    clearEnemyBullets() {
      this.enemyBullets.length = 0;
    }

    spawnEnemyAt(kind, x, y) {
      if (this.enemies.length >= this.maxEnemies) return null;
      const enemy = NO.createEnemy(kind, this, x, y);
      if (enemy) {
        this.scaleEnemy(enemy);
        this.enemies.push(enemy);
      }
      return enemy;
    }

    scaleEnemy(enemy) {
      const profile = this.difficultyProfile || difficultyAt(1);
      let minutes = this.elapsed / 60;
      if (this.mode === MODE.ENDLESS && minutes > 6) {
        // 无尽模式：六分钟之后仍继续变强，但走对数增长，避免十分钟时出现
        // 血条是屏幕宽度的敌人（那种数值失控只会让玩家放弃而不是更紧张）。
        minutes = 6 + Math.log2(1 + (minutes - 6)) * 1.6;
      } else {
        minutes = Math.min(6, minutes);
      }
      const hpScale = (1 + minutes * 0.16) * profile.hp;
      const speedScale = (1 + minutes * 0.035) * profile.speed;
      enemy.maxHp = Math.round(enemy.maxHp * hpScale);
      enemy.hp = enemy.maxHp;
      enemy.baseSpeed *= speedScale;
      enemy.speed = enemy.baseSpeed;
      enemy.xp = Math.round(enemy.xp * (1 + minutes * 0.05));
      // 接触伤害也吃难度系数，否则高难度只是「敌人更肉」而不是更危险。
      if (profile.contact !== 1 && typeof enemy.contactDamage === 'number') {
        enemy.contactDamage = Math.max(1, Math.round(enemy.contactDamage * profile.contact));
      }
    }

    getNearestTarget(x, y, range) {
      // 近距离的普通敌人始终优先清掉，避免 BOSS 战期间小怪无限堆积。
      let close = null;
      let closeDistance = 150 * 150;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead || enemy.spawnTimer > 0) continue;
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const distance = dx * dx + dy * dy;
        if (distance <= closeDistance) {
          closeDistance = distance;
          close = enemy;
        }
      }
      if (close) return close;

      // 否则 BOSS 战期间优先锁定 BOSS：小怪会抢走全部火力，导致 BOSS 永远打不死。
      if (this.boss && !this.boss.dead && this.boss.spawnTimer <= 0) {
        const bdx = this.boss.x - x;
        const bdy = this.boss.y - y;
        if (bdx * bdx + bdy * bdy <= range * range) return this.boss;
      }
      let best = null;
      let bestDistance = range * range;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead || enemy.spawnTimer > 0) continue;
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = enemy;
        }
      }
      if (this.boss && !this.boss.dead && this.boss.spawnTimer <= 0) {
        const dx = this.boss.x - x;
        const dy = this.boss.y - y;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = this.boss;
        }
      }
      return best;
    }

    triggerEMP(radius, damage) {
      let hitAny = false;
      this.particles.ring(this.player.x, this.player.y, '#00e5ff', 12, radius, 0.45, 3);
      this.particles.ring(this.player.x, this.player.y, '#965bff', 6, radius * 0.7, 0.35, 2);
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead) continue;
        const distance = U.distance(this.player.x, this.player.y, enemy.x, enemy.y);
        if (distance <= radius + enemy.radius) {
          hitAny = true;
          enemy.damage(damage, Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x), { knockback: 90 });
          this.particles.hit(enemy.x, enemy.y, 0, '#7de9ff', false);
        }
      }
      if (this.boss && !this.boss.dead) {
        const distance = U.distance(this.player.x, this.player.y, this.boss.x, this.boss.y);
        if (distance <= radius + this.boss.radius) {
          this.boss.damage(damage, Math.atan2(this.boss.y - this.player.y, this.boss.x - this.player.x), {});
          hitAny = true;
        }
      }
      if (hitAny) this.audio.play('hit');
      this.addScreenShake(2.4, 0.12);
    }

    // 跳弹：命中后改向最近的另一个敌人，返回是否找到了新的弹射目标。
    redirectBullet(bullet, from) {
      let best = null;
      let bestDistance = 300 * 300;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const other = this.enemies[i];
        if (!other.alive || other.dead || other === from || other.spawnTimer > 0) continue;
        const dx = other.x - bullet.x;
        const dy = other.y - bullet.y;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = other;
        }
      }
      if (!best && this.boss && !this.boss.dead && from !== this.boss) best = this.boss;
      if (!best) return false;
      const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
      bullet.angle = Math.atan2(best.y - bullet.y, best.x - bullet.x);
      bullet.vx = Math.cos(bullet.angle) * speed;
      bullet.vy = Math.sin(bullet.angle) * speed;
      this.particles.ring(bullet.x, bullet.y, '#c9a6ff', 4, 24, 0.24, 2);
      this.audio.play('ricochet');
      return true;
    }

    // 反制装甲的伤害反弹：按坐标找到来源单位，直接结算伤害。
    reflectDamage(sourceX, sourceY, amount) {
      const value = Math.max(1, Math.round(amount));
      let dealt = false;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead) continue;
        if (U.distance(enemy.x, enemy.y, sourceX, sourceY) > enemy.radius + 34) continue;
        enemy.damage(value, Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x), { knockback: 60 });
        this.particles.damageText(enemy.x, enemy.y - enemy.radius - 6, value, '#9dfbff', false, 0.9);
        dealt = true;
        break;
      }
      if (!dealt && this.boss && !this.boss.dead) {
        if (U.distance(this.boss.x, this.boss.y, sourceX, sourceY) <= this.boss.radius + 40) {
          this.boss.damage(value, Math.atan2(this.boss.y - this.player.y, this.boss.x - this.player.x), {});
          dealt = true;
        }
      }
      return dealt;
    }

    // 相位冲击：冲刺收尾的环形电磁爆。
    triggerDashBlast(radius, damage) {
      this.particles.ring(this.player.x, this.player.y, '#00e5ff', 10, radius, 0.34, 3.2);
      this.particles.ring(this.player.x, this.player.y, '#965bff', 5, radius * 0.65, 0.24, 2);
      let hit = false;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead) continue;
        if (U.distance(this.player.x, this.player.y, enemy.x, enemy.y) <= radius + enemy.radius) {
          enemy.damage(damage, Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x), { knockback: 120 });
          this.particles.hit(enemy.x, enemy.y, 0, '#9dfbff', false);
          hit = true;
        }
      }
      if (this.boss && !this.boss.dead) {
        if (U.distance(this.player.x, this.player.y, this.boss.x, this.boss.y) <= radius + this.boss.radius) {
          this.boss.damage(damage * 0.6, Math.atan2(this.boss.y - this.player.y, this.boss.x - this.player.x), {});
          hit = true;
        }
      }
      if (hit) {
        this.audio.play('explode');
        this.addScreenShake(2.6, 0.12);
      }
    }

    addScreenShake(magnitude, duration) {
      if (NO.Storage.get('shake') === false) return;
      this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude || 3);
      this.shakeTime = Math.max(this.shakeTime, duration || 0.16);
    }

    showToast(text, tone) {
      if (this.ui) this.ui.showToast(text, tone);
    }

    getStageInfo() {
      if (this.boss && !this.boss.dead) {
        return { label: this.boss.isFinal ? 'FINAL CORE // OMEGA' : 'BOSS // ' + this.boss.name.split(' ')[0] };
      }
      if (this.mode === MODE.ENDLESS && this.elapsed >= BOSS_TWO_TIME) {
        // 无尽模式没有「终局」可言，阶段标签改成波次，给玩家一个不断往上走的刻度。
        return { label: 'ENDLESS · WAVE ' + String(this.endlessCycle + 1).padStart(2, '0') };
      }
      if (this.elapsed < 60) return { label: 'PHASE 01 · 接触' };
      if (this.elapsed < 120) return { label: 'PHASE 02 · 压制' };
      if (this.elapsed < 180) return { label: 'PHASE 03 · 猎杀' };
      if (this.elapsed < 300) return { label: 'PHASE 04 · 高压' };
      if (this.elapsed < 360) return { label: 'PHASE 05 · 终局' };
      return { label: 'PHASE 06 · 核心' };
    }

    /* ---------------- events from entities ---------------- */

    onPlayerShoot() {
      this.audio.play('shoot');
    }

    onDash() {
      this.audio.play('dash');
      this.particles.ring(this.player.x, this.player.y, '#00e5ff', 14, 62, 0.3, 2);
      this.addScreenShake(1.8, 0.1);
    }

    onPlayerHurt(amount) {
      this.audio.play('hurt');
      if (this.ui) {
        this.ui.flash();
        this.ui.updateHud();
      }
      this.addScreenShake(7, 0.24);
      this.particles.ring(this.player.x, this.player.y, '#ff365e', 8, 48, 0.35, 2);
    }

    onPlayerDeath() {
      if (this.state === STATE.GAME_OVER || this.state === STATE.VICTORY) return;
      this.finishRun(false);
    }

    onEnemyKilled(enemy, options) {
      const opts = options || {};
      const credited = opts.byPlayer !== false;
      if (credited) {
        this.kills += 1;
        this.addScore(enemy.score);
        this.comboCount += 1;
        this.comboTimer = 2.4;
        if (this.comboCount === 2) this.showCombo('DOUBLE KILL');
        else if (this.comboCount === 3) this.showCombo('TRIPLE KILL', true);
        else if (this.comboCount >= 4 && this.comboCount % 2 === 0) this.showCombo('MEGA KILL', true);

        if (this.player && this.player.volatileLevel > 0 && Math.random() < this.player.volatileChance) {
          this.detonateVolatile(enemy);
        }
        // 能量汲取：击杀回血，让「清怪效率」本身变成续航手段。
        if (this.player && this.player.lifesteal > 0) {
          this.player.healQuiet(this.player.lifesteal);
        }
      }

      if (!opts.silentDeath) {
        const scale = enemy.isElite ? 1.9 : enemy.kind === 'tank' ? 1.35 : 1;
        this.particles.enemyDeath(enemy.x, enemy.y, enemy.color, scale);
        this.particles.ring(enemy.x, enemy.y, enemy.accent || enemy.color, 6, 60 * scale, 0.42, 2);
        this.playKillSound(enemy);
        if (enemy.isElite) this.addScreenShake(6, 0.24);
      }

      if (credited) {
        const orbColor = enemy.isElite ? '#b98bff' : '#5cffb2';
        this.orbs.push(new XPOrb(enemy.x, enemy.y, enemy.xp, orbColor));
        // 维修包：精英必掉，普通单位小概率掉落。后期生存压力大，必须给玩家可争取的回复来源。
        const healChance = enemy.isElite ? 1 : 0.08;
        if (Math.random() < healChance) {
          this.orbs.push(new XPOrb(enemy.x, enemy.y, 0, '#5cffb2', enemy.isElite ? 18 : 10));
        }
        this.addScore(Math.round(enemy.score * 0.15));
      }
    }

    // 击杀音效分层：不同机体用不同的基频与包络，连杀越高音调越高。
    // 全部走既有 Web Audio 引擎，不新增素材文件。
    playKillSound(enemy) {
      const combo = Math.min(6, Math.max(0, this.comboCount - 1));
      if (enemy.isElite) {
        this.audio.play('explode');
        this.audio.play('eliteKill', { detune: combo });
      } else if (enemy.kind === 'tank') {
        this.audio.play('explode');
        this.audio.play('killHeavy', { detune: combo });
      } else if (enemy.kind === 'bomber') {
        this.audio.play('killPop', { detune: combo });
      } else if (enemy.kind === 'sniper') {
        this.audio.play('killZap', { detune: combo });
      } else if (enemy.kind === 'drone') {
        this.audio.play('killLight', { detune: combo });
      } else {
        this.audio.play('kill');
      }
      // 连杀达到里程碑时再叠一层上扬的确认音，和屏幕上的 KILL 文案同步。
      if (this.comboCount === 5 || this.comboCount === 10) {
        this.audio.play('comboUp');
      }
    }

    detonateVolatile(enemy) {
      const radius = this.player.volatileRadius;
      const damage = this.player.volatileDamage;
      this.particles.ring(enemy.x, enemy.y, '#ffd166', 8, radius, 0.4, 3);
      this.particles.burst(enemy.x, enemy.y, '#ff9f43', 16, 220, 3, 0.5, 'spark');
      this.addScreenShake(3.2, 0.14);
      for (let i = 0; i < this.enemies.length; i += 1) {
        const other = this.enemies[i];
        if (!other.alive || other.dead || other === enemy) continue;
        if (U.distance(enemy.x, enemy.y, other.x, other.y) <= radius + other.radius) {
          other.damage(damage, Math.atan2(other.y - enemy.y, other.x - enemy.x), { knockback: 70 });
        }
      }
      if (this.boss && !this.boss.dead) {
        if (U.distance(enemy.x, enemy.y, this.boss.x, this.boss.y) <= radius + this.boss.radius) {
          this.boss.damage(damage * 0.6, Math.atan2(this.boss.y - enemy.y, this.boss.x - enemy.x), {});
        }
      }
    }

    onBomberExploded(bomber) {
      this.particles.burst(bomber.x, bomber.y, '#ff7b2d', 12, 200, 3, 0.5, 'spark');
      // Chain reaction against nearby machines.
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead || enemy === bomber) continue;
        if (U.distance(bomber.x, bomber.y, enemy.x, enemy.y) <= bomber.explosionRadius + enemy.radius) {
          enemy.damage(18, Math.atan2(enemy.y - bomber.y, enemy.x - bomber.x), { knockback: 80 });
        }
      }
    }

    showCombo(text, big) {
      if (this.ui) this.ui.showCombo(text, big);
    }

    /* ---------------- boss flow ---------------- */

    spawnBoss(isFinal, hpScale) {
      if (this.boss) return;
      const scale = typeof hpScale === 'number' && hpScale > 0 ? hpScale : 1;
      const boss = isFinal ? new NO.BossOmega(this) : new NO.BossJudge(this);
      boss.isFinal = Boolean(isFinal);
      if (scale !== 1) {
        // 无尽模式循环 BOSS：按轮次整体加厚，同时补一点接触伤害，
        // 否则后期只是一堵更肉的墙，威胁度没有实际提升。
        boss.maxHp = Math.round(boss.maxHp * scale);
        boss.hp = boss.maxHp;
        boss.contactDamage = Math.round(boss.contactDamage * Math.min(1.8, 1 + (scale - 1) * 0.5));
      }
      this.boss = boss;
      // 清场：BOSS 登场前遗留的杂兵会立刻把玩家淹没，只保留少量作为陪衬。
      const keep = 8;
      if (this.enemies.length > keep) {
        for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
          if (this.enemies.length <= keep) break;
          const enemy = this.enemies[i];
          this.particles.burst(enemy.x, enemy.y, enemy.color, 6, 120, 3, 0.5, 'spark');
          this.enemies.splice(i, 1);
        }
      }
      this.clearEnemyBullets();
      // BOSS 登场时投放补给：否则残血玩家只能眼睁睁看着下一阶段开始。
      // 这是真实的治疗，不是视觉演出。
      if (this.player) {
        const supply = Math.round(this.player.maxHp * 0.35);
        const before = this.player.hp;
        this.player.heal(supply);
        if (this.player.hp > before) {
          this.particles.label(this.player.x, this.player.y - 40, 'SUPPLY +' + Math.round(this.player.hp - before), '#5cffb2', 15);
          this.particles.ring(this.player.x, this.player.y, '#5cffb2', 14, 120, 0.6, 2.4);
        }
        if (this.ui) this.ui.updateHud();
      }
      this.state = STATE.BOSS_INTRO;
      this.introTimer = 2.5;
      this.audio.play('boss');
      this.addScreenShake(8, 0.5);
      this.particles.ring(boss.x, boss.y, boss.color, 40, 420, 1.1, 5);
      this.particles.bigExplosion(boss.x, boss.y, boss.accent, 1.4);
      if (this.ui) {
        this.ui.hideLevelUp();
        this.ui.showBossIntro(boss);
      }
      NO.Input.clearKeys();
    }

    finishBossIntro() {
      if (this.state !== STATE.BOSS_INTRO) return;
      this.introTimer = 0;
      this.state = STATE.PLAYING;
      if (this.ui) {
        this.ui.hideBossIntro();
        if (this.boss) this.ui.showBossBar(this.boss);
      }
      NO.Input.clearPressed();
    }

    skipBossIntro() {
      if (this.state !== STATE.BOSS_INTRO) return;
      this.finishBossIntro();
    }

    // 最终核心登场时，若旧 BOSS 仍存活，则被核心吞并清场（不给予击杀奖励，避免刷分）。
    retireBossForFinale(boss) {
      this.particles.bigExplosion(boss.x, boss.y, boss.color, 2.2);
      this.particles.ring(boss.x, boss.y, boss.accent, 30, 480, 0.9, 5);
      boss.dead = true;
      boss.hp = 0;
      this.boss = null;
      this.clearEnemyBullets();
      this.addScreenShake(14, 0.7);
      this.audio.play('explode');
      if (this.ui) {
        this.ui.hideBossBar();
        this.ui.showBossBar(null);
      }
      this.showToast('JUDGE-09 被核心吞并 · 终极协议启动', 'danger');
    }

    onBossDefeated(boss) {
      const isFinal = boss.isFinal;
      this.bossDefeated = true;
      this.audio.play('explode');
      this.audio.play('boss');
      this.particles.bigExplosion(boss.x, boss.y, boss.color, 2.6);
      this.particles.bigExplosion(boss.x, boss.y, '#ffffff', 1.8);
      this.particles.ring(boss.x, boss.y, boss.accent, 30, 620, 1.2, 6);
      this.addScreenShake(isFinal ? 22 : 16, 0.9);
      this.clearEnemyBullets();
      this.addScore(isFinal ? 15000 : 5000);
      this.boss = null;
      if (this.ui) {
        this.ui.hideBossBar();
        this.ui.showBossBar(null);
      }

      if (this.mode === MODE.ENDLESS) {
        // 无尽模式：击破 BOSS 只是清掉一波，接下来进入更长的间歇再刷新更强的一只。
        // 敌人走对数变强，玩家这边也要有对应的成长曲线，否则第九分钟必然无解：
        // 每波 BOSS 给一层「超频」，永久加伤害、移速与生命上限。
        this.endlessCycle += 1;
        this.nextBossAt = this.elapsed + Math.max(38, 62 - this.endlessCycle * 3);
        this.addScore(6000 + this.endlessCycle * 1500);
        this.grantOverclock();
        this.showToast('WAVE ' + (this.endlessCycle < 10 ? '0' : '') + this.endlessCycle + ' 肃清 · 超频叠至 ' + this.overclockCount + ' 层', 'gold');
        if (this.ui) this.ui.updateHud();
        this.state = STATE.PLAYING;
        return;
      }

      if (isFinal) {
        this.timerFrozen = true;
        this.finishRun(true);
        return;
      }

      if (this.player) this.player.heal(40);
      this.showToast('JUDGE-09 已销毁 · 系统降级', 'gold');
      if (this.ui) {
        this.ui.showToast('JUDGE-09 已销毁 · 系统降级', 'gold');
        this.ui.updateHud();
      }
      this.state = STATE.PLAYING;
    }

    /* ---------------- director ---------------- */

    spawnInterval() {
      const profile = this.difficultyProfile || difficultyAt(1);
      const t = Math.min(this.elapsed, 360) / 360;
      // 玩家的清怪速度约 30~80/分钟，生成速率必须留出操作空间，否则场面必然失控。
      // 默认档已经比旧版更密（2.2s → 1.05s），难度档在此基础上再叠倍率。
      let base = 2.2 - t * 1.15;
      // 无尽模式：越过六分钟后继续缓慢加压，但设底线，保证屏幕始终可读。
      if (this.mode === MODE.ENDLESS && this.elapsed > BOSS_TWO_TIME) {
        const extra = (this.elapsed - BOSS_TWO_TIME) / 60;
        base -= Math.min(0.55, extra * 0.06);
      }
      // 难度：spawn 就是「刷怪频率倍率」，直接除间隔即可。
      base /= profile.spawn;
      // BOSS 战期间大幅放缓增援：玩家的注意力要留给预警和弹幕，不是清杂兵。
      if (this.boss) base += 1.7;
      if (this.isMobile) base += 0.25;
      return Math.max(0.42, base);
    }

    // BOSS 战期间压缩小怪上限，否则满屏杂兵会淹没 BOSS 与弹幕，玩家无从走位。
    enemyCap() {
      const profile = this.difficultyProfile || difficultyAt(1);
      if (this.boss) return Math.round((this.isMobile ? 16 : 24) * profile.cap);
      return Math.round(this.maxEnemies * profile.cap);
    }

    pickKind() {
      const t = this.elapsed;
      const pool = [];
      if (t < 60) {
        pool.push(['drone', 10], ['bomber', 2]);
      } else if (t < 120) {
        pool.push(['drone', 10], ['tank', 3], ['sniper', 2.5], ['bomber', 3]);
      } else if (t < 180) {
        pool.push(['drone', 9], ['tank', 4], ['sniper', 3.6], ['bomber', 3.4], ['elite', 1]);
      } else if (t < 300) {
        pool.push(['drone', 9], ['tank', 5], ['sniper', 4.4], ['bomber', 4], ['elite', 1.8]);
      } else {
        pool.push(['drone', 9], ['tank', 6], ['sniper', 5], ['bomber', 4.6], ['elite', 2.6]);
      }
      let total = 0;
      for (let i = 0; i < pool.length; i += 1) total += pool[i][1];
      let roll = Math.random() * total;
      for (let i = 0; i < pool.length; i += 1) {
        roll -= pool[i][1];
        if (roll <= 0) return pool[i][0];
      }
      return 'drone';
    }

    spawnWave() {
      const cap = this.enemyCap();
      if (this.enemies.length >= cap) return;
      const angle = Math.random() * TAU;
      const radius = this.spawnRadius() + U.rand(0, 220);
      const x = this.player.x + Math.cos(angle) * radius;
      const y = this.player.y + Math.sin(angle) * radius;
      const enemy = this.spawnEnemyAt(this.pickKind(), x, y);
      if (!enemy) return;
      this.particles.ring(x, y, enemy.color, 4, 34, 0.4, 1.4);
      // Higher difficulty occasionally sends a small pack instead of one unit.
      const packChance = this.elapsed > 90 ? 0.22 : 0.1;
      if (Math.random() < packChance && this.enemies.length < cap - 3) {
        const extra = this.elapsed > 240 ? 2 : 1;
        for (let i = 0; i < extra; i += 1) {
          const spread = angle + U.rand(-0.42, 0.42);
          const r = this.spawnRadius() + U.rand(0, 200);
          this.spawnEnemyAt(this.pickKind(), this.player.x + Math.cos(spread) * r, this.player.y + Math.sin(spread) * r);
        }
      }
    }

    /* ---------------- main update ---------------- */

    update(dt) {
      if (this.state === STATE.BOSS_INTRO) {
        this.introTimer -= dt;
        this.particles.update(dt);
        this.updateShake(dt);
        if (this.introTimer <= 0) this.finishBossIntro();
        return;
      }
      if (this.state !== STATE.PLAYING) {
        this.updateShake(dt);
        return;
      }

      const player = this.player;
      if (!player) return;

      if (!this.timerFrozen) this.elapsed += dt;
      this.survivalTick += dt;
      while (this.survivalTick >= 1) {
        this.survivalTick -= 1;
        this.addScore(12);
      }

      this.updateShake(dt);

      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.comboCount = 0;
      }

      // Director
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval();
        this.spawnWave();
      }

      // Boss triggers
      if (!this.firstBossSpawned && this.elapsed >= BOSS_ONE_TIME) {
        this.firstBossSpawned = true;
        this.spawnBoss(false, 1);
        return;
      }
      if (this.mode === MODE.ENDLESS) {
        // 无尽模式下 360 秒不是终点，而是「OMEGA 解锁」的里程碑；
        // 真正的 BOSS 全部由下面的循环调度负责，保证场上永远只有一只。
        if (!this.omegaUnlocked && this.elapsed >= BOSS_TWO_TIME) {
          this.omegaUnlocked = true;
          this.finalBossSpawned = true;
          this.showToast('终局核心 OMEGA 已解锁 · 循环协议升级', 'danger');
        }
        // 上一只被击破后倒计时，到点再来一只，血量逐轮变厚；
        // OMEGA 解锁后与 JUDGE-09 交替登场。
        if (this.endlessCycle > 0 && !this.boss && this.elapsed >= this.nextBossAt) {
          // cycle 为偶数时轮到 OMEGA（第 2、4、6 波），奇数时是 JUDGE-09。
          const useOmega = this.omegaUnlocked && this.endlessCycle % 2 === 0;
          this.spawnBoss(useOmega, 1 + this.endlessCycle * 0.55);
          return;
        }
      } else if (!this.finalBossSpawned && this.elapsed >= BOSS_TWO_TIME) {
        this.finalBossSpawned = true;
        // OMEGA 的登场不允许被幸存的第一 BOSS 阻塞：旧 BOSS 被核心吞并后清场。
        if (this.boss && !this.boss.dead) this.retireBossForFinale(this.boss);
        this.timerFrozen = true;
        this.spawnBoss(true, 1);
        return;
      }

      player.update(dt);

      // 完美闪避送出的升级：延迟一小会儿再弹面板，先让玩家看到闪避特效。
      if (this.pendingLevelDelay > 0) {
        this.pendingLevelDelay = Math.max(0, this.pendingLevelDelay - dt);
        if (this.pendingLevelDelay <= 0 && this.pendingLevelUps > 0) this.openLevelUp();
      }

      // Enemies
      for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
        const enemy = this.enemies[i];
        if (enemy.dead) {
          this.enemies.splice(i, 1);
          continue;
        }
        enemy.update(dt, player);
        if (enemy.dead) {
          this.enemies.splice(i, 1);
        }
      }

      // Boss
      if (this.boss) {
        this.boss.update(dt);
        if (this.boss && this.boss.dead) this.boss = null;
      }

      // Player bullets
      for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
        const bullet = this.bullets[i];
        bullet.update(dt);
        if (bullet.dead) {
          this.bullets.splice(i, 1);
          continue;
        }
        let consumed = false;
        for (let e = 0; e < this.enemies.length; e += 1) {
          const enemy = this.enemies[e];
          if (!enemy.alive || enemy.dead || enemy.spawnTimer > 0) continue;
          const dx = enemy.x - bullet.x;
          const dy = enemy.y - bullet.y;
          const radius = enemy.radius + bullet.radius;
          if (dx * dx + dy * dy > radius * radius) continue;
          if (!bullet.hit(enemy)) continue;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const hitAngle = Math.atan2(dy, dx);
          // 处决协议：目标残血时追加伤害，把清场效率变成可见的数值差异。
          let dealt = bullet.damage;
          if (bullet.executeBonus > 0 && enemy.hp / enemy.maxHp <= 0.3) {
            dealt = bullet.damage * (1 + bullet.executeBonus);
          }
          enemy.damage(dealt, hitAngle, {
            frostChance: bullet.frostChance,
            knockback: bullet.crit ? 90 : 52
          });
          this.particles.hit(bullet.x, bullet.y, hitAngle, bullet.color, bullet.crit);
          this.particles.damageText(
            enemy.x + U.rand(-6, 6),
            enemy.y - enemy.radius - 4,
            Math.round(dealt),
            bullet.crit ? '#ffd166' : '#bff7ff',
            bullet.crit,
            // 伤害越高数字越大：暴击基础 1.35 倍，再按伤害量微调，重击更有存在感。
            bullet.crit ? 1.35 + Math.min(0.5, bullet.damage / 220) : 1
          );
          this.audio.play(bullet.crit ? 'crit' : 'hit');
          if (bullet.ricochet > 0 && this.redirectBullet(bullet, enemy)) {
            bullet.ricochet -= 1;
            bullet.damage *= 0.72;
            bullet.life = Math.max(bullet.life, 0.5);
            break;
          }
          if (bullet.pierce > 0) {
            bullet.pierce -= 1;
            bullet.damage *= 0.85;
          } else {
            bullet.dead = true;
            consumed = true;
          }
          break;
        }

        if (!consumed && !bullet.dead && this.boss && !this.boss.dead && this.boss.spawnTimer <= 0) {
          const boss = this.boss;
          const dx = boss.x - bullet.x;
          const dy = boss.y - bullet.y;
          const radius = boss.radius * 0.9 + bullet.radius;
          if (dx * dx + dy * dy <= radius * radius && bullet.hit(boss)) {
            const hitAngle = Math.atan2(dy, dx);
            boss.damage(bullet.damage, hitAngle, {});
            this.particles.hit(bullet.x, bullet.y, hitAngle, bullet.color, bullet.crit);
            this.particles.damageText(
              boss.x + U.rand(-18, 18),
              boss.y - boss.radius * 0.7,
              Math.round(bullet.damage),
              bullet.crit ? '#ffd166' : '#e3f7ff',
              bullet.crit,
              bullet.crit ? 1.5 + Math.min(0.6, bullet.damage / 200) : 1.05
            );
            this.audio.play(bullet.crit ? 'crit' : 'hit');
            if (bullet.pierce > 0) {
              bullet.pierce -= 1;
              bullet.damage *= 0.85;
            } else {
              bullet.dead = true;
            }
          }
        }

        if (bullet.dead) this.bullets.splice(i, 1);
      }

      // Enemy bullets
      for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
        const shot = this.enemyBullets[i];
        shot.update(dt);
        if (shot.dead) {
          this.enemyBullets.splice(i, 1);
          continue;
        }
        const dx = player.x - shot.x;
        const dy = player.y - shot.y;
        const radius = shot.radius + player.radius * 0.72;
        if (dx * dx + dy * dy <= radius * radius) {
          if (player.isPhasing()) {
            // 冲刺无敌帧：子弹被相位消解，给予明确反馈，而不是「无事发生」。
            player.absorbProjectile(shot.x, shot.y);
            this.enemyBullets.splice(i, 1);
            continue;
          }
          if (!player.isInvulnerable()) {
            player.hurt(shot.damage, shot.x, shot.y);
            this.particles.ring(shot.x, shot.y, shot.color, 6, 30, 0.3, 2);
          }
          this.enemyBullets.splice(i, 1);
        }
      }

      // Contact damage
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive || enemy.dead || enemy.spawnTimer > 0) continue;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const radius = enemy.radius + player.radius * 0.85;
        if (dx * dx + dy * dy <= radius * radius) {
          if (!player.isInvulnerable()) player.hurt(enemy.getContactDamage(), enemy.x, enemy.y);
        }
      }

      // XP orbs
      for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
        const orb = this.orbs[i];
        orb.update(dt, player);
        if (orb.dead) {
          this.orbs.splice(i, 1);
          continue;
        }
        const dx = player.x - orb.x;
        const dy = player.y - orb.y;
        const radius = orb.radius + player.radius * 0.9;
        if (dx * dx + dy * dy <= radius * radius) {
          this.orbs.splice(i, 1);
          this.particles.pickup(orb.x, orb.y, orb.color);
          this.audio.play('pickup');
          this.addScore(4);
          if (orb.heal > 0) {
            this.player.heal(orb.heal);
            this.particles.label(orb.x, orb.y - 12, '+' + orb.heal, '#5cffb2', 15);
            this.particles.burst(orb.x, orb.y, '#5cffb2', 14, 150, 2.6, 0.5, 'spark');
            if (this.ui) this.ui.updateHud();
            continue;
          }
          // Route XP through the single gainXp() path so pickup triggers the
          // exact same level-up rewards (chassis growth, repair, pending queue)
          // as every other source. Duplicating the loop here previously meant
          // picked-up XP skipped those rewards entirely.
          this.gainXp(orb.value);
          if (this.state !== STATE.PLAYING) break;
        }
      }
      if (this.state !== STATE.PLAYING) return;

      this.particles.update(dt);

      // Camera follow with soft lag
      const follow = Math.min(1, dt * 9);
      this.camera.x += (player.x - this.camera.x) * follow;
      this.camera.y += (player.y - this.camera.y) * follow;

      if (this.ui) this.ui.updateHud();

      if (player.hp <= 0 && this.state === STATE.PLAYING) {
        this.finishRun(false);
      }
    }

    updateShake(dt) {
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const power = Math.max(0, this.shakeTime) * this.shakeMagnitude * 6;
        this.shakeX = U.rand(-power, power);
        this.shakeY = U.rand(-power, power);
        if (this.shakeTime <= 0) {
          this.shakeMagnitude = 0;
          this.shakeX = 0;
          this.shakeY = 0;
        }
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
    }

    /* ---------------- end of run ---------------- */

    finishRun(victory) {
      if (this.state === STATE.GAME_OVER || this.state === STATE.VICTORY) return;
      const wasLevelUp = this.state === STATE.LEVEL_UP;
      const endless = this.mode === MODE.ENDLESS;
      this.state = victory ? STATE.VICTORY : STATE.GAME_OVER;
      this.runActive = false;

      if (this.boss) {
        this.particles.bigExplosion(this.boss.x, this.boss.y, this.boss.color, 3);
        this.boss = null;
      }
      this.addScore(victory ? Math.round(this.elapsed * 20) + 15000 : 0);
      const finalScore = Math.max(0, Math.round(this.score));
      const record = NO.Storage.recordRun({
        score: finalScore,
        time: this.elapsed,
        kills: this.kills,
        mode: this.mode,
        wave: this.endlessCycle
      });

      const grade = this.computeGrade(finalScore, victory, endless);
      this.audio.play(victory ? 'victory' : 'gameover');
      this.addScreenShake(victory ? 12 : 8, 0.6);

      if (this.ui) {
        if (wasLevelUp) this.ui.hideLevelUp();
        this.ui.hidePause();
        this.ui.hideBossBar();
        this.ui.showResult({
          victory: Boolean(victory),
          endless,
          wave: this.endlessCycle,
          grade,
          time: this.elapsed,
          kills: this.kills,
          level: this.player ? this.player.level : 1,
          score: finalScore,
          best: record.highScore,
          newRecord: record.newRecord
        });
      }

      NO.Input.clearKeys();
      NO.Input.clearPressed();
      NO.Input.resetJoystick();
    }

    computeGrade(score, victory, endless) {
      if (endless) {
        // 无尽模式没有终点，评级只看撑了多久：越久越难，所以按时长而不是分数。
        const minutes = this.elapsed / 60;
        if (minutes >= 14) return 'S';
        if (minutes >= 10) return 'A';
        if (minutes >= 7.5) return 'B';
        if (minutes >= 6) return 'C';
        return 'D';
      }
      const total = score + (victory ? 8000 : 0);
      if (total >= 62000) return 'S';
      if (total >= 42000) return 'A';
      if (total >= 27000) return 'B';
      if (total >= 14000) return 'C';
      return 'D';
    }

    /* ---------------- rendering ---------------- */

    drawBackgroundGrid(ctx) {
      const camX = this.camera.x;
      const camY = this.camera.y;
      const left = camX - this.viewW / 2;
      const right = camX + this.viewW / 2;
      const top = camY - this.viewH / 2;
      const bottom = camY + this.viewH / 2;

      const step = 88;
      const startX = Math.floor(left / step) * step;
      const startY = Math.floor(top / step) * step;

      ctx.lineWidth = 1;
      for (let x = startX; x <= right; x += step) {
        const major = Math.round(x / step) % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(0,229,255,0.16)' : 'rgba(70,140,190,0.075)';
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      for (let y = startY; y <= bottom; y += step) {
        const major = Math.round(y / step) % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(150,91,255,0.12)' : 'rgba(70,140,190,0.07)';
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }

      // Procedural city debris / circuit decorations, deterministic per cell.
      const cell = 420;
      const cx0 = Math.floor(left / cell);
      const cx1 = Math.ceil(right / cell);
      const cy0 = Math.floor(top / cell);
      const cy1 = Math.ceil(bottom / cell);
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const h1 = this.hash(cx, cy, 1);
          const h2 = this.hash(cx, cy, 2);
          const h3 = this.hash(cx, cy, 3);
          if (h1 < 0.34) continue;
          const bx = cx * cell + h2 * cell * 0.7;
          const by = cy * cell + h3 * cell * 0.7;
          const size = 26 + h2 * 74;
          const color = h3 > 0.55 ? '0,229,255' : h1 > 0.72 ? '150,91,255' : '90,160,200';
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate((h1 - 0.5) * 0.5);
          ctx.fillStyle = 'rgba(6,14,26,0.72)';
          ctx.strokeStyle = 'rgba(' + color + ',0.22)';
          ctx.lineWidth = 1;
          if (h2 > 0.5) {
            ctx.fillRect(-size / 2, -size / 2, size, size);
            ctx.strokeRect(-size / 2, -size / 2, size, size);
            ctx.fillStyle = 'rgba(' + color + ',0.16)';
            ctx.fillRect(-size / 2 + 6, -size / 2 + 6, size - 12, 3);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.55, 0, TAU);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.28, 0, TAU);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Faint player-centred energy halo.
      ctx.save();
      ctx.translate(this.player ? this.player.x : camX, this.player ? this.player.y : camY);
      const halo = ctx.createRadialGradient(0, 0, 10, 0, 0, 300);
      halo.addColorStop(0, 'rgba(0,229,255,0.055)');
      halo.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 300, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    hash(x, y, salt) {
      const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7 + this.decorSeed) * 43758.5453;
      return n - Math.floor(n);
    }

    render() {
      const ctx = this.ctx;
      if (!ctx) return;
      const w = this.viewW;
      const h = this.viewH;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      if (!this.gradient) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#070a14');
        g.addColorStop(0.55, '#080d1a');
        g.addColorStop(1, '#04060d');
        this.gradient = g;
      }
      ctx.fillStyle = this.gradient;
      ctx.fillRect(0, 0, w, h);

      if (!this.player && this.state === STATE.MENU) {
        this.renderMenuDrift(ctx, w, h);
        return;
      }

      ctx.save();
      ctx.translate(w / 2 - this.camera.x + this.shakeX, h / 2 - this.camera.y + this.shakeY);

      this.drawBackgroundGrid(ctx);

      // XP crystals
      for (let i = 0; i < this.orbs.length; i += 1) this.orbs[i].draw(ctx);

      // Enemy bullets
      for (let i = 0; i < this.enemyBullets.length; i += 1) this.enemyBullets[i].draw(ctx);

      // Enemies
      for (let i = 0; i < this.enemies.length; i += 1) this.enemies[i].draw(ctx);

      // Boss
      if (this.boss) this.boss.draw(ctx);

      // Player
      if (this.player) this.player.draw(ctx);

      // Player bullets
      for (let i = 0; i < this.bullets.length; i += 1) this.bullets[i].draw(ctx);

      // Particles & floating text
      this.particles.draw(ctx);

      ctx.restore();

      // Boss intro darkening handled by the DOM overlay; add a subtle arena wash.
      if (this.boss && this.boss.phase === 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.06 + Math.sin(this.boss.animTime * 3) * 0.02;
        ctx.fillStyle = this.boss.color;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    renderMenuDrift(ctx, w, h) {
      // Slow parallax drift behind the menu, keeps the main screen alive.
      const t = performance.now() * 0.00008;
      ctx.save();
      ctx.translate(Math.sin(t) * 40, Math.cos(t * 0.8) * 30);
      const step = 96;
      ctx.strokeStyle = 'rgba(0,229,255,0.075)';
      ctx.lineWidth = 1;
      for (let x = -step; x <= w + step; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, -step);
        ctx.lineTo(x, h + step);
        ctx.stroke();
      }
      for (let y = -step; y <= h + step; y += step) {
        ctx.beginPath();
        ctx.moveTo(-step, y);
        ctx.lineTo(w + step, y);
        ctx.stroke();
      }
      const aura = ctx.createRadialGradient(w * 0.5, h * 0.44, 20, w * 0.5, h * 0.44, Math.max(w, h) * 0.6);
      aura.addColorStop(0, 'rgba(150,91,255,0.16)');
      aura.addColorStop(0.55, 'rgba(0,229,255,0.05)');
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  NO.Game = Game;
  NO.STATE = STATE;
  NO.MODE = MODE;
  NO.DIFFICULTY = DIFFICULTY;
  NO.difficultyAt = difficultyAt;
  NO.RUN_DURATION = RUN_DURATION;
})();
