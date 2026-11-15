// The armoury. Every weapon is one row: its price in the buy menu, its
// magazine, its damage, and the spread that punishes firing on the move. The
// head multiplier is one rule for all of them: a headshot is three body shots.
// Bots use the same rows, so a weapon reads the same whoever holds it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const HEAD_MULT = 3;

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, mag: 12, reserve: 36,
    damage: 26, fireGap: 0.16, reloadTime: 1.4, spreadStill: 0.003, spreadMoving: 0.02,
    auto: false, pellets: 1, zoom: 1, falloff: 0, barrel: 0.3, kind: 'pistol',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', price: 2700, mag: 30, reserve: 90,
    damage: 34, fireGap: 0.096, reloadTime: 1.9, spreadStill: 0.0022, spreadMoving: 0.028,
    auto: true, pellets: 1, zoom: 1, falloff: 0, barrel: 0.5, kind: 'rifle',
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', price: 1500, mag: 32, reserve: 96,
    damage: 22, fireGap: 0.07, reloadTime: 1.6, spreadStill: 0.004, spreadMoving: 0.032,
    auto: true, pellets: 1, zoom: 1, falloff: 25, barrel: 0.38, kind: 'smg',
  },
  shotgun: {
    id: 'shotgun', name: 'M870 Breacher', price: 1200, mag: 6, reserve: 24,
    damage: 12, fireGap: 0.85, reloadTime: 2.4, spreadStill: 0.016, spreadMoving: 0.03,
    auto: false, pellets: 8, zoom: 1, falloff: 14, barrel: 0.55, kind: 'shotgun',
  },
  sniper: {
    id: 'sniper', name: 'Lynx .50', price: 4750, mag: 5, reserve: 15,
    damage: 95, fireGap: 1.15, reloadTime: 2.8, spreadStill: 0.0006, spreadMoving: 0.05,
    auto: false, pellets: 1, zoom: 3.2, falloff: 0, barrel: 0.7, kind: 'sniper',
  },
};

export const GRENADE = {
  id: 'grenade', name: 'F-1 Frag', price: 300,
  fuse: 1.5, radius: 7, damage: 110, throwSpeed: 17,
};

// The buy menu, in the order it shows. A weapon already owned is not sold twice.
export const BUY_MENU = [
  WEAPONS.rifle, WEAPONS.smg, WEAPONS.shotgun, WEAPONS.sniper, GRENADE,
];

/** A gun's numbers only: magazine, cooldown, reload. No meshes, so bots use it too. */
export function createGun(defId) {
  let def = WEAPONS[defId];
  const state = {
    mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
  };

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() { return def; },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
    },
    spread(speed) {
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMoving;
    },
    // Damage at a range: past the falloff distance a pellet loses a third.
    damageAt(distance) {
      if (def.falloff && distance > def.falloff) return def.damage * 0.66;
      return def.damage;
    },
    equip(nextId) {
      def = WEAPONS[nextId];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

/** The gun the player sees: a box-built view model on the camera, driven by the gun's state. */
export function createViewModel(camera, gun) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.5, metalness: 0.35 });

  const model = new THREE.Group();
  let barrelLength = gun.def.barrel;
  function rebuild() {
    while (model.children.length) model.remove(model.children[0]);
    barrelLength = gun.def.barrel;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, barrelLength), grip);
    barrel.position.set(0, 0.025, -0.21 - barrelLength / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    model.add(receiver, barrel, stock);
  }
  rebuild();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  return {
    rebuild,
    step(dt) {
      const s = gun.state;
      model.position.z = -0.42 + s.kick;
      model.rotation.x = s.kick * 2.2;
      if (s.reloadLeft > 0) {
        model.rotation.x = -0.55 * Math.min(1, (gun.def.reloadTime - s.reloadLeft) * 2);
      }
      flash.visible = s.flash > 0;
      flash.rotation.z = s.flash * 30;
      flashLight.intensity = s.flash > 0 ? 18 : 0;
    },
  };
}
