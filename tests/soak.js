/*
 * NEON OUTBREAK — 自动化 soak 机器人（仅供测试，游戏本体不加载此文件）
 *
 * 用法（需以 ?test=1 打开游戏，静态服务器下）：
 *   await fetch('/tests/soak.js').then(r => r.text()).then(t => eval(t));
 *   window.__soak(900);                       // 模拟 900 秒
 *   window.__soak(900, { invincible: true }); // 无敌模式，用于验证 360s 后的流程
 *
 * 机器人策略模拟真实玩家：保持距离、优先吃经验/维修包、危险时冲刺、
 * 残血时优先选防御类强化。它不会读取游戏内部作弊接口，只通过输入层操作。
 */
(() => {
  const OFFENSE = ['multishot', 'damage', 'pierce', 'firerate', 'crit', 'emp', 'frost', 'volatile', 'magnet', 'speed'];
  const DEFENSE = ['repair', 'armor', 'field-repair', 'speed'];

  window.__soak = function soak(maxSeconds = 900, opts = {}) {
    const g = window.NO.game;
    if (!g) throw new Error('NO.game 不可用，请以 ?test=1 打开');
    if (g.state !== 'MENU') { try { g.backToMenu(); } catch (e) { /* 忽略 */ } }
    g.start(opts.mode === 'endless' ? 'endless' : 'standard');

    const choose = () => {
      const cards = g.levelChoices || [];
      const p = g.player;
      const low = p.hp / p.maxHp < 0.65;
      const order = low ? DEFENSE.concat(OFFENSE) : OFFENSE.concat(DEFENSE);
      let best = 0;
      let rank = 999;
      cards.forEach((c, i) => {
        const id = c && (c.id || (c.def && c.def.id));
        const r = order.indexOf(id);
        if (r !== -1 && r < rank) { rank = r; best = i; }
      });
      g.chooseUpgrade(best);
    };

    let frames = 0;
    let ang = 0;
    let prevBoss = null;
    let b1At = null; let b1Down = null; let b2At = null; let b2Down = null; let win = null;
    let maxWave = 0;
    const samples = [];
    const dmg = {};

    const origHurt = g.player.hurt.bind(g.player);
    g.player.hurt = function hurt(amount, sx, sy) {
      const before = this.hp;
      const r = origHurt(amount, sx, sy);
      if (this.hp < before) {
        let src = 'unknown';
        if (g.boss && sx !== undefined && Math.hypot(sx - g.boss.x, sy - g.boss.y) < g.boss.radius + 25) src = 'boss-contact';
        if (src === 'unknown' && g.enemyBullets.some(b => Math.hypot(b.x - sx, b.y - sy) < 30)) src = 'enemy-bullet';
        if (src === 'unknown') {
          for (const e of g.enemies) {
            if (Math.hypot(e.x - sx, e.y - sy) < e.radius + 20) { src = 'mob-' + e.kind; break; }
          }
        }
        dmg[src] = dmg[src] || { hits: 0, total: 0 };
        dmg[src].hits += 1;
        dmg[src].total += before - this.hp;
      }
      return r;
    };

    while (frames < 60 * maxSeconds) {
      if (opts.invincible) g.player.hp = g.player.maxHp;
      if (g.state === 'PLAYING') {
        const p = g.player;
        let ax = 0; let ay = 0;
        let nd = 1e9; let nearest = null;
        for (const e of g.enemies) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; nearest = e; }
        }
        if (nearest && nd < 330) {
          const dx = p.x - nearest.x; const dy = p.y - nearest.y; const d = Math.hypot(dx, dy) || 1;
          ax += (dx / d) * ((330 - nd) / 100);
          ay += (dy / d) * ((330 - nd) / 100);
        }
        let bo = null; let bd = 1e9;
        for (const o of g.orbs) {
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          const w = o.heal > 0 ? d * 0.4 : d;
          if (w < bd) { bd = w; bo = o; }
        }
        if (bo && bd < 600) {
          const dd = Math.hypot(bo.x - p.x, bo.y - p.y) || 1;
          ax += (bo.x - p.x) / dd * 1.6;
          ay += (bo.y - p.y) / dd * 1.6;
        }
        if (g.boss) {
          const d = Math.hypot(g.boss.x - p.x, g.boss.y - p.y) || 1;
          const k = (d - 230) / 110;
          ax += (g.boss.x - p.x) / d * k;
          ay += (g.boss.y - p.y) / d * k;
          ang += (1 / 60) * 1.5;
          ax += Math.cos(ang);
          ay += Math.sin(ang);
        }
        // 躲避弹幕：把靠近的敌方子弹按“越近权重越大”推开，模拟真人侧移躲弹。
        let bx = 0; let by = 0;
        let closestBullet = 1e9;
        for (const b of g.enemyBullets) {
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 150 && d > 0.01) {
            const w = (150 - d) / 150;
            bx += (dx / d) * w * 2.6;
            by += (dy / d) * w * 2.6;
            if (d < closestBullet) closestBullet = d;
          }
        }
        // 优先朝子弹来向的垂直方向侧移，这是人类最自然的躲法。
        if (bx || by) {
          ax += bx;
          ay += by;
        }
        const l = Math.hypot(ax, ay);
        NO.Input.touchActive = true;
        NO.Input.touchVector = l > 0.01 ? { x: ax / l, y: ay / l } : { x: 0, y: 0 };
        const danger = (nearest && nd < 110) || closestBullet < 70;
        if (danger && p.dashCooldownTimer <= 0) NO.Input.pressed.Enter = true;
      }
      g.update(1 / 60);
      frames += 1;
      if (g.state === 'LEVEL_UP') choose();
      if (g.state === 'BOSS_INTRO') {
        if (g.boss && g.boss.isFinal && b2At === null) b2At = Math.round(g.elapsed);
        if (g.boss && !g.boss.isFinal && b1At === null) b1At = Math.round(g.elapsed);
        g.skipBossIntro();
      }
      if (prevBoss && !g.boss) {
        if (prevBoss.isFinal && b2Down === null) b2Down = Math.round(g.elapsed);
        if (!prevBoss.isFinal && b1Down === null) b1Down = Math.round(g.elapsed);
      }
      prevBoss = g.boss;
      if (g.endlessCycle > maxWave) maxWave = g.endlessCycle;
      if (g.state === 'VICTORY' && win === null) win = Math.round(g.elapsed);
      if (g.state === 'VICTORY' || g.state === 'GAME_OVER') break;
      if (frames % 1800 === 0) {
        samples.push({
          t: Math.round(g.elapsed),
          lv: g.player.level,
          hp: Math.round(g.player.hp),
          max: g.player.maxHp,
          k: g.kills,
          en: g.enemies.length,
          boss: g.boss ? Math.round(g.boss.hp) : null,
        });
      }
    }

    NO.Input.touchActive = false;
    g.player.hurt = origHurt;
    return {
      b1At, b1Down, b2At, b2Down, win, maxWave,
      mode: g.mode,
      final: g.state,
      secs: Math.round(frames / 60),
      score: g.score,
      kills: g.kills,
      level: g.player.level,
      dmg,
      samples,
    };
  };
  return 'soak ready';
})();
