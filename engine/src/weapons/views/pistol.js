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
// lighter barrel hood, polymer, the stippled zones, the dark groove floors and the white sight dots all live in the same
// draw call. Meshes that never move relative to each other are merged: `frame` (polymer grip module, dust cover with its
// rail, trigger guard, stippling, takedown lever, magazine release, trigger pin), `slide` (slide, sights, dots,
// serrations, striker plate), and the four that move: `barrel`, `trigger`, `magazine`, `slideStop`. That is 6 draw calls.
//
// THE GRIP is one lofted solid: eight sections, seven of them horizontal (each a rounded rectangle of 16 points: a fuller
// round at the back for the palm, tighter corners at the front strap) and the last one square to the magazine axis, so the
// floor sits flat against the base plate. Section by section it has the beavertail lip, the high-cut hollow under it,
// the palm swell, the undercut where the guard meets the front strap and a slight flare at the magazine well. The
// backstrap and the front strap run raked 18 degrees back from vertical (dims.gripAxis). Stippling is an inset zone (a
// thin solid a little proud of the side, slightly rougher and lighter) on both sides, the front strap and the backstrap.
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
  slideWidth: 0.026, slideTop: 0.0282, sightTop: 0.0352, serrations: 7,
});

export function buildPistolView(THREE, opts = {}) {
  const { Vector2, Vector3, BufferGeometry, Float32BufferAttribute, Color } = THREE;
  const frameColor = opts.frameColor || '#26272a';
  const D = PISTOL_DIMS;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- the merge: pieces of geometry with a colour, metalness and roughness, into one BufferGeometry -----------
  const WEAR = new Color('#9a9da2');
  function makeBuilder() {
    const pos = [], nor = [], col = [], mr = [], pieces = [];
    return {
      pieces,
      /**
       * Add `geo` (any BufferGeometry). `crease` > 0 recomputes normals, smooth within that many degrees.
       * `wear` (0..0.08): vertices on a convex edge sharper than 30 degrees are lightened by that share (worn steel).
       */
      add(geo, { color, metal = 0, rough = 0.6, crease = 0, name = '', solid = true, wear = 0 }) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        const p = g.attributes.position.array;
        const n = crease ? creaseNormals(p, crease) : g.attributes.normal.array;
        const c = new Color(color);
        const count = p.length / 3;
        const edge = wear ? edgeFlags(p, 30) : null;
        let vol = 0;
        if (solid) for (let i = 0; i < p.length; i += 9) {
          vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
        }
        for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
        const lit = wear ? c.clone().lerp(WEAR, wear) : c;
        for (let i = 0; i < count; i++) { const cc = edge && edge[i] ? lit : c; col.push(cc.r, cc.g, cc.b); mr.push(metal, rough); }
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

  const vkey = (p, i) => `${Math.round(p[i] * 2e5)},${Math.round(p[i + 1] * 2e5)},${Math.round(p[i + 2] * 2e5)}`;
  function faceNormals(p) {
    const tris = p.length / 9, fn = new Float32Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      fn[t * 3] = ay * bz - az * by; fn[t * 3 + 1] = az * bx - ax * bz; fn[t * 3 + 2] = ax * by - ay * bx; // area-weighted
    }
    return fn;
  }
  function vertexFaces(p) {
    const at = new Map();
    for (let t = 0; t < p.length / 9; t++) for (let v = 0; v < 3; v++) { const k = vkey(p, t * 9 + v * 3); (at.get(k) || at.set(k, []).get(k)).push(t); }
    return at;
  }
  /** Normals of a non-indexed triangle soup, smooth across edges flatter than `deg` and hard across sharper ones. */
  function creaseNormals(p, deg) {
    const tris = p.length / 9, fn = faceNormals(p), cosT = Math.cos(deg * DEG), at = vertexFaces(p);
    const out = new Float32Array(p.length);
    for (let t = 0; t < tris; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2], fl = Math.hypot(fx, fy, fz) || 1;
      for (let v = 0; v < 3; v++) {
        let sx = 0, sy = 0, sz = 0;
        for (const u of at.get(vkey(p, t * 9 + v * 3))) {
          const ux = fn[u * 3], uy = fn[u * 3 + 1], uz = fn[u * 3 + 2], ul = Math.hypot(ux, uy, uz) || 1;
          if ((ux * fx + uy * fy + uz * fz) / (ul * fl) >= cosT) { sx += ux; sy += uy; sz += uz; }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        out[t * 9 + v * 3] = sx / l; out[t * 9 + v * 3 + 1] = sy / l; out[t * 9 + v * 3 + 2] = sz / l;
      }
    }
    return out;
  }
  /** Per vertex: true when a face that shares the vertex turns more than `deg` away from this vertex's own face. */
  function edgeFlags(p, deg) {
    const tris = p.length / 9, fn = faceNormals(p), cosT = Math.cos(deg * DEG), at = vertexFaces(p), out = new Uint8Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2], fl = Math.hypot(fx, fy, fz) || 1;
      for (let v = 0; v < 3; v++) for (const u of at.get(vkey(p, t * 9 + v * 3))) {
        const ux = fn[u * 3], uy = fn[u * 3 + 1], uz = fn[u * 3 + 2], ul = Math.hypot(ux, uy, uz) || 1;
        if ((ux * fx + uy * fy + uz * fz) / (ul * fl) < cosT) { out[t * 3 + v] = 1; break; }
      }
    }
    return out;
  }

  // ---- geometry helpers ---------------------------------------------------------------------------------------
  const v2 = (pts) => pts.map(([a, b]) => new Vector2(a, b));
  /** Points on an arc, degrees, `n` segments, inclusive of both ends. */
  const arc = (cx, cy, r, a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * DEG; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const circle = (r, n = 20) => Array.from({ length: n }, (_, i) => [r * Math.cos(i / n * 2 * Math.PI), r * Math.sin(i / n * 2 * Math.PI)]);

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
   * the same count in every ring; f is the distance forward of the origin (z = -f). `frontHoles` are cut through the
   * front cap. The two caps are triangulated, so a ring may have a notch.
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
    const last = rings[rings.length - 1];
    tris.push(...cap(rings[0].pts, [], -rings[0].f, 1), ...cap(last.pts, frontHoles, -last.f, -1));
    for (const h of frontHoles) { // a hole is a closed pocket: its wall (facing the axis) and its floor (facing the opening)
      const cx = h.reduce((a, q) => a + q[0], 0) / h.length, cy = h.reduce((a, q) => a + q[1], 0) / h.length, zb = -(last.f - 0.004);
      for (let i = 0; i < h.length; i++) {
        const [x0, y0] = h[i], [x1, y1] = h[(i + 1) % h.length], mid = [cx - (x0 + x1) / 2, cy - (y0 + y1) / 2, 0];
        tris.push(facing([x0, y0, -last.f], [x1, y1, -last.f], [x1, y1, zb], mid), facing([x0, y0, -last.f], [x1, y1, zb], [x0, y0, zb], mid));
        tris.push(facing([cx, cy, zb], [x0, y0, zb], [x1, y1, zb], [0, 0, -1]));
      }
    }
    return soup(tris);
  }
  /**
   * A closed solid lofted through convex rings of 3D points [x, y, f] (z = -f), the same count in every ring; the end
   * rings are fanned shut. Used for the grip and its stippled inset zones.
   */
  function loft3(rings) {
    const tris = [], P = (q) => [q[0], q[1], -q[2]];
    const centre = (R) => { const c = [0, 0, 0]; for (const q of R) { c[0] += q[0] / R.length; c[1] += q[1] / R.length; c[2] += -q[2] / R.length; } return c; };
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1], n = A.length, c = centre(A);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = P(A[i]), b = P(A[j]), cc = P(B[j]), d = P(B[i]);
        const out = [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1], (a[2] + b[2]) / 2 - c[2]];
        tris.push(facing(a, d, cc, out), facing(a, cc, b, out));
      }
    }
    const fan = (R, dir) => {
      const c = centre(R), n = R.length;
      for (let i = 0; i < n; i++) tris.push(facing(c, P(R[i]), P(R[(i + 1) % n]), dir));
    };
    const c0 = centre(rings[0]), c1 = centre(rings[rings.length - 1]), L = rings[rings.length - 1], F = rings[0];
    fan(F, [c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]]);
    fan(L, [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]]);
    return soup(tris);
  }
  /** A profile drawn side-on (f forward, y up) extruded across the gun from x0 to x1, with optional holes and bevel. */
  function sideExtrude(poly, x0, x1, { holes = [], bevel = 0, segs = 1 } = {}) {
    const shape = new THREE.Shape(v2(poly));
    for (const h of holes) shape.holes.push(new THREE.Path(v2(h)));
    const depth = x1 - x0 - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 1, steps: 1 });
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
  /** A cylinder whose axis is x, centred at (f, y), from x0 to x1; `rEnd` is the radius at x1 (a bevelled button). */
  const pin = (r, f, y, x0, x1, seg = 18, rEnd = r) => {
    const g = new THREE.CylinderGeometry(rEnd, r, x1 - x0, seg, 1, false);
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
  const STEEL = { color: '#232427', metal: 0.7, rough: 0.38, wear: 0.08 };
  const HOOD = { color: '#3d4045', metal: 0.8, rough: 0.3 };
  const POLY = { color: frameColor, metal: 0, rough: 0.7 };
  const stipple = new Color(frameColor).lerp(new Color('#ffffff'), 0.016).getStyle();
  const STIPPLE = { color: stipple, metal: 0, rough: 0.92 };
  const GROOVE = { color: '#060607', metal: 0, rough: 0.95 };
  const DOT = { color: '#f4f4f0', metal: 0, rough: 0.5 };
  const BLACK = { color: '#030304', metal: 0, rough: 0.9 };

  // ---- the grip's own frame of reference: axis down the grip at the rake, t across it towards the muzzle ---------
  const sinR = Math.sin(D.gripRakeDeg * DEG), cosR = Math.cos(D.gripRakeDeg * DEG), tanR = Math.tan(D.gripRakeDeg * DEG);
  const GB = [-0.002, -0.030];                       // a point on the backstrap line
  /** (f, y) of the point `s` down the grip axis and `t` forward across it, from the backstrap line. */
  const G = (s, t) => [GB[0] - s * sinR + t * cosR, GB[1] - s * cosR - t * sinR];
  const T0 = -0.003, TD = 0.042;
  const baseDrop = 0.1032;                           // the lowest point of the magazine base plate, below the origin
  const S = (baseDrop + GB[1] - sinR * 0.047) / cosR - D.magBaseProtrusion; // grip floor, down the axis
  const gripAxis = new Vector3(0, -cosR, +sinR); // down and rearwards

  // ---- the grip's sections: y -> outline -----------------------------------------------------------------------------
  const interp = (tab, y) => { // tab: [[y, v]] from the top down; linear
    if (y >= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (y >= tab[i][0]) { const [y0, v0] = tab[i - 1], [y1, v1] = tab[i]; return v0 + (v1 - v0) * (y - y0) / (y1 - y0); }
    return tab[tab.length - 1][1];
  };
  const lineB = (y) => -0.0050 + (y + 0.030) * tanR;                    // backstrap, straight part
  const lineF = (y) => 0.03794 + (y + 0.0430) * tanR;                    // front strap, straight part
  const swell = (y) => 0.0013 * Math.sin(Math.PI * clamp((-0.030 - y) / 0.058, 0, 1));
  const flare = (y) => 0.0016 * clamp((-0.074 - y) / 0.014, 0, 1);
  const fBack = (y) => y > -0.030
    ? interp([[-0.0008, -0.0100], [-0.0060, -0.0079], [-0.0150, -0.0062], [-0.0300, -0.0050]], y)
    : lineB(y) - swell(y) - flare(y);
  const undercut = (y) => 0.0030 * Math.max(0, 1 - Math.abs((y + 0.0525) / 0.0085));
  const fFront = (y) => lineF(y) - undercut(y) - 0.0012 * clamp((-0.074 - y) / 0.014, 0, 1) * 0; // straight below the guard
  const hwAt = (y) => interp([[-0.0008, 0.0128], [-0.0060, 0.0124], [-0.0150, 0.0128], [-0.0300, 0.0146], [-0.0500, 0.0156], [-0.0700, 0.0155], [-0.0880, 0.0152], [-0.1040, 0.0158]], y);
  const rBackAt = (y) => interp([[-0.0008, 0.0050], [-0.0150, 0.0070], [-0.0300, 0.0092], [-0.1040, 0.0096]], y);
  const rFrontAt = (y) => interp([[-0.0008, 0.0030], [-0.0300, 0.0050], [-0.1040, 0.0062]], y);
  /** A rounded rectangle in (x, f): 16 points, the back corners fuller than the front ones. */
  function roundRect(hw, fB, fF, rB, rF) {
    const pts = [], n = 3;
    const corner = (cx, cf, r, a0, a1) => { for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * DEG; pts.push([cx + r * Math.cos(a), cf + r * Math.sin(a)]); } };
    corner(hw - rF, fF - rF, rF, 90, 0); corner(hw - rB, fB + rB, rB, 0, -90);
    corner(-hw + rB, fB + rB, rB, -90, -180); corner(-hw + rF, fF - rF, rF, 180, 90);
    return pts;
  }
  const gripYs = [-0.0008, -0.0060, -0.0150, -0.0300, -0.0475, -0.0545, -0.0680, -0.0780];
  const gripRings = gripYs.map((y) => roundRect(hwAt(y), fBack(y), fFront(y), rBackAt(y), rFrontAt(y)).map(([x, f]) => [x, y, f]));
  { // the last section: square to the magazine axis, a little fuller at the well
    const tB = T0 - 0.0040, tF = TD + 0.0022;
    gripRings.push(roundRect(hwAt(-0.1040), tB, tF, 0.0092, 0.0050).map(([x, t]) => { const [f, y] = G(S, t); return [x, y, f]; }));
  }
  /** A thin solid proud of the grip on one flat: rectangle `[u0, u1]` across, from y0 down to y1 (sections every ~12 mm). */
  function inset(y0, y1, outline) { // outline(y) -> 4 points [x, y, f]
    const n = Math.max(2, Math.round((y0 - y1) / 0.012)), rings = [];
    for (let i = 0; i <= n; i++) rings.push(outline(y0 + (y1 - y0) * i / n));
    return loft3(rings);
  }
  const sideZone = (sgn, y0, y1) => inset(y0, y1, (y) => {
    const hw = hwAt(y), fB = fBack(y) + rBackAt(y) + 0.0045, fF = fFront(y) - rFrontAt(y) - 0.0022, xo = sgn * (hw + 0.0006), xi = sgn * (hw - 0.0005);
    return [[xo, y, fF], [xo, y, fB], [xi, y, fB], [xi, y, fF]];
  });
  const frontZone = (y0, y1) => inset(y0, y1, (y) => {
    const hw = hwAt(y) - rFrontAt(y) - 0.0016, f = fFront(y);
    return [[-hw, y, f + 0.0006], [hw, y, f + 0.0006], [hw, y, f - 0.0006], [-hw, y, f - 0.0006]];
  });
  const backZone = (y0, y1) => inset(y0, y1, (y) => {
    const hw = Math.max(0.004, hwAt(y) - rBackAt(y) * 0.8), f = fBack(y);
    return [[-hw, y, f - 0.0006], [hw, y, f - 0.0006], [hw, y, f + 0.0006], [-hw, y, f + 0.0006]];
  });
  const rakeOfGrip = (() => { // measured from the sections: the front strap's slope below the guard
    const y0 = -0.066, y1 = -0.090; return Math.atan2(fFront(y0) - fFront(y1), y0 - y1) / DEG;
  })();

  // ===== FRAME (static): polymer grip module, rail, stippling, takedown lever, magazine release, trigger pin ===========
  const fb = makeBuilder();
  {
    fb.add(loft3(gripRings), { ...POLY, crease: 36, name: 'grip' });

    // the dust cover: a bar under the slide, with the accessory rail forward of the guard
    const yUnder = -0.0170;
    const cover = [[0.020, 0], [0.1680, 0], [0.1680, -0.0150], [0.1655, yUnder], [0.1150, yUnder], [0.1150, -0.0125], [0.020, -0.0125]];
    fb.add(sideExtrude(cover, -0.0118, 0.0118, { bevel: 0.0011, segs: 2 }), { ...POLY, crease: 36, name: 'dustCover' });
    // the trigger guard: a rounded-square loop 18 mm across with real thickness, a flat front, the opening cut through
    const outer = [
      [0.022, -0.0475], [0.1060, -0.0475], ...arc(0.1060, -0.0385, 0.0090, -90, 0, 5).slice(1), [0.1150, -0.0100], [0.0850, -0.0100], [0.022, -0.0100],
    ];
    const holeRear = (y) => fFront(y) - 0.0016;
    const hole = [
      [holeRear(-0.0125), -0.0125], [0.1030, -0.0125], ...arc(0.1030, -0.0155, 0.0030, 90, 0, 3).slice(1),
      [0.1060, -0.0330], ...arc(0.1005, -0.0350, 0.0055, 0, -90, 5).slice(1), [holeRear(-0.0405), -0.0405],
    ];
    fb.add(sideExtrude(outer, -0.0092, 0.0092, { holes: [hole], bevel: 0.0022, segs: 3 }), { ...POLY, crease: 38, name: 'guard' });

    // accessory rail under the dust cover: five teeth, four real slots between them
    for (let k = 0; k < 5; k++) {
      const f0 = 0.1165 + k * 0.0105;
      fb.add(box(0.0212, 0.0034, 0.0075, 0, -0.0187, -(f0 + 0.00375)), { ...POLY, name: 'rail' + k });
    }
    for (let k = 0; k < 4; k++) fb.add(box(0.0160, 0.0004, 0.0030, 0, -0.0170 - 0.0002, -(0.1165 + 0.0075 + 0.0015 + k * 0.0105)), { ...GROOVE, name: 'railSlot' + k, solid: true });

    // stippled zones: both sides, the front strap below the guard, the backstrap
    fb.add(sideZone(+1, -0.034, -0.080), { ...STIPPLE, crease: 40, name: 'stippleR' });
    fb.add(sideZone(-1, -0.034, -0.080), { ...STIPPLE, crease: 40, name: 'stippleL' });
    fb.add(frontZone(-0.064, -0.090), { ...STIPPLE, crease: 40, name: 'stippleFront' });
    fb.add(backZone(-0.038, -0.078), { ...STIPPLE, crease: 40, name: 'stippleBack' });

    // the slide rails of the frame: a steel strip each side under the slide, from the web to the dust cover
    for (const side of [-1, 1]) fb.add(box(0.0012, 0.0036, 0.1020, side * 0.0122, -0.0020, -0.0560), { ...STEEL, name: 'slideRail' + side });
    // takedown lever (left, above the trigger): a boss and a short arm
    fb.add(pin(0.0046, 0.0900, -0.0080, -0.0158, -0.0124, 20, 0.0040), { ...STEEL, name: 'takedownBoss' });
    fb.add(sideExtrude([[0.0900, -0.0100], [0.1105, -0.0090], [0.1115, -0.0060], [0.0900, -0.0060]], -0.0158, -0.0136, { bevel: 0.0004 }), { ...STEEL, crease: 40, name: 'takedownArm' });
    // magazine release button (left, behind the guard): round, bevelled, standing 1.4 mm proud of the strap
    const hwR = hwAt(-0.0235);
    fb.add(pin(0.0046, 0.0405, -0.0235, -(hwR + 0.0016), -hwR + 0.0004, 20, 0.0040), { ...STEEL, name: 'magRelease' });
    // trigger pin: a head each side above the trigger
    fb.add(pin(0.0021, 0.0785, -0.0085, -0.0104, 0.0104, 14), { ...STEEL, name: 'triggerPin' });
  }
  const frameGeo = fb.finish();

  // ===== SLIDE ======================================================================================================
  const sb = makeBuilder();
  const hw = D.slideWidth / 2, yT = D.slideTop, boreY = D.boreY;
  const sd = 0.0006, bandLo = 0.0035, bandHi = 0.0222; // a serration groove: 0.6 mm deep, on the flat between these heights
  const rakeS = 12;                                    // serrations lean 12 degrees
  {
    // the slide's section: flat 3 mm x 45 degree bevels along the top edges (`cx`), narrower in plan towards the nose (`h`)
    const ring = (cx = 0.0030, h = hw, shrink = 0, band = false) => {
      const w = h - shrink, wb = Math.min(0.0122, w - 0.0004), cy = cx;
      const top = yT - shrink * 0.8;
      const side = band ? [[w, bandLo - 0.0008], [w, bandLo], [w - sd, bandLo], [w - sd, bandHi], [w, bandHi]] : [];
      const sideL = band ? [[-w, bandHi], [-(w - sd), bandHi], [-(w - sd), bandLo], [-w, bandLo], [-w, bandLo - 0.0008]] : [];
      return [[-wb, 0], [wb, 0], [w, 0.0010], ...side, [w, top - cy], [w - cx, top], [-(w - cx), top], [-w, top - cy], ...sideL, [-w, 0.0010]];
    };
    const fPortA = 0.0600, fPortB = 0.0980;
    const notch = (cx = 0.0030) => [[-0.0122, 0], [0.0122, 0], [hw, 0.0010], [hw, 0.0105], [-0.0030, 0.0105], [-0.0030, yT], [-(hw - cx), yT], [-hw, yT - cx], [-hw, 0.0010]];
    // rear: shrunk rear face (chamfered all round), then full section; the rear serration zone, then the plain flat to the port
    sb.add(loft([{ f: D.slideRear, pts: ring(0.0040, hw, 0.0014) }, { f: D.slideRear + 0.0014, pts: ring() }, { f: -0.0010, pts: ring() }]), { ...STEEL, crease: 35, name: 'slideRear' });
    sb.add(loft([{ f: -0.0010, pts: ring(0.003, hw, 0, true) }, { f: 0.0400, pts: ring(0.003, hw, 0, true) }]), { ...STEEL, crease: 35, name: 'slideRearZone' });
    sb.add(loft([{ f: 0.0400, pts: ring() }, { f: fPortA, pts: ring() }]), { ...STEEL, crease: 35, name: 'slideMid' });
    sb.add(loft([{ f: fPortA, pts: notch() }, { f: fPortB, pts: notch() }]), { ...STEEL, crease: 35, name: 'slidePort' });
    // forward of the port: the sloped lightening bevel grows from 3 to 5.5 mm; the front narrows in plan to the nose
    sb.add(loft([{ f: fPortB, pts: ring() }, { f: 0.1090, pts: ring() }]), { ...STEEL, crease: 35, name: 'slideFore' });
    sb.add(loft([{ f: 0.1090, pts: ring(0.0030, hw, 0, true) }, { f: 0.1560, pts: ring(0.0055, hw - 0.0002, 0, true) }]), { ...STEEL, crease: 35, name: 'slideForeZone' });
    const front = loft([{ f: 0.1560, pts: ring(0.0055, hw - 0.0002) }, { f: 0.1700, pts: ring(0.0058, hw - 0.0009) }, { f: D.slideFront - 0.0030, pts: ring(0.0055, hw - 0.0012) }, { f: D.slideFront, pts: ring(0.0050, hw - 0.0020, 0.0008) }], [circle(0.0088, 24).map(([x, y]) => [x, y + boreY])]);
    sb.add(front, { ...STEEL, crease: 35, name: 'slideFront' });
    sb.add(disc(0.0092, 0, boreY, -(D.slideFront - 0.0014), -1), { ...BLACK, solid: false, name: 'boreShadow' });
    // striker cover plate on the rear face, and its dark hole
    sb.add(box(0.0150, 0.0100, 0.0006, 0, 0.0150, -(D.slideRear) + 0.0003 - 0.00005), { ...HOOD, name: 'strikerPlate' });
    sb.add(disc(0.0030, 0, 0.0150, -(D.slideRear) + 0.0007, 1), { ...BLACK, solid: false, name: 'strikerHole' });

    // cocking serrations: seven angled grooves each end, both sides. The floor is 0.6 mm below the flat (the zone's
    // section is cut in); the lands between the grooves stand back up to the flat; each groove has its dark floor.
    const lean = rakeS * DEG, hBand = (bandHi - bandLo) / Math.cos(lean) + 0.0006, yc = (bandLo + bandHi) / 2;
    const serr = (f0, prefix) => {
      const wTop = (f) => (f > 0.1090 ? hw - 0.0002 * ((f - 0.109) / 0.047) : hw);
      for (const side of [-1, 1]) {
        for (let k = 0; k <= 7; k++) { // eight lands, seven grooves
          const f = f0 + k * 0.0052 - 0.0026;
          sb.add(box(sd + 0.0001, hBand, 0.0030, side * (wTop(f) - sd / 2 + 0.00005), yc, -f, rakeS), { ...STEEL, wear: 0.05, name: `${prefix}Land${k}${side}` });
        }
        for (let k = 0; k < 7; k++) {
          const f = f0 + k * 0.0052 + 0.0000;
          sb.add(box(0.0001, hBand - 0.0006, 0.0017, side * (wTop(f) - sd + 0.00006), yc, -f, rakeS), { ...GROOVE, name: `${prefix}${k}${side}` });
        }
      }
    };
    serr(0.0042, 'rearSerr'); serr(0.1165, 'frontSerr');

    // sights: rear notch block on a dovetail, front post on a dovetail; three white dots
    const rf0 = -0.0075, rf1 = 0.0020, sTop = D.sightTop, rTop = D.sightTop - 0.0012, yD = yT;
    sb.add(box(0.0176, 0.0016, rf1 - rf0 + 0.0010, 0, yD + 0.0004, -(rf1 + rf0 - 0.0010) / 2), { ...STEEL, name: 'rearDovetail' });
    for (const side of [-1, 1]) sb.add(sideExtrude([[rf0, yD], [rf1, yD], [rf1, rTop], [rf0 + 0.0014, rTop]], side > 0 ? 0.0027 : -0.0078, side > 0 ? 0.0078 : -0.0027, { bevel: 0.0002 }), { ...STEEL, crease: 40, name: 'rearPost' + side });
    sb.add(box(0.0054, 0.0036, rf1 - rf0, 0, yD + 0.0018, -(rf0 + rf1) / 2), { ...STEEL, name: 'rearNotchFloor' });
    for (const side of [-1, 1]) sb.add(disc(0.0016, side * 0.0052, rTop - 0.0040, -rf0 + 0.0002, 1), { ...DOT, solid: false, name: 'rearDot' + side });
    sb.add(box(0.0074, 0.0014, 0.0092, 0, yD + 0.0003, -0.1615), { ...STEEL, name: 'frontDovetail' });
    sb.add(sideExtrude([[0.1575, yD], [0.1655, yD], [0.1655, sTop - 0.0007], [0.1633, sTop], [0.1595, sTop]], -0.0017, 0.0017, { bevel: 0.0002 }), { ...STEEL, crease: 40, name: 'frontPost' });
    sb.add(disc(0.0013, 0, sTop - 0.0006, -0.1585 + 0.0003, 1), { ...DOT, solid: false, name: 'frontDot' });
    // extractor: a lighter steel strip on the right of the slide behind the port, and its claw showing in the port
    sb.add(box(0.0008, 0.0070, 0.0140, hw + 0.0001, 0.0160, -0.0530), { ...HOOD, name: 'extractor' });
    sb.add(box(0.0016, 0.0030, 0.0042, hw - 0.0020, 0.0125, -0.0605), { ...HOOD, name: 'extractorClaw' });
  }
  const slideGeo = sb.finish();

  // ===== BARREL (pivot: front bushing) ================================================================================
  const bb = makeBuilder();
  const bPivot = [0, boreY, -0.1740];
  {
    const fRear = D.slideFront - 0.0004 - D.barrel; // 119 mm of barrel, chamber to crown
    const hoodPts = [[-0.0065, 0.0045], [0.0065, 0.0045], [0.0065, 0.0225], [0.0050, 0.0246], [-0.0050, 0.0246], [-0.0065, 0.0225]];
    bb.add(loft([{ f: fRear, pts: hoodPts }, { f: 0.1030, pts: hoodPts }]), { ...HOOD, crease: 35, wear: 0.06, name: 'hood' });
    // the witness notch: a small dark recess in the hood's top at the front of the port
    bb.add(box(0.0036, 0.0005, 0.0028, 0.0008, 0.0246, -0.0925), { ...GROOVE, name: 'witness' });
    bb.add(bore(0.0072, 0, boreY, 0.1030, D.slideFront - 0.0004), { color: '#2a2c30', metal: 0.8, rough: 0.34, name: 'barrel' });
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
    tb.add(sideExtrude(blade, -0.0050, 0.0050, { bevel: 0.0006, segs: 2 }), { ...STEEL, crease: 38, name: 'trigger' });
    tb.add(box(0.0030, 0.0150, 0.0014, 0, -0.0230, -0.0705 + 0.0035), { ...STEEL, name: 'triggerSafety' });
  }
  const triggerGeo = tb.finish(tPivot);

  // ===== SLIDE STOP LEVER (left; pivot at its pin) =======================================================================
  const lb = makeBuilder();
  const lPivot = [-0.0141, -0.0085, -0.0750];
  {
    const lever = [[0.0440, -0.0040], [0.0440, -0.0082], [0.0468, -0.0112], [0.0705, -0.0112], [0.0705, -0.0060], [0.0585, -0.0060], [0.0556, -0.0030], [0.0500, -0.0028]];
    lever.forEach((q) => { q[0] += 0.0095; });
    lb.add(sideExtrude(lever, -0.0156, -0.0132, { bevel: 0.0004 }), { ...STEEL, crease: 40, name: 'slideStop' });
    lb.add(pin(0.0020, 0.0750, -0.0085, -0.0158, -0.0129, 12), { ...STEEL, name: 'slideStopPin' });
  }
  const slideStopGeo = lb.finish(lPivot);

  // ===== MAGAZINE (steel body in the grip; polymer base plate protruding 4 mm) ===========================================
  const mb = makeBuilder();
  {
    const sTop = -0.026, L = S - sTop, tc = (0.0040 + 0.0365) / 2;
    const [cf, cy] = G((S + sTop) / 2, tc);
    mb.add(box(0.0224, L, 0.0325, 0, cy, -cf, -D.gripRakeDeg), { color: '#2a2c30', metal: 0.7, rough: 0.42, name: 'magBody' });
    const [pf, py] = G(S + D.magBaseProtrusion / 2, (-0.0035 + 0.0435) / 2);
    mb.add(box(0.0278, D.magBaseProtrusion, 0.0470, 0, py, -pf, -D.gripRakeDeg), { color: '#1c1d1f', metal: 0, rough: 0.75, name: 'baseplate' });
    const [lf, ly] = G(S + D.magBaseProtrusion / 2, 0.0455);
    mb.add(box(0.0200, D.magBaseProtrusion, 0.0030, 0, ly, -lf, -D.gripRakeDeg), { color: '#1c1d1f', metal: 0, rough: 0.75, name: 'baseplateLip' });
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
  const rear = new THREE.Object3D(); rear.name = 'rear'; rear.position.set(0, D.sightTop - 0.0012 - 0.0017, 0.0075);
  sights.add(front, rear); slide.add(sights);

  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, boreY, -D.slideFront); group.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.name = 'ejection'; ejection.position.set(hw, 0.0190, -0.0800);
  ejection.userData.dir = [0.85, 0.45, 0.28]; slide.add(ejection);

  const pieces = [fb, sb, bb, tb, lb, mb].flatMap((b) => b.pieces);
  const count = (re) => pieces.filter((p) => re.test(p.name)).length;
  const dims = {
    ...D, gripAxis, pieces,
    boreY, sightRear: rear.position.clone(), sightFront: front.position.clone(),
    gripRakeMeasuredDeg: rakeOfGrip,
    /** The grip's outline at height y (metres, y < 0): fB backstrap and fF front strap (forward distances), hw half width. */
    gripAt: (y) => ({ fB: fBack(y), fF: fFront(y), hw: hwAt(y) }),
    serrationGrooves: { rear: count(/^rearSerr\d+(-1|1)$/) / 2, front: count(/^frontSerr\d+(-1|1)$/) / 2 },
    anim: { slideTravel: 0.045, barrelTilt: 3 * DEG, triggerPull: -12 * DEG, magAxis: gripAxis.clone() },
    triangles: [frameGeo, slideGeo, barrelGeo, triggerGeo, slideStopGeo, magGeo].reduce((n, g) => n + g.attributes.position.count / 3, 0),
    drawCalls: 6,
  };
  return { group, parts: { slide, barrel, frame, trigger, magazine, slideStop, sights }, muzzle, ejection, dims, material };
}
