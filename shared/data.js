// Shared game data — used by both the server (Node) and the browser client.
(function (root) {
  'use strict';

  const W = 4800, H = 2800;

  const TEAM_NAMES = ['Blue Barn', 'Red Barn'];
  const TEAM_COLORS = ['#3b82f6', '#ef4444'];
  const TEAM_DARK = ['#1e3a8a', '#7f1d1d'];
  const TEAM_LIGHT = ['#93c5fd', '#fca5a5'];

  const BASES = [{ x: 400, y: 1400 }, { x: 4400, y: 1400 }];      // flag stands
  const FOUNTAINS = [{ x: 120, y: 1400 }, { x: 4680, y: 1400 }];  // spawn + shop + heal

  const C = {
    START_GOLD: 500,
    PASSIVE_GOLD: 2,          // per second
    R_LEVEL: 5,               // ultimate unlocks at this level
    MAX_LEVEL: 15,
    CAPTURES_TO_WIN: 3,
    FLAG_RETURN: 20,          // seconds before a dropped flag returns home
    FLAG_PICK_R: 75,
    CAPTURE_R: 150,
    FLAG_SLOW: 15,            // % move speed penalty while carrying
    RECALL_TIME: 6,
    FOUNTAIN_R: 210,          // heals allies, burns enemies
    SHOP_R: 380,              // distance from fountain you can shop
    BASE_R: 560,
    WAVE_FIRST: 20,
    WAVE_EVERY: 30,
    VISION_CHAMP: 1100,
    VISION_MINION: 650,
    VISION_TOWER: 900,
    VISION_BASE: 1300,
    TOWER_R: 55,
    LANE_WIDTH: 260,
    HARVEST_R: 80,
  };
  const xpToNext = (lvl) => 200 + 120 * (lvl - 1);
  const respawnTime = (lvl) => 4 + 1.6 * lvl;

  // Lane paths from Blue's base to Red's base.
  const LANES = {
    top: [[400, 1400], [700, 450], [4100, 450], [4400, 1400]],
    mid: [[400, 1400], [4400, 1400]],
    bot: [[400, 1400], [700, 2350], [4100, 2350], [4400, 1400]],
  };
  const RIVER = { x: 2300, y: 450, w: 200, h: 1900 };

  // Hay-bale walls, designed for the top-left quadrant, mirrored to all four.
  const WALLS_TL = [
    [900, 640, 380, 80], [1480, 640, 520, 80],
    [900, 1120, 330, 60], [1420, 1120, 560, 60],
    [1180, 820, 80, 260], [1650, 860, 300, 80], [2080, 720, 80, 340],
  ];
  const WALLS = [];
  for (const [x, y, w, h] of WALLS_TL) {
    WALLS.push({ x, y, w, h });
    WALLS.push({ x: W - x - w, y, w, h });
    WALLS.push({ x, y: H - y - h, w, h });
    WALLS.push({ x: W - x - w, y: H - y - h, w, h });
  }

  // One "Grain Silo" guards each flag. It can always be attacked and rebuilds after it falls.
  const TOWERS = [
    { team: 0, lane: 'base', tier: 0, x: 660, y: 1290 },
    { team: 1, lane: 'base', tier: 0, x: W - 660, y: 1290 },
  ];
  TOWERS.forEach((t, i) => { t.idx = i; t.r = 62; });
  const TOWER_STATS = {
    base: { hp: 4200, armor: 40, range: 820, ad: 240, adPerMin: 10, as: 1.0, rebuild: 120, minionPct: 0.5 },
  };

  // Tall grass: units inside can only be seen by enemies who are also inside the same patch.
  const BRUSH_TL = [
    [2000, 550, 230, 80], [1990, 1185, 240, 75], [1290, 740, 140, 90],
    [870, 770, 150, 80], [1300, 140, 260, 100], [690, 1080, 150, 80],
  ];
  const BRUSHES = [];
  for (const [x, y, w, h] of BRUSH_TL) {
    BRUSHES.push({ x, y, w, h });
    BRUSHES.push({ x: W - x - w, y, w, h });
    BRUSHES.push({ x, y: H - y - h, w, h });
    BRUSHES.push({ x: W - x - w, y: H - y - h, w, h });
  }
  BRUSHES.push({ x: 2330, y: 1060, w: 140, h: 130 });
  BRUSHES.push({ x: 2330, y: H - 1060 - 130, w: 140, h: 130 });
  BRUSHES.forEach((b, i) => { b.idx = i; });
  const brushAt = (x, y) => {
    for (const b of BRUSHES) if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return b.idx;
    return -1;
  };

  // Jungle camps
  const CAMPS_TL = [
    { type: 'raccoon', x: 1000, y: 930 }, { type: 'turkey', x: 1480, y: 960 }, { type: 'coyote', x: 1850, y: 1030 },
  ];
  const CAMPS = [];
  for (const c of CAMPS_TL) {
    CAMPS.push({ type: c.type, x: c.x, y: c.y });
    CAMPS.push({ type: c.type, x: W - c.x, y: c.y });
    CAMPS.push({ type: c.type, x: c.x, y: H - c.y });
    CAMPS.push({ type: c.type, x: W - c.x, y: H - c.y });
  }
  CAMPS.push({ type: 'goose', x: 2400, y: 880 });
  CAMPS.push({ type: 'bull', x: 2400, y: 1920 });

  const NEUTRALS = {
    raccoon: { name: 'Raccoon', icon: '🦝', hp: 380, ad: 16, as: 1.0, range: 90, r: 20, gold: 18, xp: 30, ms: 330 },
    turkey: { name: 'Wild Turkey', icon: '🦃', hp: 540, ad: 22, as: 0.9, range: 100, r: 24, gold: 28, xp: 45, ms: 330 },
    coyote: { name: 'Coyote', icon: '🐺', hp: 1100, ad: 38, as: 0.8, range: 110, r: 30, gold: 60, xp: 90, ms: 340 },
    pup: { name: 'Coyote Pup', icon: '🐺', hp: 320, ad: 14, as: 1.0, range: 90, r: 18, gold: 15, xp: 25, ms: 340 },
    goose: { name: 'Golden Goose', icon: '🦢', hp: 2400, ad: 55, as: 0.8, range: 320, ranged: true, vis: 'feather', r: 38, gold: 80, xp: 160, ms: 300, big: true },
    bull: { name: 'Prize Bull', icon: '🐂', hp: 3400, ad: 85, as: 0.7, range: 150, r: 46, gold: 120, xp: 220, ms: 320, big: true },
  };
  const CAMP_TYPES = {
    raccoon: { units: [['raccoon', -40, 0], ['raccoon', 40, 0], ['raccoon', 0, 45]], respawn: 75, first: 45 },
    turkey: { units: [['turkey', -35, 0], ['turkey', 35, 10]], respawn: 75, first: 45 },
    coyote: { units: [['coyote', 0, 0], ['pup', -55, 30], ['pup', 55, 30]], respawn: 90, first: 45 },
    goose: { units: [['goose', 0, 0]], respawn: 180, first: 150, reward: 'goose', desc: 'Every teammate gets +120 gold' },
    bull: { units: [['bull', 0, 0]], respawn: 240, first: 240, reward: 'bull', desc: 'Team buff: +15% damage, +10% speed for 2 min' },
  };

  // Crops — whack a ripe crop with attacks or abilities; the hit that finishes it harvests it.
  const CROP_TYPES = {
    carrot: { name: 'Carrots', icon: '🥕', xp: 70, gold: 10, hits: 3, regrow: 60 },
    corn: { name: 'Corn', icon: '🌽', xp: 90, gold: 15, hits: 3, regrow: 75 },
    wheat: { name: 'Wheat', icon: '🌾', xp: 80, gold: 10, hits: 3, regrow: 70 },
    pumpkin: { name: 'Giant Pumpkin', icon: '🎃', xp: 200, gold: 40, hits: 6, regrow: 120 },
  };
  // Prized crops sprout at random spots and grant a powerful temporary blessing.
  const PRIZE_TYPES = {
    goldcarrot: { name: 'Golden Carrot', icon: '🥕', glow: '#facc15', hits: 5, xp: 120, gold: 40, dur: 60, stats: { msPct: 40 }, buff: 'Super Speed', desc: '+40% move speed' },
    pepper: { name: 'Blazing Pepper', icon: '🌶️', glow: '#f97316', hits: 5, xp: 120, gold: 40, dur: 60, dmgPct: 25, buff: 'Fire Power', desc: '+25% damage dealt' },
    melon: { name: 'Quick Melon', icon: '🍉', glow: '#4ade80', hits: 5, xp: 120, gold: 40, dur: 60, stats: { cdr: 30 }, cdNow: 0.5, buff: 'Quick Cooldowns', desc: 'Cooldowns halved instantly, then 30% cooldown reduction' },
    ironberry: { name: 'Iron Berries', icon: '🍇', glow: '#a78bfa', hits: 5, xp: 120, gold: 40, dur: 60, stats: { armor: 40, hp: 250 }, buff: 'Iron Hide', desc: '+40 armor and +250 health' },
  };
  const PRIZE_SPOTS = [[2400, 1400], [2400, 455], [2400, 2345], [1500, 1400], [3300, 1400]];
  const PRIZE = { first: 90, every: 60, max: 2 };
  const CROPS_TL = [
    { type: 'carrot', x: 780, y: 1000 }, { type: 'corn', x: 1450, y: 790 }, { type: 'wheat', x: 1500, y: 190 },
  ];
  const CROPS = [];
  for (const c of CROPS_TL) {
    CROPS.push({ type: c.type, x: c.x, y: c.y });
    CROPS.push({ type: c.type, x: W - c.x, y: c.y });
    CROPS.push({ type: c.type, x: c.x, y: H - c.y });
    CROPS.push({ type: c.type, x: W - c.x, y: H - c.y });
  }
  CROPS.push({ type: 'pumpkin', x: 2400, y: 640 });
  CROPS.push({ type: 'pumpkin', x: 2400, y: 2160 });
  CROPS.forEach((c, i) => { c.idx = i; });

  const MINIONS = {
    chick: { name: 'Chick', icon: '🐥', hp: 420, ad: 13, as: 1.0, range: 90, r: 17, ms: 300, gold: 20, xp: 32, armor: 0 },
    mouse: { name: 'Field Mouse', icon: '🐭', hp: 280, ad: 22, as: 0.8, range: 420, ranged: true, vis: 'seed', r: 15, ms: 300, gold: 15, xp: 26, armor: 0 },
    tractor: { name: 'Tractor', icon: '🚜', hp: 900, ad: 40, as: 0.6, range: 300, ranged: true, vis: 'bolt', r: 26, ms: 290, gold: 45, xp: 60, armor: 30 },
  };

  // ---------- Champions ----------
  // dmg spec: b = base, l = per level, ad / ap = ratios
  const CHAMPS = {
    cow: {
      name: 'Bessie', title: 'the Dairy Defender', icon: '🐄', role: 'Tank', color: '#f5f5f4',
      hp: 660, hpL: 96, ad: 55, adL: 3.5, armor: 36, armorL: 4, as: 0.65, range: 125, ms: 330,
      abilities: {
        Q: { name: 'Milk Spray', icon: '🥛', type: 'cone', range: 450, arc: 55, cd: 7, dmg: { b: 70, l: 18, ap: 0.5, ad: 0.3 }, fx: { slow: { p: 30, d: 1.5 } }, vis: 'milk', desc: 'Sprays milk in a cone, damaging and slowing enemies.' },
        W: { name: 'Chew the Cud', icon: '🌿', type: 'buff', cd: 14, dur: 3, hot: { b: 110, l: 22, hpPct: 4 }, stats: { armor: 25 }, desc: 'Heals over 3 seconds and gains bonus armor.' },
        E: { name: 'Stampede', icon: '💨', type: 'dash', range: 480, speed: 1400, cd: 12, stopOnHit: true, dmg: { b: 60, l: 15, ad: 0.4 }, fx: { stun: 1.0 }, desc: 'Charges forward. The first enemy hit is damaged and stunned.' },
        R: { name: 'Moo-sive Shockwave', icon: '📣', type: 'self_aoe', radius: 420, cd: 70, dmg: { b: 150, l: 30, ap: 0.6, ad: 0.4 }, fx: { knock: 260, slow: { p: 40, d: 2 } }, vis: 'moo', desc: 'A mighty MOO knocks back and slows all nearby enemies.' },
      },
    },
    pig: {
      name: 'Porkchop', title: 'the Mud Brawler', icon: '🐖', role: 'Fighter', color: '#fbcfe8',
      hp: 610, hpL: 92, ad: 62, adL: 4, armor: 30, armorL: 3.5, as: 0.7, range: 140, ms: 335,
      abilities: {
        Q: { name: 'Mud Sling', icon: '🟤', type: 'skillshot', range: 900, speed: 1300, width: 60, cd: 6, dmg: { b: 80, l: 20, ad: 0.7 }, fx: { slow: { p: 25, d: 2 } }, vis: 'mud', desc: 'Flings a mud ball that damages and slows the first enemy hit.' },
        W: { name: 'Mud Wallow', icon: '🫧', type: 'zone', range: 650, radius: 230, dur: 4, cd: 14, tick: { b: 18, l: 5, ad: 0.12 }, slow: 35, vis: 'mud', desc: 'Creates a mud pit that slows and damages enemies inside.' },
        E: { name: 'Snout Charge', icon: '🐽', type: 'dash', range: 420, speed: 1500, cd: 10, dmg: { b: 60, l: 15, ad: 0.5 }, fx: { knock: 200 }, desc: 'Charges forward, knocking back every enemy in the way.' },
        R: { name: 'Truffle Frenzy', icon: '🍄', type: 'buff', cd: 75, dur: 6, heal: { hpPct: 15 }, stats: { asPct: 60, ls: 20, msPct: 15 }, desc: 'Heals and goes wild: big attack speed, life steal and speed for 6s.' },
      },
    },
    chicken: {
      name: 'Clucky', title: 'the Egg Bomber', icon: '🐔', role: 'Mage', color: '#fef9c3', ranged: true, atk: 'egg_s',
      hp: 480, hpL: 76, ad: 48, adL: 3, armor: 20, armorL: 3, as: 0.65, range: 525, ms: 330,
      abilities: {
        Q: { name: 'Egg Toss', icon: '🥚', type: 'ground_aoe', range: 850, radius: 140, delay: 0.6, cd: 5, dmg: { b: 85, l: 22, ap: 0.75 }, vis: 'egg', desc: 'Lobs an egg that explodes at the target area after a short delay.' },
        W: { name: 'Feather Flurry', icon: '🪶', type: 'self_aoe', radius: 300, cd: 10, dmg: { b: 60, l: 15, ap: 0.5 }, fx: { slow: { p: 40, d: 1.5 } }, vis: 'feather', desc: 'Explodes in feathers, damaging and slowing nearby enemies.' },
        E: { name: 'Flutter', icon: '🐣', type: 'blink', range: 420, cd: 14, desc: 'Flaps instantly to a nearby spot (can cross walls).' },
        R: { name: 'Egg Barrage', icon: '🍳', type: 'barrage', range: 900, radius: 420, n: 12, dur: 2.4, aoe: 110, delay: 0.5, cd: 70, dmg: { b: 55, l: 11, ap: 0.3 }, vis: 'eggrain', desc: 'Rains 12 eggs over a large area for 2.4s.' },
      },
    },
    goat: {
      name: 'Billy', title: 'the Cliff Crusher', icon: '🐐', role: 'Assassin', color: '#e7e5e4',
      hp: 540, hpL: 84, ad: 66, adL: 4.2, armor: 26, armorL: 3.2, as: 0.72, range: 130, ms: 345,
      abilities: {
        Q: { name: 'Headbutt', icon: '💢', type: 'targeted', range: 550, speed: 1600, cd: 7, dmg: { b: 70, l: 20, ad: 0.9 }, fx: { knock: 140 }, desc: 'Rams the enemy nearest your cursor, dealing damage and knocking it back.' },
        W: { name: 'Tin Can Chomp', icon: '🥫', type: 'buff', cd: 12, dur: 3, heal: { b: 60, l: 15, ad: 0.4 }, stats: { asPct: 35 }, desc: 'Eats a tin can: heals and gains attack speed for 3s.' },
        E: { name: 'Mountain Hop', icon: '⛰️', type: 'blink', range: 450, cd: 13, desc: 'Hops instantly to a nearby spot (can cross walls).' },
        R: { name: 'Goat Rage', icon: '😤', type: 'targeted', range: 500, speed: 1800, cd: 60, dmg: { b: 200, l: 40, ad: 1.2 }, fx: { stun: 0.75 }, desc: 'Charges the enemy nearest your cursor for huge damage and a stun.' },
      },
    },
    horse: {
      name: 'Thunder', title: 'the Stallion', icon: '🐎', role: 'Fighter', color: '#d6b38a',
      hp: 590, hpL: 88, ad: 60, adL: 3.8, armor: 28, armorL: 3.5, as: 0.7, range: 140, ms: 355,
      abilities: {
        Q: { name: 'Buck Kick', icon: '🦶', type: 'cone', range: 280, arc: 100, cd: 6, dmg: { b: 80, l: 20, ad: 0.8 }, fx: { knock: 220 }, vis: 'kick', desc: 'A wide kick that damages and knocks back enemies in front.' },
        W: { name: 'Gallop', icon: '🏇', type: 'buff', cd: 12, dur: 3, stats: { msPct: 40 }, cleanse: true, desc: 'Removes slows and roots and gains 40% move speed for 3s.' },
        E: { name: 'Fence Leap', icon: '🚧', type: 'leap', range: 520, speed: 1200, cd: 11, land: { r: 180, dmg: { b: 50, l: 15, ad: 0.5 }, fx: { slow: { p: 30, d: 1 } }, vis: 'hoof' }, desc: 'Leaps over anything (even walls) and slams down, slowing enemies.' },
        R: { name: 'Thundering Hooves', icon: '⚡', type: 'dash', range: 900, speed: 1250, cd: 65, dmg: { b: 150, l: 35, ad: 0.8 }, fx: { stun: 1.0 }, desc: 'A long charge that damages and stuns every enemy trampled.' },
      },
    },
    sheep: {
      name: 'Wooly', title: 'the Static Shepherd', icon: '🐑', role: 'Support', color: '#f8fafc', ranged: true, atk: 'static_s',
      hp: 520, hpL: 80, ad: 45, adL: 3, armor: 24, armorL: 3.3, as: 0.65, range: 500, ms: 330,
      abilities: {
        Q: { name: 'Static Shock', icon: '✨', type: 'skillshot', range: 950, speed: 1500, width: 55, cd: 8, dmg: { b: 70, l: 18, ap: 0.6 }, fx: { root: 1.0 }, vis: 'static', desc: 'A static wool spark that damages and roots the first enemy hit.' },
        W: { name: 'Wool Shield', icon: '🧶', type: 'ally', range: 650, cd: 10, dur: 3, shield: { b: 90, l: 25, ap: 0.5 }, stats: { msPct: 20 }, desc: 'Shields the ally nearest your cursor (or yourself) and speeds them up.' },
        E: { name: 'Lullaby', icon: '💤', type: 'ground_aoe', range: 700, radius: 200, delay: 0.8, cd: 15, dmg: { b: 30, l: 10, ap: 0.3 }, fx: { stun: 1.25 }, vis: 'lullaby', desc: 'After a short delay, puts enemies in the area to sleep (stun).' },
        R: { name: 'Shear Bliss', icon: '💖', type: 'self_aoe', radius: 650, cd: 80, allyHeal: { b: 150, l: 35, ap: 0.6 }, vis: 'bliss', desc: 'Heals yourself and all nearby allies.' },
      },
    },
    bee: {
      name: 'Queenie', title: 'the Hive Hunter', icon: '🐝', role: 'Marksman', color: '#fde047', ranged: true, atk: 'sting_s',
      hp: 500, hpL: 80, ad: 58, adL: 4, armor: 22, armorL: 3, as: 0.75, range: 600, ms: 330,
      abilities: {
        Q: { name: 'Stinger Volley', icon: '📍', type: 'skillshot', range: 1000, speed: 1900, width: 45, cd: 6, pierce: true, dmg: { b: 60, l: 20, ad: 1.0 }, vis: 'sting', desc: 'Fires a stinger that pierces through every enemy in a line.' },
        W: { name: 'Honey Trap', icon: '🍯', type: 'zone', range: 750, radius: 170, dur: 3, cd: 13, slow: 60, vis: 'honey', desc: 'Pours sticky honey that heavily slows enemies for 3s.' },
        E: { name: 'Buzz Off', icon: '🪽', type: 'dash', range: 380, speed: 1700, cd: 10, desc: 'Quickly zips a short distance.' },
        R: { name: 'Swarm Mode', icon: '👑', type: 'buff', cd: 70, dur: 6, stats: { asPct: 80, range: 120, msPct: 10 }, desc: 'Huge attack speed and attack range for 6s.' },
      },
    },
    duck: {
      name: 'Quackers', title: 'the Pond Gunner', icon: '🦆', role: 'Mage', color: '#bbf7d0', ranged: true, atk: 'bread_s',
      hp: 490, hpL: 76, ad: 50, adL: 3, armor: 21, armorL: 3, as: 0.65, range: 525, ms: 330,
      abilities: {
        Q: { name: 'Bread Bomb', icon: '🍞', type: 'skillshot', range: 950, speed: 1100, width: 70, explode: 150, cd: 6, dmg: { b: 75, l: 20, ap: 0.7 }, vis: 'bread', desc: 'Throws bread that explodes on the first enemy hit (or at max range).' },
        W: { name: 'Puddle Jump', icon: '💧', type: 'leap', range: 450, speed: 1100, cd: 12, land: { r: 170, dmg: { b: 40, l: 12, ap: 0.4 }, fx: { slow: { p: 30, d: 1 } }, vis: 'splash' }, desc: 'Jumps to a spot and splashes down, slowing enemies.' },
        E: { name: 'Quack Blast', icon: '🔊', type: 'cone', range: 500, arc: 40, cd: 11, dmg: { b: 60, l: 16, ap: 0.5 }, fx: { knock: 260 }, vis: 'quack', desc: 'A deafening quack that knocks enemies away.' },
        R: { name: 'Duck Dive', icon: '🎯', type: 'ground_aoe', range: 1500, radius: 300, delay: 1.2, cd: 70, dmg: { b: 220, l: 45, ap: 0.9 }, vis: 'duckdive', desc: 'Calls in a flock of diving ducks on a large area after 1.2s.' },
      },
    },
  };

  // ---------- Items ----------
  // All items are farm equipment.
  const ITEMS = [
    { id: 'pitchfork', name: 'Pitchfork', icon: '🔱', cost: 400, stats: { ad: 18 } },
    { id: 'moonshine', name: 'Fertilizer Spreader', icon: '🧪', cost: 400, stats: { ap: 28 } },
    { id: 'cornfed', name: 'Grain Bin', icon: '🛢️', cost: 400, stats: { hp: 220 } },
    { id: 'horseshoe', name: 'Muck Boots', icon: '🥾', cost: 350, stats: { ms: 40 } },
    { id: 'haybarrier', name: 'Hay Baler', icon: '🧱', cost: 650, stats: { armor: 30, regen: 4 } },
    { id: 'alarm', name: 'Thresher Gears', icon: '⚙️', cost: 700, stats: { asPct: 35 } },
    { id: 'courier', name: 'Wheelbarrow', icon: '🛒', cost: 800, stats: { ms: 55 }, desc: 'Carry the flag in your wheelbarrow: carrying a flag no longer slows you.' },
    { id: 'feedbucket', name: 'Milking Pail', icon: '🪣', cost: 900, stats: { ad: 15, ls: 12 } },
    { id: 'plow', name: 'Iron Plowshare', icon: '🛡️', cost: 1100, stats: { armor: 45, hp: 200 } },
    { id: 'scythe', name: 'Splitting Axe', icon: '🪓', cost: 1200, stats: { ad: 45, cdr: 10 } },
    { id: 'almanac', name: 'Weather Vane', icon: '🧭', cost: 1250, stats: { ap: 70, cdr: 15 } },
    { id: 'engine', name: 'Tractor Engine', icon: '🚜', cost: 1400, stats: { hp: 400, ad: 30 } },
    { id: 'goldenegg', name: 'Irrigation Pump', icon: '🚰', cost: 1400, stats: { hp: 300, ap: 45, cdr: 10 } },
    { id: 'windmill', name: 'Windmill Blades', icon: '🌀', cost: 1500, stats: { ad: 35, asPct: 30, ms: 20 } },
  ];

  // Special spells (pick 2 in the lobby, cast with D and F)
  const SUMMONERS = {
    flash: { name: 'Hay Hop', icon: '✨', cd: 180, type: 'blink', range: 420, desc: 'Instantly hop a short distance — even over walls. (Flash)' },
    heal: { name: 'Barn Salve', icon: '❤️‍🩹', cd: 150, type: 'heal', heal: { b: 100, l: 18 }, range: 650, ms: 30, desc: 'Heal yourself and the most injured nearby ally, and gain a burst of speed. (Heal)' },
    ghost: { name: 'Tailwind', icon: '💨', cd: 150, type: 'ghost', dur: 8, ms: 45, desc: '+45% move speed for 8 seconds. (Ghost)' },
    ignite: { name: 'Bonfire', icon: '🔥', cd: 150, type: 'ignite', range: 600, dot: { b: 70, l: 22 }, dur: 5, desc: 'Set the enemy champion nearest your cursor on fire, dealing damage over 5s. (Ignite)' },
    barrier: { name: 'Haystack', icon: '🧱', cd: 150, type: 'barrier', shield: { b: 100, l: 25 }, dur: 2.5, desc: 'Shield yourself for 2.5 seconds. (Barrier)' },
    exhaust: { name: 'Muddy Boots', icon: '🥾', cd: 180, type: 'exhaust', range: 650, dur: 2.5, slow: 40, weak: 35, desc: 'Slow the enemy champion nearest your cursor by 40% and cut their damage by 35% for 2.5s. (Exhaust)' },
    cleanse: { name: 'Hose Down', icon: '🚿', cd: 180, type: 'cleanse', desc: 'Remove all stuns, roots and slows from yourself. (Cleanse)' },
  };
  const DEFAULT_SPELLS = ['flash', 'heal'];

  // Shallow streams. Each flows downstream (from first point to last) toward the base on its side.
  const STREAM_W = 100, STREAM_SPEED = 170;
  const STREAMS_BLUE = [
    [[2250, 525], [820, 525], [610, 790]],
    [[2250, 1462], [700, 1462]],
    [[2250, 2275], [820, 2275], [610, 2010]],
  ];
  const STREAMS = [];
  for (const s of STREAMS_BLUE) { STREAMS.push(s); STREAMS.push(s.map(([x, y]) => [W - x, y])); }
  const streamAt = (x, y) => {
    let best = null, bd = STREAM_W / 2;
    for (const P of STREAMS) {
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, ay] = P[i], [bx, by] = P[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
        if (d < bd) { bd = d; const L = Math.sqrt(L2); best = { fx: dx / L, fy: dy / L }; }
      }
    }
    return best;
  };
  const ITEMS_BY_ID = {};
  ITEMS.forEach((it) => { ITEMS_BY_ID[it.id] = it; });
  const STAT_NAMES = { ad: 'Attack Dmg', ap: 'Ability Power', hp: 'Health', armor: 'Armor', ms: 'Move Speed', asPct: '% Attack Speed', cdr: '% Cooldown Red.', ls: '% Life Steal', regen: 'Health Regen/s' };
  const BUILDS = {
    Tank: ['cornfed', 'courier', 'plow', 'haybarrier', 'engine', 'goldenegg'],
    Fighter: ['pitchfork', 'courier', 'feedbucket', 'engine', 'scythe', 'plow'],
    Assassin: ['pitchfork', 'courier', 'scythe', 'feedbucket', 'windmill', 'engine'],
    Mage: ['moonshine', 'courier', 'almanac', 'goldenegg', 'moonshine', 'haybarrier'],
    Marksman: ['pitchfork', 'courier', 'alarm', 'windmill', 'feedbucket', 'scythe'],
    Support: ['moonshine', 'courier', 'cornfed', 'goldenegg', 'plow', 'almanac'],
  };

  const DATA = {
    W, H, C, BRUSHES, brushAt, SUMMONERS, DEFAULT_SPELLS, STREAMS, STREAM_W, STREAM_SPEED, streamAt, PRIZE_TYPES, PRIZE_SPOTS, PRIZE, TEAM_NAMES, TEAM_COLORS, TEAM_DARK, TEAM_LIGHT, BASES, FOUNTAINS, LANES, RIVER, WALLS,
    TOWERS, TOWER_STATS, CAMPS, CAMP_TYPES, NEUTRALS, MINIONS, CHAMPS, ITEMS, ITEMS_BY_ID, STAT_NAMES, BUILDS,
    CROPS, CROP_TYPES, xpToNext, respawnTime,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.GameData = DATA;
})(typeof window !== 'undefined' ? window : this);
