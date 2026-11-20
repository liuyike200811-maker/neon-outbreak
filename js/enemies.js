/* NEON OUTBREAK - five hostile machine archetypes and enemy projectiles */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;
  const TAU = Math.PI * 2;

  class EnemyBullet {
    constructor(game, config) {
      this.game = game;
      this.x = config.x;
      this.y = config.y;
      const angle = config.angle === undefined ? 0 : config.angle;
      const speed = config.speed === undefined ? 260 : config.speed;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.radius = config.radius || 5;
      this.damage = config.damage || 10;
      this.life = config.life || 2.4;
      this.maxLife = this.life;
      this.color = config.color || '#c68bff';
      this.type = config.type || 'orb';
      this.angle = angle;
      this.spin = config.spin || 0;
      this.rotation = Math.random() * TAU;
      this.dead = false;
      this.age = 0;
    }

    update(dt) {
      this.age += dt;
      this.life -= dt;
      this.rotation += this.spin * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.life <= 0) this.dead = true;
    }

    draw(ctx) {
      const ratio = U.clamp(this.life / this.maxLife, 0, 1);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.24 + ratio * 0.45;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 2.1, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = this.color;
      if (this.type === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(this.radius * 1.5, 0);
        ctx.lineTo(0, this.radius);
        ctx.lineTo(-this.radius * 1.5, 0);
        ctx.lineTo(0, -this.radius);
        ctx.closePath();
        ctx.fill();
      } else if (this.type === 'shard') {
        ctx.beginPath();
        ctx.moveTo(this.radius * 2.2, 0);
        ctx.lineTo(-this.radius, this.radius * 0.6);
        ctx.lineTo(-this.radius, -this.radius * 0.6);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 0.36, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.26;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.radius * 0.9;
      ctx.beginPath();
      ctx.moveTo(-this.vx * 0.025, -this.vy * 0.025);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  class Enemy {
    constructor(game, x, y, def) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.kind = def.kind;
      this.name = def.name;
      this.maxHp = def.hp;
      this.hp = def.hp;
      this.baseSpeed = def.speed;
      this.speed = def.speed;
      this.radius = def.radius;
      this.contactDamage = def.contactDamage;
      this.xp = def.xp;
      this.score = def.score;
      this.color = def.color;
      this.accent = def.accent;
      this.mass = def.mass || 1;
      this.angle = Math.atan2(game.player.y - y, game.player.x - x) + Math.PI;
      this.aimAngle = Math.atan2(game.player.y - y, game.player.x - x);
      this.animTime = Math.random() * 10;
      this.spawnTimer = 0.26;
      this.hitFlash = 0;
      this.slowTimer = 0;
      this.knockX = 0;
      this.knockY = 0;
      this.alive = true;
      this.dead = false;
      this.isElite = Boolean(def.isElite);
      this.type = def.kind;
      this.chargeDamage = def.chargeDamage || def.contactDamage;
      this.seed = Math.random() * 10;
      this.wobble = 0;
    }

    applySlow(duration) {
      if (this.dead) return;
      this.slowTimer = Math.max(this.slowTimer, duration || 1.3);
      this.game.particles.emit({
        x: this.x,
        y: this.y - this.radius,
        vx: U.rand(-12, 12),
        vy: U.rand(-30, -8),
        color: '#9ad9ff',
        life: 0.4,
        size: 1.8,
        type: 'dot'
      });
    }

    damage(amount, hitAngle, opts) {
      if (!this.alive || this.dead) return false;
      const actual = Math.max(1, amount);
      this.hp -= actual;
      this.hitFlash = 0.12;
      const options = opts || {};
      const knockback = (options.knockback === undefined ? 52 : options.knockback) / Math.max(0.3, this.mass);
      if (hitAngle !== undefined) {
        this.knockX += Math.cos(hitAngle) * knockback;
        this.knockY += Math.sin(hitAngle) * knockback;
      }
      if (options.frostChance && Math.random() < options.frostChance) {
        this.applySlow(options.frostDuration || 1.3);
      }
      if (this.hp <= 0) {
        this.hp = 0;
        this.die(options);
      }
      return true;
    }

    die(options) {
      if (!this.alive) return;
      this.alive = false;
      this.dead = true;
      this.game.onEnemyKilled(this, options || {});
    }

    getContactDamage() {
      return this.contactDamage;
    }

    update(dt, player) {
      this.animTime += dt;
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
      if (this.slowTimer > 0) this.slowTimer = Math.max(0, this.slowTimer - dt);
      if (this.spawnTimer > 0) {
        this.spawnTimer = Math.max(0, this.spawnTimer - dt);
        return;
      }
      if (!player || player.hp <= 0) return;

      const slowFactor = this.slowTimer > 0 ? 0.58 : 1;
      this.updateBehavior(dt, player, slowFactor);

      this.x += (this.knockX + this.vx) * dt;
      this.y += (this.knockY + this.vy) * dt;
      const damping = Math.max(0, 1 - 9 * dt);
      this.knockX *= damping;
      this.knockY *= damping;
    }

    updateBehavior(dt, player, slowFactor) {
      const direction = U.normalize(player.x - this.x, player.y - this.y);
      this.vx = direction.x * this.speed * slowFactor;
      this.vy = direction.y * this.speed * slowFactor;
      const targetAngle = Math.atan2(direction.y, direction.x);
      this.angle = U.approachAngle(this.angle, targetAngle, 5 * dt);
    }

    draw(ctx) {
      this.drawTelegraph(ctx);
      const spawnScale = this.spawnTimer > 0 ? U.easeOutBack(1 - this.spawnTimer / 0.26) : 1;
      const flash = this.hitFlash > 0;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(0,3,8,0.68)';
      ctx.beginPath();
      ctx.ellipse(2, 7, this.radius * 1.1, this.radius * 0.58, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.rotate(this.angle);
      ctx.scale(spawnScale, spawnScale);
      this.drawBody(ctx, flash);
      ctx.restore();

      if (this.slowTimer > 0) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.strokeStyle = 'rgba(153,220,255,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + 5 + Math.sin(this.animTime * 8), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // 血条常显：五种敌人都有自己的血条，宽度/厚度按体型区分。
      // 满血的杂兵压到半透明，避免几十条血条糊满画面；受损后立刻变成实色。
      this.drawHealthBar(ctx);
    }

    drawBody(ctx, flash) {
      ctx.fillStyle = flash ? '#ffffff' : '#35121b';
      ctx.strokeStyle = flash ? '#ffffff' : this.color;
      ctx.lineWidth = 1.4;
      U.regularPolygon(ctx, 0, 0, this.radius, 5, this.animTime);
      ctx.fill();
      ctx.stroke();
    }

    drawTelegraph() {}

    drawHealthBar(ctx) {
      const ratio = U.clamp(this.hp / this.maxHp, 0, 1);
      // 体型小的单位用更窄的条，避免小怪血条互相叠在一起。
      const width = Math.max(18, this.radius * 2);
      const thick = this.isElite ? 5 : this.kind === 'tank' ? 4 : 3;
      const damaged = ratio < 0.999;
      // 满血杂兵弱化显示：画面里几十个敌人时，全亮血条会像贴纸一样糊住场景。
      const alpha = this.isElite || damaged ? 1 : 0.42;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x - width / 2, this.y - this.radius - 11);
      ctx.fillStyle = 'rgba(2,6,12,0.82)';
      ctx.fillRect(0, 0, width, thick);
      ctx.fillStyle = ratio > 0.45 ? this.color : '#ff365e';
      ctx.fillRect(0, 0, width * ratio, thick);
      ctx.strokeStyle = this.isElite ? 'rgba(185,139,255,0.55)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-0.5, -0.5, width + 1, thick + 1);
      ctx.restore();
    }
  }

  class Drone extends Enemy {
    constructor(game, x, y) {
      super(game, x, y, {
        kind: 'drone',
        name: '追踪无人机',
        hp: 24,
        speed: 95,
        radius: 13,
        contactDamage: 6,
        xp: 3,
        score: 25,
        color: '#ff365e',
        accent: '#ffb0a4',
        mass: 0.8
      });
      this.orbit = Math.random() < 0.5 ? -1 : 1;
    }

    updateBehavior(dt, player, slowFactor) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const orbitAngle = Math.atan2(dy, dx) + this.orbit * Math.sin(this.animTime * 2.2 + this.seed) * 0.16;
      this.angle = U.approachAngle(this.angle, orbitAngle, 7 * dt);
      const speed = this.speed * slowFactor * (1 + Math.sin(this.animTime * 3.5 + this.seed) * 0.08);
      this.vx = (dx / distance) * speed;
      this.vy = (dy / distance) * speed;
    }

    drawBody(ctx, flash) {
      const spin = this.animTime * 8 + this.seed;
      ctx.strokeStyle = flash ? '#ffffff' : 'rgba(255,54,94,0.34)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        ctx.save();
        ctx.rotate(spin + (i * TAU) / 3);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + 5, 0.15, 1.15);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = flash ? '#ffffff' : '#2a0a14';
      ctx.strokeStyle = flash ? '#ffffff' : this.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-5, 11);
      ctx.lineTo(-9, 4);
      ctx.lineTo(-15, 3);
      ctx.lineTo(-12, -1);
      ctx.lineTo(-15, -3);
      ctx.lineTo(-9, -4);
      ctx.lineTo(-5, -11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#571426';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, 5);
      ctx.lineTo(-4, -5);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.7 + Math.sin(this.animTime * 11) * 0.25;
      ctx.beginPath();
      ctx.arc(2, 0, 3.2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(2, 0, 7, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffd2c9';
      ctx.fillRect(9, -1, 3, 2);
    }
  }

  class Tank extends Enemy {
    constructor(game, x, y) {
      super(game, x, y, {
        kind: 'tank',
        name: '重装机器人',
        hp: 90,
        speed: 55,
        radius: 23,
        contactDamage: 11,
        xp: 7,
        score: 65,
        color: '#ff6e58',
        accent: '#ffd166',
        mass: 2.8
      });
    }

    updateBehavior(dt, player, slowFactor) {
      const direction = U.normalize(player.x - this.x, player.y - this.y);
      this.vx = direction.x * this.speed * slowFactor;
      this.vy = direction.y * this.speed * slowFactor;
      this.angle = U.approachAngle(this.angle, Math.atan2(direction.y, direction.x), 1.8 * dt);
    }

    drawBody(ctx, flash) {
      ctx.fillStyle = flash ? '#ffffff' : '#25110f';
      ctx.strokeStyle = flash ? '#ffffff' : '#743b31';
      ctx.lineWidth = 1;
      for (let side = -1; side <= 1; side += 2) {
        ctx.fillRect(-16, side * 14 - 4, 30, 8);
        ctx.strokeRect(-16, side * 14 - 4, 30, 8);
        const treadOffset = (this.animTime * 24) % 8;
        ctx.fillStyle = flash ? '#ffffff' : '#a06050';
        for (let i = -14; i < 12; i += 8) {
          ctx.fillRect(i + treadOffset - 8, side * 14 - 2, 3, 4);
        }
        ctx.fillStyle = flash ? '#ffffff' : '#25110f';
      }

      ctx.fillStyle = flash ? '#ffffff' : '#3a1a17';
      ctx.strokeStyle = flash ? '#ffffff' : this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(17, -12);
      ctx.lineTo(23, -6);
      ctx.lineTo(23, 6);
      ctx.lineTo(17, 12);
      ctx.lineTo(-9, 14);
      ctx.lineTo(-15, 8);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-9, -14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#5b2a23';
      ctx.strokeStyle = flash ? '#ffffff' : '#ff9d7d';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(-1, 0, 8.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a0a09';
      ctx.beginPath();
      ctx.arc(-1, 0, 4, 0, TAU);
      ctx.fill();

      ctx.fillStyle = flash ? '#ffffff' : '#371713';
      ctx.strokeStyle = flash ? '#ffffff' : '#ffb076';
      ctx.fillRect(0, -3.4, 28, 6.8);
      ctx.strokeRect(0, -3.4, 28, 6.8);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(25, -1.4, 5, 2.8);

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff9a5c';
      ctx.globalAlpha = 0.55 + Math.sin(this.animTime * 4) * 0.2;
      ctx.beginPath();
      ctx.arc(27, 0, 4, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      ctx.strokeStyle = flash ? '#ffffff' : '#ff9d7d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-12, -8);
      ctx.lineTo(-4, -8);
      ctx.moveTo(-12, 8);
      ctx.lineTo(-4, 8);
      ctx.stroke();
    }
  }

  class Sniper extends Enemy {
    constructor(game, x, y) {
      super(game, x, y, {
        kind: 'sniper',
        name: '狙击机器人',
        hp: 45,
        speed: 68,
        radius: 14,
        contactDamage: 5,
        xp: 6,
        score: 55,
        color: '#b06dff',
        accent: '#ead5ff',
        mass: 1
      });
      this.preferredRange = 300;
      this.shotCooldown = U.rand(1.3, 2.4);
      this.telegraph = 0;
      this.telegraphDuration = 0.72;
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.aimAngle = Math.atan2(game.player.y - y, game.player.x - x);
    }

    updateBehavior(dt, player, slowFactor) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const toPlayer = Math.atan2(dy, dx);
      this.aimAngle = U.approachAngle(this.aimAngle, toPlayer, (this.telegraph > 0 ? 2.4 : 1.4) * dt);
      this.angle = this.aimAngle;

      let moveAngle;
      if (distance < 215) {
        moveAngle = toPlayer + Math.PI;
      } else if (distance > 390) {
        moveAngle = toPlayer;
      } else {
        moveAngle = toPlayer + (Math.PI / 2) * this.strafe;
      }
      const movement = this.telegraph > 0 ? 0.18 : 1;
      this.vx = Math.cos(moveAngle) * this.speed * slowFactor * movement;
      this.vy = Math.sin(moveAngle) * this.speed * slowFactor * movement;

      if (this.telegraph > 0) {
        this.telegraph -= dt;
        if (this.telegraph <= 0) {
          this.fire(player);
        }
      } else {
        this.shotCooldown -= dt;
        if (this.shotCooldown <= 0 && distance < 560) {
          this.telegraph = this.telegraphDuration;
          this.game.particles.ring(this.x, this.y, '#b06dff', 7, 30, 0.42, 1.3);
        }
      }
    }

    fire(player) {
      const angle = Math.atan2(player.y - this.y, player.x - this.x);
      this.game.spawnEnemyBullet({
        x: this.x + Math.cos(angle) * 21,
        y: this.y + Math.sin(angle) * 21,
        angle,
        speed: 315,
        radius: 5,
        damage: 9,
        life: 2.7,
        color: '#c38bff',
        type: 'shard',
        spin: 3
      });
      this.game.particles.muzzle(this.x + Math.cos(angle) * 22, this.y + Math.sin(angle) * 22, angle, '#c38bff');
      this.game.audio.play('enemyShoot');
      this.shotCooldown = U.rand(2.4, 3.4);
    }

    drawTelegraph(ctx) {
      if (this.telegraph <= 0) return;
      const progress = 1 - this.telegraph / this.telegraphDuration;
      const length = 640;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.aimAngle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22 + progress * 0.55;
      ctx.strokeStyle = '#c58aff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([13, 8]);
      ctx.beginPath();
      ctx.moveTo(21, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.55 + progress * 0.4;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 16 + progress * 9, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    drawBody(ctx, flash) {
      const charge = this.telegraph > 0 ? 1 - this.telegraph / this.telegraphDuration : 0;
      ctx.fillStyle = flash ? '#ffffff' : '#170f2a';
      ctx.strokeStyle = flash ? '#ffffff' : this.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(8, 4);
      ctx.lineTo(-7, 9);
      ctx.lineTo(-16, 4);
      ctx.lineTo(-12, 0);
      ctx.lineTo(-16, -4);
      ctx.lineTo(-7, -9);
      ctx.lineTo(8, -4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#2b1b48';
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.translate(2, side * 8);
        ctx.rotate(side * 0.38);
        ctx.fillRect(-10, -1.6, 24, 3.2);
        ctx.strokeStyle = flash ? '#ffffff' : '#7e50bd';
        ctx.strokeRect(-10, -1.6, 24, 3.2);
        ctx.restore();
      }

      ctx.strokeStyle = flash ? '#ffffff' : '#d9b9ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(1, 0, 7.5, 0.2, TAU - 0.2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ae6aff';
      ctx.globalAlpha = 0.65 + charge * 0.35;
      ctx.beginPath();
      ctx.arc(2, 0, 3 + charge * 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.25 + charge * 0.3;
      ctx.beginPath();
      ctx.arc(2, 0, 8 + charge * 3, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = charge > 0.4 ? '#ffffff' : '#e4d2ff';
      ctx.fillRect(11, -1, 5, 2);
    }
  }

  class Bomber extends Enemy {
    constructor(game, x, y) {
      super(game, x, y, {
        kind: 'bomber',
        name: '自爆机械虫',
        hp: 18,
        speed: 138,
        radius: 12,
        contactDamage: 7,
        xp: 4,
        score: 40,
        color: '#ff9f43',
        accent: '#ffe1a0',
        mass: 0.6
      });
      this.fuse = 0;
      this.explosionRadius = 88;
      this.explosionDamage = 26;
      this.arming = false;
      this.legPhase = Math.random() * TAU;
    }

    updateBehavior(dt, player, slowFactor) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      this.legPhase += dt * 14;
      if (this.fuse > 0) {
        this.vx = 0;
        this.vy = 0;
        this.fuse -= dt;
        this.angle += dt * 3.4;
        if (this.fuse <= 0) this.detonate();
        return;
      }
      if (distance < 76) {
        this.fuse = 1.18;
        this.arming = true;
        this.game.audio.play('warning');
        this.game.particles.ring(this.x, this.y, '#ff9f43', 9, this.explosionRadius, 0.65, 2);
        return;
      }
      const speed = this.speed * slowFactor;
      this.vx = (dx / distance) * speed;
      this.vy = (dy / distance) * speed;
      this.angle = U.approachAngle(this.angle, Math.atan2(dy, dx), 9 * dt);
    }

    detonate() {
      if (this.dead) return;
      const player = this.game.player;
      if (player && !player.isInvulnerable()) {
        const distance = U.distance(this.x, this.y, player.x, player.y);
        if (distance < this.explosionRadius + player.radius) {
          player.hurt(this.explosionDamage, this.x, this.y);
        }
      }
      this.game.particles.bigExplosion(this.x, this.y, '#ff9f43', 1.25);
      this.game.particles.ring(this.x, this.y, '#ffd166', 12, this.explosionRadius, 0.44, 3);
      this.game.audio.play('explode');
      this.game.addScreenShake(7, 0.22);
      this.game.onBomberExploded(this);
      this.die({ cause: 'self-destruct', byPlayer: false, silentDeath: true });
    }

    getContactDamage() {
      return this.fuse > 0 ? 7 : this.contactDamage;
    }

    drawTelegraph(ctx) {
      if (this.fuse <= 0) return;
      const ratio = U.clamp(this.fuse / 1.18, 0, 1);
      const pulse = 0.48 + Math.sin(this.animTime * 24) * 0.24;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalAlpha = pulse * 0.7;
      ctx.strokeStyle = '#ff7b2d';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, this.explosionRadius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.13 + pulse * 0.14;
      ctx.fillStyle = '#ff5a1f';
      ctx.beginPath();
      ctx.arc(0, 0, this.explosionRadius, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - ratio));
      ctx.stroke();
      ctx.restore();
    }

    drawBody(ctx, flash) {
      const blink = this.fuse > 0 && Math.sin(this.animTime * (20 + (1.18 - this.fuse) * 30)) > 0;
      const color = flash || blink ? '#ffffff' : this.color;
      ctx.save();
      ctx.rotate(this.animTime * (this.fuse > 0 ? 1.6 : 0.4));
      ctx.fillStyle = flash || blink ? '#ffffff' : '#321a08';
      ctx.strokeStyle = blink ? '#ffffff' : color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * TAU + (i % 2 === 0 ? 0.06 : -0.04);
        const radius = i % 2 === 0 ? this.radius + 7 : this.radius * 0.66;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = flash ? '#ffffff' : '#1b0c04';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const corePulse = this.fuse > 0 ? 1 - this.fuse / 1.18 : 0.35;
      ctx.fillStyle = blink ? '#ffffff' : '#ffb23c';
      ctx.globalAlpha = 0.65 + corePulse * 0.35;
      ctx.beginPath();
      ctx.arc(0, 0, 3.2 + corePulse * 4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.2 + corePulse * 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + corePulse * 9, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = blink ? '#ffffff' : '#ffe1a0';
      ctx.fillRect(8, -1, 4, 2);
    }
  }

  class Elite extends Enemy {
    constructor(game, x, y) {
      super(game, x, y, {
        kind: 'elite',
        name: '精英守卫',
        hp: 220,
        speed: 70,
        radius: 27,
        contactDamage: 7,
        chargeDamage: 10,
        xp: 20,
        score: 180,
        color: '#8f7bff',
        accent: '#5cffb2',
        mass: 4.5,
        isElite: true
      });
      this.state = 'chase';
      this.chargeTimer = U.rand(1.9, 2.8);
      this.windup = 0;
      this.chargeTime = 0;
      this.chargeRecover = 0;
      this.lockedAngle = this.angle;
    }

    getContactDamage() {
      return this.state === 'charging' ? this.chargeDamage : this.contactDamage;
    }

    updateBehavior(dt, player, slowFactor) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const toPlayer = Math.atan2(dy, dx);

      if (this.state === 'windup') {
        this.windup -= dt;
        this.vx = 0;
        this.vy = 0;
        this.lockedAngle = U.approachAngle(this.lockedAngle, toPlayer, 2.2 * dt);
        this.angle = this.lockedAngle;
        if (this.windup <= 0) {
          this.state = 'charging';
          this.chargeTime = 0.62;
          this.game.audio.play('dash');
          this.game.particles.ring(this.x, this.y, '#b7a4ff', 18, 68, 0.35, 3);
        }
        return;
      }

      if (this.state === 'charging') {
        this.chargeTime -= dt;
        const speed = 480 * slowFactor;
        this.vx = Math.cos(this.lockedAngle) * speed;
        this.vy = Math.sin(this.lockedAngle) * speed;
        this.angle = this.lockedAngle;
        this.game.particles.trail(
          this.x - Math.cos(this.lockedAngle) * 18,
          this.y - Math.sin(this.lockedAngle) * 18,
          U.chance(0.5) ? '#8f7bff' : '#00e5ff',
          U.rand(2, 4),
          0.25
        );
        if (this.chargeTime <= 0) {
          this.state = 'recover';
          this.chargeRecover = 0.8;
          this.chargeTimer = U.rand(2.0, 2.8);
          this.game.addScreenShake(3, 0.12);
        }
        return;
      }

      if (this.state === 'recover') {
        this.chargeRecover -= dt;
        this.vx = 0;
        this.vy = 0;
        if (this.chargeRecover <= 0) this.state = 'chase';
        return;
      }

      // Chase behavior.
      const speed = this.speed * slowFactor;
      this.vx = (dx / distance) * speed;
      this.vy = (dy / distance) * speed;
      this.angle = U.approachAngle(this.angle, toPlayer, 3.2 * dt);
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0 && distance > 45 && distance < 520) {
        this.state = 'windup';
        this.windup = 0.78;
        this.lockedAngle = toPlayer;
        this.game.audio.play('warning');
      }
    }

    drawTelegraph(ctx) {
      if (this.state !== 'windup') return;
      const progress = 1 - this.windup / 0.78;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.lockedAngle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + progress * 0.2;
      ctx.fillStyle = '#ff365e';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(310, -42);
      ctx.lineTo(310, 42);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.45 + progress * 0.45;
      ctx.strokeStyle = '#ff8096';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([15, 10]);
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(310, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    drawBody(ctx, flash) {
      const chargeGlow = this.state === 'charging' ? 1 : this.state === 'windup' ? 0.5 : 0;
      const spin = this.animTime * 0.6;

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = flash ? '#ffffff' : 'rgba(143,123,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        ctx.save();
        ctx.rotate(spin + (i * TAU) / 3);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + 11, 0.2, 1.3);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = flash ? '#ffffff' : '#120e2c';
      ctx.strokeStyle = flash ? '#ffffff' : this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * TAU + spin * 0.2;
        const radius = i % 2 === 0 ? this.radius + 6 : this.radius * 0.82;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#292153';
      ctx.strokeStyle = flash ? '#ffffff' : '#b5a4ff';
      ctx.lineWidth = 1.2;
      U.regularPolygon(ctx, 0, 0, this.radius * 0.64, 6, -spin);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#080615';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.accent;
      ctx.globalAlpha = 0.55 + Math.sin(this.animTime * 5) * 0.18 + chargeGlow * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5 + chargeGlow * 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.2 + chargeGlow * 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, 16 + chargeGlow * 5, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      for (let side = -1; side <= 1; side += 2) {
        ctx.fillStyle = flash ? '#ffffff' : '#3b2b72';
        ctx.strokeStyle = flash ? '#ffffff' : '#b9a7ff';
        ctx.beginPath();
        ctx.moveTo(3, side * 14);
        ctx.lineTo(27, side * 20);
        ctx.lineTo(33, side * 11);
        ctx.lineTo(24, side * 6);
        ctx.lineTo(8, side * 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = this.accent;
        ctx.fillRect(26, side * 14 - 1, 5, 2);
      }

      ctx.fillStyle = this.accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(this.radius * 0.76, -2, 7, 4);
      ctx.globalAlpha = 1;
    }
  }

  const TYPES = {
    drone: Drone,
    tank: Tank,
    sniper: Sniper,
    bomber: Bomber,
    elite: Elite
  };

  NO.createEnemy = function (kind, game, x, y) {
    const Ctor = TYPES[kind];
    if (!Ctor) throw new Error('Unknown enemy type: ' + kind);
    return new Ctor(game, x, y);
  };

  NO.EnemyBullet = EnemyBullet;
  NO.enemyTypes = TYPES;
  NO.EnemyClasses = { Enemy, Drone, Tank, Sniper, Bomber, Elite };
})();
