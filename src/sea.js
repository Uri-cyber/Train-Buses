import * as THREE from 'three';
import { makeProjection, sampleField } from './geo.js';
import { yOf, LAKE_LEVEL } from './terrain.js';
import { C, mixHex, smooth } from './palette.js';
import { GRADIENT } from './builder.js';

/**
 * Water: the Mediterranean and the Gulf of Eilat as one sheet at sea level,
 * shading from turquoise shallows to deep blue by distance from the shore,
 * plus the Kinneret and the Dead Sea at their real (exaggerated) levels.
 */
export function createSea(world, terrain) {
  const group = new THREE.Group();
  group.name = 'sea';
  const P = makeProjection(world.proj);

  // flat cartoon water: a few colour steps by depth and a foam line at the shore
  const material = (colour, opacity) => new THREE.MeshToonMaterial({
    ...(colour === undefined ? { vertexColors: true } : { color: colour }), gradientMap: GRADIENT,
    transparent: false, opacity: 1,
  });

  // open sea: the sheet sits at sea level over ocean cells only and dives
  // under the land elsewhere, so the Jordan rift (below sea level) stays dry
  const { x0, x1, zN, zS, W, D } = terrain.bounds;
  const mask = terrain.mask;
  const toOcean = terrain.toOcean;
  const geo = new THREE.PlaneGeometry(W, D, 280, 760);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (zN + zS) / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dOcean = sampleField(mask, toOcean, x, z);
    const sunk = smooth((sampleField(mask, terrain.toCore, x, z) - (terrain.FADE1 - 8)) / 6);
    pos.setY(i, -6 * smooth((dOcean - 1.2) / 2.5) * (1 - sunk));
    const floor = terrain.heightAt(x, z);            // sunk neighbours read as deep water too
    const d = sampleField(mask, terrain.toLand, x, z);
    const deep = Math.max(smooth((d - 3) / 14), smooth((-floor - 0.15) / 0.9));
    // three steps of blue, and foam along the last kilometre before the beach
    const band = deep > 0.5 ? C.seaDeep : d < 0.9 && dOcean < 0.5 ? C.foam : d < 4 ? C.seaShallow : C.seaMid;
    tint.setHex(band);
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sea = new THREE.Mesh(geo, material(undefined, 0.86));
  sea.position.y = 0;
  sea.renderOrder = 2;
  sea.name = 'mediterranean';
  group.add(sea);

  // beyond the map: one flat sheet with a hole where the detailed sheet is
  const outer = new THREE.Shape([new THREE.Vector2(-1500, -1500), new THREE.Vector2(1500, -1500), new THREE.Vector2(1500, 1500), new THREE.Vector2(-1500, 1500)]);
  const hole = new THREE.Path([new THREE.Vector2(x0, -zN), new THREE.Vector2(x1, -zN), new THREE.Vector2(x1, -zS), new THREE.Vector2(x0, -zS)]);
  outer.holes.push(hole);
  const og = new THREE.ShapeGeometry(outer, 1);
  og.rotateX(-Math.PI / 2);
  const outerSea = new THREE.Mesh(og, material(C.seaDeep, 0.86));
  outerSea.renderOrder = 1;
  outerSea.name = 'outer-sea';
  group.add(outerSea);

  // lakes, each at its own level
  for (const lake of world.lakes) {
    const level = LAKE_LEVEL[lake.name_en] ?? 0;
    const colour = lake.name_en === 'Dead Sea' ? C.deadSea : C.kinneret;
    for (const ring of lake.rings) {
      if (ring.length < 4) continue;
      const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ShapeGeometry(shape, 4);
      g.rotateX(-Math.PI / 2);                       // Shape is in XY; lay it on XZ (y -> -z)
      const m = new THREE.Mesh(g, material(colour, 0.9));
      m.position.y = yOf(level);
      m.renderOrder = 2;
      m.name = lake.name_en;
      group.add(m);
    }
  }

  return {
    group,
    update() {},
  };
}
