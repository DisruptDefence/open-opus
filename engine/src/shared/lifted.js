import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  TubeGeometry,
  UnsignedByteType,
  Vector3,
} from '../../vendor/three.module.js';

export var SUN = { dir: new Vector3(0.916, 0.225, 0.331).normalize(), color: new Color(1, 0.72, 0.42), intensity: 9 },
  SKY = {
    zenith: new Color(0.055, 0.085, 0.13),
    horizon: new Color(0.95, 0.55, 0.28),
    horizonAway: new Color(0.16, 0.22, 0.3),
    fog: new Color(0.42, 0.47, 0.52),
  },
  BODY = { eye: 1.68, crouchEye: 1.05, radius: 0.32, height: 1.8, fov: 74, viewFov: 54 },
  vf = 0,
  zc = 1,
  QUALITY_TIERS = {
    test: {
      name: 'test',
      scale: 1,
      msaa: 0,
      shadow: 1024,
      tex: 256,
      volSteps: 10,
      ao: !0,
      planar: 0.5,
      bloom: !0,
      motionBlur: !1,
      rain: 0.4,
    },
    low: {
      name: 'low',
      scale: 0.7,
      msaa: 0,
      shadow: 2048,
      tex: 512,
      volSteps: 12,
      ao: !1,
      planar: 0,
      bloom: !0,
      motionBlur: !1,
      rain: 0.5,
    },
    medium: {
      name: 'medium',
      scale: 0.85,
      msaa: 2,
      shadow: 2048,
      tex: 1024,
      volSteps: 16,
      ao: !0,
      planar: 0.5,
      bloom: !0,
      motionBlur: !1,
      rain: 0.8,
    },
    high: {
      name: 'high',
      scale: 1,
      msaa: 4,
      shadow: 4096,
      tex: 1024,
      volSteps: 24,
      ao: !0,
      planar: 0.5,
      bloom: !0,
      motionBlur: !0,
      rain: 1,
    },
    ultra: {
      name: 'ultra',
      scale: 1,
      msaa: 4,
      shadow: 4096,
      tex: 2048,
      volSteps: 40,
      ao: !0,
      planar: 1,
      bloom: !0,
      motionBlur: !0,
      rain: 1,
    },
  };
export function pickQuality(i) {
  if (i && QUALITY_TIERS[i]) return { ...QUALITY_TIERS[i] };
  if (
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900)
  )
    return { ...QUALITY_TIERS.low };
  let t = '';
  try {
    let s = document.createElement('canvas'),
      o = s.getContext('webgl2') || s.getContext('webgl');
    if (o) {
      let r = o.getExtension('WEBGL_debug_renderer_info');
      t = String(r ? o.getParameter(r.UNMASKED_RENDERER_WEBGL) : o.getParameter(o.RENDERER));
      let a = o.getExtension('WEBGL_lose_context');
      a && a.loseContext();
    }
  } catch {}
  return {
    ...(/SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR/i.test(t) || (/Intel/i.test(t) && !/Arc/i.test(t))
      ? QUALITY_TIERS.medium
      : QUALITY_TIERS.high),
  };
}
export function createEvents() {
  let i = new Map();
  return {
    on(e, t) {
      return (i.has(e) || i.set(e, []), i.get(e).push(t), () => this.off(e, t));
    },
    off(e, t) {
      let n = i.get(e);
      if (n) {
        let s = n.indexOf(t);
        s >= 0 && n.splice(s, 1);
      }
    },
    emit(e, t) {
      let n = i.get(e);
      if (n)
        for (let s = 0; s < n.length; s++)
          try {
            n[s](t);
          } catch (o) {
            console.error(`[events] handler for "${e}" threw`, o);
          }
    },
  };
}
export function createRng(i = 1337) {
  let e = i >>> 0,
    t = () => {
      ((e |= 0), (e = (e + 1831565813) | 0));
      let n = Math.imul(e ^ (e >>> 15), 1 | e);
      return ((n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n), ((n ^ (n >>> 14)) >>> 0) / 4294967296);
    };
  return (
    (t.range = (n, s) => n + (s - n) * t()),
    (t.int = (n, s) => Math.floor(n + (s - n + 1) * t())),
    (t.pick = (n) => n[Math.floor(t() * n.length)]),
    (t.sign = () => (t() < 0.5 ? -1 : 1)),
    (t.fork = () => createRng(Math.floor(t() * 4294967296))),
    t
  );
}
export var clamp = (i, e, t) => Math.min(t, Math.max(e, i)),
  lerp = (i, e, t) => i + (e - i) * t,
  saturate = (i) => Math.min(1, Math.max(0, i)),
  smoothstep = (i, e, t) => {
    let n = saturate((t - i) / (e - i));
    return n * n * (3 - 2 * n);
  },
  damp = (i, e, t, n) => e + (i - e) * Math.exp(-t * n);
export function mergeGeometries(i, e = !1) {
  let t = i[0].index !== null,
    n = new Set(Object.keys(i[0].attributes)),
    s = new Set(Object.keys(i[0].morphAttributes)),
    o = {},
    r = {},
    a = i[0].morphTargetsRelative,
    l = new BufferGeometry(),
    c = 0;
  for (let u = 0; u < i.length; ++u) {
    let h = i[u],
      f = 0;
    if (t !== (h.index !== null))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            u +
            '. All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.',
        ),
        null
      );
    for (let p in h.attributes) {
      if (!n.has(p))
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              u +
              '. All geometries must have compatible attributes; make sure "' +
              p +
              '" attribute exists among all geometries, or in none of them.',
          ),
          null
        );
      (o[p] === void 0 && (o[p] = []), o[p].push(h.attributes[p]), f++);
    }
    if (f !== n.size)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            u +
            '. Make sure all geometries have the same number of attributes.',
        ),
        null
      );
    if (a !== h.morphTargetsRelative)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            u +
            '. .morphTargetsRelative must be consistent throughout all geometries.',
        ),
        null
      );
    for (let p in h.morphAttributes) {
      if (!s.has(p))
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              u +
              '.  .morphAttributes must be consistent throughout all geometries.',
          ),
          null
        );
      (r[p] === void 0 && (r[p] = []), r[p].push(h.morphAttributes[p]));
    }
    if (e) {
      let p;
      if (t) p = h.index.count;
      else if (h.attributes.position !== void 0) p = h.attributes.position.count;
      else
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              u +
              '. The geometry must have either an index or a position attribute',
          ),
          null
        );
      (l.addGroup(c, p, u), (c += p));
    }
  }
  if (t) {
    let u = 0,
      h = [];
    for (let f = 0; f < i.length; ++f) {
      let p = i[f].index;
      for (let d = 0; d < p.count; ++d) h.push(p.getX(d) + u);
      u += i[f].attributes.position.count;
    }
    l.setIndex(h);
  }
  for (let u in o) {
    let h = Ly(o[u]);
    if (!h)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the ' + u + ' attribute.',
        ),
        null
      );
    l.setAttribute(u, h);
  }
  for (let u in r) {
    let h = r[u][0].length;
    if (h === 0) break;
    ((l.morphAttributes = l.morphAttributes || {}), (l.morphAttributes[u] = []));
    for (let f = 0; f < h; ++f) {
      let p = [];
      for (let v = 0; v < r[u].length; ++v) p.push(r[u][v][f]);
      let d = Ly(p);
      if (!d)
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the ' + u + ' morphAttribute.',
          ),
          null
        );
      l.morphAttributes[u].push(d);
    }
  }
  return l;
}
export function Ly(i) {
  let e,
    t,
    n,
    s = -1,
    o = 0;
  for (let c = 0; c < i.length; ++c) {
    let u = i[c];
    if ((e === void 0 && (e = u.array.constructor), e !== u.array.constructor))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes.',
        ),
        null
      );
    if ((t === void 0 && (t = u.itemSize), t !== u.itemSize))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes.',
        ),
        null
      );
    if ((n === void 0 && (n = u.normalized), n !== u.normalized))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes.',
        ),
        null
      );
    if ((s === -1 && (s = u.gpuType), s !== u.gpuType))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes.',
        ),
        null
      );
    o += u.count * t;
  }
  let r = new e(o),
    a = new BufferAttribute(r, t, n),
    l = 0;
  for (let c = 0; c < i.length; ++c) {
    let u = i[c];
    if (u.isInterleavedBufferAttribute) {
      let h = l / t;
      for (let f = 0, p = u.count; f < p; f++)
        for (let d = 0; d < t; d++) {
          let v = u.getComponent(f, d);
          a.setComponent(f + h, d, v);
        }
    } else r.set(u.array, l);
    l += u.count * t;
  }
  return (s !== void 0 && (a.gpuType = s), a);
}
export var oa = new Vector3();
export function Wi(i, e, t, n = 0.02, s = 'center') {
  n = Math.min(n, i / 2 - 1e-4, e / 2 - 1e-4, t / 2 - 1e-4);
  let o = new BoxGeometry(i, e, t, 3, 3, 3),
    r = o.attributes.position,
    a = o.attributes.normal,
    l = o.attributes.uv,
    c = i / 2,
    u = e / 2,
    h = t / 2,
    f = (p, d) => {
      let v = Math.abs(p),
        g = Math.sign(p);
      return v > d - 1e-5 ? g * d : g * (d - n);
    };
  for (let p = 0; p < r.count; p++) {
    let d = f(r.getX(p), c),
      v = f(r.getY(p), u),
      g = f(r.getZ(p), h),
      x = Math.max(-(c - n), Math.min(c - n, d)),
      y = Math.max(-(u - n), Math.min(u - n, v)),
      b = Math.max(-(h - n), Math.min(h - n, g));
    if ((oa.set(d - x, v - y, g - b), oa.lengthSq() > 1e-10)) {
      oa.normalize();
      let M = a.getX(p),
        E = a.getY(p),
        w = a.getZ(p);
      (Math.abs(d) > c - 1e-5 ? 1 : 0) + (Math.abs(v) > u - 1e-5 ? 1 : 0) + (Math.abs(g) > h - 1e-5 ? 1 : 0) >= 2
        ? ((d = x + oa.x * n), (v = y + oa.y * n), (g = b + oa.z * n), a.setXYZ(p, oa.x, oa.y, oa.z))
        : a.setXYZ(p, M, E, w);
    }
    r.setXYZ(p, d, v, g);
    let m = Math.abs(a.getX(p)),
      A = Math.abs(a.getY(p)),
      _ = Math.abs(a.getZ(p));
    m >= A && m >= _ ? l.setXY(p, g, v) : A >= m && A >= _ ? l.setXY(p, d, g) : l.setXY(p, d, v);
  }
  return (s === 'bottom' && o.translate(0, e / 2, 0), o);
}
export function Fn(i, e = 0.03, t = 8, n = !1, s = 0) {
  let o = i.map((h) => (h.isVector3 ? h : new Vector3(h[0], h[1], h[2]))),
    r = new CatmullRomCurve3(o, n, 'catmullrom', s),
    a = r.getLength(),
    l = Math.max(2, Math.ceil(a / Math.max(0.08, e * 3))),
    c = new TubeGeometry(r, Math.min(l, 400), e, t, n),
    u = c.attributes.uv;
  for (let h = 0; h < u.count; h++) u.setXY(h, u.getX(h) * a, u.getY(h) * Math.PI * 2 * e);
  return c;
}
export function Ii(i) {
  let e = i
    .filter(Boolean)
    .map(
      (l) => (
        l.attributes.uv ||
          l.setAttribute('uv', new BufferAttribute(new Float32Array(l.attributes.position.count * 2), 2)),
        l.attributes.normal || l.computeVertexNormals(),
        l
      ),
    );
  if (!e.length) return new BufferGeometry();
  let t = e.some((l) => l.attributes.color),
    n = e.map((l) => {
      let c = (l.index, l);
      if (t && !c.attributes.color) {
        let u = new Float32Array(c.attributes.position.count * 3).fill(1);
        c.setAttribute('color', new BufferAttribute(u, 3));
      }
      for (let u of Object.keys(c.attributes))
        ['position', 'normal', 'uv', 'color'].includes(u) || c.deleteAttribute(u);
      return c;
    }),
    s = n.every((l) => l.index),
    o = n.every((l) => !l.index),
    r = s || o ? n : n.map((l) => (l.index ? l.toNonIndexed() : l));
  return mergeGeometries(r, !1) || new BufferGeometry();
}
export function yv(i) {
  let n = new Float32Array(4096),
    s = i >>> 0,
    o = () => {
      ((s |= 0), (s = (s + 1831565813) | 0));
      let l = Math.imul(s ^ (s >>> 15), 1 | s);
      return ((l = (l + Math.imul(l ^ (l >>> 7), 61 | l)) ^ l), ((l ^ (l >>> 14)) >>> 0) / 4294967296);
    };
  for (let l = 0; l < 4096; l++) n[l] = o();
  let r = (l, c) => {
    let u = Math.floor(l),
      h = Math.floor(c),
      f = l - u,
      p = c - h;
    ((f = f * f * (3 - 2 * f)), (p = p * p * (3 - 2 * p)));
    let d = u & 63,
      v = (u + 1) & 63,
      g = (h & 63) * 64,
      x = ((h + 1) & 63) * 64,
      y = n[g + d],
      b = n[g + v],
      m = n[x + d],
      A = n[x + v];
    return y + (b - y) * f + (m - y + (y - b - m + A) * f) * p;
  };
  return {
    noise: r,
    fbm: (l, c, u = 4) => {
      let h = 0,
        f = 0.5,
        p = 0;
      for (let d = 0; d < u; d++)
        ((h += r(l, c) * f), (p += f), (l = l * 2.03 + 17.1), (c = c * 2.03 + 9.7), (f *= 0.5));
      return h / p;
    },
    rnd: o,
  };
}
export var To = (i, e, t) => {
    let n = (t - i) / (e - i);
    return ((n = n < 0 ? 0 : n > 1 ? 1 : n), n * n * (3 - 2 * n));
  },
  Wc = 4,
  H1 = 2;
export function Bb(i = 128) {
  let e = i * Wc,
    t = i * H1,
    n = new Uint8Array(e * t * 4),
    s = yv(9173),
    o = new Float32Array(i * i),
    r = new Float32Array(i * i),
    a = new Float32Array(i * i);
  for (let c = 0; c < Wc * H1; c++) {
    let u = c % Wc,
      h = Math.floor(c / Wc),
      f = c * 13.37 + 3.1,
      p = c * 7.77 + 1.3;
    for (let d = 0; d < i; d++)
      for (let v = 0; v < i; v++) {
        let g = ((v + 0.5) / i) * 2 - 1,
          x = ((d + 0.5) / i) * 2 - 1,
          y = 1 - To(0.78, 0.98, Math.max(Math.abs(g), Math.abs(x))),
          b,
          m,
          A;
        if (c === 6) {
          let M = x * 0.5 + 0.5,
            E = 0.16 + 0.5 * M * M,
            w = (s.fbm(g * 2 + f, M * 2 + p, 3) - 0.5) * 0.25,
            S = 1 - To(E * 0.3, E, Math.abs(g + w * M)),
            z = s.fbm(g * 9 + f, M * 2.2 + p, 4),
            H = 1 - To(0.55, 0.95, M - (s.noise(g * 6 + f, 3.3) - 0.5) * 0.35),
            O = To(0, 0.12, M);
          ((b = S * H * O * To(0.22, 0.7, z + 0.25 * (1 - M))), (m = S * H), (A = b * 0.5));
        } else {
          let M = c === 7,
            E = M ? 0.3 : 0.6,
            w = (s.fbm(g * 1.4 + f, x * 1.4 + p, 3) - 0.5) * E,
            S = (s.fbm(g * 1.4 + p + 5.2, x * 1.4 + f + 1.7, 3) - 0.5) * E,
            z = g + w,
            H = x + S,
            O = Math.sqrt(z * z + H * H),
            q = (s.fbm(z * 2.2 + f, H * 2.2 + p, 3) - 0.5) * 0.6,
            U = 1 - To(0, M ? 0.84 : 0.8, O + q),
            T = s.fbm(z * 4.2 + f * 2, H * 4.2 + p * 2, 5),
            D = U * (M ? 0.8 + 0.7 * T : 0.25 + 1.5 * T);
          ((b = To(M ? 0.02 : 0.06, M ? 0.7 : 0.95, D)),
            (m = U),
            (A = U * 0.55 + U * s.fbm(z * 3.1 + f * 3, H * 3.1 + p * 3, 3) * 0.9));
        }
        let _ = d * i + v;
        ((r[_] = b * y), (a[_] = m), (o[_] = A * y));
      }
    for (let d = 0; d < i; d++)
      for (let v = 0; v < i; v++) {
        let g = Math.max(0, v - 2),
          x = Math.min(i - 1, v + 2),
          y = Math.max(0, d - 2),
          b = Math.min(i - 1, d + 2),
          m = ((o[d * i + x] - o[d * i + g]) * i) / 8,
          A = ((o[b * i + v] - o[y * i + v]) * i) / 8,
          _ = 0.55,
          M = -m * _,
          E = -A * _,
          w = 1 / Math.sqrt(M * M + E * E + 1);
        ((M *= w), (E *= w));
        let S = ((h * i + d) * e + u * i + v) * 4,
          z = d * i + v;
        ((n[S] = Math.round((M * 0.5 + 0.5) * 255)),
          (n[S + 1] = Math.round((E * 0.5 + 0.5) * 255)),
          (n[S + 2] = Math.min(255, a[z] * 255)),
          (n[S + 3] = Math.min(255, r[z] * 255)));
      }
  }
  let l = new DataTexture(n, e, t, RGBAFormat, UnsignedByteType);
  return (
    (l.magFilter = LinearFilter),
    (l.minFilter = LinearMipmapLinearFilter),
    (l.generateMipmaps = !0),
    (l.wrapS = l.wrapT = ClampToEdgeWrapping),
    (l.colorSpace = NoColorSpace),
    (l.needsUpdate = !0),
    l
  );
}
export var Af = 4,
  bv = 2,
  oo = 0,
  _v = 1,
  n0 = 2,
  OR = 3,
  Mv = 4,
  V1 = 5,
  Gc = 6,
  W1 = 7;
export function Ob(i = 128) {
  let e = i * Af,
    t = i * bv,
    n = new Uint8Array(e * t * 4),
    s = yv(4441),
    o = [0, 1].map(() => {
      let a = 7 + Math.floor(s.rnd() * 4),
        l = [];
      for (let c = 0; c < a; c++)
        l.push({
          a: (c / a + (s.rnd() - 0.5) * 0.12) * Math.PI * 2,
          l: 0.35 + s.rnd() * 0.6,
          w: 0.018 + s.rnd() * 0.05,
          g: 0.5 + s.rnd() * 0.5,
        });
      return l;
    });
  for (let a = 0; a < 8; a++) {
    let l = a % Af,
      c = Math.floor(a / Af);
    for (let u = 0; u < i; u++)
      for (let h = 0; h < i; h++) {
        let f = ((h + 0.5) / i) * 2 - 1,
          p = ((u + 0.5) / i) * 2 - 1,
          d = Math.sqrt(f * f + p * p),
          v = 1 - To(0.86, 0.99, Math.max(Math.abs(f), Math.abs(p))),
          g = 0;
        if (a === oo) {
          let b = Math.max(0, 1 - d);
          g = b * b * b * 0.75 + Math.exp(-d * d * 22) * 0.5;
        } else if (a === _v) {
          let b = Math.pow(Math.max(0, 1 - f * f), 1.5);
          g = Math.exp(-(p * p) / (0.42 * 0.42)) * b;
        } else if (a === n0 || a === OR) {
          let b = o[a - n0],
            m = Math.atan2(p, f);
          for (let A of b) {
            let _ = Math.abs(m - A.a) % (Math.PI * 2);
            _ > Math.PI && (_ = Math.PI * 2 - _);
            let M = Math.sin(Math.min(_, 1.5)) * d;
            _ < 1.5 &&
              (g += A.g * Math.exp(-(M * M) / (A.w * A.w * (0.4 + d))) * Math.pow(Math.max(0, 1 - d / A.l), 1.4));
          }
          g =
            g * (0.7 + 0.6 * s.fbm(f * 5 + a * 9, p * 5, 3)) +
            Math.exp(-d * d * 70) * 1.2 +
            Math.max(0, 1 - d * 2.2) * 0.06;
        } else if (a === Mv) {
          let b = Math.atan2(p, f),
            m = 0.78 + (s.noise(Math.cos(b) * 2 + 5, Math.sin(b) * 2 + 5) - 0.5) * 0.04;
          g =
            Math.exp(-((d - m) * (d - m)) / (0.03 * 0.03)) *
              (0.6 + 0.4 * s.noise(Math.cos(b) * 5 + 9, Math.sin(b) * 5 + 9)) +
            0.05 * To(0.2, 0.78, d) * (1 - To(0.78, 0.8, d));
        } else if (a === V1) {
          let b = (s.fbm(f * 1.6 + 3.3, p * 1.6 + 8.1, 3) - 0.5) * 0.5,
            m = (s.fbm(f * 1.6 + 7.7, p * 1.6 + 2.2, 3) - 0.5) * 0.5,
            A = f + b,
            _ = p + m,
            M = Math.sqrt(A * A + _ * _),
            E = 1 - To(0, 0.84, M),
            w = s.fbm(A * 4 + 1.1, _ * 4 + 6.6, 5);
          g = To(0.04, 0.9, E * (0.3 + 1.4 * w)) * (0.45 + 0.75 * E);
        } else if (a === Gc) g = 1 - To(0.3, 0.62, d);
        else if (a === W1) {
          let b = f * 0.5 + 0.5,
            m = 0.22 + 0.3 * b,
            A = Math.exp(-(p * p) / (m * m)) * Math.pow(b, 1.8),
            _ = (f - 0.8) / 0.16;
          (f > 0.8 && (A *= Math.max(0, 1 - _ * _)), (g = A * 1.15));
        }
        g *= v;
        let x = Math.max(0, Math.min(255, g * 255)),
          y = ((c * i + u) * e + l * i + h) * 4;
        ((n[y] = n[y + 1] = n[y + 2] = x), (n[y + 3] = 255));
      }
  }
  let r = new DataTexture(n, e, t, RGBAFormat, UnsignedByteType);
  return (
    (r.magFilter = LinearFilter),
    (r.minFilter = LinearMipmapLinearFilter),
    (r.generateMipmaps = !0),
    (r.wrapS = r.wrapT = ClampToEdgeWrapping),
    (r.colorSpace = NoColorSpace),
    (r.needsUpdate = !0),
    r
  );
}
export var dl = 4,
  xv = 2,
  da = { bullet_metal: [0, 1], bullet_concrete: [2, 3], bullet_wood: [4], scorch: [5], soot: [6], bullet_glass: [7] };
export function Hb(i = 256) {
  let e = i * dl,
    t = i * xv,
    n = document.createElement('canvas');
  ((n.width = e), (n.height = t));
  let s = document.createElement('canvas');
  ((s.width = e), (s.height = t));
  let o = document.createElement('canvas');
  ((o.width = e), (o.height = t));
  let r = n.getContext('2d'),
    a = s.getContext('2d'),
    l = o.getContext('2d', { willReadFrequently: !0 });
  ((l.fillStyle = 'rgb(128,128,128)'), l.fillRect(0, 0, e, t));
  let c = (_, M) => {
      let E = l.createRadialGradient(0, 0, 0, 0, 0, M);
      for (let [w, S] of _) E.addColorStop(w, `rgb(${S},${S},${S})`);
      ((l.fillStyle = E), l.beginPath(), l.arc(0, 0, M, 0, Math.PI * 2), l.fill());
    },
    h = yv(77123).rnd;
  ((a.fillStyle = 'rgb(0,235,0)'), a.fillRect(0, 0, e, t));
  let f = Math.PI * 2,
    p = (_, M, E, w = 22, S = 1) => {
      _.beginPath();
      for (let z = 0; z < w; z++) {
        let H = (z / w) * f,
          O = M * (1 + (h() - 0.5) * E),
          q = Math.cos(H) * O,
          U = Math.sin(H) * O * S;
        z ? _.lineTo(q, U) : _.moveTo(q, U);
      }
      _.closePath();
    },
    d = (_, M, E, w, S, z, H) => {
      _.beginPath();
      let O = E,
        q = M;
      _.moveTo(Math.cos(q) * O, Math.sin(q) * O);
      let U = 5 + Math.floor(h() * 4);
      for (let T = 1; T <= U; T++)
        ((O = E + ((w - E) * T) / U), (q += (h() - 0.5) * S), _.lineTo(Math.cos(q) * O, Math.sin(q) * O));
      ((_.strokeStyle = H), (_.lineWidth = z), (_.lineCap = 'round'), (_.lineJoin = 'round'), _.stroke());
    },
    v = (_, M) => {
      let E = ((_ % dl) + 0.5) * i,
        w = (Math.floor(_ / dl) + 0.5) * i,
        S = i / 2;
      for (let z of [r, a, l]) (z.save(), z.beginPath(), z.rect(E - S, w - S, i, i), z.clip(), z.translate(E, w));
      (M(S), r.restore(), a.restore(), l.restore());
    },
    g = (_, M, E, w) => {
      let S = _.createRadialGradient(0, 0, M, 0, 0, E);
      for (let [z, H] of w) S.addColorStop(z, H);
      return S;
    };
  for (let _ of da.bullet_metal)
    v(_, (M) => {
      ((r.fillStyle = g(r, M * 0.1, M * 0.6, [
        [0, 'rgba(14,13,12,0.4)'],
        [0.5, 'rgba(18,17,16,0.14)'],
        [1, 'rgba(20,20,20,0)'],
      ])),
        r.fillRect(-M, -M, 2 * M, 2 * M));
      let E = 6 + Math.floor(h() * 5);
      for (let T = 0; T < E; T++) {
        let D = h() * f;
        d(r, D, M * 0.2, M * (0.38 + h() * 0.45), 0.3, 0.8 + h() * 1, 'rgba(8,8,8,0.55)');
      }
      let w = M * (0.24 + h() * 0.08),
        S = 0.7 + h() * 0.5,
        z = h() * f,
        H = (T, D, C, G, j, N) => {
          for (let F of [r, a]) (F.save(), F.translate(T, D), F.rotate(G));
          let Q = [];
          for (let F = 0; F < N; F++) Q.push(1 + (h() - 0.5) * j);
          let K = (F, X) => {
            F.beginPath();
            for (let ne = 0; ne < N; ne++) {
              let re = (ne / N) * f,
                $ = C * Q[ne] * X,
                ue = Math.cos(re) * $,
                me = Math.sin(re) * $ * S;
              ne ? F.lineTo(ue, me) : F.moveTo(ue, me);
            }
            F.closePath();
          };
          (K(r, 1),
            (r.lineJoin = 'miter'),
            (r.strokeStyle = 'rgba(92,54,36,0.95)'),
            (r.lineWidth = Math.max(1.5, C * 0.14)),
            r.stroke());
          let ie = 150 + Math.floor(h() * 50);
          (K(r, 1),
            (r.fillStyle = g(r, 0, C * 1.2, [
              [0, `rgb(${ie - 30},${ie - 26},${ie - 20})`],
              [0.7, `rgb(${ie + 30},${ie + 33},${ie + 36})`],
              [1, `rgb(${ie},${ie + 3},${ie + 6})`],
            ])),
            r.fill(),
            K(a, 1),
            (a.fillStyle = 'rgb(0,85,255)'),
            a.fill(),
            r.restore(),
            a.restore());
        };
      H(0, 0, w, z, 0.75, 11);
      let O = 2 + Math.floor(h() * 4);
      for (let T = 0; T < O; T++) {
        let D = h() * f,
          C = w * (1 + h() * 0.7);
        H(Math.cos(D) * C, Math.sin(D) * C, w * (0.15 + h() * 0.3), h() * f, 0.8, 7);
      }
      for (let T = 0; T < 9; T++) {
        let D = h() * f,
          C = w * 0.3,
          G = w * (0.6 + h() * 0.3);
        (r.beginPath(),
          r.moveTo(Math.cos(D) * C, Math.sin(D) * C),
          r.lineTo(Math.cos(D + 0.1) * G, Math.sin(D + 0.1) * G),
          (r.strokeStyle = h() < 0.5 ? 'rgba(245,246,248,0.7)' : 'rgba(70,72,76,0.5)'),
          (r.lineWidth = 0.8),
          r.stroke());
      }
      let q = M * (0.1 + h() * 0.025),
        U = 8 + Math.floor(h() * 5);
      for (let T = 0; T < U; T++) {
        if (h() < 0.15) continue;
        let D = ((T + (h() - 0.5) * 0.6) / U) * f,
          C = q * (1.25 + h() * 0.9),
          G = 0.16 + h() * 0.16,
          j = 205 + Math.floor(h() * 50);
        (r.beginPath(),
          r.moveTo(Math.cos(D - G) * q * 0.9, Math.sin(D - G) * q * 0.9),
          r.lineTo(Math.cos(D) * C, Math.sin(D) * C),
          r.lineTo(Math.cos(D + G) * q * 0.9, Math.sin(D + G) * q * 0.9),
          r.closePath(),
          (r.fillStyle = `rgb(${j},${j},${Math.min(255, j + 4)})`),
          r.fill(),
          (r.strokeStyle = 'rgba(40,40,42,0.6)'),
          (r.lineWidth = 0.7),
          r.stroke());
      }
      (a.beginPath(),
        a.arc(0, 0, q * 1.8, 0, f),
        (a.fillStyle = 'rgb(0,60,255)'),
        a.fill(),
        p(r, q, 0.3, 11),
        (r.fillStyle = g(r, 0, q, [
          [0, '#000000'],
          [0.8, '#040404'],
          [1, '#141414'],
        ])),
        r.fill(),
        c(
          [
            [0, 0],
            [0.26, 10],
            [0.36, 240],
            [0.5, 200],
            [0.62, 100],
            [1, 128],
          ],
          q * 3.4,
        ),
        p(a, q, 0.1, 11),
        (a.fillStyle = 'rgb(0,250,0)'),
        a.fill());
    });
  for (let _ of da.bullet_concrete)
    v(_, (M) => {
      ((r.fillStyle = g(r, M * 0.2, M * 0.9, [
        [0, 'rgba(186,180,168,0.22)'],
        [0.6, 'rgba(180,175,165,0.07)'],
        [1, 'rgba(170,165,155,0)'],
      ])),
        r.fillRect(-M, -M, 2 * M, 2 * M));
      let E = 4 + Math.floor(h() * 4);
      for (let O = 0; O < E; O++) {
        let q = h() * f,
          U = M * (0.5 + h() * 0.42);
        (d(r, q, M * 0.25, U, 0.35, 1.3 + h() * 1.3, 'rgba(20,19,18,0.75)'),
          h() < 0.5 && d(r, q + (h() - 0.5) * 0.6, U * 0.7, U * 1.05, 0.6, 0.9, 'rgba(20,19,18,0.5)'));
      }
      let w = M * (0.33 + h() * 0.09),
        S = 12,
        z = [];
      for (let O = 0; O < S; O++) z.push(1 + (h() - 0.5) * 0.6);
      let H = (O, q, U, T) => {
        O.beginPath();
        for (let D = 0; D < S; D++) {
          let C = (D / S) * f,
            G = w * z[D] * q;
          D ? O.lineTo(Math.cos(C) * G + U, Math.sin(C) * G + T) : O.moveTo(Math.cos(C) * G + U, Math.sin(C) * G + T);
        }
        O.closePath();
      };
      (H(r, 1.05, 1.5, 1.5),
        (r.fillStyle = 'rgba(22,21,20,0.8)'),
        r.fill(),
        H(r, 1, 0, 0),
        (r.fillStyle = g(r, w * 0.1, w * 1.1, [
          [0, '#35332f'],
          [0.4, '#6f6b63'],
          [0.8, '#8f8b82'],
          [1, '#9a968c'],
        ])),
        r.fill(),
        H(r, 0.97, -1, -1),
        (r.strokeStyle = 'rgba(206,201,190,0.55)'),
        (r.lineWidth = 1.2),
        r.stroke());
      for (let O = 0; O < 6; O++) {
        let q = h() * f;
        d(r, q, w * 0.2, w * 0.9, 0.5, 1, 'rgba(28,27,25,0.5)');
      }
      for (let O = 0; O < 60; O++) {
        let q = h() * f,
          U = Math.sqrt(h()) * w * 0.85;
        ((r.fillStyle = h() < 0.55 ? 'rgba(36,34,32,0.6)' : 'rgba(196,191,180,0.6)'),
          r.beginPath(),
          r.arc(Math.cos(q) * U, Math.sin(q) * U, 0.7 + h() * 2, 0, f),
          r.fill());
      }
      (p(r, w * 0.3, 0.45, 9),
        (r.fillStyle = g(r, 0, w * 0.33, [
          [0, '#060606'],
          [0.7, '#161514'],
          [1, '#2c2a27'],
        ])),
        r.fill(),
        c(
          [
            [0, 0],
            [0.24, 20],
            [0.3, 70],
            [0.8, 112],
            [0.88, 150],
            [1, 128],
          ],
          w * 1.15,
        ));
      for (let O = 0; O < 22; O++) {
        let q = h() * f,
          U = w * (1.15 + h() * 1.3);
        ((r.fillStyle = h() < 0.5 ? 'rgba(190,185,175,0.45)' : 'rgba(30,29,27,0.45)'),
          r.beginPath(),
          r.arc(Math.cos(q) * U, Math.sin(q) * U, 0.6 + h() * 1.6, 0, f),
          r.fill());
      }
    });
  for (let _ of da.bullet_wood)
    v(_, (M) => {
      (p(r, M * 0.27, 0.7, 11, 1.45), (r.fillStyle = 'rgba(206,182,140,0.85)'), r.fill());
      for (let E = 0; E < 46; E++) {
        let w = (h() - 0.5) * M * 0.62,
          S = M * (0.25 + h() * 0.6) * (1 - Math.abs(w) / (M * 0.4)),
          z = (h() - 0.5) * M * 0.2;
        (r.beginPath(),
          r.moveTo(w, z - S),
          r.lineTo(w + (h() - 0.5) * 5, z + S),
          (r.strokeStyle = h() < 0.5 ? 'rgba(236,216,172,0.85)' : 'rgba(88,62,38,0.7)'),
          (r.lineWidth = 0.8 + h() * 2.2),
          r.stroke());
      }
      (p(r, M * 0.1, 0.5, 9, 1.1),
        (r.fillStyle = g(r, 0, M * 0.12, [
          [0, '#050403'],
          [0.8, '#140f0a'],
          [1, '#3a2a1a'],
        ])),
        r.fill(),
        c(
          [
            [0, 0],
            [0.5, 30],
            [0.8, 140],
            [1, 128],
          ],
          M * 0.17,
        ));
    });
  for (let _ of da.scorch)
    v(_, (M) => {
      ((r.fillStyle = g(r, 0, M * 0.98, [
        [0, 'rgba(6,5,5,0.92)'],
        [0.3, 'rgba(10,9,8,0.85)'],
        [0.55, 'rgba(22,18,15,0.5)'],
        [0.8, 'rgba(30,24,20,0.16)'],
        [1, 'rgba(30,24,20,0)'],
      ])),
        r.fillRect(-M, -M, 2 * M, 2 * M));
      for (let E = 0; E < 90; E++) {
        let w = h() * f,
          S = M * (0.1 + h() * 0.3),
          z = M * (0.5 + h() * 0.46);
        (r.beginPath(),
          r.moveTo(Math.cos(w - 0.03) * S, Math.sin(w - 0.03) * S),
          r.lineTo(Math.cos(w) * z, Math.sin(w) * z),
          r.lineTo(Math.cos(w + 0.03) * S, Math.sin(w + 0.03) * S),
          r.closePath(),
          (r.fillStyle = `rgba(8,7,6,${0.12 + h() * 0.3})`),
          r.fill());
      }
      for (let E = 0; E < 60; E++) {
        let w = h() * f,
          S = M * (0.15 + h() * 0.6);
        ((r.fillStyle = h() < 0.3 ? 'rgba(150,140,128,0.25)' : 'rgba(0,0,0,0.4)'),
          r.beginPath(),
          r.arc(Math.cos(w) * S, Math.sin(w) * S, 1 + h() * 4, 0, f),
          r.fill());
      }
    });
  for (let _ of da.soot)
    v(_, (M) => {
      for (let E = 0; E < 14; E++) {
        let w = h() * f,
          S = h() * M * 0.3,
          z = M * (0.15 + h() * 0.3),
          H = Math.cos(w) * S,
          O = Math.sin(w) * S,
          q = r.createRadialGradient(H, O, 0, H, O, z);
        (q.addColorStop(0, 'rgba(8,8,8,0.4)'),
          q.addColorStop(1, 'rgba(8,8,8,0)'),
          (r.fillStyle = q),
          r.fillRect(-M, -M, 2 * M, 2 * M));
      }
      (p(r, M * 0.1, 0.4, 12), (r.fillStyle = 'rgba(0,0,0,0.9)'), r.fill());
    });
  for (let _ of da.bullet_glass)
    v(_, (M) => {
      ((r.fillStyle = g(r, 0, M * 0.5, [
        [0, 'rgba(235,240,242,0.55)'],
        [1, 'rgba(235,240,242,0)'],
      ])),
        r.fillRect(-M, -M, 2 * M, 2 * M));
      for (let E = 0; E < 13; E++) {
        let w = ((E + h() * 0.6) / 13) * f;
        d(r, w, M * 0.07, M * (0.5 + h() * 0.45), 0.12, 0.9 + h(), 'rgba(240,246,248,0.85)');
      }
      for (let E = 0; E < 3; E++) {
        let w = M * (0.2 + E * 0.17 + h() * 0.05);
        for (let S = 0; S < 9; S++) {
          if (h() < 0.45) continue;
          let z = (S / 9) * f;
          (r.beginPath(),
            r.arc(0, 0, w, z, z + 0.5),
            (r.strokeStyle = 'rgba(240,246,248,0.6)'),
            (r.lineWidth = 1),
            r.stroke());
        }
      }
      (p(r, M * 0.07, 0.3, 10), (r.fillStyle = '#060606'), r.fill());
    });
  let x = new CanvasTexture(n);
  ((x.colorSpace = SRGBColorSpace), (x.anisotropy = 4));
  let y = new CanvasTexture(s);
  y.colorSpace = NoColorSpace;
  let b = 2 / i,
    m = (_) => {
      let M = _ % dl,
        E = Math.floor(_ / dl);
      return [(M + b) / dl, 1 - (E + 1 - b) / xv, (M + 1 - b) / dl, 1 - (E + b) / xv];
    },
    A = null;
  try {
    let _ = l.getImageData(0, 0, e, t),
      M = _.data;
    if (M && M.length === e * t * 4) {
      let E = l.createImageData(e, t),
        w = E.data,
        S = 5 / 255;
      for (let z = 0; z < t; z++) {
        let H = Math.max(0, z - 1) * e,
          O = Math.min(t - 1, z + 1) * e;
        for (let q = 0; q < e; q++) {
          let U = Math.max(0, q - 1),
            T = Math.min(e - 1, q + 1),
            D = (M[(z * e + T) * 4] - M[(z * e + U) * 4]) * S,
            C = (M[(O + q) * 4] - M[(H + q) * 4]) * S,
            G = 1 / Math.sqrt(D * D + C * C + 1),
            j = (z * e + q) * 4;
          ((w[j] = (-D * G * 0.5 + 0.5) * 255),
            (w[j + 1] = (C * G * 0.5 + 0.5) * 255),
            (w[j + 2] = (G * 0.5 + 0.5) * 255),
            (w[j + 3] = 255));
        }
      }
      (l.putImageData(E, 0, 0), (A = new CanvasTexture(o)), (A.colorSpace = NoColorSpace));
    }
  } catch {
    A = null;
  }
  return { map: x, orm: y, nrm: A, uv: m };
}
