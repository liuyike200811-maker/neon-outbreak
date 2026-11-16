/* NEON OUTBREAK - player unit, auto weapon and dash */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;
  const TAU = Math.PI * 2;

  class Player {
    constructor(game, x, y) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.radius = 15;
      this.angle = -Math.PI / 2;
      this.aimAngle = -Math.PI / 2;
      this.animTime = 0;
      this.moving = false;
      this.moveAmount = 0;

      this.maxHp = 100;
      this.hp = 100;
      this.baseDamage = 12;
      this.damageMult = 1;
      this.damage = 12;
      this.baseAttackInterval = 0.45;
      this.attackIntervalMult = 1;
      this.attackInterval = 0.45;
      this.fireTimer = 0;
      this.range = 450;
      this.critChance = 0.05;
      this.critMultiplier = 1.5;
      this.pierce = 0;
      this.projectiles = 1;
      this.speedMult = 1;
      this.speed = 220;
      this.pickupRangeMult = 1;
      this.pickupRange = 160;

      this.dashCooldown = 3;
      this.dashCooldownTimer = 0;
      this.dashDuration = 0.18;
      this.dashTimer = 0;
      this.dashDirX = 0;
      this.dashDirY = -1;
      // 冲刺无敌帧：冲刺本体 0.18s 全程无敌，结束后再留 0.14s 的落地护盾，
      // 让「掐时机冲刺穿弹幕」成为可靠的防守手段，而不是刚落地就被子弹收掉。
      this.dashGrace = 0;
      this.dashGraceDuration = 0.14;
      // 完美闪避统计：冲刺期间被相位消除的敌方子弹数，用于打击反馈与结算。
      this.perfectDodges = 0;
      this.invuln = 0;
      this.flashTimer = 0;
      this.recoil = 0;
      this.muzzleFlash = 0;
      this.thrusterTimer = 0;
      // 脱战自愈：脱离伤害一段时间后缓慢回血，给会走位的玩家一条可持续的生存曲线。
      this.sinceHurt = 99;
      this.regenDelay = 4;
      this.regenRate = 1.4;

      this.upgradeLevels = Object.create(null);
      this.empLevel = 0;
      this.empTimer = 4.6;
      this.empRadius = 120;
      this.empDamage = 26;
      this.frostLevel = 0;
      this.frostChance = 0;
      this.volatileLevel = 0;
      this.volatileChance = 0;
      this.volatileRadius = 92;
      this.volatileDamage = 50;

      this.trail = [];
      this.trailTick = 0;
      this.contactPulse = 0;
    }

    recalculateStats() {
      this.empLevel = this.upgradeLevels.emp || 0;
      this.frostLevel = this.upgradeLevels.frost || 0;
      this.volatileLevel = this.upgradeLevels.volatile || 0;

      this.damage = Math.max(1, this.baseDamage * this.damageMult);
      this.attackInterval = Math.max(0.08, this.baseAttackInterval * this.attackIntervalMult);
      this.speed = Math.min(370, 220 * this.speedMult);
      this.critChance = Math.min(0.7, this.critChance);
      this.pickupRange = Math.min(380, 160 * this.pickupRangeMult);

      this.empRadius = 106 + this.empLevel * 14;
      this.empDamage = 20 + this.empLevel * 6;
      this.frostChance = this.frostLevel > 0 ? 0.12 + this.frostLevel * 0.08 : 0;
      this.volatileChance = this.volatileLevel > 0 ? 0.1 + this.volatileLevel * 0.1 : 0;
      this.volatileRadius = 92;
      this.volatileDamage = 50 + this.volatileLevel * 10;
    }

    isInvulnerable() {
      return this.invuln > 0 || this.dashTimer > 0 || this.dashGrace > 0;
    }

    // 只有「冲刺相位」状态才会吞噬敌方子弹，普通受击无敌不会。
    isPhasing() {
      return this.dashTimer > 0 || this.dashGrace > 0;
    }

    heal(amount) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + Math.max(0, amount));
      const healed = this.hp - before;
      if (healed > 0 && this.game) {
        this.game.particles.burst(this.x, this.y, '#5cffb2', 9, 95, 2.2, 0.4, 'dot');
        this.game.particles.ring(this.x, this.y, '#5cffb2', 10, 38, 0.35, 1.5);
        this.game.particles.label(this.x, this.y - 22, '+' + Math.round(healed), '#5cffb2', 13);
        if (this.game.ui) this.game.ui.updateHud();
      }
      return healed;
    }

    hurt(amount, sourceX, sourceY) {
      if (this.isInvulnerable()) return false;
      if (!this.game || this.game.state !== 'PLAYING') return false;
      const damage = Math.max(1, Math.round(amount));
      this.hp = Math.max(0, this.hp - damage);
      this.invuln = 0.6;
      this.flashTimer = 0.2;
      this.sinceHurt = 0;
      this.game.particles.burst(this.x, this.y, '#ff365e', 13, 165, 2.6, 0.42, 'spark');
      this.game.particles.ring(this.x, this.y, '#ff365e', 8, 34, 0.32, 2);
      this.game.particles.damageText(this.x, this.y - 16, damage, '#ff6b83', false);
      const dx = sourceX === undefined ? 0 : this.x - sourceX;
      const dy = sourceY === undefined ? 0 : this.y - sourceY;
      const direction = U.normalize(dx, dy);
      if (direction.length > 0.01) {
        this.vx += direction.x * 105;
        this.vy += direction.y * 105;
      }
      this.game.onPlayerHurt(damage);
      if (this.hp <= 0) {
        this.game.onPlayerDeath();
      }
      return true;
    }

    tryDash(move) {
      if (this.dashCooldownTimer > 0 || this.dashTimer > 0) return false;
      let dx = move.x;
      let dy = move.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.05) {
        dx = Math.cos(this.angle);
        dy = Math.sin(this.angle);
      }
      const direction = U.normalize(dx, dy);
      if (direction.length < 0.01) return false;
      this.dashDirX = direction.x;
      this.dashDirY = direction.y;
      this.dashTimer = this.dashDuration;
      this.dashGrace = 0;
      this.dashCooldownTimer = this.dashCooldown;
      this.trail.length = 0;
      this.game.onDash();
      return true;
    }

    // 被冲刺无敌帧「相位吞噬」的敌方子弹回调：产生绿色消解特效而不是无声消失，
    // 让玩家明确感知到「这一下我是靠冲刺躲掉的」。
    absorbProjectile(x, y) {
      this.perfectDodges += 1;
      const game = this.game;
      game.particles.burst(x, y, '#5cffb2', 7, 120, 2.4, 0.32, 'spark');
      game.particles.ring(x, y, '#5cffb2', 4, 20, 0.28, 1.4);
      if (this.perfectDodges % 12 === 0) {
        game.particles.label(x, y - 18, 'PHASE', '#5cffb2', 12);
      }
    }

    update(dt) {
      this.animTime += dt;
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
      if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.sinceHurt += dt;
      if (this.sinceHurt >= this.regenDelay && this.hp > 0 && this.hp < this.maxHp) {
        const regen = this.regenRate * dt;
        this.hp = Math.min(this.maxHp, this.hp + regen);
      }
      if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
      if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 8);
      if (this.dashCooldownTimer > 0) this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
      if (this.dashGrace > 0 && this.dashTimer <= 0) {
        this.dashGrace = Math.max(0, this.dashGrace - dt);
      }
      this.contactPulse += dt;

      const wantsDash = NO.Input.consume('Space');
      const move = NO.Input.getMove();

      if (wantsDash) this.tryDash(move);

      const movingInput = Math.sqrt(move.x * move.x + move.y * move.y) > 0.08;

      if (this.dashTimer > 0) {
        this.dashTimer = Math.max(0, this.dashTimer - dt);
        if (this.dashTimer <= 0) this.dashGrace = this.dashGraceDuration;
        const speed = this.speed * 3;
        this.x += this.dashDirX * speed * dt;
        this.y += this.dashDirY * speed * dt;
        this.vx = this.dashDirX * speed;
        this.vy = this.dashDirY * speed;
        this.angle = U.approachAngle(this.angle, Math.atan2(this.dashDirY, this.dashDirX), 18 * dt);
        this.trailTick -= dt;
        if (this.trailTick <= 0) {
          this.trailTick = 0.018;
          this.pushTrail();
        }
        this.game.particles.trail(
          this.x - this.dashDirX * 12,
          this.y - this.dashDirY * 12,
          '#00e5ff',
          3.2,
          0.24,
          -this.dashDirX * U.rand(30, 90),
          -this.dashDirY * U.rand(30, 90)
        );
      } else {
        const targetSpeedX = move.x * this.speed;
        const targetSpeedY = move.y * this.speed;
        const accel = movingInput ? 2500 : 1900;
        const maxDelta = accel * dt;
        this.vx = this.approach(this.vx, targetSpeedX, maxDelta);
        this.vy = this.approach(this.vy, targetSpeedY, maxDelta);
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        if (movingInput) {
          const desiredAngle = Math.atan2(targetSpeedY, targetSpeedX);
          this.angle = U.approachAngle(this.angle, desiredAngle, 12 * dt);
        }
        this.moving = movingInput || Math.sqrt(this.vx * this.vx + this.vy * this.vy) > 25;
        this.moveAmount = Math.min(1, Math.sqrt(this.vx * this.vx + this.vy * this.vy) / this.speed);

        if (this.moving) {
          this.thrusterTimer -= dt;
          if (this.thrusterTimer <= 0) {
            this.thrusterTimer = 0.045;
            const backX = this.x - Math.cos(this.angle) * 16;
            const backY = this.y - Math.sin(this.angle) * 16;
            const side = U.rand(-5, 5);
            this.game.particles.trail(
              backX + Math.cos(this.angle + Math.PI / 2) * side,
              backY + Math.sin(this.angle + Math.PI / 2) * side,
              U.chance(0.35) ? '#965bff' : '#00e5ff',
              U.rand(1.2, 2.6),
              U.rand(0.16, 0.34),
              -Math.cos(this.angle) * U.rand(20, 55),
              -Math.sin(this.angle) * U.rand(20, 55)
            );
          }
        }
      }

      for (let i = this.trail.length - 1; i >= 0; i -= 1) {
        this.trail[i].life -= dt;
        if (this.trail[i].life <= 0) this.trail.splice(i, 1);
      }

      this.fireTimer -= dt;
      if (this.fireTimer < 0) this.fireTimer = 0;
      const target = this.game.getNearestTarget(this.x, this.y, this.range);
      if (target) {
        const targetAngle = Math.atan2(target.y - this.y, target.x - this.x);
        this.aimAngle = U.approachAngle(this.aimAngle, targetAngle, 16 * dt);
        if (this.fireTimer <= 0) {
          this.fireAt(targetAngle);
          this.fireTimer = this.attackInterval;
        }
      } else if (this.moving) {
        this.aimAngle = U.approachAngle(this.aimAngle, this.angle, 8 * dt);
      }

      if (this.empLevel > 0) {
        this.empTimer -= dt;
        if (this.empTimer <= 0) {
          this.empTimer = 4.6;
          this.game.triggerEMP(this.empRadius, this.empDamage);
        }
      }
    }

    approach(value, target, maxDelta) {
      if (value < target) return Math.min(target, value + maxDelta);
      if (value > target) return Math.max(target, value - maxDelta);
      return target;
    }

    fireAt(angle) {
      const count = Math.max(1, this.projectiles);
      const spread = 0.115;
      const start = -(count - 1) * spread * 0.5;
      const originX = this.x + Math.cos(this.aimAngle) * 11;
      const originY = this.y + Math.sin(this.aimAngle) * 11;
      for (let i = 0; i < count; i += 1) {
        const bulletAngle = angle + start + i * spread;
        const crit = Math.random() < this.critChance;
        this.game.spawnPlayerBullet({
          x: originX + Math.cos(bulletAngle) * 22,
          y: originY + Math.sin(bulletAngle) * 22,
          angle: bulletAngle,
          damage: this.damage * (crit ? this.critMultiplier : 1),
          crit,
          pierce: this.pierce,
          frostChance: this.frostChance,
          color: crit ? '#ffd166' : '#9dfbff'
        });
      }
      const muzzleX = this.x + Math.cos(this.aimAngle) * 32;
      const muzzleY = this.y + Math.sin(this.aimAngle) * 32;
      this.game.particles.muzzle(muzzleX, muzzleY, angle, '#a4fcff');
      this.game.onPlayerShoot();
      this.muzzleFlash = 0.06;
      this.recoil = 1;
    }

    pushTrail() {
      this.trail.push({
        x: this.x,
        y: this.y,
        angle: this.angle,
        aim: this.aimAngle,
        life: 0.25,
        maxLife: 0.25
      });
      if (this.trail.length > 16) this.trail.shift();
    }

    draw(ctx) {
      for (let i = 0; i < this.trail.length; i += 1) {
        const t = this.trail[i];
        const a = Math.max(0, t.life / t.maxLife);
        ctx.save();
        ctx.globalAlpha = a * 0.24;
        ctx.translate(t.x, t.y);
        ctx.rotate(t.angle);
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath();
        ctx.moveTo(19, 0);
        ctx.lineTo(1, 10);
        ctx.lineTo(-13, 7);
        ctx.lineTo(-9, 0);
        ctx.lineTo(-13, -7);
        ctx.lineTo(1, -10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#bffbff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      const flash = this.flashTimer > 0 ? Math.sin(this.animTime * 90) > -0.2 : false;
      const t = this.animTime;
      const pulse = 0.5 + Math.sin(t * 4.2) * 0.5;
      const thrust = this.moving ? (0.65 + Math.random() * 0.35) : 0.15;

      ctx.save();
      ctx.translate(this.x, this.y);

      ctx.globalAlpha = 0.56;
      ctx.fillStyle = 'rgba(0,6,14,0.72)';
      ctx.beginPath();
      ctx.ellipse(2, 7, 21, 12, 0, 0, TAU);
      ctx.fill();

      if (this.isInvulnerable()) {
        const phasing = this.isPhasing();
        ctx.globalAlpha = phasing ? 0.72 : 0.3 + Math.sin(t * 22) * 0.12;
        ctx.strokeStyle = phasing ? '#5cffb2' : '#00e5ff';
        ctx.lineWidth = phasing ? 1.8 : 1.4;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, (phasing ? 26 : 24) + Math.sin(t * 6) * 1.5, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.rotate(this.angle);

      // Thruster flames extend behind the unit.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#00e5ff';
      ctx.globalAlpha = 0.5 + thrust * 0.4;
      ctx.beginPath();
      ctx.moveTo(-12, -5);
      ctx.lineTo(-18 - thrust * 12, -2.4);
      ctx.lineTo(-12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#965bff';
      ctx.beginPath();
      ctx.moveTo(-12, 1);
      ctx.lineTo(-17 - thrust * 9, 3.2);
      ctx.lineTo(-12, 5);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      const bodyFill = flash ? '#ffffff' : '#0a1d2e';
      const bodyMid = flash ? '#ffffff' : '#123b4d';
      const edge = flash ? '#ffffff' : '#54d9e9';

      // Rear engine block and side plates.
      ctx.fillStyle = flash ? '#ffffff' : '#081521';
      ctx.strokeStyle = flash ? '#ffffff' : '#2a7f94';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-15, -8);
      ctx.lineTo(-8, -11);
      ctx.lineTo(1, -9);
      ctx.lineTo(1, 9);
      ctx.lineTo(-8, 11);
      ctx.lineTo(-15, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = bodyMid;
      ctx.beginPath();
      ctx.moveTo(-2, -14);
      ctx.lineTo(7, -11);
      ctx.lineTo(12, -5);
      ctx.lineTo(12, 5);
      ctx.lineTo(7, 11);
      ctx.lineTo(-2, 14);
      ctx.lineTo(-6, 7);
      ctx.lineTo(-6, -7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.stroke();

      // Main armor shell.
      ctx.fillStyle = bodyFill;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(11, -8);
      ctx.lineTo(18, -3.3);
      ctx.lineTo(19, 0);
      ctx.lineTo(18, 3.3);
      ctx.lineTo(11, 8);
      ctx.lineTo(0, 11);
      ctx.lineTo(-5, 5);
      ctx.lineTo(-5, -5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Shoulder pods.
      ctx.fillStyle = flash ? '#ffffff' : '#1b4c61';
      ctx.strokeStyle = flash ? '#ffffff' : '#61efff';
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.translate(1, side * 11);
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(-2, -4);
        ctx.lineTo(5, -3);
        ctx.lineTo(6, 0);
        ctx.lineTo(3, 4);
        ctx.lineTo(-3, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = flash ? '#ffffff' : '#00e5ff';
        ctx.fillRect(-2.5, -0.7, 5, 1.4);
        ctx.restore();
      }

      // Cockpit sensor slit.
      ctx.fillStyle = flash ? '#ffffff' : '#a9fcff';
      ctx.beginPath();
      ctx.moveTo(12, -2.4);
      ctx.lineTo(17, 0);
      ctx.lineTo(12, 2.4);
      ctx.closePath();
      ctx.fill();

      // Core housing.
      ctx.fillStyle = '#03121b';
      ctx.beginPath();
      ctx.arc(2, 0, 6.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = flash ? '#ffffff' : '#2f9ab1';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#00e5ff';
      ctx.globalAlpha = 0.55 + pulse * 0.35;
      ctx.beginPath();
      ctx.arc(2, 0, 3.3 + pulse * 0.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#5cffb2';
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(2, 0, 7.5, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Small tech markings.
      ctx.strokeStyle = flash ? '#ffffff' : '#2e7f92';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-2, -7);
      ctx.lineTo(4, -7);
      ctx.moveTo(-2, 7);
      ctx.lineTo(4, 7);
      ctx.stroke();

      ctx.restore();

      // Weapon assembly independently tracks the nearest target.
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.aimAngle);
      ctx.translate(-this.recoil * 1.7, 0);

      ctx.fillStyle = flash ? '#ffffff' : '#07131e';
      ctx.strokeStyle = flash ? '#ffffff' : '#3b9db3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, -4.4);
      ctx.lineTo(27, -2.3);
      ctx.lineTo(29, 0);
      ctx.lineTo(27, 2.3);
      ctx.lineTo(4, 4.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#183f4f';
      ctx.fillRect(7, -5.7, 8, 11.4);
      ctx.strokeStyle = '#65e8f7';
      ctx.strokeRect(7, -5.7, 8, 11.4);
      ctx.fillStyle = '#00e5ff';
      ctx.globalAlpha = 0.75;
      ctx.fillRect(15, -1.1, 9, 2.2);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#06131d';
      ctx.fillRect(21, -3.9, 5, 7.8);
      ctx.fillStyle = '#5cffb2';
      ctx.fillRect(26.2, -1.2, 1.8, 2.4);

      if (this.muzzleFlash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#d5ffff';
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.moveTo(27, 0);
        ctx.lineTo(37, -4.5);
        ctx.lineTo(34, 0);
        ctx.lineTo(37, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#00e5ff';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(31, 0, 4.2, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();

      if (this.dashCooldownTimer > 0) {
        const ratio = 1 - this.dashCooldownTimer / this.dashCooldown;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.strokeStyle = 'rgba(0,229,255,0.24)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(0, 0, 27, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  NO.Player = Player;
})();
