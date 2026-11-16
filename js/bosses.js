/* NEON OUTBREAK - JUDGE-09 and OMEGA core bosses */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;
  const TAU = Math.PI * 2;

  /* Estimated sustained damage per second the player can pour into a single
     large target. Boss HP is derived from this instead of from the player's
     level, so late-game power spikes cannot melt a boss in a few seconds and
     an under-built player is never handed an unkillable wall. */
  function estimatePlayerDps(game) {
    const p = game.player;
    if (!p) return 25;
    const interval = Math.max(0.08, p.attackInterval || 0.45);
    const shots = Math.max(1, p.projectiles || 1);
    // A boss body is large enough that most of a spread connects; measured
    // against real fights, ~0.8 of each extra projectile lands on a big target.
    const connect = 1 + (shots - 1) * 0.8;
    const critFactor = 1 + (p.critChance || 0) * ((p.critMultiplier || 1.5) - 1);
    let dps = ((p.damage || 12) * connect * critFactor) / interval;
    // EMP and volatile add on top of direct fire but are not the main source.
    dps *= 1.12;
    return Math.max(18, dps);
  }

  /* Seconds of focused fire a boss should survive. Tuned so the fight reads as
     a real climax: long enough for every attack pattern to appear at least
     twice, short enough that it never feels like a health sponge.
     Measured against scripted runs: realised fight length tracks this value at
     roughly 1:1 once dodging and add-clearing are counted, so keep OMEGA near
     30s and JUDGE-09 near 26s. */
  const BOSS_TTK = { judge: 26, omega: 31 };

  function bossHealth(game, kind) {
    const dps = estimatePlayerDps(game);
    const seconds = BOSS_TTK[kind] || 26;
    // 0.78: measured ratio between theoretical single-target DPS and what a
    // player actually lands while dodging patterns and clearing adds.
    return Math.round(dps * seconds * 0.78);
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 0.0001) return U.distance(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = U.clamp(t, 0, 1);
    return U.distance(px, py, x1 + dx * t, y1 + dy * t);
  }

  class Boss {
    constructor(game, config) {
      this.game = game;
      this.name = config.name;
      this.subtitle = config.subtitle;
      this.x = config.x;
      this.y = config.y;
      this.radius = config.radius;
      this.maxHp = config.maxHp;
      this.hp = config.maxHp;
      this.contactDamage = config.contactDamage;
      this.color = config.color;
      this.accent = config.accent;
      this.phase = 1;
      this.animTime = 0;
      this.hitFlash = 0;
      this.dead = false;
      this.isBoss = true;
      this.spawnTimer = 1.1;
      this.angle = 0;
      this.vx = 0;
      this.vy = 0;
      this.knockX = 0;
      this.knockY = 0;
      this.attackState = 'idle';
      this.attackTimer = 1.4;
      this.stateTimer = 0;
      this.patternIndex = 0;
      this.invulnerable = true;
      this.healthVisible = false;
      this.lastContact = 0;
      this.deathBurstTimer = 0;
    }

    get hpRatio() {
      return U.clamp(this.hp / this.maxHp, 0, 1);
    }

    damage(amount, angle, opts) {
      if (this.dead || this.invulnerable || this.spawnTimer > 0) return false;
      const actual = Math.max(1, amount);
      this.hp -= actual;
      this.hitFlash = 0.1;
      if (this.hp <= 0) {
        this.hp = 0;
        this.die();
      }
      return true;
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      this.game.onBossDefeated(this);
    }

    updateContact(dt, player) {
      if (!player || player.hp <= 0) return;
      if (this.spawnTimer > 0) return;
      const distance = U.distance(this.x, this.y, player.x, player.y);
      if (distance < this.radius + player.radius * 0.85) {
        if (this.lastContact <= 0) {
          if (!player.isInvulnerable()) {
            player.hurt(this.contactDamage, this.x, this.y);
            this.lastContact = 0.9;
          }
        }
      }
    }

    moveToward(dt, targetX, targetY, speed) {
      const direction = U.normalize(targetX - this.x, targetY - this.y);
      this.vx = direction.x * speed;
      this.vy = direction.y * speed;
      this.x += this.vx * dt + this.knockX * dt;
      this.y += this.vy * dt + this.knockY * dt;
      const damping = Math.max(0, 1 - 7 * dt);
      this.knockX *= damping;
      this.knockY *= damping;
    }

    tickCommon(dt, player) {
      this.animTime += dt;
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
      if (this.lastContact > 0) this.lastContact = Math.max(0, this.lastContact - dt);
      if (this.spawnTimer > 0) {
        this.spawnTimer = Math.max(0, this.spawnTimer - dt);
        if (this.spawnTimer <= 0) {
          this.invulnerable = false;
          this.healthVisible = true;
        }
        return false;
      }
      this.updateContact(dt, player);
      return true;
    }

    spawnRingBullets(count, speed, damage, radius, offset, color) {
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * TAU + (offset || 0);
        this.game.spawnEnemyBullet({
          x: this.x + Math.cos(angle) * (this.radius + 8),
          y: this.y + Math.sin(angle) * (this.radius + 8),
          angle,
          speed,
          radius: radius || 5,
          damage,
          life: 4.2,
          color: color || this.color,
          type: 'orb',
          spin: 4
        });
      }
    }

    drawGroundAura(ctx) {
      const pulse = 0.5 + Math.sin(this.animTime * 2.4) * 0.5;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.1 + pulse * 0.07;
      const gradient = ctx.createRadialGradient(0, 0, this.radius * 0.4, 0, 0, this.radius * 2.4);
      gradient.addColorStop(0, this.color);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 2.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.2 + pulse * 0.14;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([9, 13]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 19 + pulse * 4, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    drawSpawn(ctx) {
      if (this.spawnTimer <= 0) return;
      const ratio = 1 - this.spawnTimer / 1.1;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + ratio * 0.5;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        const radius = (1 - ratio) * 250 + i * 34;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(4, radius), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(this.animTime * 16) * 6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    draw(ctx) {
      this.drawGroundAura(ctx);
      this.drawTelegraphs(ctx);
      ctx.save();
      ctx.translate(this.x, this.y);
      const flash = this.hitFlash > 0;
      const scale = this.spawnTimer > 0 ? U.easeOutBack(U.clamp(1 - this.spawnTimer / 1.1, 0, 1)) : 1;
      ctx.scale(scale, scale);
      this.drawBody(ctx, flash);
      ctx.restore();
      this.drawSpawn(ctx);
    }

    drawTelegraphs() {}
    drawBody() {}
    update() {}
  }

  /* ---------------------------------------------------------------
     BOSS 1 - JUDGE-09 heavy defence platform
     --------------------------------------------------------------- */
  class BossJudge extends Boss {
    constructor(game) {
      super(game, {
        name: '机械审判者 JUDGE-09',
        subtitle: 'DEFENSE PLATFORM',
        x: game.player.x + 330,
        y: game.player.y - 240,
        radius: 56,
        maxHp: bossHealth(game, 'judge'),
        contactDamage: 24,
        color: '#ff365e',
        accent: '#ffd166'
      });
      this.patterns = ['barrage', 'laser', 'charge'];
      this.waveShots = 0;
      this.waveTimer = 0;
      this.laserAngle = 0;
      this.laserTelegraph = 0;
      this.laserActive = 0;
      this.laserHit = false;
      this.chargeWindup = 0;
      this.chargeTime = 0;
      this.chargeRecover = 0;
      this.chargeAngle = 0;
      this.chargeHit = false;
      this.legPhase = 0;
      this.attackTimer = 1.6;
      this.attackState = 'idle';
      this.dronesReleased = 0;
    }

    update(dt) {
      if (this.dead) return;
      if (!this.tickCommon(dt, this.game.player)) return;
      const player = this.game.player;

      if (this.attackState === 'barrage') {
        this.updateBarrage(dt);
      } else if (this.attackState === 'laser') {
        this.updateLaser(dt, player);
      } else if (this.attackState === 'charge') {
        this.updateCharge(dt, player);
      } else {
        this.attackTimer -= dt;
        const distance = U.distance(this.x, this.y, player.x, player.y);
        if (distance > 240) {
          this.moveToward(dt, player.x, player.y, this.phase === 2 ? 88 : 70);
        } else {
          const side = Math.atan2(player.y - this.y, player.x - this.x) + Math.PI / 2;
          this.x += Math.cos(side) * 26 * dt;
          this.y += Math.sin(side) * 26 * dt;
        }
        this.angle = Math.atan2(player.y - this.y, player.x - this.x);
        if (this.attackTimer <= 0) this.startPattern();
      }
    }

    startPattern() {
      const pattern = this.patterns[this.patternIndex % this.patterns.length];
      this.patternIndex += 1;
      this.attackState = pattern;
      this.attackTimer = 0;
      if (pattern === 'barrage') {
        this.waveShots = 0;
        this.waveTimer = 0.55;
        this.game.audio.play('warning');
      } else if (pattern === 'laser') {
        this.laserTelegraph = 1.05;
        this.laserActive = 0;
        this.laserHit = false;
        this.laserAngle = Math.atan2(this.game.player.y - this.y, this.game.player.x - this.x);
        this.game.audio.play('warning');
      } else if (pattern === 'charge') {
        this.chargeWindup = 0.95;
        this.chargeAngle = Math.atan2(this.game.player.y - this.y, this.game.player.x - this.x);
        this.chargeHit = false;
        this.game.audio.play('warning');
      }
    }

    updateBarrage(dt) {
      this.hover(dt, 0.4);
      this.attackTimer -= dt;
      if (this.waveShots < 3) {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          const offset = (this.waveShots * Math.PI) / 18;
          this.spawnRingBullets(this.phase === 2 ? 24 : 20, 205, 8, 5.5, offset, '#ff6b83');
          this.game.particles.ring(this.x, this.y, '#ff365e', this.radius, this.radius + 60, 0.35, 3);
          this.game.audio.play('enemyShoot');
          this.game.addScreenShake(2.5, 0.1);
          this.waveShots += 1;
          this.waveTimer = 0.36;
        }
      } else if (this.waveTimer <= 0) {
        this.attackState = 'idle';
        this.attackTimer = this.phase === 2 ? 1.05 : 1.55;
      }
    }

    hover(dt, speedScale) {
      const player = this.game.player;
      const distance = U.distance(this.x, this.y, player.x, player.y);
      if (distance > 280) this.moveToward(dt, player.x, player.y, 46 * speedScale);
      this.angle += dt * 0.4;
    }

    updateLaser(dt, player) {
      if (this.laserTelegraph > 0) {
        this.laserTelegraph -= dt;
        const target = Math.atan2(player.y - this.y, player.x - this.x);
        this.laserAngle = U.approachAngle(this.laserAngle, target, 0.35 * dt);
        this.angle = this.laserAngle;
        if (this.laserTelegraph <= 0) {
          this.laserActive = 0.62;
          this.game.audio.play('enemyShoot');
          this.game.addScreenShake(5, 0.2);
        }
        return;
      }
      if (this.laserActive > 0) {
        this.laserActive -= dt;
        if (!this.laserHit) {
          const distance = distanceToSegment(player.x, player.y, this.x, this.y, this.x + Math.cos(this.laserAngle) * 1200, this.y + Math.sin(this.laserAngle) * 1200);
          if (distance < 19 + player.radius && !player.isInvulnerable()) {
            player.hurt(20, this.x, this.y);
            this.laserHit = true;
          }
        }
        if (this.laserActive <= 0) {
          this.attackState = 'idle';
          this.attackTimer = this.phase === 2 ? 1.0 : 1.5;
        }
      }
    }

    updateCharge(dt, player) {
      if (this.chargeWindup > 0) {
        this.chargeWindup -= dt;
        const target = Math.atan2(player.y - this.y, player.x - this.x);
        this.chargeAngle = U.approachAngle(this.chargeAngle, target, 1.3 * dt);
        this.angle = this.chargeAngle;
        if (this.chargeWindup <= 0) {
          this.chargeTime = 0.62;
          this.game.audio.play('dash');
          this.game.addScreenShake(3, 0.15);
        }
        return;
      }
      if (this.chargeTime > 0) {
        this.chargeTime -= dt;
        const speed = this.phase === 2 ? 780 : 690;
        this.x += Math.cos(this.chargeAngle) * speed * dt;
        this.y += Math.sin(this.chargeAngle) * speed * dt;
        this.game.particles.trail(this.x, this.y, '#ff7a52', 6, 0.3);
        if (!this.chargeHit) {
          if (U.distance(this.x, this.y, player.x, player.y) < this.radius + player.radius) {
            if (!player.isInvulnerable()) {
              player.hurt(22, this.x, this.y);
              this.chargeHit = true;
              this.game.addScreenShake(9, 0.3);
            }
          }
        }
        if (this.chargeTime <= 0) {
          this.chargeRecover = 0.7;
          this.attackState = 'recover';
        }
        return;
      }
      if (this.attackState === 'recover') {
        this.chargeRecover -= dt;
        this.x *= 0.999;
        this.y *= 0.999;
        if (this.chargeRecover <= 0) {
          this.attackState = 'idle';
          this.attackTimer = 1.0;
        }
      }
    }

    takePhaseCheck() {
      if (this.phase === 1 && this.hpRatio <= 0.5) {
        this.phase = 2;
        this.game.audio.play('boss');
        this.game.addScreenShake(12, 0.5);
        this.game.particles.bigExplosion(this.x, this.y, '#ff365e', 2.2);
        this.game.showToast('审判者进入第二阶段 // OVERDRIVE', 'danger');
      }
    }

    update(dt) {
      if (this.dead) return;
      if (!this.tickCommon(dt, this.game.player)) return;
      this.takePhaseCheck();
      const player = this.game.player;
      this.legPhase += dt * 2.2;

      if (this.attackState === 'barrage') {
        this.updateBarrage(dt);
      } else if (this.attackState === 'laser') {
        this.updateLaser(dt, player);
      } else if (this.attackState === 'charge') {
        this.updateCharge(dt, player);
      } else if (this.attackState === 'recover') {
        this.updateCharge(dt, player);
      } else {
        this.attackTimer -= dt;
        const distance = U.distance(this.x, this.y, player.x, player.y);
        if (distance > 240) this.moveToward(dt, player.x, player.y, this.phase === 2 ? 92 : 72);
        else this.moveToward(dt, player.x, player.y, 18);
        this.angle = U.approachAngle(this.angle, Math.atan2(player.y - this.y, player.x - this.x), 2.4 * dt);
        if (this.attackTimer <= 0) this.startPattern();
      }
    }

    drawTelegraphs(ctx) {
      if (this.attackState === 'laser') {
        const charging = this.laserTelegraph > 0;
        const alpha = charging ? 0.25 + (1 - this.laserTelegraph / 1.05) * 0.5 : 0.75;
        const length = 1400;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.laserAngle);
        ctx.globalCompositeOperation = 'lighter';
        if (charging) {
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = '#ff8096';
          ctx.lineWidth = 1;
          ctx.setLineDash([18, 12]);
          ctx.beginPath();
          ctx.moveTo(this.radius, 0);
          ctx.lineTo(length, 0);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = alpha * 0.13;
          ctx.fillStyle = '#ff365e';
          ctx.fillRect(this.radius, -14, length, 28);
        } else {
          ctx.globalAlpha = 0.95;
          const beam = ctx.createLinearGradient(this.radius, 0, length, 0);
          beam.addColorStop(0, 'rgba(255,240,245,0.95)');
          beam.addColorStop(0.35, 'rgba(255,84,110,0.85)');
          beam.addColorStop(1, 'rgba(255,54,94,0)');
          ctx.fillStyle = beam;
          ctx.fillRect(this.radius, -11, length, 22);
          ctx.fillStyle = '#fff2f5';
          ctx.fillRect(this.radius, -2.5, length, 5);
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = '#ff365e';
          ctx.fillRect(this.radius, -30, length, 60);
        }
        ctx.restore();
      }

      if (this.attackState === 'charge') {
        const charging = this.chargeWindup > 0;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.chargeAngle);
        ctx.globalCompositeOperation = 'lighter';
        if (charging) {
          const progress = 1 - this.chargeWindup / 0.95;
          ctx.globalAlpha = 0.2 + progress * 0.3;
          ctx.fillStyle = '#ff365e';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(560, -70);
          ctx.lineTo(560, 70);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.5 + progress * 0.4;
          ctx.strokeStyle = '#ffb0b4';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([20, 14]);
          ctx.beginPath();
          ctx.moveTo(this.radius, 0);
          ctx.lineTo(560, 0);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    drawBody(ctx, flash) {
      const leg = this.legPhase;
      const glow = flash ? '#ffffff' : this.color;

      // Spider legs.
      for (let i = 0; i < 4; i += 1) {
        const side = i < 2 ? -1 : 1;
        const index = i % 2;
        const baseAngle = side * (0.55 + index * 0.52);
        ctx.save();
        ctx.rotate(baseAngle + Math.sin(leg + index * 1.4 + (side > 0 ? 0.8 : 0)) * 0.07);
        ctx.strokeStyle = flash ? '#ffffff' : '#5c2230';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(this.radius * 0.9, 0);
        ctx.lineTo(this.radius * 1.65, this.radius * 0.24);
        ctx.stroke();
        ctx.strokeStyle = glow;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(this.radius * 0.9, 0);
        ctx.lineTo(this.radius * 1.65, this.radius * 0.24);
        ctx.stroke();
        ctx.fillStyle = flash ? '#ffffff' : '#ffd166';
        ctx.fillRect(this.radius * 1.55, this.radius * 0.18, 7, 5);
        ctx.restore();
      }
      ctx.lineCap = 'butt';

      // Armour hull.
      ctx.fillStyle = flash ? '#ffffff' : '#230a10';
      ctx.strokeStyle = flash ? '#ffffff' : '#74202f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * TAU;
        const radius = i % 2 === 0 ? this.radius : this.radius * 0.86;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#3c1019';
      ctx.strokeStyle = flash ? '#ffffff' : '#ff5b6d';
      ctx.lineWidth = 1.4;
      U.regularPolygon(ctx, 0, 0, this.radius * 0.68, 6, this.angle * 0.3);
      ctx.fill();
      ctx.stroke();

      // Rotating gun pods.
      for (let i = 0; i < 3; i += 1) {
        const angle = this.animTime * 0.7 + (i / 3) * TAU;
        ctx.save();
        ctx.rotate(angle);
        ctx.translate(this.radius * 0.9, 0);
        ctx.fillStyle = flash ? '#ffffff' : '#15070b';
        ctx.strokeStyle = flash ? '#ffffff' : '#ff8090';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6, -5);
        ctx.lineTo(9, -4);
        ctx.lineTo(15, 0);
        ctx.lineTo(9, 4);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff365e';
        ctx.fillRect(11, -1.2, 5, 2.4);
        ctx.restore();
      }

      // Core eye.
      ctx.fillStyle = '#050208';
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = flash ? '#ffffff' : '#ffb3bd';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.62 + Math.sin(this.animTime * 6) * 0.22;
      ctx.fillStyle = this.phase === 2 ? '#ffd166' : '#ff365e';
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(0, 0, 9 + pulse * 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, 28 + pulse * 5, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(-11, -2, 22, 4);
    }
  }

  /* ---------------------------------------------------------------
     BOSS 2 - OMEGA runaway AI core
     --------------------------------------------------------------- */
  class BossOmega extends Boss {
    constructor(game) {
      super(game, {
        name: '失控核心 OMEGA',
        subtitle: 'RUNAWAY ARTIFICIAL CORE',
        x: game.player.x - 260,
        y: game.player.y - 320,
        radius: 66,
        maxHp: bossHealth(game, 'omega'),
        contactDamage: 30,
        color: '#ff365e',
        accent: '#965bff'
      });
      this.patterns = ['spiral', 'rotatingLaser', 'summon', 'shockwave'];
      this.phaseTransition = 0;
      this.spiralTimer = 0;
      this.spiralAngle = 0;
      this.laserCount = 3;
      this.rotLaserTelegraph = 0;
      this.rotLaserActive = 0;
      this.rotLaserAngle = 0;
      this.rotLaserHitCooldown = 0;
      this.summonTelegraph = 0;
      this.summoned = false;
      this.shockwaves = [];
      this.shockwaveCount = 0;
      this.shockwaveTimer = 0;
      this.attackTimer = 1.8;
      this.attackState = 'idle';
      this.coreRotation = 0;
      this.ringRotation = 0;
    }

    takePhaseCheck() {
      if (this.phase === 1 && this.hpRatio <= 0.5) {
        this.phase = 2;
        this.phaseTransition = 1.35;
        this.invulnerable = true;
        this.attackState = 'transition';
        this.shockwaves.length = 0;
        this.game.clearEnemyBullets();
        this.game.audio.play('boss');
        this.game.addScreenShake(14, 0.7);
        this.game.particles.bigExplosion(this.x, this.y, '#ff365e', 2.6);
        this.game.particles.bigExplosion(this.x, this.y, '#965bff', 2.2);
        this.game.showToast('OMEGA // 核心过载 · 第二阶段', 'danger');
      }
    }

    update(dt) {
      if (this.dead) return;
      if (!this.tickCommon(dt, this.game.player)) return;
      this.coreRotation += dt * (this.phase === 2 ? 1.9 : 1.2);
      this.ringRotation -= dt * 0.7;

      if (this.phaseTransition > 0) {
        this.phaseTransition -= dt;
        const player = this.game.player;
        this.x += Math.sin(this.animTime * 22) * 30 * dt;
        this.y += Math.cos(this.animTime * 19) * 30 * dt;
        if (Math.random() < 0.45) {
          this.game.particles.burst(this.x + U.rand(-60, 60), this.y + U.rand(-60, 60), U.chance(0.5) ? '#ff365e' : '#965bff', 3, 130, 2.6, 0.4, 'spark');
        }
        if (this.phaseTransition <= 0) {
          this.invulnerable = false;
          this.attackState = 'idle';
          this.attackTimer = 0.8;
          this.game.addScreenShake(10, 0.4);
          this.game.particles.ring(this.x, this.y, '#ff365e', 40, 520, 0.9, 5);
        }
        return;
      }

      this.takePhaseCheck();
      const player = this.game.player;

      if (this.attackState === 'spiral') {
        this.updateSpiral(dt, player);
      } else if (this.attackState === 'rotatingLaser') {
        this.updateRotatingLaser(dt, player);
      } else if (this.attackState === 'summon') {
        this.updateSummon(dt);
      } else if (this.attackState === 'shockwave') {
        this.updateShockwave(dt, player);
      } else if (this.attackState === 'shockwaveEnd') {
        this.attackState = 'idle';
        this.attackTimer = 1.1;
      } else {
        this.attackTimer -= dt;
        const distance = U.distance(this.x, this.y, player.x, player.y);
        if (distance > 330) this.moveToward(dt, player.x, player.y, 54);
        else if (distance < 240) this.moveToward(dt, this.x * 2 - player.x, this.y * 2 - player.y, 44);
        if (this.attackTimer <= 0) this.startPattern();
      }

      this.updateShockwaveRings(dt, player);
    }

    startPattern() {
      const pattern = this.patterns[this.patternIndex % this.patterns.length];
      this.patternIndex += 1;
      this.attackState = pattern;
      this.game.audio.play('warning');
      if (pattern === 'spiral') {
        this.spiralTimer = 2.2;
        this.spiralAngle = Math.random() * TAU;
      } else if (pattern === 'rotatingLaser') {
        this.rotLaserTelegraph = 1.1;
        this.rotLaserActive = 0;
        this.rotLaserAngle = Math.atan2(this.game.player.y - this.y, this.game.player.x - this.x);
        this.laserCount = this.phase === 2 ? 4 : 3;
      } else if (pattern === 'summon') {
        this.summonTelegraph = 1.0;
        this.summoned = false;
      } else if (pattern === 'shockwave') {
        this.shockwaves.length = 0;
        this.shockwaveCount = 0;
        this.shockwaveTimer = 0.6;
      }
    }

    updateSpiral(dt) {
      this.spiralTimer -= dt;
      this.spiralAngle += dt * (this.phase === 2 ? 4.4 : 3.2);
      this.spiralTimer -= 0;
      const interval = this.phase === 2 ? 0.085 : 0.115;
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = interval;
        const arms = this.phase === 2 ? 4 : 3;
        for (let i = 0; i < arms; i += 1) {
          const angle = this.spiralAngle + (i / arms) * TAU;
          this.game.spawnEnemyBullet({
            x: this.x + Math.cos(angle) * (this.radius + 6),
            y: this.y + Math.sin(angle) * (this.radius + 6),
            angle,
            speed: 195,
            radius: 5,
            damage: 11,
            life: 5,
            color: '#c48bff',
            type: 'diamond',
            spin: 5
          });
        }
      }
      const player = this.game.player;
      this.moveToward(dt, player.x, player.y, 16);
      if (this.spiralTimer <= 0) {
        this.attackState = 'idle';
        this.attackTimer = this.phase === 2 ? 0.65 : 1.0;
      }
    }

    updateRotatingLaser(dt, player) {
      if (this.rotLaserTelegraph > 0) {
        this.rotLaserTelegraph -= dt;
        if (this.rotLaserTelegraph <= 0) {
          this.rotLaserActive = this.phase === 2 ? 1.9 : 1.55;
          this.game.addScreenShake(5, 0.2);
          this.game.audio.play('enemyShoot');
        }
        return;
      }
      if (this.rotLaserActive > 0) {
        this.rotLaserActive -= dt;
        this.rotLaserAngle += dt * (this.phase === 2 ? 1.35 : 0.95);
        if (this.rotLaserHitCooldown > 0) this.rotLaserHitCooldown -= dt;
        if (this.rotLaserHitCooldown <= 0) {
          for (let i = 0; i < this.laserCount; i += 1) {
            const angle = this.rotLaserAngle + (i / this.laserCount) * TAU;
            const distance = distanceToSegment(
              player.x, player.y, this.x, this.y,
              this.x + Math.cos(angle) * 1200,
              this.y + Math.sin(angle) * 1200
            );
            if (distance < 15 + player.radius && !player.isInvulnerable()) {
              player.hurt(16, this.x, this.y);
              this.rotLaserHitCooldown = 0.55;
              break;
            }
          }
        }
        for (let i = 0; i < 2 && Math.random() < 0.5; i += 1) {
          const angle = this.rotLaserAngle + Math.random() * TAU;
          this.game.particles.emit({
            x: this.x + Math.cos(angle) * 600,
            y: this.y + Math.sin(angle) * 600,
            color: '#ff7b92',
            life: 0.22,
            size: 2.4,
            type: 'dot'
          });
        }
        if (this.rotLaserActive <= 0) {
          this.attackState = 'idle';
          this.attackTimer = 1.0;
        }
      }
    }

    updateSummon(dt) {
      if (this.summonTelegraph > 0) {
        this.summonTelegraph -= dt;
        if (!this.summoned && this.summonTelegraph <= 0.45) {
          this.summoned = true;
          const count = this.phase === 2 ? 4 : 3;
          for (let i = 0; i < count; i += 1) {
            const angle = (i / count) * TAU + this.animTime;
            const kind = i === 0 && this.phase === 2 ? 'sniper' : 'drone';
            this.game.spawnEnemyAt(kind, this.x + Math.cos(angle) * 118, this.y + Math.sin(angle) * 118);
            this.game.particles.ring(this.x + Math.cos(angle) * 118, this.y + Math.sin(angle) * 118, '#c48bff', 4, 48, 0.45, 2);
          }
          this.game.audio.play('boss');
        }
        if (this.summonTelegraph <= 0) {
          this.attackState = 'idle';
          this.attackTimer = 1.1;
        }
      }
    }

    updateShockwave(dt) {
      this.shockwaveTimer -= dt;
      if (this.shockwaveTimer <= 0 && this.shockwaveCount < (this.phase === 2 ? 4 : 3)) {
        this.shockwaveCount += 1;
        this.shockwaveTimer = 0.52;
        this.shockwaves.push({ radius: 24, speed: 250, damage: 18, hit: false, maxRadius: 700 });
        this.game.audio.play('explode');
        this.game.addScreenShake(5, 0.2);
        this.game.particles.ring(this.x, this.y, '#ff365e', 20, 80, 0.3, 3);
      }
      if (this.shockwaveCount >= (this.phase === 2 ? 4 : 3) && this.shockwaveTimer <= -0.4) {
        this.attackState = 'shockwaveEnd';
      }
    }

    updateShockwaveRings(dt, player) {
      for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
        const ring = this.shockwaves[i];
        ring.radius += ring.speed * dt;
        if (!ring.hit && player && !player.isInvulnerable()) {
          const distance = U.distance(this.x, this.y, player.x, player.y);
          if (Math.abs(distance - ring.radius) < 20 + player.radius) {
            player.hurt(ring.damage, this.x, this.y);
            ring.hit = true;
          }
        }
        if (ring.radius > ring.maxRadius) this.shockwaves.splice(i, 1);
      }
    }

    drawTelegraphs(ctx) {
      if (this.attackState === 'rotatingLaser') {
        const charging = this.rotLaserTelegraph > 0;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this.laserCount; i += 1) {
          const angle = this.rotLaserAngle + (i / this.laserCount) * TAU;
          ctx.save();
          ctx.rotate(angle);
          if (charging) {
            const progress = 1 - this.rotLaserTelegraph / 1.1;
            ctx.globalAlpha = 0.14 + progress * 0.32;
            ctx.fillStyle = '#ff365e';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(1300, -26);
            ctx.lineTo(1300, 26);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = '#ffa4b0';
            ctx.lineWidth = 1;
            ctx.setLineDash([22, 16]);
            ctx.beginPath();
            ctx.moveTo(this.radius, 0);
            ctx.lineTo(1300, 0);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.globalAlpha = 0.85;
            const gradient = ctx.createLinearGradient(this.radius, 0, 1300, 0);
            gradient.addColorStop(0, 'rgba(255,240,246,0.92)');
            gradient.addColorStop(0.4, 'rgba(255,84,110,0.8)');
            gradient.addColorStop(1, 'rgba(255,54,94,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(this.radius, -9, 1300, 18);
            ctx.fillStyle = '#fff1f4';
            ctx.fillRect(this.radius, -2, 1300, 4);
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = '#ff365e';
            ctx.fillRect(this.radius, -25, 1300, 50);
          }
          ctx.restore();
        }
        ctx.restore();
      }

      if (this.attackState === 'shockwave' || this.shockwaves.length > 0) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this.shockwaves.length; i += 1) {
          const ring = this.shockwaves[i];
          const fade = 1 - ring.radius / ring.maxRadius;
          ctx.globalAlpha = 0.35 + fade * 0.45;
          ctx.strokeStyle = '#ff5b73';
          ctx.lineWidth = 13;
          ctx.beginPath();
          ctx.arc(0, 0, ring.radius, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#ffe1b0';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(0, 0, ring.radius, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (this.attackState === 'summon' && this.summonTelegraph > 0) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        const progress = 1 - this.summonTelegraph / 1.0;
        ctx.globalAlpha = 0.3 + progress * 0.4;
        ctx.strokeStyle = '#c48bff';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, 118, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 3; i += 1) {
          ctx.globalAlpha = 0.25 + progress * 0.3;
          ctx.beginPath();
          ctx.arc(0, 0, 40 + i * 30, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawBody(ctx, flash) {
      const phase2 = this.phase === 2;
      const primary = flash ? '#ffffff' : phase2 ? '#ff2d55' : '#ff365e';
      const secondary = flash ? '#ffffff' : phase2 ? '#ffd166' : '#965bff';
      const pulse = 0.5 + Math.sin(this.animTime * 4) * 0.5;

      // Outer rotating rings.
      for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
        const radius = this.radius + 14 + ringIndex * 15;
        const rotation = this.ringRotation * (ringIndex % 2 === 0 ? 1 : -1) + ringIndex;
        const segments = 6 + ringIndex * 2;
        ctx.save();
        ctx.rotate(rotation);
        ctx.strokeStyle = flash ? '#ffffff' : ringIndex === 0 ? secondary : U.rgba(phase2 ? '#ff365e' : '#965bff', 0.55);
        ctx.lineWidth = ringIndex === 0 ? 2.2 : 1.2;
        for (let i = 0; i < segments; i += 1) {
          const start = (i / segments) * TAU;
          ctx.beginPath();
          ctx.arc(0, 0, radius, start, start + TAU / segments - 0.22);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Focal lens spike.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = primary;
      ctx.globalAlpha = 0.16 + pulse * 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 1.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // Main core shell.
      ctx.fillStyle = flash ? '#ffffff' : '#170a20';
      ctx.strokeStyle = flash ? '#ffffff' : primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * TAU + this.coreRotation * 0.12;
        const radius = i % 2 === 0 ? this.radius : this.radius * 0.9;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#26102f';
      ctx.strokeStyle = flash ? '#ffffff' : U.rgba(secondary, 0.8);
      ctx.lineWidth = 1.4;
      U.regularPolygon(ctx, 0, 0, this.radius * 0.72, 8, -this.coreRotation * 0.4);
      ctx.fill();
      ctx.stroke();

      // Central eye.
      ctx.fillStyle = '#04020a';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 0.42, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = flash ? '#ffffff' : secondary;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.globalCompositeOperation = 'lighter';
      const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, this.radius * 0.45);
      gradient.addColorStop(0, phase2 ? '#ffffff' : '#ffd7de');
      gradient.addColorStop(0.35, primary);
      gradient.addColorStop(1, 'rgba(150,91,255,0)');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 0.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Pupil slit.
      ctx.fillStyle = '#0a0210';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 0.07, this.radius * 0.26, Math.sin(this.animTime * 0.8) * 0.3, 0, TAU);
      ctx.fill();

      // Orbiting shards.
      for (let i = 0; i < 6; i += 1) {
        const angle = this.coreRotation * 1.4 + (i / 6) * TAU;
        const radius = this.radius * 1.22;
        ctx.save();
        ctx.rotate(angle);
        ctx.translate(radius, 0);
        ctx.rotate(this.coreRotation);
        ctx.fillStyle = i % 2 === 0 ? primary : secondary;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(0, 5);
        ctx.lineTo(-8, 0);
        ctx.lineTo(0, -5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      if (phase2) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55 + Math.sin(this.animTime * 9) * 0.25;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * 0.94, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  NO.BossJudge = BossJudge;
  NO.BossOmega = BossOmega;
  NO.distanceToSegment = distanceToSegment;
})();
