import {
  AddEquation,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  ZeroFactor,
} from '../../vendor/three.module.js';
import { Af, Bb, Gc, H1, Hb, Mv, Ob, SKY, SUN, V1, W1, Wc, _v, bv, da, n0, oo } from '../shared/lifted.js';

export var HR = `
attribute vec4 aPos;    // xyz centre, w size (m)
attribute vec4 aAxis;   // mode 1: stretch axis (length = streak length); mode 2: plane normal; w = roll (rad)
attribute vec4 aCol;    // rgb (HDR), a
attribute vec4 aMisc;   // x atlas frame, y mode (0 billboard, 1 velocity-stretched, 2 surface-aligned), z age 0..1, w sun visibility
uniform vec2 uAtlas;
uniform float uPx;      // world size of one pixel at distance 1
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;     // view z, age, shade
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
void main() {
  vec2 c = position.xy;
  vec3 center = aPos.xyz; float size = aPos.w; float mode = aMisc.y;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 toCam = cameraPosition - center; float dist = length(toCam); toCam /= max(dist, 1e-4);
  float sn = sin(aAxis.w), cs = cos(aAxis.w);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  vec3 off; float comp = 1.0;
  if (mode < 0.5) {
    off = (camR * rc.x + camU * rc.y) * size;
    vT = camR * cs + camU * sn; vB = camU * cs - camR * sn;
  } else if (mode < 1.5) {
    float len = length(aAxis.xyz); vec3 d = aAxis.xyz / max(len, 1e-5);
    vec3 side = cross(d, toCam); float sl = length(side); side = sl > 1e-3 ? side / sl : camR;
    float w = max(size, dist * uPx * 1.4); comp = size / w;
    if (aMisc.w > 1.5) w = min(w, dist * uPx * aMisc.w);       // additive only: cap on-screen width (tracers near the lens)
    off = d * (c.x * max(len, w)) + side * (c.y * w);
    vT = d; vB = side;
  } else {
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(abs(n.y) > 0.9 ? cross(n, vec3(1.0, 0.0, 0.0)) : cross(vec3(0.0, 1.0, 0.0), n));
    vec3 b = cross(n, t);
    off = (t * rc.x + b * rc.y) * size;
    vT = t * cs + b * sn; vB = b * cs - t * sn;
  }
  vec4 mv = viewMatrix * vec4(center + off, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = floor(aMisc.x + 0.5);
  float col = mod(f, uAtlas.x), row = floor(f / uAtlas.x);
  vUv = (vec2(col, row) + c + 0.5) / uAtlas;
  vCol = vec4(aCol.rgb * comp, aCol.a);
  vOff = off / max(size, 1e-4);
  vToCam = toCam;
  vInfo = vec3(mv.z, aMisc.z, aMisc.w);
  vSoftD = clamp(size * 0.4, 0.04, 0.7);
}`,
  Xb = `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
float softFade() {
  float s = 1.0;
  if (uSoft > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    float zs = (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * d - uNearFar.y);
    s = clamp((vInfo.x - zs) / vSoftD, 0.0, 1.0);
  }
  return s;
}`,
  VR =
    Xb +
    `
uniform vec3 uSun, uSunDir, uAmbLo, uAmbHi;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float er = vInfo.y * 0.45;                                  // wisps erode as the puff ages
  float a = smoothstep(er, er + (vInfo.z > 1.5 ? 0.38 : 0.6), t.a) * vCol.a;   // fire lobes: denser body, crisper edge
  a *= softFade() * smoothstep(0.2, 0.9, -vInfo.x);           // soft intersection + fade right at the lens
  if (a < 0.004) discard;
  vec3 V = normalize(vToCam);
  vec3 q = vOff * 2.0; float r2 = min(dot(q, q), 1.0);
  vec3 Ns = q + V * (sqrt(1.0 - r2) * 0.9 + 0.05);            // overall sphere normal
  vec2 tn = t.rg * 2.0 - 1.0;                                 // billow normal from the flipbook
  vec3 Nb = vT * tn.x + vB * tn.y + V * sqrt(max(1.0 - dot(tn, tn), 0.0));
  vec3 N = normalize(Ns * 0.55 + Nb);
  float wrap = clamp((dot(N, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 5.0);   // looking into the sun: forward scatter through thin edges
  float thin = 1.0 - t.b * smoothstep(0.0, 0.5, a);
  float hot = step(1.5, vInfo.z), shade = vInfo.z - 2.0 * hot;      // aMisc.w >= 2: emissive fire lobe (colour = emission)
  vec3 sun = uSun * (wrap * wrap * 0.85 + back * (0.15 + 1.3 * thin)) * shade;
  vec3 amb = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5) * (1.0 - 0.35 * t.b);
  vec3 col = vCol.rgb * (amb + sun);
  if (hot > 0.5) {
    // alpha-blended fire: hot dense cores, dim orange skin, soot underneath. Because it is NOT additive, overlapping lobes
    // keep their shape and smoke in front can occlude them.
    float lump = clamp(dot(tn, vec2(0.6, 0.8)) * 0.6 + 0.5, 0.0, 1.0);
    float core = t.b * t.b * smoothstep(0.15, 0.9, t.a);
    vec3 fire = vCol.rgb * (0.10 + 1.7 * core) * (0.45 + 1.1 * lump);
    col = vec3(0.045, 0.042, 0.04) * (amb + sun) + fire;
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;                         // premultiply after the (possibly no-op) output transform
}`,
  WR =
    Xb +
    `
void main() {
  float t = texture2D(uTex, vUv).r;
  float k = t * vCol.a * softFade();
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  Vb = new Vector2();
export function Ev(i, e, { lit: t, tex: n, cols: s, rows: o, renderOrder: r, sun: a, sunDir: l, ambLo: c, ambHi: u }) {
  let h = new InstancedBufferGeometry();
  (h.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
  ),
    h.setIndex([0, 1, 2, 0, 2, 3]));
  let f = (S) => {
      let z = new InstancedBufferAttribute(new Float32Array(e * 4), 4);
      return (z.setUsage(DynamicDrawUsage), h.setAttribute(S, z), z);
    },
    p = f('aPos'),
    d = f('aAxis'),
    v = f('aCol'),
    g = f('aMisc');
  h.instanceCount = 0;
  let x = {
    uTex: { value: n },
    uAtlas: { value: new Vector2(s, o) },
    uPx: { value: 0.001 },
    uDepth: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uNearFar: { value: new Vector2(0.08, 900) },
    uSoft: { value: 0 },
  };
  t && Object.assign(x, { uSun: { value: a }, uSunDir: { value: l }, uAmbLo: { value: c }, uAmbHi: { value: u } });
  let y = new ShaderMaterial({
    uniforms: x,
    vertexShader: HR,
    fragmentShader: t ? VR : WR,
    transparent: !0,
    depthWrite: !1,
    depthTest: !0,
    side: DoubleSide,
    fog: !1,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: t ? OneMinusSrcAlphaFactor : OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  y.name = t ? 'fx_lit' : 'fx_add';
  let b = new Mesh(h, y);
  ((b.frustumCulled = !1),
    (b.renderOrder = r),
    (b.castShadow = !1),
    (b.receiveShadow = !1),
    (b.matrixAutoUpdate = !1),
    (b.name = y.name),
    (b.onBeforeRender = (S, z, H) => {
      let O = S.getRenderTarget(),
        q;
      O ? (q = O.height) : (S.getDrawingBufferSize(Vb), (q = Vb.y));
      let U = H.projectionMatrix.elements;
      x.uPx.value = 2 / (Math.max(U[5], 0.001) * Math.max(q, 1));
      let T = i.render,
        D = T && T.depthTexture;
      D && D.image && H === i.camera && T.depthTextureIsLive !== !0 && i.params.fxsoft !== '0'
        ? ((x.uDepth.value = D),
          (x.uSoft.value = 1),
          T.resolution && T.resolution.x > 0
            ? x.uRes.value.set(T.resolution.x, T.resolution.y)
            : x.uRes.value.set(D.image.width || 1, D.image.height || 1),
          x.uNearFar.value.set(H.near, H.far))
        : ((x.uDepth.value = null), (x.uSoft.value = 0));
    }));
  let m = p.array,
    A = d.array,
    _ = v.array,
    M = g.array,
    E = {
      mesh: b,
      cap: e,
      n: 0,
      P: m,
      A,
      C: _,
      M,
      begin() {
        E.n = 0;
      },
      push(S, z, H, O, q, U, T, D, C, G, j, N, Q, K, ie, F) {
        let X = E.n;
        if (X >= e) return !1;
        let ne = X * 4;
        return (
          (m[ne] = S),
          (m[ne + 1] = z),
          (m[ne + 2] = H),
          (m[ne + 3] = O),
          (A[ne] = q),
          (A[ne + 1] = U),
          (A[ne + 2] = T),
          (A[ne + 3] = D),
          (_[ne] = C),
          (_[ne + 1] = G),
          (_[ne + 2] = j),
          (_[ne + 3] = N),
          (M[ne] = Q),
          (M[ne + 1] = K),
          (M[ne + 2] = ie),
          (M[ne + 3] = F),
          (E.n = X + 1),
          !0
        );
      },
      end: null,
    },
    w = [p, d, v, g];
  return (
    (E.end = () => {
      let S = E.n;
      if (((h.instanceCount = S), (b.visible = S > 0), !!S))
        for (let z = 0; z < 4; z++) {
          let H = w[z];
          (H.clearUpdateRanges(), H.addUpdateRange(0, S * 4), (H.needsUpdate = !0));
        }
    }),
    E
  );
}
export var qc = 1,
  Xc = 2,
  GR = 4,
  Rf = class {
    constructor(e, t) {
      ((this.cap = e), (this.sorted = t), (this.n = 0), (this.freeTop = e));
      let n = () => new Float32Array(e);
      ((this.px = n()),
        (this.py = n()),
        (this.pz = n()),
        (this.vx = n()),
        (this.vy = n()),
        (this.vz = n()),
        (this.age = n()),
        (this.life = n()),
        (this.s0 = n()),
        (this.s1 = n()),
        (this.sk = n()),
        (this.rot = n()),
        (this.rotv = n()),
        (this.r = n()),
        (this.g = n()),
        (this.b = n()),
        (this.a = n()),
        (this.drag = n()),
        (this.grav = n()),
        (this.wind = n()),
        (this.turb = n()),
        (this.seed = n()),
        (this.fin = n()),
        (this.fout = n()),
        (this.stretch = n()),
        (this.shade = n()),
        (this.key = n()),
        (this.gy = n()),
        (this.frame = new Uint8Array(e)),
        (this.mode = new Uint8Array(e)),
        (this.flags = new Uint8Array(e)),
        (this.ramp = new Uint8Array(e)),
        (this.order = new Uint16Array(e)),
        (this.free = new Uint16Array(e)));
      for (let s = 0; s < e; s++) this.free[s] = e - 1 - s;
    }
    clear() {
      ((this.n = 0), (this.freeTop = this.cap));
      for (let e = 0; e < this.cap; e++) this.free[e] = this.cap - 1 - e;
    }
    emit(e, t, n, s, o, r, a, l, c) {
      if (this.freeTop === 0) return -1;
      let u = this.free[--this.freeTop];
      return (
        (this.order[this.n++] = u),
        (this.px[u] = e),
        (this.py[u] = t),
        (this.pz[u] = n),
        (this.vx[u] = s),
        (this.vy[u] = o),
        (this.vz[u] = r),
        (this.age[u] = -1),
        (this.life[u] = a),
        (this.s0[u] = l),
        (this.s1[u] = c),
        (this.sk[u] = 2),
        (this.rot[u] = 0),
        (this.rotv[u] = 0),
        (this.r[u] = 1),
        (this.g[u] = 1),
        (this.b[u] = 1),
        (this.a[u] = 1),
        (this.drag[u] = 0),
        (this.grav[u] = 0),
        (this.wind[u] = 0),
        (this.turb[u] = 0),
        (this.seed[u] = Math.random() * 100),
        (this.fin[u] = 0),
        (this.fout[u] = 0.5),
        (this.stretch[u] = 0.02),
        (this.shade[u] = 1),
        (this.key[u] = 0),
        (this.gy[u] = 0),
        (this.frame[u] = 0),
        (this.mode[u] = 0),
        (this.flags[u] = 0),
        (this.ramp[u] = 0),
        u
      );
    }
    update(e, t, n, s, o) {
      let { px: r, py: a, pz: l, vx: c, vy: u, vz: h, age: f, life: p, order: d, flags: v } = this,
        g = n.x,
        x = n.y,
        y = n.z,
        b = 0,
        m = this.n;
      for (let A = 0; A < m; A++) {
        let _ = d[A];
        if (f[_] < 0) f[_] = 0;
        else {
          if (((f[_] += e), f[_] >= p[_])) {
            this.free[this.freeTop++] = _;
            continue;
          }
          let M = 1 - Math.exp(-this.drag[_] * e),
            E = this.wind[_];
          ((c[_] += (s.x * E - c[_]) * M),
            (u[_] += (s.y * E - u[_]) * M),
            (h[_] += (s.z * E - h[_]) * M),
            (u[_] -= this.grav[_] * e));
          let w = this.turb[_];
          if (w > 0) {
            let H = this.seed[_];
            ((c[_] += Math.sin(a[_] * 2.3 + H + o * 1.7) * w * e),
              (h[_] += Math.cos(r[_] * 1.9 + H * 1.3 + o * 1.3) * w * e),
              (u[_] += Math.sin(l[_] * 2.1 + H * 0.7 + o * 2.1) * w * 0.4 * e));
          }
          ((r[_] += c[_] * e), (a[_] += u[_] * e), (l[_] += h[_] * e), (this.rot[_] += this.rotv[_] * e));
          let S = v[_],
            z = this.gy[_] + 0.012;
          if (S && a[_] < z) {
            if (S & Xc) {
              this.free[this.freeTop++] = _;
              continue;
            }
            S & qc
              ? ((a[_] = z),
                u[_] < 0 && ((u[_] = -u[_] * (0.25 + (this.seed[_] % 1) * 0.3)), (c[_] *= 0.65), (h[_] *= 0.65)))
              : S & GR && ((a[_] = z), (c[_] = u[_] = h[_] = 0));
          }
        }
        if (this.sorted) {
          let M = r[_] - g,
            E = a[_] - x,
            w = l[_] - y;
          this.key[_] = M * M + E * E + w * w;
        }
        d[b++] = _;
      }
      if (((this.n = b), this.sorted && b > 1)) {
        let A = this.key;
        for (let _ = 1; _ < b; _++) {
          let M = d[_],
            E = A[M],
            w = _ - 1;
          for (; w >= 0 && A[d[w]] < E; ) ((d[w + 1] = d[w]), w--);
          d[w + 1] = M;
        }
      }
      for (let A = 0; A < b; A++) {
        let _ = d[A],
          M = f[_] / p[_],
          E = 1 - M,
          w = 1 - Math.pow(E, this.sk[_]),
          S = this.s0[_] + (this.s1[_] - this.s0[_]) * w,
          z = this.a[_],
          H = this.fin[_],
          O = this.fout[_];
        if ((H > 0 && M < H && (z *= M / H), M > O)) {
          let Q = 1 - (M - O) / (1 - O);
          z *= Q * Q * (3 - 2 * Q);
        }
        let q = this.r[_],
          U = this.g[_],
          T = this.b[_],
          D = this.ramp[_];
        if (D === 1) ((q *= Math.pow(E, 0.5)), (U *= Math.pow(E, 1.4)), (T *= Math.pow(E, 3)));
        else if (D === 2) {
          let Q = 1 - Math.pow(M, 1.6),
            K = Q * Math.sqrt(Q);
          ((q *= K), (U *= (0.22 + 0.78 * Math.pow(Q, 1.3)) * K), (T *= (0.04 + 0.96 * Math.pow(Q, 3.5)) * K));
        } else if (D === 3) {
          let Q = 0.55 + 0.45 * Math.sin(o * 17 + this.seed[_] * 9);
          ((q *= Q), (U *= Q * (0.6 + 0.4 * E)), (T *= Q * E));
        }
        let C = this.mode[_],
          G = 0,
          j = 1,
          N = 0;
        if (C === 1) {
          let Q = this.stretch[_];
          ((G = c[_] * Q), (j = u[_] * Q), (N = h[_] * Q));
        }
        if (!t.push(r[_], a[_], l[_], S, G, j, N, this.rot[_], q, U, T, z, this.frame[_], C, M, this.shade[_])) break;
      }
    }
  },
  q1 = class {
    constructor(e = 48) {
      ((this.cap = e), (this.n = 0));
      let t = () => new Float32Array(e);
      ((this.fx = t()),
        (this.fy = t()),
        (this.fz = t()),
        (this.dx = t()),
        (this.dy = t()),
        (this.dz = t()),
        (this.dist = t()),
        (this.speed = t()),
        (this.trav = t()),
        (this.len = t()),
        (this.width = t()),
        (this.r = t()),
        (this.g = t()),
        (this.b = t()),
        (this.frames = new Uint8Array(e)));
    }
    clear() {
      this.n = 0;
    }
    add(e, t, n, s, o, r, a) {
      let l = this.n;
      l >= this.cap ? (l = 0) : this.n++;
      let c = t.x - e.x,
        u = t.y - e.y,
        h = t.z - e.z,
        f = Math.sqrt(c * c + u * u + h * h);
      if (f < 0.001) {
        l === this.n - 1 && this.n--;
        return;
      }
      ((this.fx[l] = e.x),
        (this.fy[l] = e.y),
        (this.fz[l] = e.z),
        (this.dx[l] = c / f),
        (this.dy[l] = u / f),
        (this.dz[l] = h / f),
        (this.dist[l] = f),
        (this.speed[l] = r),
        (this.trav[l] = 0),
        (this.len[l] = Math.min(Math.max(r * 0.022, 2), 7)),
        (this.width[l] = a),
        (this.r[l] = n),
        (this.g[l] = s),
        (this.b[l] = o),
        (this.frames[l] = 0));
    }
    update(e, t, n, s) {
      let o = this.n;
      for (let r = 0; r < o; r++) {
        let a = this.speed[r],
          l = this.dist[r],
          c = this.len[r];
        this.frames[r] === 0
          ? (this.trav[r] = Math.min(l, a * Math.max(e, 0.008) * (0.35 + Math.random() * 0.4)))
          : (this.trav[r] += a * e);
        let u = Math.min(this.trav[r], l),
          h = Math.max(0, this.trav[r] - c);
        if (h >= l) {
          if (this.frames[r] >= 2) {
            if ((o--, r !== o)) {
              for (let E of qR) this[E][r] = this[E][o];
              this.frames[r] = this.frames[o];
            }
            r--;
            continue;
          }
          ((h = Math.max(0, l - c * 0.5)), (u = l));
        }
        this.frames[r] = Math.min(250, this.frames[r] + 1);
        let f = (u + h) * 0.5,
          p = Math.max(u - h, 0.05),
          d = this.dx[r],
          v = this.dy[r],
          g = this.dz[r],
          x = this.width[r],
          y = this.fx[r] + d * f,
          b = this.fy[r] + v * f,
          m = this.fz[r] + g * f,
          A = this.r[r],
          _ = this.g[r],
          M = this.b[r];
        (t.push(y, b, m, x, d * p, v * p, g * p, 0, A, _, M, 1, n, 1, 0, 5),
          t.push(
            y,
            b,
            m,
            x * 6,
            d * p * 1.05,
            v * p * 1.05,
            g * p * 1.05,
            0,
            A * 0.04,
            _ * 0.032,
            M * 0.028,
            1,
            n,
            1,
            0,
            28,
          ),
          t.push(
            this.fx[r] + d * u,
            this.fy[r] + v * u,
            this.fz[r] + g * u,
            x * 5,
            0,
            1,
            0,
            0,
            A * 0.2,
            _ * 0.16,
            M * 0.12,
            1,
            s,
            0,
            0,
            1,
          ));
      }
      this.n = o;
    }
  },
  qR = ['fx', 'fy', 'fz', 'dx', 'dy', 'dz', 'dist', 'speed', 'trav', 'len', 'width', 'r', 'g', 'b'],
  ws = new Matrix4(),
  Oo = new Quaternion(),
  X1 = new Vector3(),
  Y1 = new Vector3(),
  Wb = new Vector3();
export function XR() {
  let i = new BoxGeometry(1, 1, 1, 2, 1, 2),
    e = i.attributes.position,
    t = 1234.5,
    n = () => ((t = Math.sin(t * 12.9898 + 78.233) * 43758.5453), (t -= Math.floor(t)), t),
    s = new Map();
  for (let o = 0; o < e.count; o++) {
    let r = e.getX(o).toFixed(3) + ',' + e.getY(o).toFixed(3) + ',' + e.getZ(o).toFixed(3),
      a = s.get(r);
    if (!a) {
      let l = e.getX(o),
        c = e.getY(o),
        u = e.getZ(o),
        f = Math.abs(l) > 0.49 && Math.abs(u) > 0.49 ? 0.72 + n() * 0.2 : 1;
      ((l = l * f + (n() - 0.5) * 0.14),
        (u = u * f + (n() - 0.5) * 0.14),
        (c = c * (0.8 + n() * 0.3) + (n() - 0.5) * 0.1),
        (a = [l, c, u]),
        s.set(r, a));
    }
    e.setXYZ(o, a[0], a[1], a[2]);
  }
  return ((i = i.toNonIndexed()), i.computeVertexNormals(), i);
}
export var $1 = class {
    constructor(e, t = 256) {
      ((this.G = e), (this.cap = t), (this.next = 0), (this.live = 0));
      let n = new MeshStandardMaterial({ color: 16777215, roughness: 0.82, metalness: 0.05 });
      n.name = 'fx_debris';
      let s = (this.mesh = new InstancedMesh(XR(), n, t));
      (s.instanceMatrix.setUsage(DynamicDrawUsage),
        (s.instanceColor = new InstancedBufferAttribute(new Float32Array(t * 3).fill(1), 3)),
        (s.frustumCulled = !1),
        (s.castShadow = !1),
        (s.receiveShadow = !0),
        (s.name = 'fx_debris'));
      let o = () => new Float32Array(t);
      ((this.px = o()),
        (this.py = o()),
        (this.pz = o()),
        (this.vx = o()),
        (this.vy = o()),
        (this.vz = o()),
        (this.ax = o()),
        (this.ay = o()),
        (this.az = o()),
        (this.ang = o()),
        (this.spin = o()),
        (this.sx = o()),
        (this.sy = o()),
        (this.sz = o()),
        (this.age = o()),
        (this.life = o()),
        (this.floor = o()),
        (this.state = new Uint8Array(t)),
        ws.makeScale(0, 0, 0));
      for (let r = 0; r < t; r++) ws.toArray(s.instanceMatrix.array, r * 16);
      s.visible = !1;
    }
    clear() {
      (this.state.fill(0), ws.makeScale(0, 0, 0));
      for (let e = 0; e < this.cap; e++) ws.toArray(this.mesh.instanceMatrix.array, e * 16);
      ((this.mesh.instanceMatrix.needsUpdate = !0), (this.live = 0), (this.mesh.visible = !1));
    }
    add(e, t, n, s, o, r, a, l, c, u, h, f, p, d) {
      let v = this.next;
      ((this.next = (v + 1) % this.cap),
        (this.px[v] = e),
        (this.py[v] = t),
        (this.pz[v] = n),
        (this.vx[v] = s),
        (this.vy[v] = o),
        (this.vz[v] = r));
      let g = Math.random() - 0.5,
        x = Math.random() - 0.5,
        y = Math.random() - 0.5,
        b = Math.hypot(g, x, y) || 1;
      ((this.ax[v] = g / b),
        (this.ay[v] = x / b),
        (this.az[v] = y / b),
        (this.ang[v] = Math.random() * 6.28),
        (this.spin[v] = (Math.random() - 0.5) * 50),
        (this.sx[v] = a),
        (this.sy[v] = l),
        (this.sz[v] = c),
        (this.age[v] = 0),
        (this.life[v] = p),
        (this.floor[v] = d),
        (this.state[v] = 1));
      let m = this.mesh.instanceColor.array;
      ((m[v * 3] = u), (m[v * 3 + 1] = h), (m[v * 3 + 2] = f), (this.mesh.instanceColor.needsUpdate = !0));
    }
    update(e) {
      let t = this.state,
        n = this.mesh.instanceMatrix.array,
        s = 0,
        o = !1;
      for (let r = 0; r < this.cap; r++) {
        let a = t[r];
        if (!a) continue;
        this.age[r] += e;
        let l = this.life[r] - this.age[r];
        if (l <= 0) {
          ((t[r] = 0), ws.makeScale(0, 0, 0), ws.toArray(n, r * 16), (o = !0));
          continue;
        }
        if ((s++, a === 2 && l > 0.5)) continue;
        if (a === 1) {
          ((this.vy[r] -= 9.81 * e),
            (this.px[r] += this.vx[r] * e),
            (this.py[r] += this.vy[r] * e),
            (this.pz[r] += this.vz[r] * e),
            (this.ang[r] += this.spin[r] * e));
          let u = this.floor[r] + Math.min(this.sx[r], this.sy[r], this.sz[r]) * 0.5;
          this.py[r] < u &&
            this.vy[r] < 0 &&
            ((this.py[r] = u),
            this.vy[r] > -1.2
              ? ((t[r] = 2), (this.vx[r] = this.vy[r] = this.vz[r] = 0))
              : ((this.vy[r] = -this.vy[r] * 0.32), (this.vx[r] *= 0.55), (this.vz[r] *= 0.55), (this.spin[r] *= 0.5)));
        }
        let c = l < 0.5 ? l / 0.5 : 1;
        (Wb.set(this.ax[r], this.ay[r], this.az[r]),
          Oo.setFromAxisAngle(Wb, this.ang[r]),
          X1.set(this.px[r], this.py[r], this.pz[r]),
          Y1.set(this.sx[r] * c, this.sy[r] * c, this.sz[r] * c),
          ws.compose(X1, Oo, Y1),
          ws.toArray(n, r * 16),
          (o = !0));
      }
      ((this.live = s), (this.mesh.visible = s > 0), o && (this.mesh.instanceMatrix.needsUpdate = !0));
    }
  },
  wv = { pos: new Vector3(), surface: 'concrete' },
  YR = new Vector3(0, -1, 0),
  Gb = new Vector3(),
  qb = new Quaternion(),
  G1 = new Euler();
export function $R() {
  let t = [
      [0, 0],
      [0.006076, 0],
      [0.0062, 0.0012],
      [0.005083999999999999, 0.0022],
      [0.005083999999999999, 0.0034],
      [0.006013999999999999, 0.0046],
      [0.005889999999999999, 0.036399999999999995],
      [0.004092, 0.0416],
      [0.003968, 0.052],
      [0.003224, 0.052],
      [0.0031, 0.044719999999999996],
    ],
    n = new LatheGeometry(
      t.map((s) => new Vector2(s[0], s[1] - 0.052 / 2)),
      10,
    );
  return (n.computeVertexNormals(), n);
}
export var Z1 = class {
  constructor(e, t = 60) {
    ((this.G = e), (this.cap = t), (this.next = 0));
    let n;
    try {
      n = e.mats.get('brass');
    } catch {
      n = null;
    }
    (!n || !n.isMaterial) && (n = new MeshStandardMaterial({ color: 11570492, roughness: 0.3, metalness: 1 }));
    let s = (this.mesh = new InstancedMesh($R(), n, t));
    (s.instanceMatrix.setUsage(DynamicDrawUsage),
      (s.frustumCulled = !1),
      (s.castShadow = !1),
      (s.receiveShadow = !0),
      (s.name = 'fx_shells'));
    let o = () => new Float32Array(t);
    ((this.px = o()),
      (this.py = o()),
      (this.pz = o()),
      (this.vx = o()),
      (this.vy = o()),
      (this.vz = o()),
      (this.qx = o()),
      (this.qy = o()),
      (this.qz = o()),
      (this.qw = o().fill(1)),
      (this.wx = o()),
      (this.wy = o()),
      (this.wz = o()),
      (this.age = o()),
      (this.rest = o()),
      (this.floor = o()),
      (this.state = new Uint8Array(t)),
      (this.bounces = new Uint8Array(t)),
      ws.makeScale(0, 0, 0));
    for (let r = 0; r < t; r++) ws.toArray(s.instanceMatrix.array, r * 16);
    ((s.visible = !1), (this.surface = new Array(t).fill('concrete')));
  }
  clear() {
    (this.state.fill(0), ws.makeScale(0, 0, 0));
    for (let e = 0; e < this.cap; e++) ws.toArray(this.mesh.instanceMatrix.array, e * 16);
    ((this.mesh.instanceMatrix.needsUpdate = !0), (this.mesh.visible = !1));
  }
  _floorAt(e) {
    let t = this.G.physics;
    if (((this.floor[e] = 0), (this.surface[e] = 'concrete'), t && t.raycast)) {
      Gb.set(this.px[e], this.py[e] + 0.25, this.pz[e]);
      let n = t.raycast(Gb, YR, 6);
      n ? ((this.floor[e] = n.point.y), (this.surface[e] = n.surface || 'concrete')) : (this.floor[e] = -50);
    }
  }
  add(e, t) {
    let n = this.next;
    ((this.next = (n + 1) % this.cap),
      (this.px[n] = e.x),
      (this.py[n] = e.y),
      (this.pz[n] = e.z),
      (this.vx[n] = t.x),
      (this.vy[n] = t.y),
      (this.vz[n] = t.z),
      G1.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28),
      Oo.setFromEuler(G1),
      (this.qx[n] = Oo.x),
      (this.qy[n] = Oo.y),
      (this.qz[n] = Oo.z),
      (this.qw[n] = Oo.w),
      (this.wx[n] = (Math.random() - 0.5) * 40),
      (this.wy[n] = (Math.random() - 0.5) * 20),
      (this.wz[n] = (Math.random() - 0.5) * 40),
      (this.age[n] = 0),
      (this.rest[n] = 0),
      (this.state[n] = 1),
      (this.bounces[n] = 0),
      this._floorAt(n));
  }
  update(e) {
    let t = this.state,
      n = this.mesh.instanceMatrix.array,
      s = 0,
      o = !1;
    for (let r = 0; r < this.cap; r++) {
      let a = t[r];
      if (!a) continue;
      (s++, (this.age[r] += e));
      let l = 1;
      if (a === 1) {
        ((this.vy[r] -= 9.81 * e),
          (this.px[r] += this.vx[r] * e),
          (this.py[r] += this.vy[r] * e),
          (this.pz[r] += this.vz[r] * e));
        let c = this.wx[r],
          u = this.wy[r],
          h = this.wz[r],
          f = this.qx[r],
          p = this.qy[r],
          d = this.qz[r],
          v = this.qw[r],
          g = 0.5 * e,
          x = f + g * (c * v + u * d - h * p),
          y = p + g * (u * v + h * f - c * d),
          b = d + g * (h * v + c * p - u * f),
          m = v - g * (c * f + u * p + h * d),
          A = 1 / (Math.hypot(x, y, b, m) || 1);
        ((this.qx[r] = x * A), (this.qy[r] = y * A), (this.qz[r] = b * A), (this.qw[r] = m * A));
        let _ = this.floor[r] + 0.0065;
        if (this.py[r] < _ && this.vy[r] < 0) {
          this.py[r] = _;
          let M = this.bounces[r]++;
          (M < 2 &&
            (wv.pos.set(this.px[r], this.py[r], this.pz[r]),
            (wv.surface = this.surface[r]),
            this.G.events.emit('shell:bounce', wv)),
            this.vy[r] > -0.9 || M >= 4
              ? ((t[r] = 2),
                (this.vx[r] = this.vy[r] = this.vz[r] = 0),
                G1.set(Math.PI / 2, 0, Math.random() * 6.28, 'ZXY'),
                Oo.setFromEuler(G1),
                (this.qx[r] = Oo.x),
                (this.qy[r] = Oo.y),
                (this.qz[r] = Oo.z),
                (this.qw[r] = Oo.w))
              : ((this.vy[r] = -this.vy[r] * (0.32 + Math.random() * 0.16)),
                (this.vx[r] = this.vx[r] * 0.6 + (Math.random() - 0.5) * 0.6),
                (this.vz[r] = this.vz[r] * 0.6 + (Math.random() - 0.5) * 0.6),
                (this.wx[r] = (Math.random() - 0.5) * 50),
                (this.wy[r] = (Math.random() - 0.5) * 30),
                (this.wz[r] = (Math.random() - 0.5) * 50),
                M === 0 && this._floorAt(r)));
        }
        this.age[r] > 8 && (t[r] = 2);
      } else {
        if (((this.rest[r] += e), this.rest[r] < 4 && this.rest[r] > e * 1.5)) continue;
        if (this.rest[r] >= 4.7) {
          ((t[r] = 0), ws.makeScale(0, 0, 0), ws.toArray(n, r * 16), (o = !0));
          continue;
        }
        this.rest[r] >= 4 && (l = 1 - (this.rest[r] - 4) / 0.7);
      }
      (qb.set(this.qx[r], this.qy[r], this.qz[r], this.qw[r]),
        X1.set(this.px[r], this.py[r], this.pz[r]),
        Y1.set(l, l, l),
        ws.compose(X1, qb, Y1),
        ws.toArray(n, r * 16),
        (o = !0));
    }
    ((this.mesh.visible = s > 0), o && (this.mesh.instanceMatrix.needsUpdate = !0));
  }
};
export var ZR = {
    bullet_metal: 0.25,
    bullet_concrete: 0.34,
    bullet_wood: 0.24,
    scorch: 2.4,
    soot: 0.3,
    bullet_glass: 0.3,
  },
  Yb = 14,
  j1 = class {
    constructor(e, t = 160) {
      ((this.cap = t), (this.next = 0), (this.count = 0));
      let n = (this.atlas = Hb(256)),
        s = new BufferGeometry();
      ((this.pos = new BufferAttribute(new Float32Array(t * 12), 3)),
        this.pos.setUsage(DynamicDrawUsage),
        (this.nor = new BufferAttribute(new Float32Array(t * 12), 3)),
        this.nor.setUsage(DynamicDrawUsage),
        (this.uv = new BufferAttribute(new Float32Array(t * 8), 2)),
        this.uv.setUsage(DynamicDrawUsage),
        (this.col = new BufferAttribute(new Float32Array(t * 16), 4)),
        this.col.setUsage(DynamicDrawUsage),
        (this.baseA = new Float32Array(t)),
        s.setAttribute('position', this.pos),
        s.setAttribute('normal', this.nor),
        s.setAttribute('uv', this.uv),
        s.setAttribute('color', this.col));
      let o = new Uint16Array(t * 6);
      for (let l = 0; l < t; l++) {
        let c = l * 4,
          u = l * 6;
        ((o[u] = c), (o[u + 1] = c + 1), (o[u + 2] = c + 2), (o[u + 3] = c), (o[u + 4] = c + 2), (o[u + 5] = c + 3));
      }
      s.setIndex(new BufferAttribute(o, 1));
      let r = new MeshStandardMaterial({
        map: n.map,
        roughnessMap: n.orm,
        metalnessMap: n.orm,
        roughness: 1,
        metalness: 1,
        transparent: !0,
        vertexColors: !0,
        depthWrite: !1,
        polygonOffset: !0,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      (n.nrm && ((r.normalMap = n.nrm), (r.normalScale = new Vector2(1, 1))), (r.name = 'fx_decals'));
      let a = (this.mesh = new Mesh(s, r));
      ((a.frustumCulled = !1),
        (a.castShadow = !1),
        (a.receiveShadow = !0),
        (a.renderOrder = -5),
        (a.matrixAutoUpdate = !1),
        (a.name = 'fx_decals'),
        (a.visible = !1),
        (this.uvs = {}));
      for (let l in da) this.uvs[l] = da[l].map((c) => n.uv(c));
    }
    clear() {
      (this.col.array.fill(0),
        this.pos.array.fill(0),
        (this.col.needsUpdate = this.pos.needsUpdate = !0),
        (this.next = 0),
        (this.count = 0),
        (this.mesh.visible = !1));
    }
    add(e, t, n, s, o = 1, r = 1) {
      let a = this.uvs[n] || this.uvs.bullet_concrete,
        l = a[(Math.random() * a.length) | 0],
        c = (s || ZR[n] || 0.25) * (0.85 + Math.random() * 0.3) * 0.5,
        u = this.next;
      ((this.next = (u + 1) % this.cap), this.count < this.cap && this.count++);
      let h = t.x,
        f = t.y,
        p = t.z,
        d = Math.hypot(h, f, p) || 1;
      ((h /= d), (f /= d), (p /= d));
      let v, g, x;
      Math.abs(f) > 0.9 ? ((v = 1), (g = 0), (x = 0)) : ((v = -p), (g = 0), (x = h));
      let y = v * h + g * f + x * p;
      ((v -= h * y), (g -= f * y), (x -= p * y));
      let b = Math.hypot(v, g, x) || 1;
      ((v /= b), (g /= b), (x /= b));
      let m = f * x - p * g,
        A = p * v - h * x,
        _ = h * g - f * v,
        M = n === 'bullet_wood' ? (Math.random() - 0.5) * 0.3 : Math.random() * 6.283,
        E = Math.cos(M),
        w = Math.sin(M),
        S = (v * E + m * w) * c,
        z = (g * E + A * w) * c,
        H = (x * E + _ * w) * c,
        O = (m * E - v * w) * c,
        q = (A * E - g * w) * c,
        U = (_ * E - x * w) * c,
        T = 0.004 + (u % 7) * 3e-4,
        D = e.x + h * T,
        C = e.y + f * T,
        G = e.z + p * T,
        j = this.pos.array,
        N = this.nor.array,
        Q = this.uv.array,
        K = this.col.array,
        ie = u * 12;
      ((j[ie] = D - S - O),
        (j[ie + 1] = C - z - q),
        (j[ie + 2] = G - H - U),
        (j[ie + 3] = D + S - O),
        (j[ie + 4] = C + z - q),
        (j[ie + 5] = G + H - U),
        (j[ie + 6] = D + S + O),
        (j[ie + 7] = C + z + q),
        (j[ie + 8] = G + H + U),
        (j[ie + 9] = D - S + O),
        (j[ie + 10] = C - z + q),
        (j[ie + 11] = G - H + U));
      for (let F = 0; F < 4; F++) ((N[ie + F * 3] = h), (N[ie + F * 3 + 1] = f), (N[ie + F * 3 + 2] = p));
      ((ie = u * 8),
        (Q[ie] = l[0]),
        (Q[ie + 1] = l[1]),
        (Q[ie + 2] = l[2]),
        (Q[ie + 3] = l[1]),
        (Q[ie + 4] = l[2]),
        (Q[ie + 5] = l[3]),
        (Q[ie + 6] = l[0]),
        (Q[ie + 7] = l[3]),
        (ie = u * 16),
        (this.baseA[u] = r));
      for (let F = 0; F < 4; F++)
        ((K[ie + F * 4] = o), (K[ie + F * 4 + 1] = o), (K[ie + F * 4 + 2] = o), (K[ie + F * 4 + 3] = r));
      if (this.count >= this.cap)
        for (let F = 0; F < Yb; F++) {
          let X = (this.next + F) % this.cap,
            ne = (this.baseA[X] * (F + 1)) / (Yb + 1),
            re = X * 16;
          K[re + 3] = K[re + 7] = K[re + 11] = K[re + 15] = ne;
        }
      ((this.pos.needsUpdate = this.nor.needsUpdate = this.uv.needsUpdate = this.col.needsUpdate = !0),
        (this.mesh.visible = !0));
    }
  };
export var $b = 1400,
  Zb = 3200,
  ht = Math.random,
  Ze = (i, e) => i + (e - i) * Math.random(),
  Et = new Vector3(),
  zt = new Vector3(),
  J1 = new Vector3(),
  qe = new Vector3(),
  Es = new Vector3(),
  Ho = new Vector3(),
  Ei = new Vector3(0, 1, 0),
  jR = new Vector3(0, -1, 0),
  K1 = new Color(),
  Ao = [1, 1, 1];
export function Yc(i, e, t, n) {
  return (
    i == null
      ? ((Ao[0] = e), (Ao[1] = t), (Ao[2] = n))
      : Array.isArray(i)
        ? ((Ao[0] = i[0]), (Ao[1] = i[1]), (Ao[2] = i[2]))
        : i.isColor
          ? ((Ao[0] = i.r), (Ao[1] = i.g), (Ao[2] = i.b))
          : (K1.set(i), (Ao[0] = K1.r), (Ao[1] = K1.g), (Ao[2] = K1.b)),
    Ao
  );
}
export function ro(i, e, t) {
  let n = ht() * 2 - 1,
    s = ht() * 2 - 1,
    o = ht() * 2 - 1,
    r = Math.hypot(n, s, o) || 1,
    a = (e * Math.cbrt(ht())) / r;
  t.set(i.x + n * a, i.y + s * a, i.z + o * a);
  let l = t.length();
  return (l < 1e-4 ? t.copy(i) : t.multiplyScalar(1 / l), t);
}
export async function createFx(i) {
  let e = i.scene || (i.render && i.render.scene),
    t = new Vector3(-0.8, 0, 0.3),
    n = new Vector3(SUN.color.r, SUN.color.g, SUN.color.b).multiplyScalar((SUN.intensity / Math.PI) * 0.9),
    s = new Vector3(
      SKY.zenith.r * 0.6 + SKY.horizonAway.r * 0.5 + SKY.fog.r * 0.25,
      SKY.zenith.g * 0.6 + SKY.horizonAway.g * 0.5 + SKY.fog.g * 0.25,
      SKY.zenith.b * 0.6 + SKY.horizonAway.b * 0.5 + SKY.fog.b * 0.25,
    ),
    o = new Vector3(
      SKY.horizonAway.r * 0.3 + SKY.fog.r * 0.14,
      SKY.horizonAway.g * 0.3 + SKY.fog.g * 0.14,
      SKY.horizonAway.b * 0.3 + SKY.fog.b * 0.14,
    ),
    r = Ev(i, $b, {
      lit: !0,
      tex: Bb(128),
      cols: Wc,
      rows: H1,
      renderOrder: 10,
      sun: n,
      sunDir: SUN.dir.clone().normalize(),
      ambLo: o,
      ambHi: s,
    }),
    a = Ev(i, Zb, { lit: !1, tex: Ob(128), cols: Af, rows: bv, renderOrder: 20 }),
    l = new Rf($b, !0),
    c = new Rf(Zb - 160, !1),
    u = new q1(48),
    h = new $1(i, 256),
    f = new Z1(i, 60),
    p = new j1(i, 160),
    d = new Group();
  ((d.name = 'fx'), d.add(p.mesh, h.mesh, f.mesh, r.mesh, a.mesh), e.add(d));
  let v = 0,
    g = -1,
    x = -1,
    y = () => i.render && i.render.lightPool,
    b = (ee, B, P, V, Y) => {
      let L = y();
      L && L.flash(ee, B, P, V, Y);
    };
  function m(ee, B) {
    let P = i.physics;
    if (!P || !P.raycast) return 1;
    (Es.copy(ee), B && Es.addScaledVector(B, 0.08), (Es.y += 0.03));
    let V = null;
    try {
      V = P.raycast(Es, SUN.dir, 90);
    } catch {
      V = null;
    }
    return V ? 0.2 : 1;
  }
  function A(ee) {
    let B = i.physics;
    if (!B || !B.raycast) return 0;
    (Es.copy(ee), (Es.y += 0.1));
    let P = null;
    try {
      P = B.raycast(Es, jR, 12);
    } catch {
      P = null;
    }
    return P ? P.point.y : -50;
  }
  function _(ee, B, P, V, Y, L, Z, J, oe, fe, le, R, I, se, ae, k, ce, ve) {
    let _e = l.emit(ee, B, P, V, Y, L, Z, J, oe);
    return _e < 0
      ? -1
      : ((l.r[_e] = fe),
        (l.g[_e] = le),
        (l.b[_e] = R),
        (l.a[_e] = I),
        (l.shade[_e] = se),
        (l.drag[_e] = ae),
        (l.grav[_e] = -k),
        (l.wind[_e] = ce),
        (l.turb[_e] = 0.5),
        (l.rot[_e] = ht() * 6.283),
        (l.rotv[_e] = (ht() - 0.5) * 1.2),
        (l.frame[_e] = ve < 0 ? (ht() * 6) | 0 : ve),
        (l.fin[_e] = 0.06),
        (l.fout[_e] = 0.3),
        (l.sk[_e] = 2.5),
        _e);
  }
  function M(ee, B, P, V, Y, L, Z, J, oe, fe, le, R) {
    let I = c.emit(ee, B, P, V, Y, L, Z, J, J * 0.5);
    return I < 0
      ? -1
      : ((c.mode[I] = 1),
        (c.frame[I] = _v),
        (c.stretch[I] = 0.03),
        (c.grav[I] = 9.81),
        (c.drag[I] = 0.9),
        (c.ramp[I] = 1),
        (c.r[I] = oe * 0.6),
        (c.g[I] = fe * 0.6),
        (c.b[I] = le * 0.6),
        (c.fout[I] = 0.55),
        (c.flags[I] = R),
        (c.sk[I] = 1),
        I);
  }
  function E(ee, B, P, V, Y, L, Z, J, oe, fe, le, R) {
    for (let I = 0; I < P; I++) {
      ro(B, L, qe);
      let se = Ze(V, Y) * (0.35 + 0.65 * ht());
      M(
        ee.x,
        ee.y,
        ee.z,
        qe.x * se,
        qe.y * se,
        qe.z * se,
        Ze(Z, J),
        Ze(0.01, 0.02),
        oe * Ze(0.6, 1.2),
        fe * Ze(0.6, 1.2),
        le,
        R,
      );
    }
  }
  function w(ee, B, P, V, Y, L, Z, J, oe, fe) {
    let le = c.emit(ee, B, P, 0, 0, 0, V, Y, L);
    return le < 0
      ? -1
      : ((c.frame[le] = fe),
        (c.r[le] = Z),
        (c.g[le] = J),
        (c.b[le] = oe),
        (c.fout[le] = 0.2),
        (c.rot[le] = ht() * 6.283),
        (c.sk[le] = 1.5),
        le);
  }
  function S(ee, B, P, V, Y, L, Z, J, oe) {
    let fe = c.emit(ee, B, P, 0, 0, 0, V, Y, L);
    return fe < 0
      ? -1
      : ((c.mode[fe] = 2),
        (c.frame[fe] = Mv),
        (c.r[fe] = Z),
        (c.g[fe] = J),
        (c.b[fe] = oe),
        (c.fout[fe] = 0.15),
        (c.fin[fe] = 0.08),
        (c.sk[fe] = 2.2),
        (c.rot[fe] = ht() * 6.283),
        fe);
  }
  function z(ee, B, P, V, Y, L, Z, J, oe, fe, le, R, I, se, ae, k) {
    for (let ce = 0; ce < P; ce++) {
      ro(B, ae, qe);
      let ve = Ze(V, Y),
        _e = Ze(0.8, 1.15);
      h.add(
        ee.x + qe.x * 0.02,
        ee.y + qe.y * 0.02,
        ee.z + qe.z * 0.02,
        qe.x * ve,
        qe.y * ve + 0.8,
        qe.z * ve,
        Ze(L, Z),
        Ze(J, oe),
        Ze(fe, le),
        R * _e,
        I * _e,
        se * _e,
        Ze(3.5, 6),
        k,
      );
    }
  }
  function H(ee, B, P = 12) {
    (zt.copy(B || Ei),
      zt.lengthSq() < 1e-6 && zt.copy(Ei),
      zt.normalize(),
      E(ee, zt, P, 5, 18, 0.6, 0.15, 0.5, 36, 22, 9, qc),
      w(ee.x, ee.y, ee.z, 0.05, 0.2, 0.35, 10, 6.5, 3, oo));
  }
  function O(ee, B = {}) {
    let P = B.size || 1,
      V = B.life || 2.5,
      Y = B.rise === void 0 ? 0.6 : B.rise,
      L = Yc(B.color, 0.32, 0.32, 0.33),
      Z = B.vel,
      J = m(ee, null),
      oe = B.count || 3;
    for (let fe = 0; fe < oe; fe++)
      _(
        ee.x + (ht() - 0.5) * 0.2 * P,
        ee.y + (ht() - 0.5) * 0.2 * P,
        ee.z + (ht() - 0.5) * 0.2 * P,
        (Z ? Z.x : 0) + (ht() - 0.5) * 0.4,
        (Z ? Z.y : 0) + ht() * 0.3,
        (Z ? Z.z : 0) + (ht() - 0.5) * 0.4,
        V * Ze(0.75, 1.2),
        P * 0.3,
        P * Ze(1, 1.5),
        L[0],
        L[1],
        L[2],
        B.alpha || 0.4,
        J,
        1.2,
        Y,
        1,
        -1,
      );
  }
  function q(ee, B, P = 1, V = 0.5, Y = 0.48, L = 0.45) {
    (Et.copy(B || Ei), Et.lengthSq() < 1e-6 && Et.copy(Ei), Et.normalize());
    let Z = m(ee, Et);
    for (let J = 0; J < 8; J++) {
      ro(Et, 0.5, qe);
      let oe = Ze(1, 4.5) * P,
        fe = Ze(0.85, 1.1);
      _(
        ee.x + Et.x * 0.03,
        ee.y + Et.y * 0.03,
        ee.z + Et.z * 0.03,
        qe.x * oe,
        qe.y * oe,
        qe.z * oe,
        Ze(0.5, 1.1),
        0.08 * P,
        Ze(0.35, 0.7) * P,
        V * fe,
        Y * fe,
        L * fe,
        0.9,
        Z,
        3.5,
        0.15,
        0.6,
        J < 3 ? 7 : -1,
      );
    }
    for (let J = 0; J < 2; J++)
      _(
        ee.x + Et.x * 0.15,
        ee.y + Et.y * 0.15,
        ee.z + Et.z * 0.15,
        Et.x * 0.5 + (ht() - 0.5) * 0.3,
        Et.y * 0.5 + 0.1,
        Et.z * 0.5 + (ht() - 0.5) * 0.3,
        Ze(2.2, 3.6),
        0.25 * P,
        Ze(0.9, 1.5) * P,
        V,
        Y,
        L,
        0.28,
        Z,
        1.5,
        0.1,
        1,
        -1,
      );
    return Z;
  }
  function U(ee, B = {}) {
    let P;
    if (B.color !== void 0) P = Yc(B.color, 0.4, 0.4, 0.4);
    else if (B.mat) {
      let oe = null;
      try {
        oe = typeof B.mat == 'string' ? i.mats.get(B.mat) : B.mat;
      } catch {
        oe = null;
      }
      P = Yc(oe && oe.color ? oe.color : null, 0.4, 0.4, 0.4);
    } else P = Yc(null, 0.4, 0.39, 0.37);
    let V = P[0],
      Y = P[1],
      L = P[2],
      Z = B.size || 0.06,
      J = B.speed || 5;
    (Et.copy(B.normal || Ei).normalize(),
      z(
        ee,
        Et,
        Math.min(B.count || 6, 40),
        J * 0.4,
        J * 1.3,
        Z * 0.4,
        Z * 1.2,
        Z * 0.3,
        Z * 0.9,
        Z * 0.4,
        Z * 1.2,
        V,
        Y,
        L,
        B.spread || 1,
        A(ee),
      ));
  }
  function T(ee, B = 1) {
    let P = m(ee, Ei),
      V = ee.y;
    for (let fe = 0; fe < 5; fe++) {
      let le = Ze(0.35, 0.6) * B,
        R = _(
          ee.x + (ht() - 0.5) * 0.08 * B,
          V + 0.1 * B,
          ee.z + (ht() - 0.5) * 0.08 * B,
          (ht() - 0.5) * 0.5,
          Ze(1.6, 2.8) * Math.sqrt(B),
          (ht() - 0.5) * 0.5,
          Ze(0.4, 0.65),
          le * 0.3,
          le,
          0.72,
          0.78,
          0.84,
          0.95,
          P,
          0.5,
          -7,
          0,
          6,
        );
      R >= 0 && ((l.rot[R] = (ht() - 0.5) * 0.3), (l.rotv[R] = 0), (l.turb[R] = 0), (l.sk[R] = 3), (l.fout[R] = 0.4));
    }
    for (let fe = 0; fe < 2; fe++)
      _(
        ee.x,
        V + 0.15 * B,
        ee.z,
        (ht() - 0.5) * 0.6,
        0.5,
        (ht() - 0.5) * 0.6,
        Ze(0.7, 1.1),
        0.2 * B,
        0.7 * B,
        0.7,
        0.75,
        0.8,
        0.14,
        P,
        2,
        0,
        0.8,
        -1,
      );
    let Y = 1.9 * P + 0.35,
      L = 1.5 * P + 0.45,
      Z = 1.05 * P + 0.55,
      J = Math.round(14 * Math.min(B, 1.6));
    for (let fe = 0; fe < J; fe++) {
      ro(Ei, 0.75, qe);
      let le = Ze(1.5, 4.8) * Math.sqrt(B),
        R = c.emit(ee.x, V + 0.03, ee.z, qe.x * le, Math.abs(qe.y) * le, qe.z * le, Ze(0.5, 1), Ze(0.012, 0.024), 0.01);
      R >= 0 &&
        ((c.mode[R] = 1),
        (c.frame[R] = Gc),
        (c.stretch[R] = 0.012),
        (c.grav[R] = 9.81),
        (c.drag[R] = 0.4),
        (c.r[R] = Y),
        (c.g[R] = L),
        (c.b[R] = Z),
        (c.fout[R] = 0.7),
        (c.flags[R] = Xc),
        (c.sk[R] = 1),
        (c.gy[R] = V));
    }
    S(ee.x, V + 0.012, ee.z, 0.9, 0.12 * B, 1.5 * B, 0.3 * P + 0.08, 0.27 * P + 0.09, 0.22 * P + 0.1);
    let oe = S(ee.x, V + 0.012, ee.z, 1.3, 0.05 * B, 1 * B, 0.2 * P + 0.05, 0.18 * P + 0.06, 0.15 * P + 0.07);
    oe >= 0 && (c.fin[oe] = 0.35);
  }
  let D = { p: new Vector3() };
  function C(ee, B, P, V, Y) {
    (Et.copy(B || Ei),
      Et.lengthSq() < 1e-6 && Et.copy(Ei),
      Et.normalize(),
      V && V.lengthSq() > 1e-6 ? zt.copy(V).normalize() : zt.copy(Et).negate(),
      J1.copy(zt)
        .addScaledVector(Et, -2 * zt.dot(Et))
        .normalize());
    let L = D.p.copy(ee);
    if ((Y && (P = 'enemy'), P !== 'enemy' && P !== 'water' && Et.y > 0.7 && i.ground && i.ground.isPuddle))
      try {
        i.ground.isPuddle(L.x, L.z) && L.y < 0.08 && (P = 'water');
      } catch {}
    let J = (i.camera ? i.camera.position : Es.set(0, 0, 0)).distanceToSquared(L) > 3025,
      oe = J ? 0.5 : 1,
      fe = Et.x,
      le = Et.y,
      R = Et.z;
    switch (P) {
      case 'metal': {
        (qe.copy(J1).addScaledVector(Et, 0.6).normalize(),
          zt.copy(qe),
          E(L, zt, Math.round(18 * oe), 6, 24, 0.55, 0.1, 0.38, 40, 25, 10.5, 0),
          E(L, zt, 2 + ((ht() * 2) | 0), 9, 18, 0.9, 0.7, 1.3, 32, 18, 7, qc),
          w(L.x + fe * 0.03, L.y + le * 0.03, L.z + R * 0.03, 0.05, 0.25, 0.45, 16, 11, 5.5, oo),
          w(L.x + fe * 0.04, L.y + le * 0.04, L.z + R * 0.04, 0.04, 0.35, 0.5, 9, 6, 2.6, n0 + ((ht() * 2) | 0)),
          v - g > 0.09 && ((g = v), Es.copy(L).addScaledVector(Et, 0.12), b(Es, 16760944, 10, 5, 0.05)));
        let I = m(L, Et);
        for (let se = 0; se < 2; se++)
          _(
            L.x + fe * 0.04,
            L.y + le * 0.04,
            L.z + R * 0.04,
            fe * 0.8 + (ht() - 0.5) * 0.5,
            le * 0.8 + 0.2,
            R * 0.8 + (ht() - 0.5) * 0.5,
            Ze(0.5, 0.9),
            0.06,
            Ze(0.3, 0.5),
            0.4,
            0.4,
            0.41,
            0.4,
            I,
            2.5,
            0.3,
            0.8,
            -1,
          );
        (J || z(L, Et, 2, 1.5, 4, 0.012, 0.03, 0.003, 0.005, 0.01, 0.025, 0.2, 0.21, 0.23, 0.8, A(L)),
          p.add(L, Et, 'bullet_metal'));
        break;
      }
      case 'wood': {
        let I = q(L, Et, 0.75, 0.5, 0.42, 0.32);
        (z(L, Et, J ? 3 : 7, 2, 6, 0.004, 0.009, 0.03, 0.1, 0.004, 0.012, 0.62, 0.5, 0.33, 0.7, A(L)),
          I > 0.5 && ht() < 0.3 && w(L.x, L.y, L.z, 0.04, 0.1, 0.2, 3, 2, 1, oo),
          p.add(L, Et, 'bullet_wood'));
        break;
      }
      case 'water': {
        T(L, 1);
        break;
      }
      case 'rubber':
      case 'dirt': {
        let I = m(L, Et),
          se = P === 'dirt',
          ae = se ? 0.3 : 0.14,
          k = se ? 0.25 : 0.14,
          ce = se ? 0.19 : 0.14;
        for (let ve = 0; ve < 5; ve++) {
          ro(Et, 0.6, qe);
          let _e = Ze(0.6, 2.6);
          _(
            L.x + fe * 0.03,
            L.y + le * 0.03,
            L.z + R * 0.03,
            qe.x * _e,
            qe.y * _e,
            qe.z * _e,
            Ze(0.5, 1),
            0.07,
            Ze(0.3, 0.55),
            ae,
            k,
            ce,
            0.85,
            I,
            3.5,
            0.1,
            0.6,
            ve < 2 ? 7 : -1,
          );
        }
        (z(L, Et, 3, 1.5, 4, 0.01, 0.03, 0.008, 0.02, 0.01, 0.03, ae * 0.8, k * 0.8, ce * 0.8, 0.7, A(L)),
          p.add(L, Et, 'soot', 0.2, 1, 0.8));
        break;
      }
      case 'glass': {
        for (let I = 0; I < 12; I++) {
          ro(Et, 0.9, qe);
          let se = Ze(1.5, 6),
            ae = c.emit(L.x, L.y, L.z, qe.x * se, qe.y * se, qe.z * se, Ze(0.4, 0.9), Ze(0.012, 0.02), 0.008);
          ae >= 0 &&
            ((c.mode[ae] = 1),
            (c.frame[ae] = Gc),
            (c.stretch[ae] = 0.01),
            (c.grav[ae] = 9.81),
            (c.r[ae] = 2.6),
            (c.g[ae] = 2.7),
            (c.b[ae] = 2.8),
            (c.flags[ae] = Xc),
            (c.ramp[ae] = 3));
        }
        (z(L, Et, 4, 1.5, 5, 0.01, 0.03, 0.002, 0.004, 0.01, 0.03, 0.62, 0.72, 0.74, 0.8, A(L)),
          _(
            L.x,
            L.y,
            L.z,
            fe * 0.6,
            le * 0.6 + 0.2,
            R * 0.6,
            0.6,
            0.08,
            0.4,
            0.75,
            0.8,
            0.82,
            0.2,
            m(L, Et),
            2.5,
            0.2,
            0.8,
            -1,
          ),
          p.add(L, Et, 'bullet_glass'));
        break;
      }
      case 'enemy': {
        (qe.copy(J1).addScaledVector(Et, 0.8).normalize(),
          zt.copy(qe),
          E(L, zt, Math.round(13 * oe), 5, 20, 0.9, 0.12, 0.45, 42, 29, 14, 0),
          E(L, zt, 2, 6, 12, 1, 0.6, 1.1, 32, 18, 7, qc),
          w(L.x, L.y, L.z, 0.06, 0.3, 0.55, 18, 12, 6, oo),
          w(L.x, L.y, L.z, 0.04, 0.3, 0.45, 8, 5, 2.4, n0 + ((ht() * 2) | 0)),
          v - g > 0.09 && ((g = v), b(L, 16756832, 8, 4.5, 0.05)));
        let I = m(L, Et);
        for (let se = 0; se < 2; se++)
          _(
            L.x,
            L.y,
            L.z,
            fe * 0.5 + (ht() - 0.5) * 0.4,
            le * 0.5 + 0.3,
            R * 0.5 + (ht() - 0.5) * 0.4,
            Ze(0.6, 1.1),
            0.06,
            Ze(0.3, 0.5),
            0.13,
            0.13,
            0.14,
            0.65,
            I,
            2.2,
            0.5,
            0.9,
            -1,
          );
        if (!J) {
          let se = ht() < 0.35;
          z(L, Et, 3, 2, 6, 0.012, 0.035, 0.004, 0.008, 0.012, 0.03, 0.6, se ? 0.2 : 0.62, se ? 0.05 : 0.64, 0.8, A(L));
        }
        break;
      }
      default: {
        (q(L, Et, 1, 0.52, 0.5, 0.47),
          z(L, Et, J ? 2 : 4, 1.5, 5.5, 0.012, 0.035, 0.008, 0.02, 0.012, 0.035, 0.42, 0.41, 0.39, 0.7, A(L)),
          qe.copy(J1).addScaledVector(Et, 0.7).normalize(),
          zt.copy(qe));
        for (let I = 0; I < 4; I++) {
          ro(zt, 0.5, qe);
          let se = Ze(3, 9),
            ae = _(
              L.x,
              L.y,
              L.z,
              qe.x * se,
              qe.y * se,
              qe.z * se,
              Ze(0.25, 0.45),
              0.03,
              0.09,
              0.6,
              0.58,
              0.54,
              0.7,
              1,
              2,
              -6,
              0.2,
              7,
            );
          ae >= 0 && (l.turb[ae] = 0);
        }
        (ht() < 0.3 && E(L, zt, 3, 4, 10, 0.6, 0.08, 0.2, 26, 15, 6, 0), p.add(L, Et, 'bullet_concrete'));
      }
    }
  }
  function G(ee, B, P = {}) {
    let V = Yc(P.color, 1, 0.8, 0.46),
      Y = P.intensity || 16;
    if (
      (u.add(ee, B, V[0] * Y, V[1] * Y, V[2] * Y, P.speed || 260, P.width || 0.024), v - x > 0.07 && P.trail !== !1)
    ) {
      ((x = v), qe.subVectors(B, ee));
      let L = qe.length();
      if (L > 2) {
        qe.multiplyScalar(1 / L);
        let Z = 5,
          J = Math.min(L, 7),
          oe = m(ee, null);
        for (let fe = 0; fe < Z; fe++) {
          let le = 0.6 + ((fe + ht()) / Z) * (J - 0.6),
            R = _(
              ee.x + qe.x * le,
              ee.y + qe.y * le,
              ee.z + qe.z * le,
              qe.x * 0.6,
              0.05,
              qe.z * 0.6,
              Ze(0.45, 0.8),
              0.04,
              Ze(0.12, 0.2),
              0.6,
              0.6,
              0.62,
              0.1,
              oe,
              2,
              0.1,
              0.7,
              -1,
            );
          R >= 0 && (l.fin[R] = 0.25);
        }
      }
    }
  }
  function j(ee, B, P = {}) {
    let V = P.scale || 1;
    (zt.copy(B || Ei), zt.lengthSq() < 1e-6 && zt.set(0, 0, -1), zt.normalize());
    let Y = Yc(P.color, 1, 0.68, 0.32),
      L = ee.x,
      Z = ee.y,
      J = ee.z,
      oe = Y[0],
      fe = Y[1],
      le = Y[2];
    (w(
      L + zt.x * 0.1 * V,
      Z + zt.y * 0.1 * V,
      J + zt.z * 0.1 * V,
      0.045,
      0.75 * V,
      1.15 * V,
      34 * oe,
      34 * fe,
      34 * le,
      n0,
    ),
      w(
        L + zt.x * 0.14 * V,
        Z + zt.y * 0.14 * V,
        J + zt.z * 0.14 * V,
        0.035,
        0.5 * V,
        0.85 * V,
        22 * oe,
        22 * fe,
        22 * le,
        n0 + 1,
      ),
      w(
        L + zt.x * 0.05 * V,
        Z + zt.y * 0.05 * V,
        J + zt.z * 0.05 * V,
        0.045,
        0.13 * V,
        0.2 * V,
        22,
        22 * (fe + 0.25),
        22 * (le + 0.3),
        oo,
      ),
      w(L, Z, J, 0.05, 0.8 * V, 1.1 * V, 0.4 * oe, 0.4 * fe, 0.4 * le, oo));
    let R = c.emit(
      L + zt.x * 0.4 * V,
      Z + zt.y * 0.4 * V,
      J + zt.z * 0.4 * V,
      -zt.x,
      -zt.y,
      -zt.z,
      0.04,
      0.11 * V,
      0.14 * V,
    );
    R >= 0 &&
      ((c.mode[R] = 1),
      (c.frame[R] = W1),
      (c.stretch[R] = 0.9 * V),
      (c.r[R] = 18 * oe),
      (c.g[R] = 18 * fe),
      (c.b[R] = 18 * le),
      (c.fout[R] = 0.3));
    for (let I = 0; I < 3; I++) {
      ro(zt, 0.25, qe);
      let se = Ze(8, 22);
      M(L, Z, J, qe.x * se, qe.y * se, qe.z * se, Ze(0.08, 0.22), 0.012, 30, 18, 7, 0);
    }
    (_(
      L + zt.x * 0.2,
      Z + zt.y * 0.2,
      J + zt.z * 0.2,
      zt.x * 1.5,
      zt.y * 1.5 + 0.2,
      zt.z * 1.5,
      Ze(0.5, 0.9),
      0.08 * V,
      0.45 * V,
      0.5,
      0.5,
      0.52,
      0.16,
      1,
      3,
      0.3,
      0.8,
      -1,
    ),
      Es.copy(ee).addScaledVector(zt, 0.25),
      b(Es, 16756832, 16 * V, 7 * V, 0.05));
  }
  function N(ee, B) {
    f.add(ee, B);
  }
  let Q = { pos: new Vector3(), size: 1 };
  function K(ee, B = 1) {
    let P = Math.max(0.4, Math.min(B, 4)),
      V = ee.x,
      Y = ee.y,
      L = ee.z,
      Z = Math.sqrt(P),
      J = A(ee),
      oe = Y - J < 1.4 * P,
      fe = m(ee, Ei);
    (Es.set(V, Y + 0.4, L), b(Es, 16769712, 320 * P, 10 + 9 * P, 0.08), b(Es, 16747056, 55 * P, 8 + 6 * P, 0.45));
    let le = Y + 0.35 * P;
    (w(V, le, L, 0.055, 1.5 * P, 2.3 * P, 16, 13.5, 9.5, oo),
      w(V, le, L, 0.05, 2.6 * P, 4.2 * P, 7, 5, 2.4, n0 + ((ht() * 2) | 0)),
      w(V, le, L, 0.3, 3.5 * P, 5.5 * P, 0.35, 0.2, 0.08, oo));
    let R = Math.round(13 + 5 * P);
    for (let ae = 0; ae < R; ae++) {
      (ro(Ei, 1.6, qe), oe && qe.y < -0.1 && (qe.y = -qe.y * 0.5));
      let k = Ze(2.2, 7.5) * Z,
        ce = Ze(0.7, 1.15),
        ve = l.emit(
          V + qe.x * 0.3 * P,
          le + qe.y * 0.3 * P,
          L + qe.z * 0.3 * P,
          qe.x * k,
          qe.y * k + 1.4,
          qe.z * k,
          Ze(0.55, 1.05),
          0.85 * P,
          Ze(1.8, 2.7) * P,
        );
      ve >= 0 &&
        ((l.frame[ve] = ae % 4 === 0 ? 7 : (ht() * 6) | 0),
        (l.ramp[ve] = 2),
        (l.r[ve] = 5.8 * ce),
        (l.g[ve] = 2.4 * ce),
        (l.b[ve] = 0.5 * ce),
        (l.a[ve] = 0.96),
        (l.shade[ve] = 2 + fe),
        (l.drag[ve] = 4),
        (l.grav[ve] = -2.6),
        (l.wind[ve] = 0.6),
        (l.turb[ve] = 1.5),
        (l.rot[ve] = ht() * 6.283),
        (l.rotv[ve] = (ht() - 0.5) * 2.5),
        (l.sk[ve] = 3),
        (l.fin[ve] = 0),
        (l.fout[ve] = 0.6));
    }
    for (let ae = 0; ae < 5; ae++) {
      ro(Ei, 1.4, qe);
      let k = Ze(2, 5) * Z,
        ce = c.emit(
          V + qe.x * 0.3 * P,
          le + qe.y * 0.3 * P,
          L + qe.z * 0.3 * P,
          qe.x * k,
          Math.abs(qe.y) * k + 1.2,
          qe.z * k,
          Ze(0.3, 0.55),
          0.6 * P,
          Ze(1.2, 1.8) * P,
        );
      ce >= 0 &&
        ((c.frame[ce] = V1),
        (c.ramp[ce] = 2),
        (c.r[ce] = 2.4),
        (c.g[ce] = 1.1),
        (c.b[ce] = 0.3),
        (c.drag[ce] = 4),
        (c.grav[ce] = -2.5),
        (c.rot[ce] = ht() * 6.283),
        (c.sk[ce] = 3),
        (c.fout[ce] = 0.4));
    }
    let I = Math.round(11 + 5 * P);
    for (let ae = 0; ae < I; ae++) {
      let k = ae % 2 === 0;
      (ro(Ei, 1.4, qe), oe && qe.y < 0 && (qe.y = -qe.y * 0.4));
      let ce = (k ? Ze(4.5, 9) : Ze(1.5, 5)) * Z,
        ve = Ze(0.04, 0.1),
        _e = k ? 0.75 : 0.3,
        Te = _(
          V + qe.x * _e * P,
          le + qe.y * _e * P,
          L + qe.z * _e * P,
          qe.x * ce,
          qe.y * ce + 0.8,
          qe.z * ce,
          Ze(2.8, 4.8),
          (k ? 0.8 : 1.2) * P,
          Ze(2.6, 4.2) * P,
          ve,
          ve * 0.95,
          ve * 0.9,
          k ? 0.7 : 0.8,
          fe,
          3.4,
          Ze(0.8, 1.7),
          1,
          ae % 3 === 0 ? 7 : -1,
        );
      Te >= 0 && ((l.fin[Te] = k ? 0.025 : 0.16), (l.fout[Te] = 0.35), (l.turb[Te] = 1.2));
    }
    X(V, Y + 0.3 * P, L, 'smolder', 1.3 + 0.3 * P, P, fe);
    let se = Math.min(90, Math.round(34 * P));
    for (let ae = 0; ae < se; ae++) {
      (ro(Ei, 1.5, qe), oe && qe.y < 0 && (qe.y = -qe.y));
      let k = Ze(6, 26) * Z,
        ce = M(V, Y + 0.05, L, qe.x * k, qe.y * k, qe.z * k, Ze(0.5, 1.5), Ze(0.014, 0.028), 40, 23, 8, qc);
      ce >= 0 && ((c.drag[ce] = 1.4), (c.stretch[ce] = 0.035));
    }
    for (let ae = 0; ae < 10 * P; ae++) {
      ro(Ei, 1.2, qe);
      let k = Ze(1, 5),
        ce = c.emit(V, Y + 0.3, L, qe.x * k, Math.abs(qe.y) * k + 1, qe.z * k, Ze(1.4, 3), 0.035, 0.02);
      ce >= 0 &&
        ((c.frame[ce] = oo),
        (c.ramp[ce] = 3),
        (c.r[ce] = 9),
        (c.g[ce] = 4),
        (c.b[ce] = 1),
        (c.drag[ce] = 1.2),
        (c.grav[ce] = 0.6),
        (c.turb[ce] = 3),
        (c.wind[ce] = 1),
        (c.fout[ce] = 0.5));
    }
    if (oe) {
      let ae = J + 0.015;
      S(V, ae, L, 0.32, 0.6 * P, 9 * P, 1.6, 1.2, 0.75);
      let k = Math.round(12 + 3 * P);
      for (let ce = 0; ce < k; ce++) {
        let ve = ((ce + ht()) / k) * 6.283,
          _e = Ze(5, 10) * Z,
          Te = Ze(0.42, 0.55),
          Pe = _(
            V + Math.cos(ve) * 0.4 * P,
            ae + 0.2,
            L + Math.sin(ve) * 0.4 * P,
            Math.cos(ve) * _e,
            Ze(0.2, 0.9),
            Math.sin(ve) * _e,
            Ze(1.2, 2.2),
            0.4 * P,
            Ze(1.2, 1.9) * P,
            Te,
            Te * 0.96,
            Te * 0.9,
            0.26,
            fe,
            3,
            0.15,
            0.7,
            -1,
          );
        Pe >= 0 && (l.fin[Pe] = 0.1);
      }
      (Ho.set(V, J, L), p.add(Ho, Ei, 'scorch', 2.3 * P, 1, 0.92));
    }
    (Ho.set(V, Math.max(Y, J + 0.1), L),
      z(Ho, Ei, Math.round(13 + 6 * P), 4, 13 * Z, 0.04, 0.13, 0.025, 0.08, 0.04, 0.13, 0.07, 0.066, 0.062, 1.1, J),
      Q.pos.copy(ee),
      (Q.size = B),
      i.events.emit('explosion', Q));
  }
  let ie = [];
  for (let ee = 0; ee < 24; ee++) {
    let B = {
      active: !1,
      kind: 'steam',
      pos: new Vector3(),
      acc: 0,
      acc2: 0,
      ttl: 1 / 0,
      scale: 1,
      shade: 1,
      t: 0,
      light: null,
      drop: -1,
    };
    ((B.stop = () => {
      ((B.active = !1), B.light && (B.light.release(), (B.light = null)));
    }),
      (B.setPos = (P) => {
        B.pos.copy(P);
      }),
      ie.push(B));
  }
  let F = { active: !1, pos: new Vector3(), stop() {}, setPos() {} };
  function X(ee, B, P, V, Y, L, Z) {
    let J = null;
    for (let oe = 0; oe < ie.length; oe++)
      if (!ie[oe].active) {
        J = ie[oe];
        break;
      }
    if (!J) return F;
    if (
      ((J.active = !0),
      (J.kind = V),
      J.pos.set(ee, B, P),
      (J.acc = 0),
      (J.acc2 = 0),
      (J.ttl = Y),
      (J.scale = L),
      (J.t = 0),
      (J.drop = -1),
      (J.shade = Z === void 0 ? m(J.pos, null) : Z),
      V === 'fire')
    ) {
      let oe = y();
      ((J.light = oe && oe.acquire ? oe.acquire() : null),
        J.light &&
          (J.light.light.color.set(16747066),
          (J.light.light.distance = 9),
          J.light.light.position.set(ee, B + 0.5, P)));
    }
    return J;
  }
  function ne(ee, B = 'steam', P = {}) {
    return X(ee.x, ee.y, ee.z, B, P.ttl || 1 / 0, P.scale || 1, void 0);
  }
  function re(ee) {
    for (let B = 0; B < ie.length; B++) {
      let P = ie[B];
      if (!P.active) continue;
      if (((P.t += ee), P.t > P.ttl)) {
        P.stop();
        continue;
      }
      let V = P.pos.x,
        Y = P.pos.y,
        L = P.pos.z,
        Z = P.scale;
      if (P.kind === 'steam')
        for (P.acc += ee * 13; P.acc > 1; ) {
          P.acc -= 1;
          let J = _(
            V + (ht() - 0.5) * 0.08,
            Y,
            L + (ht() - 0.5) * 0.08,
            (ht() - 0.5) * 0.4,
            Ze(1.4, 2.4),
            (ht() - 0.5) * 0.4,
            Ze(1.8, 3),
            0.12 * Z,
            Ze(0.8, 1.3) * Z,
            0.8,
            0.82,
            0.85,
            0.2,
            P.shade,
            1.3,
            0.5,
            1,
            -1,
          );
          J >= 0 && ((l.fin[J] = 0.12), (l.turb[J] = 0.9));
        }
      else if (P.kind === 'smolder')
        for (P.acc += ee * 9 * (1 - P.t / P.ttl); P.acc > 1; ) {
          P.acc -= 1;
          let J = Ze(0.05, 0.11),
            oe = _(
              V + (ht() - 0.5) * 0.5 * Z,
              Y,
              L + (ht() - 0.5) * 0.5 * Z,
              (ht() - 0.5) * 0.6,
              Ze(1.2, 2.4),
              (ht() - 0.5) * 0.6,
              Ze(2.4, 3.8),
              0.5 * Z,
              Ze(1.6, 2.6) * Z,
              J,
              J,
              J,
              0.6,
              P.shade,
              1,
              0.9,
              1,
              -1,
            );
          oe >= 0 && ((l.fin[oe] = 0.12), (l.turb[oe] = 1));
        }
      else if (P.kind === 'embers')
        for (P.acc += ee * 8; P.acc > 1; ) {
          P.acc -= 1;
          let J = c.emit(
            V + (ht() - 0.5) * 0.4 * Z,
            Y,
            L + (ht() - 0.5) * 0.4 * Z,
            (ht() - 0.5) * 0.6,
            Ze(0.6, 1.8),
            (ht() - 0.5) * 0.6,
            Ze(1.5, 3.2),
            Ze(0.02, 0.04),
            0.012,
          );
          J >= 0 &&
            ((c.frame[J] = oo),
            (c.ramp[J] = 3),
            (c.r[J] = 10),
            (c.g[J] = 4.2),
            (c.b[J] = 1),
            (c.drag[J] = 0.8),
            (c.grav[J] = -0.5),
            (c.turb[J] = 3.5),
            (c.wind[J] = 1),
            (c.fout[J] = 0.5));
        }
      else if (P.kind === 'fire') {
        for (P.acc += ee * 24; P.acc > 1; ) {
          P.acc -= 1;
          let J = c.emit(
            V + (ht() - 0.5) * 0.3 * Z,
            Y + 0.1 * Z,
            L + (ht() - 0.5) * 0.3 * Z,
            (ht() - 0.5) * 0.5,
            Ze(1.2, 2.6) * Z,
            (ht() - 0.5) * 0.5,
            Ze(0.35, 0.65),
            0.45 * Z,
            Ze(0.2, 0.35) * Z,
          );
          J >= 0 &&
            ((c.frame[J] = V1),
            (c.ramp[J] = 2),
            (c.r[J] = 9),
            (c.g[J] = 5.5),
            (c.b[J] = 2.2),
            (c.drag[J] = 1),
            (c.rot[J] = ht() * 6.283),
            (c.rotv[J] = (ht() - 0.5) * 4),
            (c.fin[J] = 0.12),
            (c.fout[J] = 0.4),
            (c.wind[J] = 1),
            (c.turb[J] = 2));
        }
        for (P.acc2 += ee * 4; P.acc2 > 1; ) {
          P.acc2 -= 1;
          let J = Ze(0.05, 0.1),
            oe = _(
              V,
              Y + 0.8 * Z,
              L,
              (ht() - 0.5) * 0.4,
              Ze(1.2, 2),
              (ht() - 0.5) * 0.4,
              Ze(2.2, 3.4),
              0.3 * Z,
              Ze(1.1, 1.8) * Z,
              J,
              J,
              J,
              0.5,
              P.shade,
              0.9,
              0.8,
              1,
              -1,
            );
          oe >= 0 && ((l.fin[oe] = 0.2), (l.turb[oe] = 1));
          let fe = c.emit(
            V + (ht() - 0.5) * 0.3,
            Y + 0.3,
            L + (ht() - 0.5) * 0.3,
            ht() - 0.5,
            Ze(1.5, 3),
            ht() - 0.5,
            Ze(1, 2.2),
            0.03,
            0.012,
          );
          fe >= 0 &&
            ((c.frame[fe] = oo),
            (c.ramp[fe] = 3),
            (c.r[fe] = 10),
            (c.g[fe] = 4.2),
            (c.b[fe] = 1),
            (c.drag[fe] = 0.8),
            (c.grav[fe] = -0.6),
            (c.turb[fe] = 4),
            (c.wind[fe] = 1));
        }
        P.light && (P.light.light.intensity = (14 + 6 * Math.sin(P.t * 23) + 4 * Math.sin(P.t * 37.7)) * Z);
      } else if (P.kind === 'drip') {
        if (((P.acc += ee * 1.6), P.drop >= 0 && ((P.drop -= ee), P.drop < 0))) {
          let J = P.shade;
          S(V, 0.014, L, 0.8, 0.05, 0.55, 0.4 * J + 0.14, 0.36 * J + 0.16, 0.3 * J + 0.18);
          for (let oe = 0; oe < 3; oe++) {
            ro(Ei, 0.7, qe);
            let fe = c.emit(V, 0.03, L, qe.x * 1.2, Math.abs(qe.y) * 1.6, qe.z * 1.2, 0.35, 0.012, 0.008);
            fe >= 0 &&
              ((c.mode[fe] = 1),
              (c.frame[fe] = Gc),
              (c.stretch[fe] = 0.012),
              (c.grav[fe] = 9.81),
              (c.r[fe] = 1.6 * J + 0.3),
              (c.g[fe] = 1.3 * J + 0.4),
              (c.b[fe] = 0.9 * J + 0.5),
              (c.flags[fe] = Xc));
          }
        }
        for (; P.acc > 1; ) {
          P.acc -= 1 + ht() * 0.6;
          let J = Math.sqrt((2 * Math.max(Y, 0.05)) / 9.81),
            oe = c.emit(V, Y, L, 0, -0.2, 0, J + 0.05, 0.014, 0.014);
          (oe >= 0 &&
            ((c.mode[oe] = 1),
            (c.frame[oe] = Gc),
            (c.stretch[oe] = 0.02),
            (c.grav[oe] = 9.81),
            (c.r[oe] = 1.4 * P.shade + 0.4),
            (c.g[oe] = 1.2 * P.shade + 0.5),
            (c.b[oe] = 0.9 * P.shade + 0.6),
            (c.flags[oe] = Xc),
            (c.fout[oe] = 0.98)),
            (P.drop = J));
        }
      }
    }
  }
  i.events.on('impact', (ee) => {
    !ee || !ee.point || C(ee.point, ee.normal, ee.surface, ee.dir, ee.enemy);
  });
  let $ = (ee, B) => {
    try {
      return !!(i.ground && i.ground.isPuddle && i.ground.isPuddle(ee, B));
    } catch {
      return !1;
    }
  };
  (i.events.on('player:step', (ee) => {
    let B = (ee && ee.pos) || (i.player && i.player.pos);
    B &&
      ((ee && ee.surface === 'water') || $(B.x, B.z)) &&
      (Ho.set(B.x, Math.max(0, B.y), B.z), T(Ho, ee && ee.sprint ? 0.55 : 0.4));
  }),
    i.events.on('player:land', (ee) => {
      let B = i.player && i.player.pos;
      if (B) {
        if ((Ho.set(B.x, Math.max(0, B.y), B.z), (ee && ee.surface === 'water') || $(B.x, B.z))) T(Ho, 0.9);
        else if (ee && ee.speed > 5) {
          let P = m(Ho, Ei);
          for (let V = 0; V < 6; V++) {
            let Y = ht() * 6.283;
            _(
              Ho.x + Math.cos(Y) * 0.2,
              Ho.y + 0.08,
              Ho.z + Math.sin(Y) * 0.2,
              Math.cos(Y) * 1.6,
              0.3,
              Math.sin(Y) * 1.6,
              Ze(0.7, 1.2),
              0.15,
              Ze(0.5, 0.8),
              0.45,
              0.44,
              0.42,
              0.22,
              P,
              3,
              0.1,
              0.8,
              -1,
            );
          }
        }
      }
    }));
  function ue(ee) {
    (ee > 0 || (ee = 0), (v += ee), re(ee));
    let B = i.camera ? i.camera.position : Es.set(0, 0, 0);
    (r.begin(),
      l.update(ee, r, B, t, v),
      r.end(),
      a.begin(),
      c.update(ee, a, B, t, v),
      u.update(ee, a, W1, oo),
      a.end(),
      h.update(ee),
      f.update(ee));
  }
  function me() {
    (l.clear(), c.clear(), u.clear(), h.clear(), f.clear(), p.clear());
    for (let ee of ie) ee.active && ee.stop();
    (r.begin(), r.end(), a.begin(), a.end());
  }
  return {
    update: ue,
    clear: me,
    muzzleFlash: j,
    tracer: G,
    impact: C,
    sparks: H,
    smoke: O,
    dust: q,
    explosion: K,
    shell: N,
    splash: T,
    addEmitter: ne,
    debris: U,
    decal(ee, B, P = 'bullet_concrete', V) {
      (Et.copy(B || Ei), p.add(ee, Et, P, V));
    },
    wind: t,
    root: d,
    stats() {
      return { lit: l.n, add: c.n, tracers: u.n, debris: h.live, drawCalls: 5 };
    },
  };
}
