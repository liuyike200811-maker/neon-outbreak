/* NEON OUTBREAK - shared utilities */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const TAU = Math.PI * 2;
  const colorCache = new Map();

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function invLerp(a, b, v) {
    if (a === b) return 0;
    return clamp((v - a) / (b - a), 0, 1);
  }

  function smoothstep(a, b, v) {
    const t = invLerp(a, b, v);
    return t * t * (3 - 2 * t);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function choose(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function chance(probability) {
    return Math.random() < probability;
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function distanceSq(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  }

  function distance(ax, ay, bx, by) {
    return Math.sqrt(distanceSq(ax, ay, bx, by));
  }

  function len(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function normalize(x, y) {
    const length = Math.sqrt(x * x + y * y);
    if (length < 0.0001) return { x: 0, y: 0, length: 0 };
    return { x: x / length, y: y / length, length };
  }

  function angleTo(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  }

  function shortestAngle(from, to) {
    let diff = (to - from + Math.PI) % TAU;
    if (diff < 0) diff += TAU;
    return diff - Math.PI;
  }

  function approachAngle(from, to, maxStep) {
    const diff = shortestAngle(from, to);
    if (Math.abs(diff) <= maxStep) return to;
    return from + Math.sign(diff) * maxStep;
  }

  function pointInCircle(px, py, cx, cy, radius) {
    return distanceSq(px, py, cx, cy) <= radius * radius;
  }

  function circleOverlap(ax, ay, ar, bx, by, br) {
    const radius = ar + br;
    return distanceSq(ax, ay, bx, by) <= radius * radius;
  }

  function circlesOverlap(a, b) {
    return circleOverlap(a.x, a.y, a.r || a.radius || 0, b.x, b.y, b.r || b.radius || 0);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInCubic(t) {
    return t * t * t;
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function rgba(hex, alpha) {
    const key = hex + alpha;
    const cached = colorCache.get(key);
    if (cached) return cached;
    let body = hex.replace('#', '');
    if (body.length === 3) {
      body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
    }
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    const result = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    colorCache.set(key, result);
    return result;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function formatTimeLong(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    if (mins <= 0) return secs + '秒';
    return mins + '分' + String(secs).padStart(2, '0') + '秒';
  }

  function formatScore(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function randomPointOnCircle(radius) {
    const angle = Math.random() * TAU;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
  }

  function randomPointInAnnulus(minRadius, maxRadius) {
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(rand(minRadius * minRadius, maxRadius * maxRadius));
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
  }

  function isTouchDevice() {
    return (
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1100)
    );
  }

  function lerpColorHex(hexA, hexB, t) {
    function parse(hex) {
      let body = hex.replace('#', '');
      if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
      return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
    }
    const a = parse(hexA);
    const b = parse(hexB);
    const r = Math.round(lerp(a[0], b[0], t));
    const g = Math.round(lerp(a[1], b[1], t));
    const bl = Math.round(lerp(a[2], b[2], t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function polygonPath(ctx, points, close) {
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    if (close !== false) ctx.closePath();
  }

  function regularPolygon(ctx, x, y, radius, sides, rotation) {
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * TAU + (rotation || 0);
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  NO.TAU = TAU;
  NO.Utils = {
    clamp,
    lerp,
    invLerp,
    smoothstep,
    rand,
    randInt,
    choose,
    chance,
    shuffle,
    distance,
    distanceSq,
    len,
    normalize,
    angleTo,
    shortestAngle,
    approachAngle,
    pointInCircle,
    circleOverlap,
    circlesOverlap,
    easeOutCubic,
    easeInCubic,
    easeOutBack,
    easeInOutQuad,
    rgba,
    formatTime,
    formatTimeLong,
    formatScore,
    randomPointOnCircle,
    randomPointInAnnulus,
    isTouchDevice,
    lerpColorHex,
    line,
    polygonPath,
    regularPolygon
  };
})();
