/* NEON OUTBREAK - bounded particle, ring and damage-number system */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const U = NO.Utils;
  const TAU = Math.PI * 2;

  function Particle() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.maxLife = 1;
    this.size = 2;
    this.endSize = 0;
    this.color = '#00e5ff';
    this.type = 'dot';
    this.drag = 0;
    this.gravity = 0;
    this.rotation = 0;
    this.spin = 0;
    this.alpha = 1;
    this.width = 1;
  }

  function FloatText() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = -45;
    this.life = 0;
    this.maxLife = 0.8;
    this.text = '';
    this.color = '#ffffff';
    this.size = 12;
    this.crit = false;
  }

  class Particles {
    constructor(maxParticles, maxTexts) {
      this.max = maxParticles || 520;
      this.particles = new Array(this.max);
      for (let i = 0; i < this.max; i += 1) this.particles[i] = new Particle();
      this.cursor = 0;
      this.activeCount = 0;

      this.maxTexts = maxTexts || 44;
      this.texts = new Array(this.maxTexts);
      for (let i = 0; i < this.maxTexts; i += 1) this.texts[i] = new FloatText();
      this.textCursor = 0;
    }

    _nextParticle() {
      const p = this.particles[this.cursor];
      if (!p.active) this.activeCount += 1;
      this.cursor = (this.cursor + 1) % this.max;
      p.active = true;
      p.drag = 0;
      p.gravity = 0;
      p.rotation = 0;
      p.spin = 0;
      p.alpha = 1;
      p.width = 1;
      p.endSize = 0;
      return p;
    }

    emit(config) {
      const p = this._nextParticle();
      p.x = config.x;
      p.y = config.y;
      p.vx = config.vx || 0;
      p.vy = config.vy || 0;
      p.life = p.maxLife = config.life || 0.5;
      p.size = config.size || 2;
      p.endSize = config.endSize === undefined ? 0 : config.endSize;
      p.color = config.color || '#00e5ff';
      p.type = config.type || 'dot';
      p.drag = config.drag || 0;
      p.gravity = config.gravity || 0;
      p.rotation = config.rotation === undefined ? Math.random() * TAU : config.rotation;
      p.spin = config.spin || 0;
      p.alpha = config.alpha === undefined ? 1 : config.alpha;
      p.width = config.width || 1;
      return p;
    }

    burst(x, y, color, count, speed, size, life, type) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * TAU;
        const velocity = U.rand(speed * 0.2, speed);
        this.emit({
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          color,
          life: U.rand(life * 0.55, life),
          size: U.rand(size * 0.5, size),
          endSize: 0,
          type: type || 'spark',
          drag: 2.2,
          rotation: angle
        });
      }
    }

    muzzle(x, y, angle, color) {
      for (let i = 0; i < 2; i += 1) {
        const a = angle + U.rand(-0.32, 0.32);
        const speed = U.rand(65, 170);
        this.emit({
          x: x + Math.cos(angle) * 2,
          y: y + Math.sin(angle) * 2,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          color,
          life: U.rand(0.08, 0.18),
          size: U.rand(1.2, 2.6),
          type: 'spark',
          drag: 5,
          rotation: a
        });
      }
    }

    hit(x, y, angle, color, crit) {
      const count = crit ? 8 : 5;
      for (let i = 0; i < count; i += 1) {
        const a = angle + Math.PI + U.rand(-0.8, 0.8);
        const speed = U.rand(80, crit ? 310 : 220);
        this.emit({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          color: i === 0 && crit ? '#ffd166' : color,
          life: U.rand(0.1, crit ? 0.34 : 0.25),
          size: U.rand(1.4, crit ? 3.4 : 2.6),
          type: 'spark',
          drag: 4.5,
          rotation: a
        });
      }
      this.emit({
        x,
        y,
        color: crit ? '#ffd166' : color,
        life: crit ? 0.2 : 0.14,
        size: crit ? 7 : 4,
        endSize: 0,
        type: 'glow',
        alpha: 0.7
      });
    }

    enemyDeath(x, y, color, size) {
      const count = Math.round(U.clamp(size * 1.2, 6, 24));
      this.burst(x, y, color, count, 190 + size * 2, 2.8, 0.5, 'spark');
      this.burst(x, y, '#f4fbff', Math.round(count * 0.35), 110, 1.8, 0.3, 'dot');
      this.ring(x, y, color, size * 0.6, size * 3.6, 0.32, 2);
      this.emit({
        x,
        y,
        color: '#ffffff',
        life: 0.17,
        size: size * 1.5,
        endSize: size * 0.2,
        type: 'glow',
        alpha: 0.65
      });
    }

    bigExplosion(x, y, color, scale) {
      this.burst(x, y, color, Math.min(55, Math.round(20 * scale)), 260 * scale, 3.4 * scale, 0.7, 'spark');
      this.burst(x, y, '#ffd166', Math.min(30, Math.round(12 * scale)), 180 * scale, 2.4 * scale, 0.55, 'dot');
      this.burst(x, y, '#ffffff', Math.min(20, Math.round(8 * scale)), 120 * scale, 1.8 * scale, 0.35, 'dot');
      this.ring(x, y, color, 9 * scale, 95 * scale, 0.55, 3);
      this.ring(x, y, '#ffd166', 4 * scale, 68 * scale, 0.4, 1.5);
    }

    pickup(x, y, color) {
      for (let i = 0; i < 4; i += 1) {
        const a = Math.random() * TAU;
        const speed = U.rand(25, 100);
        this.emit({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          color,
          life: U.rand(0.15, 0.34),
          size: U.rand(1, 2.2),
          type: 'spark',
          drag: 6,
          rotation: a
        });
      }
      this.emit({ x, y, color, life: 0.24, size: 5, endSize: 0, type: 'glow', alpha: 0.45 });
    }

    trail(x, y, color, size, life, vx, vy) {
      this.emit({
        x,
        y,
        vx: vx || 0,
        vy: vy || 0,
        color,
        life: life || 0.2,
        size: size || 2,
        endSize: 0,
        type: 'dot',
        alpha: 0.75,
        drag: 1.5
      });
    }

    ring(x, y, color, startSize, endSize, life, width) {
      this.emit({
        x,
        y,
        color,
        life,
        size: startSize,
        endSize,
        type: 'ring',
        width: width || 2,
        alpha: 0.9
      });
    }

    slash(x, y, angle, color, length) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.emit({
        x: x + cos * (length * 0.35),
        y: y + sin * (length * 0.35),
        vx: cos * 320,
        vy: sin * 320,
        color,
        life: 0.22,
        size: length,
        type: 'line',
        rotation: angle,
        alpha: 0.8,
        drag: 1
      });
    }

    damageText(x, y, amount, color, crit, scale) {
      const t = this.texts[this.textCursor];
      this.textCursor = (this.textCursor + 1) % this.maxTexts;
      const power = typeof scale === 'number' ? Math.max(0.6, scale) : 1;
      t.active = true;
      t.x = x + U.rand(-5, 5);
      t.y = y - 12;
      t.vx = crit ? U.rand(-38, 38) : U.rand(-16, 16);
      t.vy = crit ? -95 : -58;
      t.life = t.maxLife = crit ? 1.05 : 0.72;
      t.text = String(Math.max(1, Math.round(amount)));
      t.color = color || '#ffffff';
      // 暴击数字明显放大：普通 15px，暴击 34px，再乘上伤害量带来的轻微缩放，
      // 让高伤暴击在满屏粒子中依然一眼可见。
      t.size = crit ? 34 * power : 15 * power;
      t.crit = Boolean(crit);
    }

    label(x, y, text, color, size) {
      const t = this.texts[this.textCursor];
      this.textCursor = (this.textCursor + 1) % this.maxTexts;
      t.active = true;
      t.x = x;
      t.y = y;
      t.vx = 0;
      t.vy = -20;
      t.life = t.maxLife = 1.2;
      t.text = text;
      t.color = color || '#eafcff';
      t.size = size || 12;
      t.crit = false;
    }

    update(dt) {
      for (let i = 0; i < this.max; i += 1) {
        const p = this.particles[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          this.activeCount = Math.max(0, this.activeCount - 1);
          continue;
        }
        if (p.drag) {
          const damping = Math.max(0, 1 - p.drag * dt);
          p.vx *= damping;
          p.vy *= damping;
        }
        if (p.gravity) p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.rotation += p.spin * dt;
      }

      for (let i = 0; i < this.maxTexts; i += 1) {
        const t = this.texts[i];
        if (!t.active) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.active = false;
          continue;
        }
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.vy *= Math.max(0, 1 - 2.8 * dt);
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.max; i += 1) {
        const p = this.particles[i];
        if (!p.active) continue;
        const ratio = Math.max(0, p.life / p.maxLife);
        const progress = 1 - ratio;
        const fade = ratio < 0.4 ? ratio / 0.4 : 1;
        ctx.globalAlpha = Math.max(0, fade * p.alpha);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;

        if (p.type === 'ring') {
          const radius = U.lerp(p.size, p.endSize, U.easeOutCubic(progress));
          ctx.lineWidth = Math.max(0.4, p.width * (0.35 + ratio * 0.65));
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.2, radius), 0, TAU);
          ctx.stroke();
        } else if (p.type === 'spark') {
          const vx = p.vx * 0.018;
          const vy = p.vy * 0.018;
          ctx.lineWidth = Math.max(0.5, p.size * (0.35 + ratio * 0.65));
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - vx, p.y - vy);
          ctx.stroke();
        } else if (p.type === 'line') {
          const length = p.size;
          const dx = Math.cos(p.rotation) * length;
          const dy = Math.sin(p.rotation) * length;
          ctx.globalAlpha *= 0.8;
          ctx.lineWidth = Math.max(0.5, 2.2 * ratio);
          ctx.beginPath();
          ctx.moveTo(p.x - dx, p.y - dy);
          ctx.lineTo(p.x + dx, p.y + dy);
          ctx.stroke();
        } else if (p.type === 'square' || p.type === 'debris') {
          const size = Math.max(0.4, p.size * (0.5 + ratio * 0.7));
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillRect(-size / 2, -size / 2, size, size);
          ctx.restore();
        } else if (p.type === 'glow') {
          const radius = Math.max(0.2, U.lerp(p.size, p.endSize, progress));
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.globalAlpha *= 0.34;
          ctx.fill();
          ctx.globalAlpha *= 1.65;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.42, 0, TAU);
          ctx.fill();
        } else {
          const radius = Math.max(0.2, p.size * (0.35 + ratio * 0.65));
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.fill();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < this.maxTexts; i += 1) {
        const t = this.texts[i];
        if (!t.active) continue;
        const ratio = Math.max(0, t.life / t.maxLife);
        const fadeIn = Math.min(1, (1 - ratio) * 7);
        const alpha = Math.min(ratio * 1.8, 1) * fadeIn;
        ctx.globalAlpha = Math.max(0, alpha);
        const scale = t.crit ? U.easeOutBack(Math.min(1, (1 - ratio) * 5)) : 1;
        ctx.font = (t.crit ? '700 ' : '600 ') + Math.round(t.size * scale) + 'px "Cascadia Mono", Consolas, monospace';
        ctx.lineWidth = t.crit ? 3 : 2;
        ctx.strokeStyle = 'rgba(2,5,12,0.78)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    }

    clear() {
      for (let i = 0; i < this.max; i += 1) this.particles[i].active = false;
      for (let i = 0; i < this.maxTexts; i += 1) this.texts[i].active = false;
      this.activeCount = 0;
      this.cursor = 0;
      this.textCursor = 0;
    }
  }

  NO.Particles = Particles;
})();
