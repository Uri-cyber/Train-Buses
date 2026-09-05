import * as THREE from 'three';
import { OUTLINE_LAYER } from './post.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, stdMat, glowMat, paint } from './builder.js';
import { C } from './palette.js';
import { TRACK } from './rails.js';
import { SCALE as TRAIN_SCALE } from './trains.js';
import { labelTexture } from './labels.js';

/**
 * Stations: platforms either side of the line, a white barrel canopy on blue
 * posts (the Israel Railways look), a building sized by importance, and a
 * bilingual name plate that floats above, readable when you are close enough.
 */
const MAJOR = new Set(['tel-aviv-savidor', 'tel-aviv-hashalom', 'tel-aviv-hahagana', 'haifa-center', 'haifa-hof-hacarmel',
  'jerusalem-navon', 'beersheba-center', 'ben-gurion-airport', 'nahariya', 'ashkelon', 'modiin-center', 'herzliya', 'netanya', 'lod', 'binyamina']);

export { labelTexture };

export function createStations(network, rails, terrain) {
  const group = new THREE.Group();
  group.name = 'stations';
  const pieces = [];
  const glowPieces = [];
  const hits = [];
  const stations = [];

  const edgeOf = (node) => {
    const ei = network.edges.findIndex((e) => e.a === node || e.b === node);
    return ei < 0 ? null : { ei, e: network.edges[ei] };
  };

  for (const s of network.stations) {
    const found = edgeOf(s.node);
    if (!found) continue;
    const { ei, e } = found;
    const pr = rails.profiles[ei];
    const atA = e.a === s.node;
    const p0 = atA ? e.pts[0] : e.pts[e.pts.length - 1];
    const p1 = atA ? e.pts[1] : e.pts[e.pts.length - 2];
    const rot = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const y = (atA ? pr.h[0] : pr.h[pr.h.length - 1]) + TRACK.lift;
    const major = MAJOR.has(s.id);

    // build in local space: track runs along +z, then rotate into place
    const b = new Builder(s.id.length * 7);
    // platforms sit outside the toy trains on their lanes
    const off = TRACK.laneOffset + (0.62 * TRAIN_SCALE) / 2 + 0.55;
    const PW = 0.9;                                    // platform width
    const L = major ? 3.0 : 2.2;
    for (const side of [-1, 1]) {
      b.up(side * off, 0.0, 0, PW, 0.12, L, C.platform, { jitter: 0.03 });
      b.up(side * (off - PW / 2 + 0.1), 0.12, 0, 0.1, 0.012, L, 0xe9c25a);     // yellow edge line
      // barrel canopy from tilted slats over each platform
      const cx = side * off, r = 0.65, y0 = 0.55;
      for (let k = 0; k < 7; k++) {
        const a0 = Math.PI * (k / 7), a1 = Math.PI * ((k + 1) / 7);
        const am = (a0 + a1) / 2;
        const len = r * (a1 - a0) * 1.05;
        b.box(cx + Math.cos(am) * r, y0 + Math.sin(am) * r, 0, len, 0.05, L * 0.86, C.irWhite, { rotZ: am - Math.PI / 2, jitter: 0.02 });
      }
      for (const zz of [-L * 0.36, 0, L * 0.36]) b.up(cx, 0.12, zz, 0.12, y0 - 0.12 + 0.03, 0.12, C.irBlue);
    }
    // station building set back on the platform's outer side
    const bw = major ? 2.6 : 1.5, bd = major ? 1.2 : 0.8, bh = major ? 1.2 : 0.65;
    const bx = -(off + PW / 2 + bd / 2 + 0.1);
    b.up(bx, 0.0, 0, bd, bh, bw, C.stucco, { rotY: 0, jitter: 0.03 });
    b.up(bx, bh, 0, bd + 0.1, 0.08, bw + 0.1, C.roofFlat);
    b.up(bx, bh + 0.08, -bw * 0.25, bd * 0.6, 0.25, bw * 0.3, C.irBlue);     // roof sign block
    // glass band on the trackside face
    const gb = new Builder();
    gb.box(bx + bd / 2 + 0.005, bh * 0.55, 0, 0.01, bh * 0.45, bw * 0.9, C.windowLit, { jitter: 0.05 });
    // name post
    b.up(off + 0.8, 0.0, L * 0.35, 0.1, 1.8, 0.1, C.irBlue);
    b.up(off + 0.8, 1.8, L * 0.35, 0.7, 0.35, 0.1, C.irWhite);
    b.up(off + 0.8, 1.9, L * 0.35, 0.7, 0.05, 0.11, C.irRed);

    const place = (geo) => { geo.rotateY(rot); geo.translate(s.x, y, s.z); return geo; };
    const geo = b.build(); if (geo) pieces.push(place(geo));
    const glow = gb.build(); if (glow) glowPieces.push(place(glow));

    // name plate: a sprite that keeps its pixel size
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(s.he, s.en), transparent: true, depthTest: false, sizeAttenuation: false }));
    sprite.scale.set(0.125, 0.039, 1);
    sprite.center.set(0.5, -0.55);
    sprite.position.set(s.x, y + 1.6, s.z);
    sprite.renderOrder = 20;
    sprite.material.opacity = 0;
    group.add(sprite);

    // invisible hit target for clicks
    const hit = new THREE.Mesh(new THREE.SphereGeometry(major ? 1.6 : 1.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(s.x, y + 0.4, s.z);
    hit.userData.stationId = s.id;
    group.add(hit);
    hits.push(hit);

    stations.push({ ...s, y, rot, major, sprite, hit });
  }

  if (pieces.length) {
    const m = new THREE.Mesh(mergeGeometries(pieces, false), stdMat({ roughness: 0.75 }));
    m.layers.enable(OUTLINE_LAYER);
    m.castShadow = true; m.receiveShadow = true; m.name = 'station-buildings';
    group.add(m);
  }
  const glowMesh = glowPieces.length ? new THREE.Mesh(mergeGeometries(glowPieces, false), glowMat()) : null;
  if (glowMesh) { glowMesh.name = 'station-glass'; group.add(glowMesh); }

  let selected = null, selectedT = 0;
  const _v = new THREE.Vector3();
  return {
    group, stations, hits, glowMesh,
    byId: Object.fromEntries(stations.map((s) => [s.id, s])),
    select(id) { selected = id; selectedT = 8; },
    /** fade the plates by distance; the selected one stays up */
    update(camera, dt) {
      selectedT = Math.max(0, selectedT - dt);
      const camPos = camera.position;
      for (const s of stations) {
        const d = _v.set(s.x, s.y, s.z).distanceTo(camPos);
        // majors show from 70 km, the rest only once you are close
        const near = s.major ? 70 : 22;
        let o = Math.max(0, Math.min(1, (near - d) / (near * 0.3)));
        if (s.id === selected && selectedT > 0) o = 1;
        s.sprite.material.opacity = o;
        s.sprite.visible = o > 0.02;
        const k = s.id === selected && selectedT > 0 ? 1.35 : 1;
        s.sprite.scale.set(0.125 * k, 0.039 * k, 1);
      }
    },
  };
}
