// What a threat looks like: the figure named by the archetype's `body.figure`, built once per kind and drawn per
// threat. threats.js decides and moves; a figure only shows it. The contract every figure keeps:
//
//   root            an Object3D that threats.js places at the threat's position and turns to its yaw (facing -Z)
//   lens            a material whose colour threats.js sets (calm, hot, the flare before a burst)
//   update(dt, v)   pose for this frame from the view `v` (below), alive or dead
//   muzzle(out, aim?)  where its shots leave, in the world
//   fired()         a shot left (recoil)
//   hit(dir, amount, part)   a round arrived along `dir` (a reaction, not damage)
//   die(dir)        it was killed; update() goes on posing the fall or the wreck
//   setFar(far)     the far tier (same bones, fewer triangles), chosen by distance to the camera
//   zones()         optional: hit volumes in the world as capsules { a, b, r, part }; without it the threat is an
//                   upright cylinder (threats.js)
//   machine         true for a machine (it sparks and smokes when hit or wrecked)
//   dispose()       its own materials; the geometry is the kind's and is kept
//
// The view `v`: { pos, yaw, vx, vy, vz, alive, health (0..1), engaged, target (a point or null), aim ('idle' | 'tele' |
// 'burst'), melee (null | 'wind' | 'lunge' | 'recover'), alert, crouch (0..1) }.
//
// The machine rigs are lifted (rigs.js, quadruped.js, quadcopter.js); `person` is the engine's own plain figure.
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, ShaderMaterial } from '../../../vendor/three.module.js';
import { buildQuadcopterRig, buildQuadrupedRig, setRigDetail } from './rigs.js';
import { createQuadruped } from './quadruped.js';
import { createQuadcopter, createSearchlight } from './quadcopter.js';
import { createPlainPerson } from './plain.js';
import { createRng } from '../../shared/lifted.js';

/** Beyond this distance from the camera a figure draws its far tier. */
export const FAR_METRES = 18;
export const FIGURES = ['person', 'quadruped', 'quadcopter'];
export { createSearchlight };

const kits = new WeakMap(); // G.mats -> { kind -> kit }
/** The machines' materials, as the stand-in's enemy module made them (bundle 846), from the engine's material set. */
function machineMats(G) {
  const em = G.mats.emissive ? G.mats.emissive(0xffffff, 1) : null;
  const glow = em && em.isMeshBasicMaterial ? em.clone() : new MeshBasicMaterial();
  glow.color.setRGB(1, 1, 1); glow.vertexColors = true; glow.needsUpdate = true;
  const lens = G.mats.emissive ? G.mats.emissive(0xffa040, 6) : null;
  const toneMapped = em && em.toneMapped !== undefined ? em.toneMapped : true;
  return {
    shell: G.mats.get('armor_white', { triplanar: true, vertexColors: true }),
    metal: G.mats.get('gunmetal', { triplanar: true, vertexColors: true }),
    glow, lensBase: lens && lens.isMeshBasicMaterial ? lens : new MeshBasicMaterial({ color: 0xffa040 }),
    disc: new MeshBasicMaterial({ color: 0x0c0d0f, transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide, toneMapped }),
    cone: new ShaderMaterial({ // the lamp's beam: brightest along its axis and near the lamp, nothing at its end
      uniforms: { uColor: { value: new Color(1, 0.9, 0.74) }, uGain: { value: 0.085 } },
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          #include <beginnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
          vN = normalMatrix * objectNormal; vV = -mv.xyz; vT = 1.0 - uv.y;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uGain;
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          f = f * f * (3.0 - 2.0 * f);
          float t = clamp(vT, 0.0, 1.0);
          float k = pow(1.0 - t, 1.7) * (0.35 + 0.65 * smoothstep(0.0, 0.06, t));
          gl_FragColor = vec4(uColor * (uGain * f * k), 1.0);
        }`,
      transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
    }),
  };
}
const RIGS = { quadruped: buildQuadrupedRig, quadcopter: buildQuadcopterRig };
function kitOf(G, kind) {
  let byKind = kits.get(G.mats); if (!byKind) kits.set(G.mats, (byKind = {}));
  if (byKind[kind]) return byKind[kind];
  let mats = byKind.machineMats; if (!mats) mats = byKind.machineMats = machineMats(G);
  setRigDetail(0); const near = RIGS[kind]();
  setRigDetail(1); const far = RIGS[kind](); setRigDetail(0);
  return (byKind[kind] = { near, far, mats });
}

/** Which figure an archetype draws. */
export const figureOf = (def) => def.body.figure || (def.type === 'air' ? 'quadcopter' : 'person');

/** A seeded random stream from a name (FNV-1a): the same threat id looks and moves the same every time. */
export function rngOf(name) { let h = 2166136261; for (const ch of String(name)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return createRng(h >>> 0); }

/** A new figure for one threat of archetype `def`; `seed` (its id) picks its variant and its little randomness. */
export function createFigure(G, def, seed) {
  const kind = figureOf(def), rng = rngOf(def.id + '/' + seed);
  if (kind === 'quadruped') return Object.assign(createQuadruped(G, kitOf(G, kind), rng), { machine: true });
  if (kind === 'quadcopter') return Object.assign(createQuadcopter(G, kitOf(G, kind), rng), { machine: true });
  return createPlainPerson(G, def, rng);
}

/** Triangles of each figure kind at each tier, for the budgets (GAMEPLAY-PARITY.md J). */
export function figureTriangles(G) {
  const out = {};
  for (const kind of Object.keys(RIGS)) { const k = kitOf(G, kind); out[kind] = { near: k.near.tris + (k.near.extra ? k.near.extra.tris : 0), far: k.far.tris + (k.far.extra ? k.far.extra.tris : 0) }; }
  return out;
}
