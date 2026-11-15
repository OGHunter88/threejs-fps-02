// DUSTLINE: a round-based tactical FPS. Boot and the one loop: a fixed 60 Hz
// simulation feeding a render at the display's rate. One `game` object holds
// every piece of state — the player, the bots, the bomb, the round, the money
// — so no module keeps a private copy of what another one decides.
// ?shot=start|play|bomb|buy with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, SITES, SPAWNS } from './map.js';
import { createBody } from './player.js';
import { createGun, createViewModel, WEAPONS, GRENADE, HEAD_MULT } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, BOMB_TIME, FREEZE_TIME } from './rounds.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

// The renderer is the one call that touches the GPU, and a strict option can
// refuse a context where a plain one succeeds (software GL, for instance).
// Try the preferred setup first, then fall back step by step so the game
// boots on any WebGL-capable browser instead of dying before the canvas.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!shot });
} catch (e1) {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!shot });
  } catch (e2) {
    renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: !!shot });
  }
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2e3138');
scene.fog = new THREE.Fog(new THREE.Color('#2e3138'), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene);
const audio = createAudio();

// --- The one state store.
const game = {
  map,
  SPAWNS,
  player: null,
  bots: null,
  round: null,
  bomb: {
    state: 'carried', site: null, carrier: null,
    position: new THREE.Vector3(), timer: BOMB_TIME,
    plantProgress: 0, defuseProgress: 0, defuser: null,
  },
  latestNoise: null,
  grenades: [],
  frozen: false,
  started: false,
  elapsed: 0,
  beepAt: 0,
};

// --- The player.
const playerBody = createBody(map.colliders, SPAWNS.defender[0]);
const playerGun = createGun('pistol');
const viewModel = createViewModel(camera, playerGun);
const player = {
  kind: 'player', team: 'vanguard', name: 'You',
  body: playerBody, gun: playerGun,
  health: 100, money: 800, owned: { pistol: true }, grenades: 0,
  alive: true, defuseProgress: 0,
};
game.player = player;

// The player's hit boxes: invisible to the eye, solid to a raycast, so bots
// can hit the player with the same resolution the player uses on them.
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerBodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.1, 0.68), hitMat);
const playerHeadBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), hitMat);
playerBodyBox.userData.agent = player;
playerBodyBox.userData.part = 'body';
playerHeadBox.userData.agent = player;
playerHeadBox.userData.part = 'head';
scene.add(playerBodyBox, playerHeadBox);
player.hitMeshes = [playerBodyBox, playerHeadBox];

// --- The bomb's visible body: a dark case with a blinking teal light.
const bombMesh = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.26, 0.32),
  new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombLight.position.set(0, 0.18, 0);
bombMesh.add(bombCase, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const hud = createHud({
  onPlay: () => {
    if (game.round.state.phase === 'matchover') return;
    audio.unlock();
    input.requestLock();
  },
  onPlayAgain: () => {
    audio.unlock();
    game.round.startMatch();
    hud.hideOverlay();
    input.requestLock();
  },
  onBuy: (itemId) => buyItem(itemId),
  onBuyClose: () => {
    hud.showBuy(false);
    if (game.round.state.phase === 'freeze') input.requestLock();
  },
});
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, game);
game.bots = bots;
const round = createRounds(game);
game.round = round;

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

// --- Shared combat: one hitscan resolution for the player and every bot.
function agents() {
  const list = player.alive ? [player] : [];
  for (const bot of bots.list) if (bot.alive) list.push(bot);
  return list;
}
game.agents = agents;

function aliveCount(team) {
  let n = team === 'vanguard' && player.alive ? 1 : 0;
  return n + bots.aliveCount(team);
}
game.aliveCount = aliveCount;

function fireHitscan(shooter, origin, direction, spread) {
  const def = shooter.gun.def;
  const targets = [...map.shootables];
  for (const agent of agents()) {
    if (agent === shooter) continue;
    targets.push(...agent.hitMeshes);
  }
  for (let p = 0; p < def.pellets; p += 1) {
    _direction.copy(direction);
    _direction.x += (random() * 2 - 1) * spread;
    _direction.y += (random() * 2 - 1) * spread;
    _direction.z += (random() * 2 - 1) * spread;
    _direction.normalize();
    raycaster.set(origin, _direction);
    const hit = raycaster.intersectObjects(targets, false)[0];
    _muzzle.copy(origin).addScaledVector(_direction, 0.6);
    if (hit) {
      _end.copy(hit.point);
      effects.tracer(_muzzle, _end);
      const agent = hit.object.userData.agent;
      if (agent) {
        const dist = origin.distanceTo(hit.point);
        const damage = shooter.gun.damageAt(dist) * (hit.object.userData.part === 'head' ? HEAD_MULT : 1);
        damageAgent(agent, damage, hit.object.userData.part, shooter);
      } else {
        effects.sparksAt(hit.point, hit.face ? hit.face.normal : _direction, 5);
      }
    } else {
      _end.copy(origin).addScaledVector(_direction, 80);
      effects.tracer(_muzzle, _end);
    }
  }
}
game.fireHitscan = fireHitscan;

function damageAgent(target, amount, part, shooter) {
  if (target.kind === 'player') {
    player.health -= amount;
    hud.setHealth(player.health);
    audio.hurt();
    const damageEl = document.getElementById('damage');
    damageEl.style.opacity = '0.55';
    window.setTimeout(() => { damageEl.style.opacity = '0'; }, 140);
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      input.releaseLock();
      hud.showBanner('Eliminated', 'Your team fights on — next round you return.', 'bad');
      onAgentKilled(player, shooter);
    }
    return;
  }
  const wasAlive = target.alive;
  bots.damage(target, amount, part, shooter);
  if (shooter === player) {
    hud.hitMarker(!target.alive);
    if (!target.alive) audio.kill();
    else audio.hit();
  }
  if (wasAlive && !target.alive) onAgentKilled(target, shooter);
}

function onAgentKilled(agent, killer) {
  hud.killfeed(killer ? killer.name : '—', agent.name, false);
  if (killer === player && agent.kind === 'bot') round.killReward();
}

function noise(x, z) {
  game.latestNoise = { x, z, at: game.elapsed };
}
game.noise = noise;

// --- The bomb.
function plantBomb(site, position) {
  game.bomb.state = 'planted';
  game.bomb.site = site;
  game.bomb.position.set(position.x, 0, position.z);
  game.bomb.timer = BOMB_TIME;
  game.bomb.plantProgress = 0;
  bombMesh.position.set(position.x, 0.16, position.z);
  bombMesh.visible = true;
  audio.plant();
  hud.showBomb(`Bomb planted at ${site} — defuse it!`, 'danger');
}
game.plantBomb = plantBomb;

function defuseBomb(agent) {
  game.bomb.state = 'defused';
  game.bomb.defuseProgress = 0;
  game.bomb.defuser = null;
  bombMesh.visible = false;
  hud.showBomb('', '');
  round.endRound('vanguard', `${agent.name} defused the bomb`);
}
game.defuseBomb = defuseBomb;

function explodeBomb() {
  game.bomb.state = 'exploded';
  bombMesh.visible = false;
  effects.explosion(game.bomb.position);
  audio.explosion();
  hud.showBomb('', '');
  for (const agent of agents()) {
    const d = agent.body.state.position.distanceTo(game.bomb.position);
    if (d < 10) damageAgent(agent, 140 * (1 - d / 12), 'body', null);
  }
}
game.explodeBomb = explodeBomb;

// --- Round plumbing.
function resetRound() {
  playerBody.respawn(SPAWNS.defender[0]);
  player.health = 100;
  player.alive = true;
  player.defuseProgress = 0;
  playerGun.refill();
  hud.setHealth(100);
  hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
  hud.setGrenades(player.grenades);
  hud.setMoney(player.money);
  hud.showBomb('', '');
  hud.setProgress(null, null);
  hud.resetBuy();
  for (const id of Object.keys(player.owned)) hud.markBought(id);
  game.bomb.state = 'carried';
  game.bomb.site = null;
  game.bomb.plantProgress = 0;
  game.bomb.defuseProgress = 0;
  game.bomb.defuser = null;
  bombMesh.visible = false;
  game.grenades.length = 0;
  bots.reset(round.state.number);
  hud.setScore(round.state.score.vanguard, round.state.score.raider);
}
game.resetRound = resetRound;

function onRoundStart() {
  hud.showBuy(false);
  hud.showBanner(`Round ${round.state.number}`, 'Defend the sites.', 'info');
}
game.onRoundStart = onRoundStart;

function onRoundEnd(winner, reason) {
  const won = winner === 'vanguard';
  hud.showBanner(won ? 'Round won' : 'Round lost', reason, won ? 'good' : 'bad');
  if (won) audio.roundWin();
  else audio.roundLose();
  hud.setScore(round.state.score.vanguard, round.state.score.raider);
  hud.setMoney(player.money);
  input.releaseLock();
}
game.onRoundEnd = onRoundEnd;

function onMatchEnd(winner) {
  const won = winner === 'vanguard';
  input.releaseLock();
  hud.showOverlay('end', { won, v: round.state.score.vanguard, r: round.state.score.raider, reason: won ? 'Yard 7 is yours.' : 'The Raiders took Yard 7.' });
}
game.onMatchEnd = onMatchEnd;

// --- Buying.
function buyItem(itemId) {
  if (round.state.phase !== 'freeze' || !player.alive) return;
  if (itemId === 'grenade') {
    if (player.grenades >= 3 || player.money < GRENADE.price) return;
    player.money -= GRENADE.price;
    player.grenades += 1;
    hud.setGrenades(player.grenades);
  } else {
    const def = WEAPONS[itemId];
    if (player.owned[itemId] || player.money < def.price) return;
    player.money -= def.price;
    player.owned[itemId] = true;
    playerGun.equip(itemId);
    viewModel.rebuild();
    hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
    hud.markBought(itemId);
  }
  hud.setMoney(player.money);
  audio.buy();
}

// --- Shooting.
function playerShoot() {
  if (!playerGun.ready()) return;
  if (!playerGun.takeRound()) {
    playerGun.reload();
    audio.reload();
    return;
  }
  playerGun.pullTrigger();
  camera.getWorldDirection(_direction);
  _origin.copy(camera.position);
  fireHitscan(player, _origin, _direction, playerGun.spread(playerBody.groundSpeed()));
  playerBody.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(playerGun.def.kind);
  noise(playerBody.state.position.x, playerBody.state.position.z);
  hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
}

// --- Grenades.
function throwGrenade() {
  if (player.grenades <= 0 || round.state.phase !== 'live' || !player.alive) return;
  player.grenades -= 1;
  hud.setGrenades(player.grenades);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.5 }),
  );
  camera.getWorldDirection(_direction);
  mesh.position.copy(camera.position).addScaledVector(_direction, 0.5);
  scene.add(mesh);
  game.grenades.push({
    mesh,
    velocity: _direction.clone().multiplyScalar(GRENADE.throwSpeed).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: GRENADE.fuse,
  });
  audio.shot('smg');
}

function stepGrenades(dt) {
  for (let i = game.grenades.length - 1; i >= 0; i -= 1) {
    const g = game.grenades[i];
    g.fuse -= dt;
    g.velocity.y -= 14 * dt;
    const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
    // A cheap bounce: if the next spot is inside a collider, reflect that axis.
    let bounced = false;
    for (const c of map.colliders) {
      if (next.x > c.min.x - 0.12 && next.x < c.max.x + 0.12 && next.y > c.min.y - 0.12 && next.y < c.max.y + 0.12 && next.z > c.min.z - 0.12 && next.z < c.max.z + 0.12) {
        if (g.mesh.position.y < c.min.y || g.mesh.position.y > c.max.y) g.velocity.y *= -0.45;
        else if (Math.abs(next.x - g.mesh.position.x) > 0.001) g.velocity.x *= -0.45;
        else g.velocity.z *= -0.45;
        bounced = true;
        break;
      }
    }
    if (!bounced) g.mesh.position.copy(next);
    if (g.mesh.position.y < 0.12) {
      g.mesh.position.y = 0.12;
      g.velocity.y = Math.abs(g.velocity.y) * 0.45;
      g.velocity.x *= 0.7;
      g.velocity.z *= 0.7;
    }
    if (g.fuse <= 0) {
      effects.explosion(g.mesh.position);
      audio.explosion();
      for (const agent of agents()) {
        const d = agent.body.state.position.distanceTo(g.mesh.position);
        if (d < GRENADE.radius) {
          damageAgent(agent, GRENADE.damage * (1 - d / (GRENADE.radius * 1.4)), 'body', player);
        }
      }
      scene.remove(g.mesh);
      game.grenades.splice(i, 1);
    }
  }
}

// --- Scoping.
let scoped = false;
function setScoped(on) {
  if (playerGun.def.id !== 'sniper') on = false;
  if (on === scoped) return;
  scoped = on;
  camera.fov = on ? 74 / playerGun.def.zoom : 74;
  camera.updateProjectionMatrix();
  hud.setScoped(on);
}

// --- Discrete keys: buy, grenade, weapon slots.
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyB' && round.state.phase === 'freeze' && player.alive) {
    const open = !hud.isBuyOpen();
    hud.showBuy(open);
    if (open) input.releaseLock();
    else input.requestLock();
  }
  if (event.code === 'KeyG') throwGrenade();
  const slots = { Digit1: 'pistol', Digit2: 'rifle', Digit3: 'smg', Digit4: 'shotgun', Digit5: 'sniper' };
  const next = slots[event.code];
  if (next && player.owned[next] && playerGun.def.id !== next) {
    playerGun.equip(next);
    viewModel.rebuild();
    setScoped(false);
    hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
  }
});
renderer.domElement.addEventListener('mousedown', (event) => {
  if (event.button === 2) setScoped(true);
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) setScoped(false);
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    game.started = true;
    hud.hideOverlay();
    hud.showBuy(false);
  } else if (round.state.phase !== 'matchover') {
    hud.showOverlay(game.started ? 'paused' : 'start', {
      round: round.state.number, v: round.state.score.vanguard, r: round.state.score.raider,
    });
  }
}

function syncCamera() {
  const b = playerBody.state;
  camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
  camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
  // The player's hit boxes ride on the simulated body.
  playerBodyBox.position.set(b.position.x, b.position.y + 0.85, b.position.z);
  playerHeadBox.position.set(b.position.x, b.position.y + b.eye, b.position.z);
}

function step(dt, now) {
  game.elapsed += dt;
  const phase = round.state.phase;
  const keys = input.state.keys;

  if (player.alive && phase !== 'matchover') {
    const look = input.takeLook();
    playerBody.look(look.x, look.y);
    const jump = input.takeJump();
    playerBody.step(dt, keys, jump);
    playerGun.step(dt);
    viewModel.step(dt);
    if (input.state.firing && playerGun.ready() && phase === 'live') playerShoot();
    if (keys.has('KeyR')) {
      if (playerGun.state.reloadLeft === 0 && playerGun.state.mag < playerGun.def.mag) audio.reload();
      playerGun.reload();
    }
    // Defusing: hold E beside the planted bomb.
    if (game.bomb.state === 'planted' && keys.has('KeyE')) {
      const d = Math.hypot(game.bomb.position.x - playerBody.state.position.x, game.bomb.position.z - playerBody.state.position.z);
      if (d < 2.2) {
        player.defuseProgress += dt;
        game.bomb.defuseProgress = player.defuseProgress / DEFUSE_TIME;
        game.bomb.defuser = player;
        hud.setProgress('Defusing the bomb', game.bomb.defuseProgress);
        if (player.defuseProgress >= DEFUSE_TIME) {
          player.defuseProgress = 0;
          hud.setProgress(null, null);
          defuseBomb(player);
        }
      } else {
        player.defuseProgress = 0;
      }
    } else if (player.defuseProgress > 0) {
      player.defuseProgress = 0;
      if (!game.bomb.defuser || game.bomb.defuser === player) hud.setProgress(null, null);
    }
  }

  if (phase === 'live') bots.step(dt, now);
  stepGrenades(dt);
  effects.step(dt);
  round.step(dt);

  // The bomb's beep quickens as its timer runs out.
  if (game.bomb.state === 'planted') {
    const interval = 0.25 + (game.bomb.timer / BOMB_TIME) * 0.75;
    if (now >= game.beepAt) {
      game.beepAt = now + interval;
      audio.beep();
    }
    bombLight.material.color.setHex(Math.floor(now * 4) % 2 === 0 ? 0x2ec4b6 : 0xff4444);
    // A bot defusing shows on the same progress bar.
    if (game.bomb.defuser && game.bomb.defuser !== player) {
      hud.setProgress('A teammate is defusing', game.bomb.defuseProgress);
    }
  } else if (game.bomb.plantProgress > 0 && game.bomb.state === 'carried') {
    hud.showBomb('Raiders are planting the bomb!', 'danger');
  } else if (game.bomb.state === 'carried') {
    hud.showBomb('', '');
  }

  hud.setTimer(round.state.timer, phase);
  syncCamera();
}

let accumulator = 0;
let lastTime = performance.now();

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!game.frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP, now);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP, game.elapsed + i * FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
      // &dl=1 turns the staged frame into a downloadable JPEG: the page
      // navigates to the canvas as an image, so a browser can save it.
      // Only used when capturing screenshots for the entry.
      if (params.get('dl')) {
        window.location.href = renderer.domElement.toDataURL('image/jpeg', 0.85);
      }
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(point) {
  const b = playerBody.state;
  const dx = point.x - b.position.x;
  const dy = point.y - (b.position.y + b.eye);
  const dz = point.z - b.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  b.yaw = Math.atan2(-dx, -dz);
  b.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  playerBody.state.pitch = 0;
  playerBody.state.yaw = 0;
  round.startMatch();
  if (name === 'start') {
    playerBody.respawn({ x: 0.6, z: 8.6, yaw: 0 });
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start', {});
  } else if (name === 'play') {
    round.state.phase = 'live';
    round.state.timer = 88;
    playerBody.respawn({ x: 0, z: 8, yaw: 0 });
    // One Raider mid-lane, in the open, for the shot.
    const raider = bots.list.find((b) => b.team === 'raider');
    raider.body.state.position.set(0, 0, -2);
    raider.body.state.yaw = Math.PI;
    raider.mesh.group.position.set(0, 0, -2);
    settle(24);
    aimAt(new THREE.Vector3(0, 1.3, -2));
    playerShoot();
    settle(2);
  } else if (name === 'bomb') {
    round.state.phase = 'live';
    round.state.timer = 64;
    plantBomb('A', new THREE.Vector3(-14, 0, -11));
    playerBody.respawn({ x: -9, z: -4, yaw: 0 });
    const raider = bots.list.find((b) => b.team === 'raider');
    raider.body.state.position.set(-11, 0, -9);
    raider.body.state.yaw = Math.PI * 0.75;
    raider.mesh.group.position.set(-11, 0, -9);
    settle(24);
    aimAt(new THREE.Vector3(-14, 0.4, -11));
  } else if (name === 'buy') {
    player.money = 5200;
    playerBody.respawn({ x: 0, z: 14, yaw: 0 });
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.setMoney(player.money);
    hud.showBuy(true);
  }
  hud.setScore(round.state.score.vanguard, round.state.score.raider);
  hud.setHealth(player.health);
  hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
  hud.setMoney(player.money);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setAmmo(playerGun.state.mag, playerGun.state.reserve);
hud.setMoney(player.money);
hud.setScore(0, 0);
hud.setTimer(FREEZE_TIME, 'freeze');
round.startMatch();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
