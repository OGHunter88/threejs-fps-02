// The bots. Seven of them: four Raiders who push a site and plant the bomb,
// three Vanguard teammates who hold the sites with the player. Each bot is a
// small state machine — route, hold, engage, plant, defuse, investigate —
// walking the map's waypoint graph, seeing through a line of sight and a field
// of view, and hearing gunshots. They shoot with the same guns and the same
// hitscan resolution as the player, so a firefight reads the same both ways.
import * as THREE from 'three';
import { createBody } from './player.js';
import { createGun, WEAPONS } from './weapons.js';
import { TEAM_COLORS } from './palette.js';
import { WAYPOINTS, findPath, nearestWaypoint, SITES } from './map.js';

const VIEW_DISTANCE = 45;
const VIEW_HALF_ANGLE = 0.96; // ~110 degrees of vision
const HEAR_DISTANCE = 18;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;

const RAIDER_NAMES = ['Dune', 'Jackal', 'Vulture', 'Scorpion'];
const VANGUARD_NAMES = ['Sable', 'Wren', 'Kestrel'];

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _forward = new THREE.Vector3();

function makeBotMesh(scene, team) {
  const color = new THREE.Color(TEAM_COLORS[team]);
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });

  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.15;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), trim);
  band.position.y = 1.72;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.22), cloth);
  legL.position.set(-0.14, 0.3, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.55), trim);
  gun.position.set(0.2, 1.2, -0.25);
  group.add(torso, head, band, legL, legR, gun);
  scene.add(group);
  return { group, torso, head };
}

export function createBots(scene, game) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VIEW_DISTANCE;
  const bots = [];

  function spawnBot(team, name, spawn, role, site) {
    const body = createBody(game.map.colliders, spawn);
    const gun = createGun(team === 'raider' ? 'rifle' : (Math.random() < 0.5 ? 'rifle' : 'smg'));
    const mesh = makeBotMesh(scene, team);
    mesh.torso.userData.agent = null; // filled below, once the bot object exists
    mesh.head.userData.agent = null;
    const bot = {
      kind: 'bot', team, name, role, site,
      body, gun, mesh,
      health: 100, alive: true,
      state: 'route', path: [], pathIndex: 0,
      holdNode: null, holdUntil: 0,
      target: null, reactAt: 0, burstLeft: 0, nextBurstAt: 0,
      lastSeen: null, investigate: null, investigateUntil: 0,
      plantProgress: 0, defuseProgress: 0,
      yawTarget: body.state.yaw,
      skill: 0.55 + Math.random() * 0.35, // reaction and aim vary per bot
      scanAt: Math.random() * 0.15,
      keys: new Set(),
    };
    mesh.torso.userData.agent = bot;
    mesh.torso.userData.part = 'body';
    mesh.head.userData.agent = bot;
    mesh.head.userData.part = 'head';
    bot.hitMeshes = [mesh.torso, mesh.head];
    bots.push(bot);
    return bot;
  }

  function reset(roundNumber) {
    for (const bot of bots) {
      scene.remove(bot.mesh.group);
    }
    bots.length = 0;
    const { SPAWNS } = game;
    // Raiders: two to A, two to B, one of them carrying the bomb.
    const lanes = ['A', 'A', 'B', 'B'];
    const carrierIndex = Math.floor(Math.random() * 4);
    RAIDER_NAMES.forEach((name, i) => {
      const bot = spawnBot('raider', name, SPAWNS.attacker[i], 'attacker', lanes[i]);
      bot.carrier = i === carrierIndex;
    });
    // Vanguard teammates: one holds A, one holds B, one holds Mid.
    const holds = ['holdA', 'holdB', 'holdM'];
    VANGUARD_NAMES.forEach((name, i) => {
      const bot = spawnBot('vanguard', name, SPAWNS.defender[i + 1], 'defender', null);
      bot.holdNode = holds[i];
    });
    for (const bot of bots) {
      assignRoute(bot);
    }
    game.bomb.carrier = bots.find((b) => b.team === 'raider' && b.carrier) ?? null;
  }

  function assignRoute(bot) {
    const from = nearestWaypoint(bot.body.state.position.x, bot.body.state.position.z);
    if (bot.team === 'raider') {
      const goal = bot.site === 'A' ? 'a3' : 'b3';
      bot.path = findPath(from, goal);
    } else {
      bot.path = findPath(from, bot.holdNode);
    }
    bot.pathIndex = 0;
    bot.state = 'route';
  }

  function canSee(bot, enemy) {
    if (!enemy.alive) return false;
    const b = bot.body.state;
    const e = enemy.body.state;
    _eye.set(b.position.x, b.position.y + b.eye, b.position.z);
    _to.set(e.position.x, e.position.y + e.eye * 0.8, e.position.z);
    _dir.subVectors(_to, _eye);
    const dist = _dir.length();
    if (dist > VIEW_DISTANCE) return false;
    _dir.normalize();
    _forward.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
    if (_forward.dot(_dir) < Math.cos(VIEW_HALF_ANGLE)) return false;
    raycaster.set(_eye, _dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(game.map.shootables, false)[0];
    return !hit;
  }

  function nearestVisibleEnemy(bot, now) {
    let best = null;
    let bestD = Infinity;
    for (const enemy of game.agents()) {
      if (enemy.team === bot.team || !enemy.alive) continue;
      const d = bot.body.state.position.distanceTo(enemy.body.state.position);
      if (d < bestD && canSee(bot, enemy)) {
        best = enemy;
        bestD = d;
      }
    }
    return best;
  }

  function aimAt(bot, enemy, now) {
    const b = bot.body.state;
    const e = enemy.body.state;
    const dx = e.position.x - b.position.x;
    const dy = (e.position.y + e.eye * 0.8) - (b.position.y + b.eye);
    const dz = e.position.z - b.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    bot.yawTarget = Math.atan2(-dx, -dz);
    b.yaw = bot.yawTarget;
    b.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  }

  function shootAt(bot, enemy, now) {
    if (!bot.gun.ready()) return;
    if (bot.burstLeft <= 0) {
      if (now < bot.nextBurstAt) return;
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.nextBurstAt = now + 0.5 + Math.random() * 0.5;
    }
    bot.burstLeft -= 1;
    const b = bot.body.state;
    const e = enemy.body.state;
    const dist = b.position.distanceTo(e.position);
    // Aim error grows with distance, with a moving target, and with a moving bot.
    const targetSpeed = Math.hypot(e.velocity.x, e.velocity.z);
    const botSpeed = bot.body.groundSpeed();
    const error = (0.012 + dist * 0.0011 + targetSpeed * 0.002 + botSpeed * 0.004) * (1.25 - bot.skill);
    if (!bot.gun.takeRound()) {
      bot.gun.reload();
      return;
    }
    bot.gun.pullTrigger();
    _eye.set(b.position.x, b.position.y + b.eye, b.position.z);
    _dir.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
    _dir.y = Math.tan(b.pitch);
    _dir.normalize();
    // One shot in ten goes for the head.
    if (Math.random() < 0.1) {
      _dir.y += 0.09;
      _dir.normalize();
    }
    game.fireHitscan(bot, _eye, _dir, error);
    game.noise(b.position.x, b.position.z);
  }

  function walkPath(bot, dt, now) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = WAYPOINTS.find((w) => w.id === bot.path[bot.pathIndex]);
    const p = bot.body.state.position;
    const dx = node.x - p.x;
    const dz = node.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    bot.yawTarget = Math.atan2(-dx, -dz);
    // Turn toward the waypoint, then walk.
    let dyaw = bot.yawTarget - bot.body.state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.body.state.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
    bot.keys.clear();
    if (Math.abs(dyaw) < 0.6) bot.keys.add('KeyW');
    return false;
  }

  function stepBot(bot, dt, now) {
    if (!bot.alive) return;
    const b = bot.body.state;
    bot.gun.step(dt);

    // Scan for a visible enemy on a stagger, so nine bots do not raycast at once.
    if (now >= bot.scanAt) {
      bot.scanAt = now + 0.15;
      const seen = nearestVisibleEnemy(bot, now);
      if (seen) {
        if (bot.target !== seen) {
          bot.target = seen;
          bot.reactAt = now + (0.55 - bot.skill * 0.3) + Math.random() * 0.15;
        }
        bot.lastSeen = { x: seen.body.state.position.x, z: seen.body.state.position.z, at: now };
      } else if (bot.target && (!bot.lastSeen || now - bot.lastSeen.at > 1.2)) {
        bot.target = null;
      }
    }

    // Hearing: a recent gunshot nearby pulls a bot that has nothing to do.
    if (!bot.target && game.latestNoise) {
      const n = game.latestNoise;
      const d = Math.hypot(n.x - b.position.x, n.z - b.position.z);
      if (d < HEAR_DISTANCE && now - n.at < 1.0 && now >= bot.investigateUntil) {
        bot.investigate = { x: n.x, z: n.z };
        bot.investigateUntil = now + 4;
        if (bot.state === 'hold') bot.state = 'route';
      }
    }

    // The bomb carrier plants when it reaches its site with no enemy watching.
    if (bot.carrier && bot.alive && game.bomb.state === 'carried' && bot.state !== 'plant') {
      const site = SITES[bot.site];
      const d = Math.hypot(site.x - b.position.x, site.z - b.position.z);
      if (d < site.r * 0.8 && !bot.target) {
        bot.state = 'plant';
        bot.plantProgress = 0;
        bot.keys.clear();
      }
    }
    if (bot.state === 'plant') {
      if (bot.target || bot.health <= 0) {
        bot.state = 'route';
        bot.plantProgress = 0;
        assignRoute(bot);
      } else {
        bot.plantProgress += dt;
        game.bomb.plantProgress = bot.plantProgress / PLANT_TIME;
        if (bot.plantProgress >= PLANT_TIME) {
          game.plantBomb(bot.site, b.position);
          bot.state = 'route';
          bot.path = findPath(nearestWaypoint(b.position.x, b.position.z), bot.site === 'A' ? 'holdA' : 'holdB');
          bot.pathIndex = 0;
        }
      }
      bot.body.step(dt, bot.keys, false);
      return;
    }

    // A defender that reaches the planted bomb defuses it.
    if (bot.team === 'vanguard' && game.bomb.state === 'planted') {
      const d = Math.hypot(game.bomb.position.x - b.position.x, game.bomb.position.z - b.position.z);
      if (d < 2.2 && !bot.target) {
        bot.state = 'defuse';
        bot.defuseProgress += dt;
        game.bomb.defuseProgress = bot.defuseProgress / DEFUSE_TIME;
        if (bot.defuseProgress >= DEFUSE_TIME) {
          game.defuseBomb(bot);
          bot.state = 'route';
          bot.defuseProgress = 0;
        }
        bot.keys.clear();
        bot.body.step(dt, bot.keys, false);
        return;
      }
      if (bot.state !== 'route') {
        bot.state = 'route';
        bot.defuseProgress = 0;
        const goal = game.bomb.site === 'A' ? 'a3' : 'b3';
        bot.path = findPath(nearestWaypoint(b.position.x, b.position.z), goal);
        bot.pathIndex = 0;
      }
    }

    // Engage: stand, aim, and fire in bursts.
    if (bot.target && now >= bot.reactAt) {
      aimAt(bot, bot.target, now);
      bot.keys.clear();
      shootAt(bot, bot.target, now);
      bot.body.step(dt, bot.keys, false);
      return;
    }

    // Investigate a noise, then go back to the route.
    if (bot.investigate && now < bot.investigateUntil && !bot.target) {
      const p = b.position;
      const dx = bot.investigate.x - p.x;
      const dz = bot.investigate.z - p.z;
      if (Math.hypot(dx, dz) < 1.0) {
        bot.investigate = null;
        assignRoute(bot);
      } else {
        bot.yawTarget = Math.atan2(-dx, -dz);
        let dyaw = bot.yawTarget - b.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        b.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
        bot.keys.clear();
        if (Math.abs(dyaw) < 0.6) bot.keys.add('KeyW');
        bot.body.step(dt, bot.keys, false);
        return;
      }
    }

    // Route or hold.
    if (bot.state === 'route') {
      const arrived = walkPath(bot, dt, now);
      if (arrived) {
        if (bot.team === 'vanguard') {
          bot.state = 'hold';
          bot.holdUntil = now + 2.5 + Math.random() * 3;
        } else {
          // An attacker that arrived without planting waits, watching the site.
          bot.state = 'hold';
          bot.holdUntil = now + 2 + Math.random() * 2;
        }
      }
    } else if (bot.state === 'hold') {
      bot.keys.clear();
      // Scan the lane: slow yaw sweeps while holding.
      b.yaw += Math.sin(now * 0.5 + bot.skill * 9) * 0.35 * dt;
      if (now >= bot.holdUntil) {
        if (bot.team === 'vanguard') {
          bot.state = 'route';
          assignRoute(bot);
        } else {
          bot.state = 'route';
          assignRoute(bot);
        }
      }
    }
    bot.body.step(dt, bot.keys, false);

    // Keep the visible body on the simulated one.
    bot.mesh.group.position.set(b.position.x, b.position.y, b.position.z);
    bot.mesh.group.rotation.y = b.yaw;
  }

  function step(dt, now) {
    for (const bot of bots) stepBot(bot, dt, now);
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function damage(bot, amount, part, shooter) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.target = null;
      bot.mesh.group.visible = false;
      // The bomb drops to the nearest living Raider.
      if (bot.carrier && game.bomb.state === 'carried') {
        const next = bots.find((b) => b.team === 'raider' && b.alive);
        if (next) {
          next.carrier = true;
          game.bomb.carrier = next;
        } else {
          game.bomb.carrier = null;
        }
        bot.carrier = false;
      }
    }
  }

  return { list: bots, reset, step, aliveCount, damage };
}
