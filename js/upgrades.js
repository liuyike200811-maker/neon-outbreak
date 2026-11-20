/* NEON OUTBREAK - upgrade definitions, rarity, roll logic and stat previews */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});

  const RARITY = {
    common: { label: '常规', weight: 30, order: 1 },
    uncommon: { label: '精良', weight: 20, order: 2 },
    rare: { label: '稀有', weight: 11, order: 3 },
    epic: { label: '史诗', weight: 5, order: 4 },
    legendary: { label: '传说', weight: 2, order: 5 }
  };

  const ICONS = {
    damage: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="5"/><path d="M12 9v6M9 12h6"/>',
    firerate: '<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>',
    armor: '<path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/><path d="M12 7v7M8.5 10.5h7"/>',
    repair: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 7v10M7 12h10"/>',
    speed: '<path d="m3 7 6 5-6 5M11 7l6 5-6 5M19 7v10"/>',
    pierce: '<path d="M3 12h15M14 7l5 5-5 5"/><circle cx="7" cy="12" r="3"/><path d="M7 9v6"/>',
    crit: '<path d="M12 2 22 12 12 22 2 12z"/><circle cx="12" cy="12" r="4"/><path d="M12 8v8M8 12h8"/>',
    magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z"/><path d="M6 7h4M14 7h4"/>',
    multishot: '<path d="M4 12h13M12 6l5 6-5 6M4 5v14"/><path d="m16 5 4 3M16 19l4-3"/>',
    emp: '<circle cx="12" cy="12" r="2"/><path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9M4.5 4.5a10 10 0 0 0 0 15M19.5 4.5a10 10 0 0 1 0 15"/>',
    frost: '<path d="M12 2v20M4 6l16 12M20 6 4 18"/><path d="m9 4 3 3 3-3M9 20l3-3 3 3M4 10l4 1-1-4M20 14l-4-1 1 4"/>',
    volatile: '<path d="m12 2 2.4 6.2L21 7l-4.2 5.1L22 17l-6.6-.5L13 23l-2.4-6.5L4 17l4.2-4.9L2 7l6.6 1.2z"/><circle cx="12" cy="13" r="2.3"/>',
    critdmg: '<path d="M12 2 22 12 12 22 2 12z"/><path d="M12 7v10M9 9.5 12 7l3 2.5"/>',
    lifesteal: '<path d="M12 21C6 16 3 12.5 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 3.5-3 7-9 12z"/><path d="M12 8v6M9.5 11h5"/>',
    thorns: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    shield: '<path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/><path d="M9 12l2 2 4-4"/>',
    homing: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><path d="M6 6 3 3M18 18l3 3"/>',
    dashblast: '<path d="M4 12h9l-3-4 8 4-8 4 3-4"/><circle cx="18" cy="12" r="3.4"/>',
    xpboost: '<path d="M4 19V9M10 19V5M16 19v-7M22 19V8"/>',
    dashcool: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/><path d="M12 7v5l3 2"/>',
    execute: '<path d="M5 3v18M9 3h9l-3 5 3 5H9z"/>',
    ricochet: '<path d="M3 18 9 8l6 8 6-10"/><circle cx="9" cy="8" r="2"/><circle cx="15" cy="16" r="2"/>',
    repairField: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.5-.5-.5-2.5z"/>',
    data: '<path d="M4 4h16v5H4zM4 11h16v9H4z"/><path d="M8 15h8M8 18h5"/>',
    plating: '<path d="M12 2 3 6v6c0 5.2 3.7 8.8 9 10 5.3-1.2 9-4.8 9-10V6z"/><path d="M7 9h10M7 13h10M9 17h6"/>',
    overload: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9 8.5 8.5M15.5 15.5l3.6 3.6M19.1 4.9l-3.6 3.6M8.5 15.5l-3.6 3.6"/><circle cx="12" cy="12" r="3"/>'
  };

  /* ---------------- preview helpers ----------------
     Every card must be able to answer "what does this actually change"
     with real numbers, read from the live player. The UI renders the
     difference; nothing here mutates the player. */
  function row(label, from, to, fmt) {
    return { label: label, from: from, to: to, fmt: fmt || 'num' };
  }

  function fallbackDefs() {
    return [
      {
        id: 'field-repair',
        name: '应急维修',
        en: 'FIELD REPAIR',
        rarity: 'common',
        maxLevel: 99,
        fallback: true,
        desc: function () { return '无人机投送维修包，立即恢复 25 点生命值。'; },
        preview: function (p) {
          return [row('生命', p.hp, Math.min(p.maxHp, p.hp + 25), 'hp')];
        },
        apply: function (player) { player.heal(25); }
      },
      {
        id: 'data-cache',
        name: '数据缓存',
        en: 'DATA CACHE',
        rarity: 'uncommon',
        maxLevel: 99,
        fallback: true,
        desc: function () { return '从废弃终端回收数据，立即获得 400 分。'; },
        preview: function (p, game) {
          const now = game ? game.score : 0;
          return [row('得分', now, now + 400, 'score')];
        },
        apply: function (player, game) { if (game) game.addScore(400); }
      },
      {
        id: 'overclock',
        name: '临时超频',
        en: 'TEMPORARY OVERCLOCK',
        rarity: 'rare',
        maxLevel: 99,
        fallback: true,
        desc: function () { return '武器系统过载：本局伤害永久提高 10%。'; },
        preview: function (p) {
          return [row('伤害', p.damage, p.damage * 1.1, 'num')];
        },
        apply: function (player) { player.damageMult += 0.1; player.recalculateStats(); }
      },
      {
        id: 'plating',
        name: '装甲镀层',
        en: 'HULL PLATING',
        rarity: 'common',
        maxLevel: 99,
        fallback: true,
        desc: function () { return '现场焊接附加装甲：最大生命值 +8，并立即回复 8 点。'; },
        preview: function (p) {
          return [row('最大生命', p.maxHp, p.maxHp + 8, 'hp')];
        },
        apply: function (player) {
          player.maxHp += 8;
          player.hp = Math.min(player.maxHp, player.hp + 8);
          player.recalculateStats();
        }
      }
    ];
  }

  const DEFINITIONS = [
    {
      id: 'damage',
      name: '火力强化',
      en: 'OVERCHARGE',
      rarity: 'uncommon',
      maxLevel: 5,
      desc: function () { return '武器基础伤害提高 20%。能量核心输出上限同步扩容。'; },
      preview: function (p) { return [row('伤害', p.damage, p.damage * 1.2, 'num')]; },
      apply: function (player) {
        player.damageMult += 0.2;
        player.recalculateStats();
      }
    },
    {
      id: 'firerate',
      name: '极速射击',
      en: 'RAPID CYCLE',
      rarity: 'uncommon',
      maxLevel: 5,
      desc: function () { return '自动攻击间隔缩短 12%。最低间隔受安全阈值限制。'; },
      preview: function (p) {
        return [row('射速', 1 / p.attackInterval, 1 / Math.max(0.08, p.attackInterval * 0.88), 'rate')];
      },
      apply: function (player) {
        player.attackIntervalMult *= 0.88;
        player.recalculateStats();
      }
    },
    {
      id: 'armor',
      name: '能量护甲',
      en: 'PLASMA ARMOR',
      rarity: 'common',
      maxLevel: 4,
      desc: function () { return '最大生命值 +25，并立即恢复等量生命值。'; },
      preview: function (p) { return [row('最大生命', p.maxHp, p.maxHp + 25, 'hp')]; },
      apply: function (player) {
        player.maxHp += 25;
        player.hp = Math.min(player.maxHp, player.hp + 25);
        player.recalculateStats();
      }
    },
    {
      id: 'repair',
      name: '自我修复',
      en: 'SELF REPAIR',
      rarity: 'common',
      maxLevel: 5,
      desc: function () { return '纳米修复群启动，立即恢复 30 点生命值。'; },
      available: function (player) { return player.hp < player.maxHp - 8; },
      preview: function (p) { return [row('生命', p.hp, Math.min(p.maxHp, p.hp + 30), 'hp')]; },
      apply: function (player) { player.heal(30); }
    },
    {
      id: 'speed',
      name: '机动强化',
      en: 'KINETIC SERVO',
      rarity: 'common',
      maxLevel: 4,
      desc: function () { return '移动速度提高 12%。极限速度受伺服器安全上限保护。'; },
      preview: function (p) { return [row('移速', p.speed, Math.min(370, p.speed * 1.12), 'num')]; },
      apply: function (player) {
        player.speedMult *= 1.12;
        player.recalculateStats();
      }
    },
    {
      id: 'pierce',
      name: '弹道穿透',
      en: 'PHASE ROUNDS',
      rarity: 'rare',
      maxLevel: 3,
      desc: function () { return '子弹穿透数量 +1。弹体不会在首次命中后消亡。'; },
      preview: function (p) { return [row('穿透', p.pierce, p.pierce + 1, 'int')]; },
      apply: function (player) {
        player.pierce += 1;
        player.recalculateStats();
      }
    },
    {
      id: 'crit',
      name: '暴击模块',
      en: 'CRIT CORE',
      rarity: 'rare',
      maxLevel: 4,
      desc: function () { return '暴击概率 +8 个百分点。暴击伤害由「过载核心」单独强化。'; },
      preview: function (p) { return [row('暴击率', p.critChance, Math.min(0.65, p.critChance + 0.08), 'pct')]; },
      apply: function (player) {
        player.critChance = Math.min(0.65, player.critChance + 0.08);
        player.recalculateStats();
      }
    },
    {
      id: 'magnet',
      name: '磁力核心',
      en: 'MAGNET FIELD',
      rarity: 'common',
      maxLevel: 3,
      desc: function () { return '经验晶体吸附范围 +40%。晶体将主动飞向装甲。'; },
      preview: function (p) { return [row('拾取范围', p.pickupRange, Math.min(380, p.pickupRange * 1.4), 'num')]; },
      apply: function (player) {
        player.pickupRangeMult *= 1.4;
        player.recalculateStats();
      }
    },
    {
      id: 'multishot',
      name: '多重射击',
      en: 'SPLIT BARREL',
      rarity: 'epic',
      maxLevel: 3,
      desc: function () { return '每轮自动攻击额外发射 1 枚子弹，呈扇形扩散。'; },
      preview: function (p) { return [row('弹丸数', p.projectiles, p.projectiles + 1, 'int')]; },
      apply: function (player) {
        player.projectiles += 1;
        player.recalculateStats();
      }
    },
    {
      id: 'emp',
      name: '电磁脉冲',
      en: 'EMP PULSE',
      rarity: 'rare',
      maxLevel: 4,
      desc: function (player) {
        const level = player.upgradeLevels.emp || 0;
        if (level === 0) return '解锁周期电磁脉冲：每 4.6 秒对周围敌人造成范围伤害。';
        return '电磁脉冲强化：范围 +14，伤害 +12。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.emp || 0;
        if (lv === 0) return [row('脉冲伤害', 0, 20 + 6, 'num'), row('脉冲范围', 0, 106 + 14, 'num')];
        return [
          row('脉冲伤害', 20 + lv * 6, 20 + (lv + 1) * 6, 'num'),
          row('脉冲范围', 106 + lv * 14, 106 + (lv + 1) * 14, 'num')
        ];
      },
      apply: function (player) {
        player.recalculateStats();
      }
    },
    {
      id: 'frost',
      name: '冰霜核心',
      en: 'CRYO CORE',
      rarity: 'rare',
      maxLevel: 3,
      desc: function (player) {
        const level = player.upgradeLevels.frost || 0;
        return '攻击命中时 ' + (level === 0 ? '20%' : '额外 +8%') + ' 概率使目标减速 42%，持续 1.3 秒。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.frost || 0;
        const now = lv > 0 ? 0.12 + lv * 0.08 : 0;
        const next = 0.12 + (lv + 1) * 0.08;
        return [row('减速触发', now, next, 'pct')];
      },
      apply: function (player) {
        player.recalculateStats();
      }
    },
    {
      id: 'volatile',
      name: '能量爆裂',
      en: 'VOLATILE CORE',
      rarity: 'epic',
      maxLevel: 3,
      desc: function (player) {
        const level = player.upgradeLevels.volatile || 0;
        return '敌人死亡时 ' + (level === 0 ? '20%' : '额外 +10%') + ' 概率触发范围能量爆炸。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.volatile || 0;
        const now = lv > 0 ? 0.1 + lv * 0.1 : 0;
        const next = 0.1 + (lv + 1) * 0.1;
        return [row('爆炸触发', now, Math.min(0.9, next), 'pct'), row('爆炸伤害', 50 + lv * 10, 50 + (lv + 1) * 10, 'num')];
      },
      apply: function (player) {
        player.recalculateStats();
      }
    },
    {
      id: 'critdmg',
      name: '过载核心',
      en: 'CRIT AMPLIFIER',
      rarity: 'rare',
      maxLevel: 3,
      desc: function () { return '暴击伤害倍率 +0.25。配合「暴击模块」把暴击变成主要输出。'; },
      preview: function (p) {
        return [
          row('暴击倍率', p.critMultiplier, 1.5 + ((p.upgradeLevels.critdmg || 0) + 1) * 0.25, 'x'),
          row('暴击期望', 1 + p.critChance * (p.critMultiplier - 1),
            1 + p.critChance * (1.5 + ((p.upgradeLevels.critdmg || 0) + 1) * 0.25 - 1), 'x')
        ];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'lifesteal',
      name: '能量汲取',
      en: 'VAMPIRIC DRAW',
      rarity: 'rare',
      maxLevel: 4,
      desc: function () {
        return '每次击杀恢复生命值。击杀越多，续航越稳。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.lifesteal || 0;
        return [row('每杀回复', lv * 2, (lv + 1) * 2, 'hp')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'thorns',
      name: '反制装甲',
      en: 'ARC PLATING',
      rarity: 'uncommon',
      maxLevel: 3,
      desc: function (player) {
        const lv = player.upgradeLevels.thorns || 0;
        return '被接触伤害时反弹伤害给攻击者。当前反弹 ' + Math.round((lv * 0.4) * 100) + '%，下一级 +40%。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.thorns || 0;
        return [row('反弹比例', lv * 0.4, (lv + 1) * 0.4, 'pct')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'shield',
      name: '力场护盾',
      en: 'AEGIS FIELD',
      rarity: 'epic',
      maxLevel: 3,
      desc: function (player) {
        const lv = player.upgradeLevels.shield || 0;
        return '每 11 秒充能一层护盾，完全抵消一次伤害。当前上限 ' + Math.max(1, lv) + ' 层。';
      },
      preview: function (p) {
        const lv = p.upgradeLevels.shield || 0;
        return [row('护盾层数', lv, lv + 1, 'int')];
      },
      apply: function (player) {
        player.recalculateStats();
        player.shieldCharges = Math.min(player.maxShield, player.shieldCharges + 1);
        player.shieldTimer = player.shieldCooldown;
      }
    },
    {
      id: 'homing',
      name: '追踪弹道',
      en: 'SEEKER ROUNDS',
      rarity: 'rare',
      maxLevel: 2,
      desc: function () { return '子弹会朝最近的敌人轻微修正航向。对高速目标尤其有效。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.homing || 0;
        return [row('追踪强度', lv * 2.6, (lv + 1) * 2.6, 'num')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'dashblast',
      name: '相位冲击',
      en: 'PHASE BURST',
      rarity: 'rare',
      maxLevel: 3,
      desc: function () { return '冲刺结束的瞬间释放一圈电磁冲击，对周围敌人造成伤害。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.dashblast || 0;
        return [row('冲击伤害', lv > 0 ? 24 + lv * 16 : 0, 24 + (lv + 1) * 16, 'num')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'xpboost',
      name: '数据解析',
      en: 'DATA DECODE',
      rarity: 'uncommon',
      maxLevel: 3,
      desc: function () { return '经验晶体解析效率 +25%。升级更快，成长更猛。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.xpboost || 0;
        return [row('经验倍率', 1 + lv * 0.25, 1 + (lv + 1) * 0.25, 'x')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'dashcool',
      name: '伺服过载',
      en: 'SERVO OVERDRIVE',
      rarity: 'uncommon',
      maxLevel: 3,
      desc: function () { return '冲刺冷却缩短 20%。极限冷却受安全阈值保护。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.dashcool || 0;
        return [
          row('冷却', Math.max(1.2, 3 * (1 - lv * 0.2)), Math.max(1.2, 3 * (1 - (lv + 1) * 0.2)), 'sec')
        ];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'execute',
      name: '处决协议',
      en: 'EXECUTION PROTOCOL',
      rarity: 'epic',
      maxLevel: 2,
      desc: function () { return '命中生命值低于 30% 的敌人时，伤害额外提高 100%。清场效率质变。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.execute || 0;
        return [row('残血额外伤害', lv * 100, (lv + 1) * 100, 'pct')];
      },
      apply: function (player) { player.recalculateStats(); }
    },
    {
      id: 'ricochet',
      name: '跳弹',
      en: 'RICOCHET',
      rarity: 'legendary',
      maxLevel: 2,
      desc: function () { return '子弹命中后不再消亡，而是弹射向附近的另一个敌人。群战质变。'; },
      preview: function (p) {
        const lv = p.upgradeLevels.ricochet || 0;
        return [row('弹射次数', lv, lv + 1, 'int')];
      },
      apply: function (player) { player.recalculateStats(); }
    }
  ];

  const byId = Object.create(null);
  DEFINITIONS.forEach(function (def) { byId[def.id] = def; });
  fallbackDefs().forEach(function (def) { byId[def.id] = def; });

  function getLevel(player, id) {
    return (player && player.upgradeLevels && player.upgradeLevels[id]) || 0;
  }

  function isAvailable(def, player) {
    if (!def || !player) return false;
    if (getLevel(player, def.id) >= def.maxLevel) return false;
    if (def.available && !def.available(player)) return false;
    return true;
  }

  function weightedPick(candidates) {
    let total = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      total += RARITY[candidates[i].rarity].weight;
    }
    let roll = Math.random() * total;
    for (let i = 0; i < candidates.length; i += 1) {
      roll -= RARITY[candidates[i].rarity].weight;
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  function pickChoices(player, count) {
    const wanted = count || 3;
    const pool = DEFINITIONS.filter(function (def) { return isAvailable(def, player); });
    const chosen = [];
    while (chosen.length < wanted && pool.length > 0) {
      const pick = weightedPick(pool);
      chosen.push(pick);
      const index = pool.indexOf(pick);
      if (index !== -1) pool.splice(index, 1);
    }
    if (chosen.length < wanted) {
      // 主卡全部满级后必须仍然稳定给出三张卡，否则界面会只剩一两张，
      // 玩家无从选择。应急卡没有等级上限，因此允许重复出现：先去重补一轮，
      // 若仍不足（例如满血时「应急维修」被过滤）则允许循环复用。
      const already = new Set(chosen.map(function (def) { return def.id; }));
      const fallbacks = fallbackDefs().filter(function (def) {
        if (def.id === 'field-repair' && player.hp >= player.maxHp) return false;
        return true;
      });
      const usable = fallbacks.length > 0 ? fallbacks : fallbackDefs();
      for (let i = 0; i < usable.length && chosen.length < wanted; i += 1) {
        if (!already.has(usable[i].id)) {
          chosen.push(usable[i]);
          already.add(usable[i].id);
        }
      }
      let cursor = 0;
      while (chosen.length < wanted && cursor < wanted * 3) {
        chosen.push(usable[cursor % usable.length]);
        cursor += 1;
      }
    }
    if (chosen.length === 0) {
      chosen.push(fallbackDefs()[0]);
    }
    return chosen;
  }

  function previewFor(def, player, game) {
    if (!def || !def.preview || !player) return [];
    try {
      const rows = def.preview(player, game);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      return [];
    }
  }

  function iconMarkup(id) {
    const body = ICONS[id] || ICONS.overload;
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }

  NO.Upgrades = {
    definitions: DEFINITIONS,
    rarity: RARITY,
    get: function (id) { return byId[id]; },
    getLevel,
    isAvailable,
    pickChoices,
    previewFor,
    iconMarkup,
    getDefinitions: function () { return DEFINITIONS; }
  };
})();
