// Gloved hands for the pistol's view model: simple, hand-shaped, posed on the grip. Each hand is ONE mesh (one draw call)
// built from tapered, rounded prisms: a palm block, a thumb of two segments, fingers of three segments each, and a
// forearm with a sleeve cuff. Written from scratch; no maker's mark.
//
//   const hands = buildHands(THREE, dims);   dims from buildPistolView (it gives `gripAt(y)`, the grip's outline at a height)
//   hands.right    firing hand: wrapped high on the grip, thumb forward on the left of the frame, the trigger finger
//                  straight along the right of the frame; `setFire(0..1)` curls that finger onto the trigger (a morph
//                  target in the vertex shader: the finger has its straight and its curled position in one mesh)
//   hands.left     support hand: its palm on the left of the grip, fingers over the firing hand's fingers on the front
//                  strap, thumb forward along the frame above the right thumb
//   hands.dims     { triangles: { right, left, total } }
//
// Space: the pistol group's (metres; +x right, +y up, -z forward; the origin is the top of the backstrap).
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const HAND_COLOURS = Object.freeze({ glove: '#4a4733', knuckle: '#3d3b2b', sleeve: '#2f352b', cuff: '#3b4235' });

export function buildHands(THREE, dims) {
  const { Vector3, Color, BufferGeometry, Float32BufferAttribute } = THREE;
  const grip = dims.gripAt;

  // ---- limbs: a chain of octagonal sections along a path; w across, h up (or along the second axis) at each node ----
  const OCT = [[1, 0.5], [0.5, 1], [-0.5, 1], [-1, 0.5], [-1, -0.5], [-0.5, -1], [0.5, -1], [1, -0.5]];
  function chain(nodes, up = [0, 1, 0]) { // nodes: [{ p: [x, y, z], w, h, color }]
    const rings = nodes.map((n, i) => {
      const a = new Vector3(...nodes[Math.max(0, i - 1)].p), b = new Vector3(...nodes[Math.min(nodes.length - 1, i + 1)].p);
      const t = b.sub(a).normalize(), upv = new Vector3(...up);
      let s = new Vector3().crossVectors(upv, t); if (s.lengthSq() < 1e-6) s = new Vector3(1, 0, 0);
      s.normalize(); const u = new Vector3().crossVectors(t, s).normalize();
      return OCT.map(([x, y]) => new Vector3(...n.p).addScaledVector(s, x * n.w).addScaledVector(u, y * n.h));
    });
    return { rings, colors: nodes.map((n) => n.color), t0: new Vector3(...nodes[1].p).sub(new Vector3(...nodes[0].p)).normalize(), t1: new Vector3(...nodes[nodes.length - 1].p).sub(new Vector3(...nodes[nodes.length - 2].p)).normalize() };
  }

  // A hand is built twice when it has a morphing part: `alt` is the same topology with the curled finger.
  function assemble(limbsA, limbsB) {
    const posA = [], posB = [], col = [], idx = [];
    limbsA.forEach((L, li) => {
      const M = limbsB ? limbsB[li] : L, base = posA.length / 3, n = L.rings.length, k = OCT.length;
      for (let r = 0; r < n; r++) for (let j = 0; j < k; j++) {
        const c = new Color(L.colors[r]); col.push(c.r, c.g, c.b);
        posA.push(L.rings[r][j].x, L.rings[r][j].y, L.rings[r][j].z); posB.push(M.rings[r][j].x, M.rings[r][j].y, M.rings[r][j].z);
      }
      for (let r = 0; r < n - 1; r++) for (let j = 0; j < k; j++) {
        const a = base + r * k + j, b = base + r * k + (j + 1) % k, c = base + (r + 1) * k + (j + 1) % k, d = base + (r + 1) * k + j;
        idx.push(a, b, c, a, c, d);
      }
      // two end caps: a fan round a centre point (their own vertices, so the end is flat-shaded)
      for (const [r, flip] of [[0, true], [n - 1, false]]) {
        const cA = new Vector3(), cB = new Vector3();
        for (let j = 0; j < k; j++) { cA.add(L.rings[r][j]); cB.add(M.rings[r][j]); }
        cA.divideScalar(k); cB.divideScalar(k);
        const cb = posA.length / 3, cc = new Color(L.colors[r]);
        posA.push(cA.x, cA.y, cA.z); posB.push(cB.x, cB.y, cB.z); col.push(cc.r, cc.g, cc.b);
        for (let j = 0; j < k; j++) {
          const a = base + r * k + j, b = base + r * k + (j + 1) % k;
          idx.push(...(flip ? [cb, b, a] : [cb, a, b]));
        }
      }
    });
    const geoOf = (pos) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
    const gA = geoOf(posA), gB = limbsB ? geoOf(posB) : null;
    gA.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (gB) { gA.setAttribute('aAlt', gB.attributes.position); gA.setAttribute('aAltN', gB.attributes.normal); }
    gA.computeBoundingBox(); gA.computeBoundingSphere();
    return gA;
  }

  const G = HAND_COLOURS;
  const nd = (p, w, h, color = G.glove) => ({ p, w, h, color });
  const rho = 0.0072;                                  // a finger's centre line stands this far off the grip

  /** A finger that wraps the front strap at height y, from the right (dir +1) or from the left (dir -1), `lift` further out. */
  function wrapFinger(y, dir, lift = 0, size = 1, h = 0.0082) {
    const { fF, hw } = grip(y), r = rho + lift, k = size;
    const X = (x) => dir * x, w = 0.0070 * k;
    return chain([
      nd([X(hw + r), y, -(fF - 0.0160)], w * 1.05, h * k, G.glove),
      nd([X(hw + r * 0.80), y, -(fF + r * 0.60)], w, h * k, G.glove),
      nd([X(hw * 0.30), y, -(fF + r + 0.0010)], w * 0.95, h * k * 0.97, G.glove),
      nd([X(-hw * 0.80), y, -(fF + r * 0.55)], w * 0.80, h * k * 0.92, G.knuckle),
    ]);
  }
  /** A thumb along the left side of the frame (two segments), at height y. */
  const thumb = (y, x, f0, f1, f2, k = 1) => chain([
    nd([x + 0.0020, y - 0.0020, -f0], 0.0075 * k, 0.0078 * k), nd([x, y, -f1], 0.0070 * k, 0.0072 * k), nd([x, y + 0.0005, -f2], 0.0058 * k, 0.0062 * k, G.knuckle),
  ]);
  /** The forearm from a wrist point out along `dir`: glove, then a sleeve with its cuff. */
  function forearm(wrist, dir, k = 1) {
    const d = new Vector3(...dir).normalize(), at = (m) => [wrist[0] + d.x * m, wrist[1] + d.y * m, wrist[2] + d.z * m];
    return chain([
      nd(at(0), 0.0250 * k, 0.0215 * k, G.glove), nd(at(0.040), 0.0265 * k, 0.0235 * k, G.glove), nd(at(0.058), 0.0300 * k, 0.0265 * k, G.cuff),
      nd(at(0.070), 0.0330 * k, 0.0290 * k, G.sleeve), nd(at(0.170), 0.0370 * k, 0.0330 * k, G.sleeve), nd(at(0.300), 0.0400 * k, 0.0360 * k, G.sleeve),
    ], [0, 1, 0]);
  }

  // ---- the firing hand ------------------------------------------------------------------------------------------------
  const yIdx = -0.0090;
  const index = (curl) => curl
    ? chain([nd([0.0205, yIdx, -0.0400], 0.0072, 0.0082), nd([0.0183, -0.0130, -0.0625], 0.0066, 0.0076), nd([0.0085, -0.0205, -0.0670], 0.0060, 0.0068), nd([0.0010, -0.0262, -0.0690], 0.0050, 0.0058, G.knuckle)])
    : chain([nd([0.0205, yIdx, -0.0400], 0.0072, 0.0082), nd([0.0205, yIdx, -0.0680], 0.0066, 0.0076), nd([0.0205, yIdx, -0.0885], 0.0060, 0.0068), nd([0.0205, yIdx, -0.1060], 0.0050, 0.0058, G.knuckle)]);
  const rightLimbs = (curl) => [
    // the palm: down the back and the right of the grip, the web high under the slide
    chain([nd([0.0140, -0.0135, 0.0020], 0.0150, 0.0230), nd([0.0200, -0.0350, 0.0050], 0.0140, 0.0245), nd([0.0215, -0.0620, 0.0070], 0.0135, 0.0245), nd([0.0185, -0.0830, 0.0140], 0.0120, 0.0210)], [0, 0, -1]),
    wrapFinger(-0.0585, +1, 0.0, 1.0), wrapFinger(-0.0765, +1, 0.0, 0.96), wrapFinger(-0.0925, +1, 0.0, 0.88, 0.0078),
    thumb(-0.0225, -0.0215, 0.0040, 0.0330, 0.0600),
    index(curl),
    forearm([0.0140, -0.0130, 0.0130], [0.20, -1.0, 0.8], 0.8),
  ];
  // ---- the support hand -------------------------------------------------------------------------------------------------
  const leftLimbs = () => [
    chain([nd([-0.0215, -0.0430, -0.0100], 0.0125, 0.0225), nd([-0.0235, -0.0650, -0.0090], 0.0125, 0.0230), nd([-0.0200, -0.0850, -0.0020], 0.0110, 0.0200)], [0, 0, -1]),
    wrapFinger(-0.0535, -1, 0.0145, 1.0), wrapFinger(-0.0715, -1, 0.0145, 1.0), wrapFinger(-0.0885, -1, 0.0145, 0.94), wrapFinger(-0.1040, -1, 0.0145, 0.86, 0.0075),
    thumb(-0.0085, -0.0235, 0.0150, 0.0420, 0.0700, 1.05),
    forearm([-0.0230, -0.0560, 0.0200], [-0.30, -0.50, 1.0], 0.85),
  ];

  // ---- the materials: both hands share the colours; the firing hand's material morphs the trigger finger ----------------
  const uFire = { value: 0 };
  const rightMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  rightMat.name = 'glove_right';
  rightMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFire = uFire;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aAlt; attribute vec3 aAltN; uniform float uFire;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, aAltN, uFire));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = mix(position, aAlt, uFire);');
  };
  rightMat.customProgramCacheKey = () => 'opus-glove-fire';
  const leftMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  leftMat.name = 'glove_left';

  const rightGeo = assemble(rightLimbs(false), rightLimbs(true)), leftGeo = assemble(leftLimbs());
  const right = new THREE.Mesh(rightGeo, rightMat); right.name = 'hand-right';
  const left = new THREE.Mesh(leftGeo, leftMat); left.name = 'hand-left';
  const tri = (g) => g.index.count / 3;
  return {
    right, left,
    /** 0 = the trigger finger straight along the frame; 1 = on the trigger. */
    setFire(v) { uFire.value = clamp01(v); },
    dims: { triangles: { right: tri(rightGeo), left: tri(leftGeo), total: tri(rightGeo) + tri(leftGeo) }, drawCalls: 2 },
  };
}
