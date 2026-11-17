// A 9 mm striker-fired service pistol, full-size, as a procedural view model. Written from public spec-sheet
// numbers (overall length 203 mm, height 140 mm, width 33 mm, barrel 119 mm, sight radius 168 mm, 17-round
// magazine); nothing is copied from a model, a texture or another program. No maker's mark, name or engraving.
//
// AXES. Metres. +X is the shooter's right (the ejection port is on +X), +Y is up, -Z is the way the muzzle points
// (the three.js camera convention), so +Z is towards the shooter. The origin is the top of the backstrap, the web of
// the hand, where the grip meets the underside of the slide; the slide's underside lies on y = 0.
//
// ONE MATERIAL, SIX MESHES. Every mesh shares one MeshStandardMaterial. Its albedo comes from vertex colours and its
// metalness and roughness from a two-float vertex attribute (`aMR`, injected with onBeforeCompile), so steel, the
// lighter barrel hood, polymer, the dull groove recesses and the white sight dots all live in the same draw call.
// Meshes that never move relative to each other are merged: `frame` (polymer grip module, rail, stippling, takedown
// lever, magazine release), `slide` (slide, sights, dots, serrations), and the four that move: `barrel`, `trigger`,
// `magazine`, `slideStop`. That is 6 draw calls.
//
// PARTS and how to move them (all in the group's space; each part's origin is its pivot):
//   slide      position.z += 0.045 to cycle (dims.anim.slideTravel); origin at the group origin
//   barrel     origin at the front bushing; rotation.x = +3 deg drops the breech (dims.anim.barrelTilt)
//   trigger    origin at the trigger pin; rotation.x = -12 deg pulls it (dims.anim.triggerPull)
//   magazine   position += dims.gripAxis * drop; origin at the group origin
//   slideStop  origin at its pivot; small rotation.x (about +-6 deg) lifts the tab
//   frame      static;  sights  an empty Object3D under the slide with `front` and `rear` markers at the sight line
// `muzzle` is an Object3D at the bore on the slide's front face (it stays with the frame, the barrel is fixed to it);
// `ejection` is under the slide at the port, `userData.dir` the way a case leaves (in the slide's space).

const DEG = Math.PI / 180;

export const PISTOL_DIMS = Object.freeze({
  length: 0.203, height: 0.140, width: 0.033, barrel: 0.119, sightRadius: 0.168, magRounds: 17,
  gripRakeDeg: 18, magBaseProtrusion: 0.004, boreY: 0.0135, slideFront: 0.1775, slideRear: -0.0095,
  slideWidth: 0.026, slideTop: 0.031, sightTop: 0.0372,
});

export function buildPistolView(THREE, opts = {}) {
  const { Vector2, Vector3, Matrix4, BufferGeometry, Float32BufferAttribute, Color } = THREE;
  const frameColor = opts.frameColor || '#1f2022';
  const D = PISTOL_DIMS;

  // ---- the merge: pieces of geometry with a colour, metalness and roughness, into one BufferGeometry -----------
  function makeBuilder() {
    const pos = [], nor = [], col = [], mr = [], pieces = [];
    return {
      pieces,
      /** Add `geo` (any BufferGeometry). `crease` > 0 recomputes normals, smooth within that many degrees. */
      add(geo, { color, metal = 0, rough = 0.6, crease = 0, name = '', solid = true, matrix = null }) {
        let g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (matrix) g.applyMatrix4(matrix);
        const p = g.attributes.position.array;
        const n = crease ? creaseNormals(p, crease) : g.attributes.normal.array;
        const c = new Color(color);
        const count = p.length / 3;
        let vol = 0;
        if (solid) for (let i = 0; i < p.length; i += 9) {
          vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
        }
        for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
        for (let i = 0; i < count; i++) { col.push(c.r, c.g, c.b); mr.push(metal, rough); }
        pieces.push({ name, volume: solid ? vol : null, triangles: count / 3 });
        g.dispose();
      },
      /** The merged geometry, moved so that `pivot` is its origin. */
      finish(pivot = [0, 0, 0]) {
        const g = new BufferGeometry();
        const p = Float32Array.from(pos);
        for (let i = 0; i < p.length; i += 3) { p[i] -= pivot[0]; p[i + 1] -= pivot[1]; p[i + 2] -= pivot[2]; }
        g.setAttribute('position', new Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new Float32BufferAttribute(col, 3));
        g.setAttribute('aMR', new Float32BufferAttribute(mr, 2));
        g.computeBoundingBox(); g.computeBoundingSphere();
        return g;
      },
    };
  }

  /** Normals of a non-indexed triangle soup, smooth across edges flatter than `deg` and hard across sharper ones. */
  function creaseNormals(p, deg) {
    const tris = p.length / 9, fn = new Float32Array(tris * 3), cosT = Math.cos(deg * DEG);
    const key = (i) => `${Math.round(p[i] * 2e5)},${Math.round(p[i + 1] * 2e5)},${Math.round(p[i + 2] * 2e5)}`;
    const at = new Map();
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      fn[t * 3] = ay * bz - az * by; fn[t * 3 + 1] = az * bx - ax * bz; fn[t * 3 + 2] = ax * by - ay * bx; // area-weighted
      for (let v = 0; v < 3; v++) { const k = key(o + v * 3); (at.get(k) || at.set(k, []).get(k)).push(t); }
    }
    const out = new Float32Array(p.length);
    for (let t = 0; t < tris; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2], fl = Math.hypot(fx, fy, fz) || 1;
      for (let v = 0; v < 3; v++) {
        let sx = 0, sy = 0, sz = 0;
        for (const u of at.get(key(t * 9 + v * 3))) {
          const ux = fn[u * 3], uy = fn[u * 3 + 1], uz = fn[u * 3 + 2], ul = Math.hypot(ux, uy, uz) || 1;
          if ((ux * fx + uy * fy + uz * fz) / (ul * fl) >= cosT) { sx += ux; sy += uy; sz += uz; }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        out[t * 9 + v * 3] = sx / l; out[t * 9 + v * 3 + 1] = sy / l; out[t * 9 + v * 3 + 2] = sz / l;
      }
    }
    return out;
  }

  // ---- geometry helpers ---------------------------------------------------------------------------------------
  const v2 = (pts) => pts.map(([a, b]) => new Vector2(a, b));
  /** Points on an arc, degrees, `n` segments, inclusive of both ends. */
  const arc = (cx, cy, r, a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * DEG; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const circle = (r, n = 20) => Array.from({ length: n }, (_, i) => [r * Math.cos(i / n * 2 * Math.PI), r * Math.sin(i / n * 2 * Math.PI)]);

  /** A triangle soup from `tris` (arrays of three [x,y,z]); each is turned to face `nrm(centroid)` if given. */
  function soup(tris) {
    const a = [];
    for (const t of tris) for (const q of t) a.push(q[0], q[1], q[2]);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(a, 3));
    g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(a.length), 3));
    return g;
  }
  function facing(a, b, c, n) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    return d >= 0 ? [a, b, c] : [a, c, b];
  }
  /** A flat cap of the 2D polygon `pts` (with optional `holes`) at depth z, facing nz (+1 or -1). */
  function cap(pts, holes, z, nz) {
    const all = [...pts, ...holes.flat()], idx = THREE.ShapeUtils.triangulateShape(v2(pts), holes.map(v2));
    return idx.map(([i, j, k]) => facing([all[i][0], all[i][1], z], [all[j][0], all[j][1], z], [all[k][0], all[k][1], z], [0, 0, nz]));
  }
  /**
   * A solid lofted along the barrel axis. `rings`: [{ f, pts }] from rear to front, `pts` the cross-section (x, y),
   * counter-clockwise seen from +Z, the same count in every ring; f is the distance forward of the origin (z = -f).
   * `frontHoles` are cut through the front cap.
   */
  function loft(rings, frontHoles = []) {
    const tris = [];
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1], n = A.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, [x0, y0] = A.pts[i], [x1, y1] = A.pts[j], out = [y1 - y0, -(x1 - x0), 0];
        const a = [x0, y0, -A.f], b = [x1, y1, -A.f], c = [B.pts[j][0], B.pts[j][1], -B.f], d = [B.pts[i][0], B.pts[i][1], -B.f];
        tris.push(facing(a, d, c, out), facing(a, c, b, out));
      }
    }
    tris.push(...cap(rings[0].pts, [], -rings[0].f, 1), ...cap(rings[rings.length - 1].pts, frontHoles, -rings[rings.length - 1].f, -1));
    return soup(tris);
  }
  /** A profile drawn side-on (f forward, y up) extruded across the gun from x0 to x1, with optional holes and bevel. */
  function sideExtrude(poly, x0, x1, { holes = [], bevel = 0 } = {}) {
    const shape = new THREE.Shape(v2(poly));
    for (const h of holes) shape.holes.push(new THREE.Path(v2(h)));
    const depth = x1 - x0 - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1, steps: 1 });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i), w = p.getZ(i); p.setXYZ(i, x0 + bevel + w, v, -u); }
    p.needsUpdate = true;
    return g;
  }
  const box = (sx, sy, sz, cx, cy, cz, rotX = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotX) g.rotateX(rotX * DEG);
    g.translate(cx, cy, cz);
    return g;
  };
  /** A cylinder whose axis is the barrel axis (z), centred at (x, y), from forward distance f0 to f1. */
  const bore = (r, x, y, f0, f1, seg = 20) => {
    const g = new THREE.CylinderGeometry(r, r, f1 - f0, seg, 1, false);
    g.rotateX(Math.PI / 2); g.translate(x, y, -(f0 + f1) / 2);
    return g;
  };
  /** A cylinder whose axis is x, centred at (f, y), from x0 to x1. */
  const pin = (r, f, y, x0, x1, seg = 18) => {
    const g = new THREE.CylinderGeometry(r, r, x1 - x0, seg, 1, false);
    g.rotateZ(Math.PI / 2); g.translate((x0 + x1) / 2, y, -f);
    return g;
  };
  const disc = (r, x, y, z, nz, seg = 16) => {
    const g = new THREE.CircleGeometry(r, seg);
    if (nz < 0) g.rotateY(Math.PI);
    g.translate(x, y, z);
    return g;
  };

  // ---- the colours ----------------------------------------------------------------------------------------------
  const STEEL = { color: '#1b1c1e', metal: 0.85, rough: 0.42 };
  const HOOD = { color: '#3a3c40', metal: 0.85, rough: 0.3 };
  const POLY = { color: frameColor, metal: 0, rough: 0.75 };
  const stipple = new Color(frameColor).lerp(new Color('#ffffff'), 0.008).getStyle();
  const STIPPLE = { color: stipple, metal: 0, rough: 0.95 };
  const GROOVE = { color: '#050506', metal: 0, rough: 0.95 };
  const DOT = { color: '#f4f4f0', metal: 0, rough: 0.5 };
  const BLACK = { color: '#030304', metal: 0, rough: 0.9 };

  // ---- the grip's own frame of reference: axis down the grip at the rake, p across it towards the muzzle --------
  const sinR = Math.sin(D.gripRakeDeg * DEG), cosR = Math.cos(D.gripRakeDeg * DEG);
  const GB = [-0.002, -0.030];                       // a point on the backstrap line
  /** (f, y) of the point `s` down the grip axis and `t` forward across it, from the backstrap line. */
  const G = (s, t) => [GB[0] - s * sinR + t * cosR, GB[1] - s * cosR - t * sinR];
  /** f of the point at height y on the line `t` across the grip (the strap lines). */
  const fAt = (y, t) => G((GB[1] - y - t * sinR) / cosR, t)[0];
  const T0 = -0.003, TD = 0.042; 
  const sAt = (y, t) => (GB[1] - y - t * sinR) / cosR; // down the axis to height y on the line t
                      // backstrap and front strap, across the grip
  const baseDrop = 0.1032;                           // the lowest point of the magazine base plate, below the origin
  const S = (baseDrop + GB[1] - sinR * 0.047) / cosR - D.magBaseProtrusion; // grip floor, down the axis (lowest point: the base plate's front corner, t = 47 mm)
  const gripAxis = new Vector3(0, -cosR, +sinR); // down and rearwards

  // ===== FRAME (static): polymer grip module, rail, stippling, takedown lever, magazine release =================
  const fb = makeBuilder();
  {
    const W = 0.0156, bev = 0.0006;
    const sJ = sAt(-0.0475, TD); // where the guard's underside meets the front strap
    // the grip, seen from the right: backstrap swell, rake, flared magwell, front strap with the undercut under the guard
    const gripPoly = [
      [0, 0], [-0.0020, -0.0045], [-0.0040, -0.0110], [-0.0052, -0.0190], [-0.0055, -0.0250],
      G(0.0020, T0), G(0.040, T0), G(S - 0.004, T0 - 0.0022), G(S - 0.001, T0 - 0.0030), G(S, T0 - 0.0018),
      G(S, TD + 0.0020), G(S - 0.003, TD + 0.0026), G(sJ + 0.0219, TD + 0.0004), G(sJ + 0.0149, TD - 0.0008),
      G(sJ + 0.0104, TD - 0.0028), G(sJ + 0.0054, TD - 0.0032), G(sJ + 0.0019, TD - 0.0014), G(sJ, TD),
      G(sAt(0, TD), TD),
    ];
    fb.add(sideExtrude(gripPoly, -W, W, { bevel: bev }), { ...POLY, crease: 38, name: 'grip' });

    // the frame under the slide: dust cover and the rounded-square, undercut trigger guard, with its opening
    const ySlide = 0, yUnder = -0.0170, yGuard = -0.0475;
    const outer = [
      [0.024, yGuard], [0.1080, yGuard], ...arc(0.1080, -0.0405, 0.007, -90, 0, 6).slice(1),
      [0.1150, yUnder], [0.1655, yUnder], [0.1680, -0.0150], [0.1680, ySlide], [0.024, ySlide],
    ];
    const hole = [
      [fAt(-0.012, TD) - 0.0015, -0.012], [0.1100, -0.012], [0.1100, -0.0360], ...arc(0.1045, -0.0360, 0.0055, 0, -90, 6).slice(1),
      [fAt(-0.0415, TD) - 0.0015, -0.0415],
    ];
    fb.add(sideExtrude(outer, -0.0124, 0.0124, { holes: [hole], bevel: 0.0007 }), { ...POLY, crease: 38, name: 'frame' });

    // accessory rail under the dust cover: five teeth, four slots
    for (let k = 0; k < 5; k++) {
      const f0 = 0.1165 + k * 0.0105;
      fb.add(box(0.0205, 0.0030, 0.0075, 0, -0.0184, -(f0 + 0.00375)), { ...POLY, name: 'rail' + k });
    }

    // stippled panels: both sides of the grip, the front strap and the backstrap (a different colour and roughness)
    const panel = [G(-0.003, 0.005), G(-0.003, 0.0385), G(-0.0015, 0.0395), G(0.0595, 0.0395), G(0.0610, 0.0385), G(0.0610, 0.005), G(0.0595, 0.004), G(-0.0015, 0.004)];
    fb.add(sideExtrude(panel, W - 0.0004, W + 0.0006), { ...STIPPLE, crease: 40, name: 'stippleR' });
    fb.add(sideExtrude(panel, -W - 0.0006, -W + 0.0004), { ...STIPPLE, crease: 40, name: 'stippleL' });
    fb.add(sideExtrude([G(0.034, TD - 0.0004), G(0.0605, TD - 0.0004), G(0.0605, TD + 0.0007), G(0.034, TD + 0.0007)], -0.0105, 0.0105), { ...STIPPLE, crease: 40, name: 'stippleFront' });
    fb.add(sideExtrude([G(0.020, T0 + 0.0004), G(0.0605, T0 + 0.0004), G(0.0605, T0 - 0.0010), G(0.020, T0 - 0.0010)], -0.0105, 0.0105), { ...STIPPLE, crease: 40, name: 'stippleBack' });

    // takedown lever (left, above the trigger): a boss and a short arm
    fb.add(pin(0.0042, 0.0900, -0.0080, -0.0150, -0.0128), { ...STEEL, name: 'takedownBoss' });
    fb.add(sideExtrude([[0.0900, -0.0098], [0.1105, -0.0088], [0.1110, -0.0062], [0.0900, -0.0062]], -0.0150, -0.0130, { bevel: 0.0003 }), { ...STEEL, crease: 40, name: 'takedownArm' });
    // magazine release button (left, behind the guard): round, standing 1.2 mm proud of the strap
    fb.add(pin(0.0043, 0.0405, -0.0235, -0.0170, -W + 0.0004), { ...STEEL, name: 'magRelease' });
  }
  const frameGeo = fb.finish();

  // ===== SLIDE ======================================================================================================
  const sb = makeBuilder();
  const hw = D.slideWidth / 2, yT = D.slideTop, boreY = D.boreY;
  {
    const ring = (inx = 0, iny = 0) => {
      const base = [[-0.0122, 0], [0.0122, 0], [hw, 0.0008], [hw, 0.0270], [0.0102, yT], [-0.0102, yT], [-hw, 0.0270], [-hw, 0.0008]];
      return base.map(([x, y]) => [x * (1 - inx / hw), (y - yT / 2) * (1 - iny / (yT / 2)) + yT / 2]);
    };
    const fPortA = 0.053, fPortB = 0.107;
    const notch = [[-0.0122, 0], [0.0122, 0], [hw, 0.0008], [hw, 0.0110], [-0.0040, 0.0110], [-0.0040, yT], [-0.0102, yT], [-hw, 0.0270], [-hw, 0.0008]];
    sb.add(loft([{ f: D.slideRear, pts: ring(0.0014, 0.0014) }, { f: D.slideRear + 0.0014, pts: ring() }, { f: fPortA, pts: ring() }]), { ...STEEL, crease: 35, name: 'slideRear' });
    sb.add(loft([{ f: fPortA, pts: notch }, { f: fPortB, pts: notch }]), { ...STEEL, crease: 35, name: 'slidePort' });
    const front = loft([{ f: fPortB, pts: ring() }, { f: D.slideFront - 0.0045, pts: ring(0.0003, 0.0003) }, { f: D.slideFront, pts: ring(0.0016, 0.0030) }], [circle(0.0082, 24).map(([x, y]) => [x, y + boreY])]);
    sb.add(front, { ...STEEL, crease: 35, name: 'slideFront' });
    sb.add(disc(0.0086, 0, boreY, -(D.slideFront - 0.0012), -1), { ...BLACK, solid: false, name: 'boreShadow' });
    sb.add(disc(0.0035, 0, boreY, -(D.slideRear) + 0.0001, 1), { ...BLACK, solid: false, name: 'strikerPlate' });

    // cocking serrations: seven angled grooves each end, both sides, as thin dull dark strips on the flats
    for (const [f0, name] of [[-0.0010, 'rearSerr'], [0.1145, 'frontSerr']]) for (let k = 0; k < 7; k++) {
      const f = f0 + k * 0.0052;
      for (const side of [-1, 1]) sb.add(box(0.0007, 0.0225, 0.0013, side * hw, 0.0140, -f, 12), { ...GROOVE, name: `${name}${k}${side}` });
    }

    // sights: rear notch block on a dovetail, front post on a dovetail; three white dots
    const rf0 = -0.0075, rf1 = 0.0020, sTop = D.sightTop;
    sb.add(box(0.0176, 0.0016, rf1 - rf0 + 0.0010, 0, yT + 0.0004, -(rf1 + rf0 - 0.0010) / 2), { ...STEEL, name: 'rearDovetail' });
    for (const side of [-1, 1]) sb.add(sideExtrude([[rf0, yT], [rf1, yT], [rf1, sTop], [rf0 + 0.0014, sTop]], side > 0 ? 0.0027 : -0.0078, side > 0 ? 0.0078 : -0.0027, { bevel: 0.0002 }), { ...STEEL, crease: 40, name: 'rearPost' + side });
    sb.add(box(0.0054, 0.0036, rf1 - rf0, 0, yT + 0.0018, -(rf0 + rf1) / 2), { ...STEEL, name: 'rearNotchFloor' });
    for (const side of [-1, 1]) sb.add(disc(0.0016, side * 0.0052, 0.0348, -rf0 + 0.0002, 1), { ...DOT, solid: false, name: 'rearDot' + side });
    sb.add(box(0.0074, 0.0014, 0.0092, 0, yT + 0.0003, -0.1615), { ...STEEL, name: 'frontDovetail' });
    sb.add(sideExtrude([[0.1575, yT], [0.1655, yT], [0.1655, 0.0345], [0.1633, sTop], [0.1595, sTop]], -0.0017, 0.0017, { bevel: 0.0002 }), { ...STEEL, crease: 40, name: 'frontPost' });
    sb.add(disc(0.0013, 0, 0.0346, -0.1585 + 0.0003, 1), { ...DOT, solid: false, name: 'frontDot' });
  }
  const slideGeo = sb.finish();

  // ===== BARREL (pivot: front bushing) ================================================================================
  const bb = makeBuilder();
  const bPivot = [0, boreY, -0.1740];
  {
    const fRear = D.slideFront - 0.0004 - D.barrel; // 119 mm of barrel, chamber to crown
    const hoodPts = [[-0.0065, 0.0045], [0.0065, 0.0045], [0.0065, 0.0215], [0.0050, 0.0235], [-0.0050, 0.0235], [-0.0065, 0.0215]];
    bb.add(loft([{ f: fRear, pts: hoodPts }, { f: 0.1030, pts: hoodPts }]), { ...HOOD, crease: 35, name: 'hood' });
    bb.add(bore(0.0072, 0, boreY, 0.1030, D.slideFront - 0.0004), { color: '#2a2c30', metal: 0.85, rough: 0.34, name: 'barrel' });
    const crown = circle(0.0072, 24), hole = circle(0.0046, 20);
    bb.add(soup(cap(crown, [hole], -(D.slideFront - 0.0004) - 0.00001, -1).map((t) => t.map(([x, y, z]) => [x, y + boreY, z]))), { ...HOOD, solid: false, name: 'crown' });
    bb.add(disc(0.0046, 0, boreY, -(D.slideFront - 0.0014), -1), { ...BLACK, solid: false, name: 'boreHole' });
    bb.add(bore(0.0034, 0, boreY - 0.0105, 0.0860, 0.1725, 12), { ...HOOD, name: 'guideRod' });
  }
  const barrelGeo = bb.finish(bPivot);

  // ===== TRIGGER (pivot: the trigger pin) ===============================================================================
  const tb = makeBuilder();
  const tPivot = [0, -0.0085, -0.0785];
  {
    const blade = [[0.0800, -0.0065], [0.0765, -0.0155], [0.0720, -0.0235], [0.0688, -0.0300], [0.0685, -0.0345], [0.0712, -0.0358], [0.0740, -0.0343],
      [0.0765, -0.0275], [0.0820, -0.0185], [0.0865, -0.0105], [0.0885, -0.0065], [0.0850, -0.0040]];
    blade.forEach((q) => { q[0] -= 0.0065; });
    tb.add(sideExtrude(blade, -0.0048, 0.0048, { bevel: 0.0004 }), { ...STEEL, crease: 38, name: 'trigger' });
  }
  const triggerGeo = tb.finish(tPivot);

  // ===== SLIDE STOP LEVER (left; pivot at its pin) =======================================================================
  const lb = makeBuilder();
  const lPivot = [-0.0141, -0.0085, -0.0750];
  {
    const lever = [[0.0440, -0.0040], [0.0440, -0.0082], [0.0468, -0.0112], [0.0705, -0.0112], [0.0705, -0.0060], [0.0585, -0.0060], [0.0556, -0.0030], [0.0500, -0.0028]];
    lever.forEach((q) => { q[0] += 0.0095; });
    lb.add(sideExtrude(lever, -0.0151, -0.0131, { bevel: 0.0003 }), { ...STEEL, crease: 40, name: 'slideStop' });
    lb.add(pin(0.0020, 0.0750, -0.0085, -0.0153, -0.0129, 12), { ...STEEL, name: 'slideStopPin' });
  }
  const slideStopGeo = lb.finish(lPivot);

  // ===== MAGAZINE (steel body in the grip; polymer base plate protruding 4 mm) ===========================================
  const mb = makeBuilder();
  {
    const sTop = -0.026, L = S - sTop, tc = (0.0040 + 0.0365) / 2;
    const [cf, cy] = G((S + sTop) / 2, tc);
    mb.add(box(0.0224, L, 0.0325, 0, cy, -cf, -D.gripRakeDeg), { color: '#232427', metal: 0.85, rough: 0.45, name: 'magBody' });
    const [pf, py] = G(S + D.magBaseProtrusion / 2, (-0.0035 + 0.0435) / 2);
    mb.add(box(0.0278, D.magBaseProtrusion, 0.0470, 0, py, -pf, -D.gripRakeDeg), { color: '#1a1b1d', metal: 0, rough: 0.8, name: 'baseplate' });
    const [lf, ly] = G(S + D.magBaseProtrusion / 2, 0.0455);
    mb.add(box(0.0200, D.magBaseProtrusion, 0.0030, 0, ly, -lf, -D.gripRakeDeg), { color: '#1a1b1d', metal: 0, rough: 0.8, name: 'baseplateLip' });
  }
  const magGeo = mb.finish();

  // ---- the one material ----------------------------------------------------------------------------------------------
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 1 });
  material.name = 'pistol';
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aMR;\nvarying vec2 vMR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMR = aMR;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMR;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMR.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMR.x;');
  };
  material.customProgramCacheKey = () => 'opus-pistol-mr';

  // ---- the objects -----------------------------------------------------------------------------------------------
  const group = new THREE.Group(); group.name = 'pistol';
  const mesh = (name, geo, pivot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, material); m.name = name; m.position.set(...pivot); group.add(m); return m;
  };
  const frame = mesh('frame', frameGeo);
  const slide = mesh('slide', slideGeo);
  const barrel = mesh('barrel', barrelGeo, bPivot);
  const trigger = mesh('trigger', triggerGeo, tPivot);
  const magazine = mesh('magazine', magGeo);
  const slideStop = mesh('slideStop', slideStopGeo, lPivot);

  const sights = new THREE.Object3D(); sights.name = 'sights';
  const front = new THREE.Object3D(); front.name = 'front'; front.position.set(0, D.sightTop, -0.1595);
  const rear = new THREE.Object3D(); rear.name = 'rear'; rear.position.set(0, 0.0355, 0.0075);
  sights.add(front, rear); slide.add(sights);

  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, boreY, -D.slideFront); group.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.name = 'ejection'; ejection.position.set(hw, 0.0200, -0.0800);
  ejection.userData.dir = [0.85, 0.45, 0.28]; slide.add(ejection);

  const pieces = [fb, sb, bb, tb, lb, mb].flatMap((b) => b.pieces);
  const dims = {
    ...D, gripAxis, pieces,
    boreY, sightRear: rear.position.clone(), sightFront: front.position.clone(),
    anim: { slideTravel: 0.045, barrelTilt: 3 * DEG, triggerPull: -12 * DEG, magAxis: gripAxis.clone() },
    triangles: [frameGeo, slideGeo, barrelGeo, triggerGeo, slideStopGeo, magGeo].reduce((n, g) => n + g.attributes.position.count / 3, 0),
    drawCalls: 6,
  };
  return { group, parts: { slide, barrel, frame, trigger, magazine, slideStop, sights }, muzzle, ejection, dims, material };
}
