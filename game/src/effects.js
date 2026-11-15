// Effects: tracers, impact sparks and the bomb's explosion. Everything here
// is pooled and reused: no new objects in the hot loop, so a firefight does
// not make garbage for the collector.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const SPARK_COUNT = 64;
const TRACER_LIFE = 0.07;
const SPARK_LIFE = 0.35;

export function createEffects(scene) {
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, velocity: new THREE.Vector3() });
  }
  let sparkNext = 0;

  const boomLight = new THREE.PointLight(new THREE.Color('#ff7a2a'), 0, 30);
  scene.add(boomLight);
  let boomLife = 0;

  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();

  return {
    tracer(from, to) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACER_COUNT;
      const pos = t.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      t.line.visible = true;
      t.life = TRACER_LIFE;
    },
    sparksAt(point, normal, count = 6) {
      for (let i = 0; i < count; i += 1) {
        const s = sparks[sparkNext];
        sparkNext = (sparkNext + 1) % SPARK_COUNT;
        s.mesh.position.copy(point);
        s.velocity.set(
          normal.x * 2 + (Math.random() - 0.5) * 3,
          normal.y * 2 + Math.random() * 2.5,
          normal.z * 2 + (Math.random() - 0.5) * 3,
        );
        s.mesh.visible = true;
        s.life = SPARK_LIFE * (0.6 + Math.random() * 0.4);
      }
    },
    explosion(point) {
      boomLight.position.copy(point);
      boomLight.position.y += 1;
      boomLight.intensity = 60;
      boomLife = 0.7;
      this.sparksAt(point, _to.set(0, 1, 0), 24);
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.visible = false;
          continue;
        }
        s.velocity.y -= 9 * dt;
        s.mesh.position.addScaledVector(s.velocity, dt);
      }
      if (boomLife > 0) {
        boomLife -= dt;
        boomLight.intensity = Math.max(0, boomLife * 85);
      }
    },
  };
}
