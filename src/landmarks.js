import * as THREE from 'three';
import { Builder, stdMat, glowMat, rng } from './builder.js';
import { C } from './palette.js';
import { labelTexture } from './stations.js';

/**
 * The places you would point at: built from primitives at their real
 * coordinates, oversized so they read from the air. Each gets a gold name
 * plate that appears when you come close.
 */
export function createLandmarks(world, terrain, occupancy, network) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const b = new Builder(2026), g = new Builder(12);
  const R = rng(55);
  const P = terrain.P;
  const list = [];

  /** ground point at lat/lon, nudged off any rail */
  const at = (lat, lon, r = 0.6) => {
    let [x, z] = P.toXZ(lon, lat);
    for (let k = 0; k < 8; k++) {
      const h = occupancy.hit(x, z, r, (it) => it.kind === 'rail');
      if (!h) break;
      const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1;
      x += (dx / d) * 0.5; z += (dz / d) * 0.5;
    }
    return { x, z, y: terrain.heightAt(x, z) };
  };
  const mark = (he, en, p, r) => { occupancy.add(p.x, p.z, r, 'landmark'); list.push({ he, en, x: p.x, y: p.y, z: p.z, r }); };
  const flag = (x, y, z) => {
    b.up(x, y, z, 0.02, 0.5, 0.02, 0xdedede);
    b.box(x + 0.16, y + 0.42, z, 0.3, 0.2, 0.01, 0xffffff);
    b.box(x + 0.16, y + 0.49, z, 0.3, 0.03, 0.012, 0x0038b8);
    b.box(x + 0.16, y + 0.35, z, 0.3, 0.03, 0.012, 0x0038b8);
    b.box(x + 0.16, y + 0.42, z, 0.09, 0.09, 0.012, 0x0038b8, { rotZ: Math.PI / 4 });
  };

  /* ------------------------------------------------------------ Tel Aviv */
  {
    const p = at(32.0743, 34.7918, 0.9);                     // Azrieli Center
    b.cyl(p.x - 0.5, p.y + 1.3, p.z, 0.32, 2.6, 0x9db7d0, 20);                    // round
    b.cyl(p.x + 0.4, p.y + 1.15, p.z + 0.5, 0.36, 2.3, 0x9db7d0, 3);              // triangular
    b.up(p.x + 0.45, p.y, p.z - 0.55, 0.55, 2.0, 0.55, 0x9db7d0);                 // square
    for (let f = 0; f < 22; f++) { g.box(p.x - 0.5, p.y + 0.15 + f * 0.11, p.z + 0.325, 0.5, 0.04, 0.01, 0xdce9ff, { jitter: 0.15 }); g.box(p.x + 0.45, p.y + 0.15 + f * 0.09, p.z - 0.27, 0.45, 0.04, 0.01, 0xdce9ff, { jitter: 0.15 }); }
    b.up(p.x, p.y, p.z, 1.6, 0.35, 1.7, 0xe3ddd0);                                // mall podium
    mark('מגדלי עזריאלי', 'Azrieli Center', p, 1.2);
    // the beach: umbrellas and a lifeguard tower along Gordon beach
    const beach = at(32.086, 34.7695, 0.2);
    for (let i = 0; i < 16; i++) {
      const bx = beach.x + (R() - 0.5) * 0.35, bz = beach.z - 1.4 + i * 0.18;
      b.cyl(bx, terrain.heightAt(bx, bz) + 0.11, bz, 0.06, 0.02, [0x2f6fae, 0xe0b23a, 0xc94a3b, 0xffffff][i % 4], 8, { rTop: 0.002 });
      b.up(bx, terrain.heightAt(bx, bz), bz, 0.008, 0.11, 0.008, 0xdedede);
    }
    b.up(beach.x, beach.y, beach.z, 0.14, 0.25, 0.14, 0xffffff);
    mark('חוף גורדון', 'Gordon Beach', beach, 0.5);
    // Jaffa: the clock tower and the old port
    const j = at(32.0545, 34.7551, 0.3);
    b.up(j.x, j.y, j.z, 0.16, 0.7, 0.16, C.stoneWall); b.up(j.x, j.y + 0.7, j.z, 0.2, 0.06, 0.2, C.stoneDark);
    b.up(j.x - 0.5, j.y - 0.02, j.z + 0.2, 1.2, 0.05, 0.25, C.concrete);          // quay
    for (let i = 0; i < 4; i++) b.box(j.x - 0.9 + i * 0.3, 0.03, j.z + 0.55, 0.12, 0.06, 0.3, 0x2f6fae);    // boats
    mark('מגדל השעון ביפו', 'Jaffa Clock Tower', j, 0.6);
  }

  /* --------------------------------------------------------------- Haifa */
  {
    // the port: a quay built out into the bay from the shore east of the centre
    const q = at(32.8470, 35.0180, 0.2);                   // out in the bay, off the Kishon
    q.y = 0;
    const qa = -0.55;                                         // quay runs along the bay shore, WNW-ESE
    b.box(q.x, 0.03, q.z, 2.4, 0.06, 0.7, C.concrete, { rotY: qa });
    for (let i = 0; i < 3; i++) {                            // gantry cranes
      const t = -0.8 + i * 0.8, cx = q.x + Math.sin(qa + Math.PI / 2) * t, cz = q.z + Math.cos(qa + Math.PI / 2) * t;
      for (const s2 of [-0.22, 0.22]) b.up(cx + Math.sin(qa) * s2, 0.06, cz + Math.cos(qa) * s2, 0.07, 0.75, 0.07, 0x2f6fae);
      b.box(cx, 0.83, cz, 0.1, 0.07, 0.6, 0x2f6fae, { rotY: qa });
      b.box(cx - Math.sin(qa) * 0.7, 0.85, cz - Math.cos(qa) * 0.7, 0.07, 0.05, 1.1, 0x2f6fae, { rotY: qa, rotX: 0.12 });
    }
    for (let i = 0; i < 10; i++) { const t = -1.0 + (i % 5) * 0.45, u = 0.12 + Math.floor(i / 5) * 0.2; b.up(q.x + Math.sin(qa + Math.PI / 2) * t + Math.sin(qa) * u, 0.06, q.z + Math.cos(qa + Math.PI / 2) * t + Math.cos(qa) * u, 0.36, 0.12 * (1 + (i % 3)), 0.16, C.container[i % 5], { rotY: qa }); }
    // a container ship moored off the quay, on the water
    const sh = { x: q.x - Math.sin(qa) * 0.9, z: q.z - Math.cos(qa) * 0.9 };
    b.box(sh.x, 0.10, sh.z, 0.6, 0.26, 2.6, 0x1f4e7a, { rotY: qa + Math.PI / 2 });
    b.box(sh.x, 0.27, sh.z, 0.56, 0.08, 2.5, 0xd9d3c6, { rotY: qa + Math.PI / 2 });
    b.up(sh.x + Math.sin(qa + Math.PI / 2) * 1.0, 0.31, sh.z + Math.cos(qa + Math.PI / 2) * 1.0, 0.45, 0.4, 0.3, 0xf1eee6, { rotY: qa + Math.PI / 2 });
    for (let i = 0; i < 6; i++) { const t = -0.9 + i * 0.3; b.up(sh.x + Math.sin(qa + Math.PI / 2) * t, 0.31, sh.z + Math.cos(qa + Math.PI / 2) * t, 0.45, 0.24, 0.26, C.container[(i * 3) % 5], { rotY: qa + Math.PI / 2 }); }
    mark('נמל חיפה', 'Haifa Port', q, 0.9);
    const d = at(32.8195, 34.9993, 0.95);                    // Dagon silo
    b.up(d.x, d.y, d.z, 1.1, 1.5, 0.5, 0xe6dcc6); b.dome(d.x - 0.3, d.y + 1.5, d.z, 0.25, 0xe6dcc6, 10, { scaleY: 0.5 }); b.dome(d.x + 0.3, d.y + 1.5, d.z, 0.25, 0xe6dcc6, 10, { scaleY: 0.5 });
    b.up(d.x, d.y + 1.5, d.z, 0.3, 0.4, 0.3, 0xd9cfb8);
    mark('ממגורות דגון', 'Dagon Silo', d, 0.55);
    const bh = at(32.8116, 34.9874, 1.1);                    // Bahai gardens up the Carmel
    for (let t = 0; t < 9; t++) { const y = bh.y + t * 0.22; b.up(bh.x, y, bh.z + 0.6 + t * 0.32, 1.4 - t * 0.06, 0.22, 0.34, t % 2 ? 0x5a9a4a : 0x6faa55, { jitter: 0.03 }); b.up(bh.x, y + 0.22, bh.z + 0.6 + t * 0.32, 0.12, 0.01, 0.34, 0xf1e9d0); }
    b.cyl(bh.x, bh.y + 1.98 + 0.25, bh.z + 0.6 + 4 * 0.32, 0.34, 0.5, 0xf1eee6, 12); b.dome(bh.x, bh.y + 1.98 + 0.5, bh.z + 0.6 + 4 * 0.32, 0.34, 0xd4a83a, 14);
    mark('הגנים הבהאיים', "Bahai Gardens", bh, 0.7);
  }

  /* ----------------------------------------------------------- Jerusalem */
  {
    const o = at(31.7775, 35.2310, 1.55);                    // Old City walls
    const w = 1.1;
    for (const [dx, dz, ww, dd] of [[0, -w, 2 * w, 0.1], [0, w, 2 * w, 0.1], [-w, 0, 0.1, 2 * w], [w, 0, 0.1, 2 * w]]) b.up(o.x + dx, o.y, o.z + dz, ww, 0.42, dd, C.stoneWall, { jitter: 0.05 });
    for (const [dx, dz] of [[-w, -w], [w, -w], [-w, w], [w, w], [0, -w], [0, w]]) b.up(o.x + dx, o.y, o.z + dz, 0.22, 0.6, 0.22, C.stoneDark);
    for (let i = 0; i < 26; i++) b.up(o.x - w + 0.12 + R() * (2 * w - 0.25), o.y, o.z - w + 0.12 + R() * (2 * w - 0.25), 0.16 + R() * 0.14, 0.14 + R() * 0.14, 0.16 + R() * 0.14, C.stoneWall, { jitter: 0.05 });
    b.cyl(o.x + 0.45, o.y + 0.25, o.z + 0.35, 0.36, 0.5, 0x86a8c8, 8);          // the platform's octagon
    b.dome(o.x + 0.45, o.y + 0.5, o.z + 0.35, 0.36, 0xd4a83a, 16);               // gold dome
    b.up(o.x - 0.7, o.y, o.z - 0.6, 0.18, 0.9, 0.18, C.stoneDark);              // Tower of David
    mark('העיר העתיקה', 'Old City of Jerusalem', o, 1.15);
    const c = at(31.7890, 35.1990, 0.85);                    // Chords Bridge
    b.up(c.x, c.y, c.z, 0.12, 2.4, 0.12, 0xf4f4f0, { rotZ: 0.45 });
    b.box(c.x + 0.6, c.y + 0.3, c.z, 2.4, 0.08, 0.34, 0xe8e8e2);
    for (let i = 0; i < 8; i++) b.box(c.x - 0.15 + i * 0.16, c.y + 1.2 - i * 0.1, c.z, 0.012, 1.7 - i * 0.15, 0.012, 0xffffff, { rotZ: 0.6 + i * 0.05 });
    mark('גשר המיתרים', 'Chords Bridge', c, 0.45);
    flag(o.x - w - 0.4, o.y, o.z - w - 0.4);
  }

  /* ------------------------------------------------------------ Nazareth, Akko */
  {
    const n = at(32.7024, 35.2977, 0.4);
    b.up(n.x, n.y, n.z, 0.7, 0.5, 0.7, C.stoneWall); b.cone(n.x, n.y + 0.5, n.z, 0.42, 0.7, 0x9aa5b0, 8);
    mark('כנסיית הבשורה', 'Basilica of the Annunciation', n, 0.7);
    const a = at(32.9210, 35.0690, 0.6);
    for (const [dx, dz, ww, dd] of [[0, -0.7, 1.4, 0.1], [0, 0.7, 1.4, 0.1], [-0.7, 0, 0.1, 1.4], [0.7, 0, 0.1, 1.4]]) b.up(a.x + dx, a.y, a.z + dz, ww, 0.3, dd, C.stoneWall);
    for (let i = 0; i < 12; i++) b.up(a.x - 0.55 + R() * 1.1, a.y, a.z - 0.55 + R() * 1.1, 0.18, 0.12 + R() * 0.12, 0.18, C.stoneWall, { jitter: 0.05 });
    b.dome(a.x + 0.2, a.y + 0.3, a.z - 0.1, 0.22, 0x3f8f5f, 12); b.cyl(a.x - 0.25, a.y + 0.6, a.z + 0.25, 0.05, 1.2, C.stoneWall, 8);
    mark('עכו העתיקה', 'Old Akko', a, 1.0);
    const ca = at(32.5150, 34.8950, 0.3);                    // Caesarea aqueduct
    for (let i = 0; i < 14; i++) { const zz = ca.z - 1.0 + i * 0.15; b.up(ca.x, terrain.heightAt(ca.x, zz), zz, 0.12, 0.28, 0.06, C.stoneWall, { jitter: 0.06 }); }
    b.box(ca.x, ca.y + 0.32, ca.z, 0.14, 0.06, 2.1, C.stoneWall);
    mark('אמת המים בקיסריה', 'Caesarea Aqueduct', ca, 1.1);
  }

  /* ---------------------------------------------------------------- south */
  {
    const m = at(31.3156, 35.3536, 0.7);                     // Masada
    b.cyl(m.x, m.y + 0.35, m.z, 0.45, 0.7, 0xc9a06a, 7, { rBottom: 0.95, jitter: 0.06 });
    b.box(m.x, m.y + 0.72, m.z, 0.5, 0.04, 0.9, 0xd8b483); b.up(m.x + 0.1, m.y + 0.74, m.z + 0.2, 0.12, 0.06, 0.12, C.stoneDark);
    mark('מצדה', 'Masada', m, 1.0);
    const pw = at(31.0330, 35.3880, 0.6);                    // Dead Sea Works
    b.up(pw.x, pw.y, pw.z, 1.0, 0.5, 0.6, 0xc9c3b6); for (const dx of [-0.3, 0, 0.3]) b.cyl(pw.x + dx, pw.y + 0.75, pw.z - 0.2, 0.05, 1.0, 0x8f959c, 8);
    for (let i = 0; i < 5; i++) b.box(pw.x + 1.5 + i * 0.5, -1.29 + 0.02, pw.z + 0.5, 0.06, 0.04, 3.5, 0xf4f1e8);   // salt dykes between ponds
    mark('מפעלי ים המלח', 'Dead Sea Works', pw, 1.2);
    const e = at(29.5520, 34.9530, 0.4);                     // Eilat hotel row
    for (let i = 0; i < 7; i++) b.up(e.x - 0.9 + i * 0.3, terrain.heightAt(e.x - 0.9 + i * 0.3, e.z), e.z, 0.24, 0.5 + (i % 3) * 0.25, 0.3, 0xf4efe4, { jitter: 0.03 });
    b.up(e.x, e.y - 0.02, e.z + 0.5, 1.4, 0.04, 0.2, C.concrete);
    for (let i = 0; i < 6; i++) b.box(e.x - 0.6 + i * 0.25, 0.02, e.z + 0.8, 0.08, 0.05, 0.22, 0xffffff);
    mark('אילת', 'Eilat', e, 1.2);
    const t = at(29.7870, 34.9820, 0.3);                     // Timna pillars
    for (let i = 0; i < 4; i++) b.cyl(t.x - 0.3 + i * 0.2, terrain.heightAt(t.x - 0.3 + i * 0.2, t.z) + 0.35, t.z + (i % 2) * 0.15, 0.07, 0.7, 0xb35f3e, 6, { rBottom: 0.1 });
    mark('עמודי שלמה', "Solomon's Pillars", t, 0.6);
  }

  /* ---------------------------------------------------------------- water towers, airport */
  {
    for (const [lat, lon, he, en] of [[32.712, 35.575, 'דגניה', 'Degania'], [32.742, 35.076, 'יגור', 'Yagur'], [31.472, 34.497, 'נחל עוז', 'Nahal Oz'], [33.235, 35.628, 'דן', 'Dan'], [31.245, 34.605, 'רוחמה', 'Ruhama'], [32.575, 35.312, 'מרחביה', 'Merhavia']]) {
      const p = at(lat, lon, 0.25);
      for (const [dx, dz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) b.up(p.x + dx, p.y, p.z + dz, 0.025, 0.42, 0.025, C.concrete);
      b.cyl(p.x, p.y + 0.55, p.z, 0.13, 0.26, C.concrete, 12);
      mark(`מגדל המים ${he}`, `${en} water tower`, p, 0.3);
    }
    const ap = at(32.0055, 34.8854, 1.3);                    // Ben Gurion airport
    b.box(ap.x, ap.y + 0.015, ap.z, 0.35, 0.03, 4.0, 0x6c7178, { rotY: 0.2 });
    b.box(ap.x + 0.6, ap.y + 0.015, ap.z + 0.3, 0.35, 0.03, 3.2, 0x6c7178, { rotY: -0.6 });
    b.up(ap.x - 0.8, ap.y, ap.z - 0.3, 1.4, 0.22, 0.5, 0xf1eee6); b.up(ap.x - 0.8, ap.y + 0.22, ap.z - 0.3, 1.5, 0.05, 0.6, 0x8f959c);
    b.box(ap.x - 0.6, ap.y + 0.12, ap.z + 0.5, 0.12, 0.12, 0.9, 0xffffff); b.box(ap.x - 0.6, ap.y + 0.12, ap.z + 0.5, 0.9, 0.03, 0.12, 0xffffff); b.box(ap.x - 0.6, ap.y + 0.22, ap.z + 0.9, 0.03, 0.2, 0.15, 0x1d4f9c);
    mark('נמל התעופה בן גוריון', 'Ben Gurion Airport', ap, 0.9);
    flag(ap.x - 1.6, ap.y, ap.z - 0.6);
  }

  /* ------------------------------------------------ Haifa East railway museum turntable */
  const tt = at(32.8107, 35.0105, 1.15);
  b.cyl(tt.x, tt.y + 0.02, tt.z, 0.62, 0.05, 0x9d9789, 24);
  b.cyl(tt.x, tt.y + 0.04, tt.z, 0.55, 0.03, 0x4a4d52, 24);
  b.up(tt.x + 0.8, tt.y, tt.z, 0.6, 0.35, 0.9, C.stoneWall);                    // museum shed
  b.gable(tt.x + 0.8, tt.y + 0.35, tt.z, 0.66, 0.16, 0.95, C.roofTile);
  mark('מוזיאון הרכבת', 'Israel Railway Museum', tt, 0.75);
  const turntable = new THREE.Group();
  turntable.position.set(tt.x, tt.y + 0.06, tt.z);
  const deckB = new Builder(3);
  deckB.box(0, 0.03, 0, 0.26, 0.06, 1.05, 0x5b6068);
  for (const s of [-1, 1]) deckB.box(s * 0.1, 0.075, 0, 0.03, 0.03, 1.02, C.rail);
  deckB.cyl(0, 0.35, 0.15, 0.16, 0.6, C.steamBlack, 10, { rotX: Math.PI / 2 });    // a loco on the deck
  deckB.box(0, 0.35, -0.3, 0.42, 0.4, 0.3, C.steamGreen); deckB.cyl(0, 0.75, 0.38, 0.05, 0.2, C.steamBlack, 8);
  turntable.add(deckB.mesh(stdMat({ roughness: 0.6 })));
  group.add(turntable);

  const solid = b.mesh(stdMat({ roughness: 0.8 }));
  solid.name = 'landmarks-solid';
  group.add(solid);
  const gg = g.build();
  const glow = gg ? new THREE.Mesh(gg, glowMat()) : null;
  if (glow) { glow.name = 'landmarks-glow'; group.add(glow); }

  // gold plates
  const sprites = list.map((l) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(l.he, l.en, { plate: 'rgba(72, 48, 8, 0.9)', border: '#e0b23a', sub: '#ffe9b0' }), transparent: true, depthTest: false, sizeAttenuation: false }));
    sp.scale.set(0.125, 0.039, 1); sp.center.set(0.5, -0.6);
    sp.position.set(l.x, l.y + 0.8, l.z); sp.renderOrder = 21; sp.material.opacity = 0;
    group.add(sp);
    return sp;
  });

  const _v = new THREE.Vector3();
  const _c = new THREE.Color();
  return {
    group, list, turntable,
    update(dt, camera, turning, night, lightsOn) {
      if (turning) turntable.rotation.y += dt * 0.35;
      list.forEach((l, i) => {
        const d = _v.set(l.x, l.y, l.z).distanceTo(camera.position);
        const o = Math.max(0, Math.min(1, (34 - d) / 12));
        sprites[i].material.opacity = o; sprites[i].visible = o > 0.02;
      });
      if (glow) { _c.setScalar(lightsOn ? 1 : Math.max(0.05, Math.min(1, (night - 0.4) * 2.2))); glow.material.color.copy(_c); }
    },
  };
}
