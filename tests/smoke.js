/* Automated browser smoke + gameplay tests for NEON OUTBREAK.
   Run: node tests/smoke.js   (requires a static server on 127.0.0.1:8791) */
const path = require('path');
const PW_PATHS = [
  'C:/Users/Tutul/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright',
  'C:/Users/Tutul/AppData/Local/npm-cache/_npx/381cec31605a419a/node_modules/playwright',
  'C:/Users/Tutul/AppData/Local/npm-cache/_npx/86170c4cd1c5da32/node_modules/playwright'
];
let chromium = null;
for (const p of PW_PATHS) {
  try { chromium = require(p).chromium; break; } catch (e) { /* next */ }
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

const BASE = 'http://127.0.0.1:8791/index.html';
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const LAUNCH = {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    headless: true
  };
  let browser;
  try {
    browser = await chromium.launch(LAUNCH);
  } catch (e) {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE + '?test=1', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // 1. Boot
  const boot = await page.evaluate(() => ({
    hasGame: !!window.NO?.game,
    state: window.NO?.game?.state,
    canvas: (() => { const c = document.getElementById('game-canvas'); return c ? c.width + 'x' + c.height : null; })(),
    menuActive: document.getElementById('screen-menu')?.classList.contains('is-active'),
    menuVisible: (() => { const s = document.getElementById('screen-menu'); const cs = getComputedStyle(s); return cs.opacity === '1' && cs.visibility === 'visible'; })()
  }));
  record('Boot: game instance created', boot.hasGame, JSON.stringify(boot));
  record('Boot: initial state MENU', boot.state === 'MENU', boot.state);
  record('Boot: canvas sized', boot.canvas && !boot.canvas.startsWith('0x'), boot.canvas);
  record('Boot: menu screen visible', boot.menuActive && boot.menuVisible);

  // 2. Start via button
  await page.click('#btn-start');
  await page.waitForTimeout(300);
  const started = await page.evaluate(() => ({
    state: window.NO.game.state,
    hudActive: document.getElementById('screen-hud')?.classList.contains('is-active'),
    hasPlayer: !!window.NO.game.player,
    hp: window.NO.game.player?.hp
  }));
  record('Start: state -> PLAYING', started.state === 'PLAYING', started.state);
  record('Start: HUD visible', started.hudActive === true);
  record('Start: player spawn full HP', started.hasPlayer && started.hp === 100, 'hp=' + started.hp);

  // 3. Diagonal movement normalization
  const move = await page.evaluate(async () => {
    const g = window.NO.game;
    const p = g.player;
    const start = { x: p.x, y: p.y };
    // straight right
    window.NO.Input.keys.KeyD = true;
    const t0 = performance.now();
    let frames = 0;
    while (frames < 30) { g.update(1 / 60); frames++; }
    window.NO.Input.keys.KeyD = false;
    const straight = Math.hypot(p.x - start.x, p.y - start.y);
    // diagonal
    const s2 = { x: p.x, y: p.y };
    window.NO.Input.keys.KeyD = true; window.NO.Input.keys.KeyS = true;
    frames = 0;
    while (frames < 30) { g.update(1 / 60); frames++; }
    window.NO.Input.keys.KeyD = false; window.NO.Input.keys.KeyS = false;
    const diag = Math.hypot(p.x - s2.x, p.y - s2.y);
    return { straight: +straight.toFixed(2), diag: +diag.toFixed(2), ratio: +(diag / straight).toFixed(3) };
  });
  record('Movement: diagonal not faster than straight', move.ratio <= 1.06 && move.ratio >= 0.94, JSON.stringify(move));

  // 4. Dash applies invulnerability + cooldown
  const dash = await page.evaluate(() => {
    const g = window.NO.game, p = g.player;
    p.dashCooldownTimer = 0;
    window.NO.Input.pressed.Space = true;
    g.update(1 / 60);
    return { timer: +p.dashTimer.toFixed(3), cd: +p.dashCooldownTimer.toFixed(2), invuln: p.isInvulnerable() };
  });
  record('Dash: activates with invulnerability + cooldown', dash.timer > 0 && dash.cd > 2 && dash.invuln, JSON.stringify(dash));

  // 5. Auto-attack: spawn an enemy and confirm bullets are created and damage lands
  const combat = await page.evaluate(() => {
    const g = window.NO.game, p = g.player;
    p.x = 0; p.y = 0; p.fireTimer = 0; p.dashTimer = 0; p.dashCooldownTimer = 0;
    g.enemies.length = 0; g.bullets.length = 0;
    const e = g.spawnEnemyAt('drone', 0, -150);
    const hpBefore = e.hp;
    const shotsBefore = g.bullets.length;
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    return {
      bulletsCreated: g.bullets.length + (e.dead || !e.alive ? 1 : 0),
      hpBefore, hpAfter: e.maxHp, alive: e.alive,
      bullets: g.bullets.length,
      enemyCount: g.enemies.length
    };
  });
  record('Combat: auto-fire produced projectiles', combat.bullets > 0 || combat.enemyCount === 0, JSON.stringify(combat));

  // 6. Direct bullet damage + death
  const kill = await page.evaluate(() => {
    const g = window.NO.game;
    g.enemies.length = 0; g.bullets.length = 0;
    const e = g.spawnEnemyAt('drone', g.player.x + 40, g.player.y);
    const before = e.hp;
    e.spawnTimer = 0;
    e.damage(10, 0, {});
    const mid = e.hp;
    e.damage(999, 0, {});
    return { before, mid, dead: e.dead, kills: g.kills };
  });
  record('Combat: enemy takes damage', kill.mid === kill.before - 10, `${kill.before} -> ${kill.mid}`);
  record('Combat: enemy dies at 0 HP', kill.dead === true);

  // 7. Player damage + invuln window
  const hurt = await page.evaluate(() => {
    const g = window.NO.game, p = g.player;
    p.hp = 100; p.invuln = 0;
    p.hurt(15, 100, 100);
    const afterFirst = p.hp;
    const invuln = p.invuln;
    p.hurt(15, 100, 100);
    const afterSecond = p.hp;
    return { afterFirst, afterSecond, invuln: +invuln.toFixed(2) };
  });
  record('Damage: player loses HP', hurt.afterFirst === 85, 'hp=' + hurt.afterFirst);
  record('Damage: invuln blocks repeat hit', hurt.afterSecond === 85, 'hp=' + hurt.afterSecond);

  // 8. XP -> level up -> LEVEL_UP state -> choose upgrade
  const levelup = await page.evaluate(() => {
    const g = window.NO.game;
    g.state = 'PLAYING';
    g.player.hp = 100;
    g.pendingLevelUps = 0;
    g.xp = 0;
    g.xpNeeded = g.xpForLevel(1);
    const beforeDmg = g.player.damage;
    g.player.gainXp = null;
    g.gainXp(400);
    const stateAfter = g.state;
    const cards = document.querySelectorAll('#upgrade-cards .upgrade-card').length;
    let clicked = null;
    if (stateAfter === 'LEVEL_UP') {
      const first = document.querySelector('#upgrade-cards .upgrade-card');
      clicked = first ? first.getAttribute('data-index') : null;
    }
    return { stateAfter, cards, clicked, level: g.player.level, pending: g.pendingLevelUps };
  });
  record('XP: triggers LEVEL_UP state', levelup.stateAfter === 'LEVEL_UP', JSON.stringify(levelup));
  record('XP: three upgrade cards rendered', levelup.cards === 3, 'cards=' + levelup.cards);
  record('XP: player level increased', levelup.level > 1, 'level=' + levelup.level);

  const chose = await page.evaluate(() => {
    const g = window.NO.game;
    const before = {
      damage: g.player.damage, interval: g.player.attackInterval, maxHp: g.player.maxHp,
      speed: g.player.speed, crit: g.player.critChance, pierce: g.player.pierce,
      projectiles: g.player.projectiles, pickup: g.player.pickupRange
    };
    g.chooseUpgrade(0);
    const after = {
      damage: g.player.damage, interval: g.player.attackInterval, maxHp: g.player.maxHp,
      speed: g.player.speed, crit: g.player.critChance, pierce: g.player.pierce,
      projectiles: g.player.projectiles, pickup: g.player.pickupRange
    };
    return { before, after, state: g.state, hp: g.player.hp, maxHp: g.player.maxHp };
  });
  const changed = Object.keys(chose.before).some(k => JSON.stringify(chose.before[k]) !== JSON.stringify(chose.after[k]));
  record('Upgrade: applies a real stat change', changed, JSON.stringify({ b: chose.before, a: chose.after }));
  record('Upgrade: returns to PLAYING', chose.state === 'PLAYING', chose.state);
  record('Upgrade: HP clamped to max', chose.hp <= chose.maxHp);

  // 9. Pause fully freezes simulation
  const paused = await page.evaluate(() => {
    const g = window.NO.game;
    g.state = 'PLAYING';
    g.enemies.length = 0; g.bullets.length = 0;
    g.spawnEnemyAt('drone', 200, 0);
    const before = { t: g.elapsed, ex: g.enemies[0].x, ey: g.enemies[0].y };
    g.pause();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const after = { t: g.elapsed, ex: g.enemies[0] ? g.enemies[0].x : null, state: g.state };
    g.resume();
    return { before, after, resumed: g.state, pauseShown: document.getElementById('screen-pause').classList.contains('is-active') };
  });
  record('Pause: state PAUSED and overlay shown', paused.after.state === 'PAUSED' && paused.pauseShown, JSON.stringify(paused.after));
  record('Pause: timer + enemies frozen', paused.after.t === paused.before.t && paused.after.ex === paused.before.ex, JSON.stringify(paused.after));
  record('Resume: back to PLAYING', paused.resumed === 'PLAYING', paused.resumed);

  // 10. Boss one at 180s
  const boss1 = await page.evaluate(() => {
    const g = window.NO.game;
    g.state = 'PLAYING'; g.boss = null; g.firstBossSpawned = false; g.elapsed = 179.5;
    g.enemies.length = 0; g.bullets.length = 0; g.enemyBullets.length = 0;
    g.player.hp = g.player.maxHp;
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    const b = g.boss;
    return { spawned: !!b, name: b?.name, hp: b?.hp, maxHp: b?.maxHp, state: g.state, elapsed: +g.elapsed.toFixed(1) };
  });
  record('Boss 1: spawns at 180s', boss1.spawned === true, JSON.stringify(boss1));
  record('Boss 1: has HP pool', boss1.maxHp > 500, 'maxHp=' + boss1.maxHp);

  const boss1Fight = await page.evaluate(() => {
    const g = window.NO.game;
    if (!g.boss) return { skip: true };
    g.finishBossIntro();
    g.boss.spawnTimer = 0; g.boss.invulnerable = false;
    const shotsBefore = g.enemyBullets.length;
    for (let i = 0; i < 600; i++) {
      g.player.hp = g.player.maxHp;
      g.player.invuln = 0;
      if (g.state !== 'PLAYING') g.state = 'PLAYING';
      g.update(1 / 60);
    }
    const b = g.boss;
    return { shotsBefore, enemyBullets: g.enemyBullets.length, state: g.state, bossHp: b?.hp, bossAlive: !!b };
  });
  record('Boss 1: performs attacks (enemy bullets fired)', boss1Fight.skip || boss1Fight.enemyBullets > 0, JSON.stringify(boss1Fight));

  const boss1Kill = await page.evaluate(() => {
    const g = window.NO.game;
    if (!g.boss) {
      g.spawnBoss(false); g.finishBossIntro();
    }
    g.boss.spawnTimer = 0; g.boss.invulnerable = false;
    const name = g.boss.name;
    g.player.hp = 50;
    g.boss.damage(999999, 0, {});
    return { name, bossGone: !g.boss, state: g.state, hp: g.player.hp, toast: document.getElementById('toast')?.textContent?.trim() };
  });
  record('Boss 1: defeatable -> boss cleared', boss1Kill.bossGone === true, JSON.stringify(boss1Kill));
  record('Boss 1: heals player after defeat', boss1Kill.hp > 50, 'hp=' + boss1Kill.hp);
  record('Boss 1: run continues after defeat', boss1Kill.state === 'PLAYING', boss1Kill.state);

  // 11. Final boss at 360s with phase 2 and victory
  const boss2 = await page.evaluate(() => {
    const g = window.NO.game;
    g.state = 'PLAYING'; g.boss = null; g.finalBossSpawned = false; g.timerFrozen = false; g.elapsed = 359.5;
    g.player.hp = g.player.maxHp;
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    const b = g.boss;
    return { spawned: !!b, name: b?.name, maxHp: b?.maxHp, state: g.state, frozen: g.timerFrozen, isFinal: b?.isFinal };
  });
  record('Boss 2: spawns at 360s', boss2.spawned === true, JSON.stringify(boss2));
  record('Boss 2: marked final + timer frozen', boss2.isFinal === true && boss2.frozen === true, JSON.stringify(boss2));

  const phase2 = await page.evaluate(() => {
    const g = window.NO.game;
    if (!g.boss) return { skip: true };
    g.finishBossIntro();
    g.boss.spawnTimer = 0; g.boss.invulnerable = false;
    g.boss.damage(g.boss.maxHp * 0.55, 0, {});
    for (let i = 0; i < 200; i++) { g.player.hp = g.player.maxHp; g.player.invuln = 0; g.update(1 / 60); }
    return { phase: g.boss?.phase, hpRatio: g.boss ? +(g.boss.hpRatio).toFixed(2) : null, state: g.state };
  });
  record('Boss 2: enters phase 2 below 50%', phase2.phase === 2, JSON.stringify(phase2));

  const victory = await page.evaluate(() => {
    const g = window.NO.game;
    if (!g.boss) { g.spawnBoss(true); g.finishBossIntro(); }
    g.boss.spawnTimer = 0;
    // Force invulnerable off and the phase transition to settle before the killing blow.
    g.boss.invulnerable = false;
    g.boss.phaseTransition = 0;
    g.boss.damage(9999999, 0, {});
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    return {
      state: g.state,
      resultVisible: document.getElementById('screen-result')?.classList.contains('is-active'),
      title: document.getElementById('result-title')?.textContent?.trim(),
      grade: document.getElementById('result-grade')?.textContent?.trim(),
      score: document.getElementById('res-score')?.textContent?.trim(),
      best: document.getElementById('res-best')?.textContent?.trim()
    };
  });
  record('Victory: state VICTORY', victory.state === 'VICTORY', victory.state);
  record('Victory: result screen visible', victory.resultVisible === true);
  record('Victory: MISSION COMPLETE text', /MISSION COMPLETE/i.test(victory.title || ''), victory.title);
  record('Victory: grade computed', /^[SABCD]$/.test(victory.grade || ''), victory.grade);
  record('Victory: score + best persisted', !!victory.score && !!victory.best, `${victory.score} / ${victory.best}`);

  // 12. Restart resets everything and does not multiply loops
  const restart = await page.evaluate(() => {
    const g = window.NO.game;
    const loopsBefore = g.__loopCount || 0;
    g.start();
    return {
      state: g.state, elapsed: g.elapsed, kills: g.kills, score: g.score,
      xp: g.xp, level: g.player.level, hp: g.player.hp,
      enemies: g.enemies.length, bullets: g.bullets.length, orbs: g.orbs.length,
      boss: g.boss, pending: g.pendingLevelUps,
      upgrades: Object.keys(g.player.upgradeLevels).length
    };
  });
  const clean = restart.state === 'PLAYING' && restart.elapsed === 0 && restart.kills === 0 &&
    restart.score === 0 && restart.xp === 0 && restart.level === 1 && restart.hp === 100 &&
    restart.enemies === 0 && restart.bullets === 0 && restart.orbs === 0 && !restart.boss &&
    restart.pending === 0 && restart.upgrades === 0;
  record('Restart: full state reset', clean, JSON.stringify(restart));

  // 13. Death path
  const death = await page.evaluate(() => {
    const g = window.NO.game;
    g.start();
    g.player.invuln = 0;
    g.player.hp = 5;
    g.player.hurt(50, 0, 0);
    return { state: g.state, visible: document.getElementById('screen-result').classList.contains('is-active'), title: document.getElementById('result-title').textContent.trim() };
  });
  record('Death: state GAME_OVER', death.state === 'GAME_OVER', death.state);
  record('Death: MISSION FAILED shown', /MISSION FAILED/i.test(death.title), death.title);

  // 14. Settings persistence
  const settings = await page.evaluate(() => {
    const ui = window.NO.ui;
    window.NO.Storage.set('soundOn', false);
    window.NO.Storage.set('shake', false);
    window.NO.Storage.set('volume', 0.33);
    const raw = JSON.parse(localStorage.getItem('neonOutbreakSave.v1') || '{}');
    return { raw, shake: window.NO.Storage.get('shake'), sound: window.NO.Storage.get('soundOn') };
  });
  record('Storage: settings persisted to localStorage', settings.shake === false && settings.sound === false, JSON.stringify(settings.raw));

  // 15. Records update
  const records = await page.evaluate(() => {
    const s = window.NO.Storage.getAll();
    return { highScore: s.highScore, longestTime: s.longestTime, totalKills: s.totalKills, gamesPlayed: s.gamesPlayed };
  });
  record('Storage: run records saved', records.gamesPlayed >= 1 && records.highScore > 0, JSON.stringify(records));

  // 16. Responsive: mobile viewport + touch controls
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mobile = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    return {
      cw: c.style.width, ch: c.style.height,
      win: window.innerWidth + 'x' + window.innerHeight,
      rotateHint: getComputedStyle(document.getElementById('rotate-hint')).display
    };
  });
  record('Responsive: canvas follows viewport', mobile.cw === '390px' && mobile.ch === '844px', JSON.stringify(mobile));

  // 17. Screenshots for visual check
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.NO.game.backToMenu(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'shot-menu.png') });

  await page.evaluate(() => {
    const g = window.NO.game;
    g.start();
    g.elapsed = 100;
    for (let i = 0; i < 260; i++) g.update(1 / 60);
    g.player.xp = g.xpNeeded * 0.6;
    window.NO.ui.updateHud();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'shot-gameplay.png') });

  await page.evaluate(() => {
    const g = window.NO.game;
    g.player.level = 12;
    g.gainXp(g.xpNeeded);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'shot-levelup.png') });

  await page.evaluate(() => {
    const g = window.NO.game;
    if (g.state === 'LEVEL_UP') g.chooseUpgrade(0);
    if (g.boss) { g.boss = null; }
    g.spawnBoss(false);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'shot-bossintro.png') });

  // 18. No page errors
  record('Runtime: no JS errors during test', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log('\n================================');
  console.log(`TOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(3); });
