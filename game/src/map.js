// Yard 7: an original container yard at dusk. Two bomb sites on the defenders'
// side (north), three lanes up from the attackers' spawn (south): A Long down the
// west edge, Mid through the crate field, B Long down the east edge, and a
// connector lane behind the sites so defenders can rotate. Every box is a
// collider for movement and a surface a bullet stops on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Bomb sites: centre and radius. A plant or a defuse must happen inside one.
export const SITES = {
  A: { x: -14, z: -11, r: 4.5 },
  B: { x: 14, z: -11, r: 4.5 },
};

export const SPAWNS = {
  // Attackers push up from the south gate.
  attacker: [
    { x: -4, z: 15, yaw: 0 },
    { x: -1.5, z: 15.5, yaw: 0 },
    { x: 1, z: 15, yaw: 0 },
    { x: 3.5, z: 15.5, yaw: 0 },
    { x: 6, z: 15, yaw: 0 },
  ],
  // Defenders hold the north side, between the two sites.
  defender: [
    { x: -6, z: -14, yaw: Math.PI },
    { x: -2, z: -14.5, yaw: Math.PI },
    { x: 2, z: -14.5, yaw: Math.PI },
    { x: 6, z: -14, yaw: Math.PI },
  ],
};

// The waypoint graph the bots walk. Nodes sit on the lanes; links join neighbours.
// A bot reaches a site by breadth-first search over this graph, then walks the
// returned node list. Holding spots are the nodes bots stop at to watch a lane.
export const WAYPOINTS = [
  // Attacker spawn and the mouth of each lane.
  { id: 'atk', x: 0, z: 15, links: ['a0', 'm0', 'b0'] },
  // A Long, west edge.
  { id: 'a0', x: -16, z: 10, links: ['atk', 'a1'] },
  { id: 'a1', x: -16, z: 2, links: ['a0', 'a2'] },
  { id: 'a2', x: -16, z: -6, links: ['a1', 'a3'] },
  { id: 'a3', x: -14, z: -11, links: ['a2', 'connW'], site: 'A' },
  // Mid, through the crate field.
  { id: 'm0', x: 0, z: 10, links: ['atk', 'm1'] },
  { id: 'm1', x: 0, z: 4, links: ['m0', 'm2'] },
  { id: 'm2', x: 0, z: -2, links: ['m1', 'm3'] },
  { id: 'm3', x: 0, z: -8, links: ['m2', 'connW', 'connE'] },
  // B Long, east edge.
  { id: 'b0', x: 16, z: 10, links: ['atk', 'b1'] },
  { id: 'b1', x: 16, z: 2, links: ['b0', 'b2'] },
  { id: 'b2', x: 16, z: -6, links: ['b1', 'b3'] },
  { id: 'b3', x: 14, z: -11, links: ['b2', 'connE'], site: 'B' },
  // The connector behind the sites, for defender rotation.
  { id: 'connW', x: -7, z: -13, links: ['a3', 'm3', 'def'] },
  { id: 'connE', x: 7, z: -13, links: ['b3', 'm3', 'def'] },
  // Defender spawn.
  { id: 'def', x: 0, z: -15, links: ['connW', 'connE'] },
  // Defender holds: watching A, watching B, watching Mid.
  { id: 'holdA', x: -11, z: -8, links: ['a2', 'connW'] },
  { id: 'holdB', x: 11, z: -8, links: ['b2', 'connE'] },
  { id: 'holdM', x: 0, z: -10, links: ['m3', 'connW', 'connE'] },
];

const BY_ID = new Map(WAYPOINTS.map((w) => [w.id, w]));

/** Breadth-first search over the waypoint graph. Returns node ids, start to goal. */
export function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of BY_ID.get(id).links) {
      if (prev.has(next)) continue;
      prev.set(next, id);
      if (next === toId) {
        const path = [toId];
        let at = toId;
        while (prev.get(at) !== null) {
          at = prev.get(at);
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [fromId];
}

/** The waypoint nearest a position, for a bot that needs to join the graph. */
export function nearestWaypoint(x, z) {
  let best = WAYPOINTS[0];
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best.id;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.5 : 0.92,
      metalness: name === 'steel' ? 0.25 : 0.03,
    });
  }
  // Containers get a second rust tone so the yard does not read as one flat colour.
  const rustDark = new THREE.MeshStandardMaterial({ color: 0x8a4a28, roughness: 0.85, metalness: 0.08 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: packed sand, 40 x 36 m.
  box(40.4, 0.4, 36.4, 0, -0.4, 0, materials.sand);
  // Perimeter walls, 4.5 m, open to the dusk sky.
  box(0.5, 4.5, 36.4, -20.2, 0, 0, materials.steel);
  box(0.5, 4.5, 36.4, 20.2, 0, 0, materials.steel);
  box(40.4, 4.5, 0.5, 0, 0, -18.2, materials.steel);
  box(40.4, 4.5, 0.5, 0, 0, 18.2, materials.steel);

  // --- A Long (west): a container wall to hug, crates to crouch behind.
  box(6.0, 2.6, 2.4, -17.5, 0, 6, materials.rust);
  box(2.4, 2.6, 6.0, -17.5, 0, -1, rustDark);
  box(1.4, 1.1, 1.4, -13.5, 0, -3.5, materials.rust);
  box(1.4, 1.1, 1.4, -12.0, 0, -6.5, rustDark);
  // Site A: a container stack and a sandbag ring to plant behind.
  box(6.0, 2.6, 2.4, -16.5, 0, -13.5, materials.rust);
  box(2.4, 2.6, 2.4, -11.0, 0, -14.5, rustDark);
  box(2.2, 1.0, 1.0, -13.0, 0, -8.5, materials.sand);
  box(1.0, 1.0, 2.2, -15.5, 0, -9.0, materials.sand);

  // --- Mid: the crate field. Broken sightlines, three ways through.
  box(2.4, 2.6, 2.4, -4.5, 0, 7, materials.rust);
  box(2.4, 2.6, 2.4, 4.5, 0, 7, rustDark);
  box(1.4, 1.1, 1.4, -2.0, 0, 2.5, materials.rust);
  box(1.4, 1.1, 1.4, 2.0, 0, 1.0, rustDark);
  box(3.6, 1.1, 1.2, 0, 0, -4.5, materials.rust);
  box(1.2, 2.2, 1.2, -6.5, 0, -6.5, rustDark);
  box(1.2, 2.2, 1.2, 6.5, 0, -6.5, materials.rust);

  // --- B Long (east): a watchtower base and a container chicane.
  box(6.0, 2.6, 2.4, 17.5, 0, 6, rustDark);
  box(2.4, 2.6, 6.0, 17.5, 0, -1, materials.rust);
  box(1.4, 1.1, 1.4, 13.5, 0, -3.5, rustDark);
  box(1.4, 1.1, 1.4, 12.0, 0, -6.5, materials.rust);
  // Site B: a warehouse corner and a container to plant behind.
  box(6.0, 2.6, 2.4, 16.5, 0, -13.5, rustDark);
  box(2.4, 2.6, 2.4, 11.0, 0, -14.5, materials.rust);
  box(2.2, 1.0, 1.0, 13.0, 0, -8.5, materials.sand);
  box(1.0, 1.0, 2.2, 15.5, 0, -9.0, materials.sand);

  // --- The connector: low cover so rotation is never free.
  box(2.0, 1.0, 1.0, -7, 0, -15.5, materials.sand);
  box(2.0, 1.0, 1.0, 7, 0, -15.5, materials.sand);

  // Site markers: flat teal rings on the sand, so a site reads at a glance.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const letter = site === SITES.A ? 'A' : 'B';
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(site.x, 0.015, site.z);
    plate.userData.siteLetter = letter;
    group.add(plate);
  }

  // Light: a low warm sun from the west, a cool dusk fill, and a sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#e8c9a0'), new THREE.Color('#3a3f4a'), 1.0);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.4);
  sun.position.set(-18, 12, 10);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86a8'), 0.5);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  return { colliders, shootables, group };
}
