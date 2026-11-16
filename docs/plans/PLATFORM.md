# Plan: the platform around the engine — contracts, the phone gateway, scenarios, a reference host

Written 2026-11-16. It covers what a developer needs beside the engine to build and run a mission, cut into
items one agent can execute as they stand. An agent reads `AGENTS.md`, "Rules for every item" of
`GAMEPLAY-PARITY.md` (they apply here unchanged), and its own item. Decisions behind the designs: `../DECISIONS.md`.

## Order and dependencies

```
PL-1 contracts constant      (after GAMEPLAY-PARITY B is merged: it adds one line to engine/index.js too)
PL-2 gateway: detail, replay ─────────────────────────────► (hosts that score reports depend on it)
PL-3 scenario runtime + vectors   (after GAMEPLAY-PARITY G is merged: G owns engine/host/**)
        └──► PL-4 reference host ──► PL-6 author guide
PL-5 skill-tree format            (waits for a maintainer decision)
```

PL-1, PL-2 and PL-3 share no file and may run together. Ports for anything served: 9765 to 9769 on 127.0.0.1.

| Item | What | Size | Model | Review (planning model) checks |
|---|---|---|---|---|
| PL-1 | One constant per contract, and a test that ties it to `CONTRACTS.md` | S | Sonnet | The test fails when the table and the code differ |
| PL-2 | The gateway passes the whole Cursor-on-Target event, numbers and replays events, refuses hostile XML | M | Sonnet | The limits, by running the tests with oversized and hostile input |
| PL-3 | `opus-scenario/1`: validator, runtime, conformance vectors; the development hosts read it | L | Sonnet | Every kind of the format has a vector; the runtime holds no clock of its own |
| PL-4 | A reference host and mission client that speak `opus-session/1` over a socket | L | Sonnet | A mission plays in a browser against it; protocol rules 2 and 3 hold |
| PL-5 | The skill-tree format and viewer, published | M | Sonnet | Nothing but structure is published |
| PL-6 | "Write your first scenario": a guide that is executed, not only read | S | Sonnet | Following it on a clean clone works |

---

## PL-1. One constant per contract

**Goal.** The identifiers in `docs/CONTRACTS.md` exist once in code and cannot drift from the document.

**Owns.** `engine/src/world/contracts.js` (new), `engine/test/contracts.test.js` (new); one export line in
`engine/index.js`.

**Design.**

```js
// engine/src/world/contracts.js
export const CONTRACTS = Object.freeze({
  world: 1, scene: 'opus-scene/1', sceneMinor: 1, content: 'opus-content/1',
  session: 'opus-session/1', scenario: 'opus-scenario/1',
});
```

`engine/index.js`: `export { CONTRACTS } from './src/world/contracts.js';`. Do not replace existing literals in
other modules in this item (other branches are editing them); instead the test below reads them.

**Tests** (`contracts.test.js`): (1) every backticked identifier in the "Identifier" column of
`docs/CONTRACTS.md` that starts with `opus-` appears as a value of `CONTRACTS`, and every `opus-…/N` value of
`CONTRACTS` appears in that column; (2) `CONTRACTS.world` equals `world.version` of a world opened with
`test/headless.js`; (3) `CONTRACTS.scene` equals the `format` of `scenes/old-quebec.json`; (4) the object is frozen.

**Done.** `node --test` green; `docs/CONTRACTS.md` rule 5 says "built" with the date.

---

## PL-2. The gateway passes the whole event, numbers it, replays it

**Goal.** A host that scores what the trainee did in ATAK gets everything ATAK shared (remarks, chat text, route
points, shapes), cannot be made to miss an event by a dropped connection, and cannot be attacked through the XML.

**Owns.** `phone/local/gateway.py`, `phone/local/test_gateway.py`, `phone/README.md` ("What flows", "Scoring from
what ATAK shares"). No page code changes: pages ignore fields they do not know.

**Design.** All additive to the messages in `phone/README.md`.

1. `parse_cot(raw)` returns, beside today's keys:

   | Key | From | Rule |
   |---|---|---|
   | `time`, `start`, `stale` | the event's attributes | strings as given, at most 40 characters each, else `null` |
   | `hae`, `ce`, `le` | the point's attributes | floats, `null` when absent or not finite |
   | `detail` | the `<detail>` element | a tree: `{ "t": tag, "a": { attribute: value }, "x": text, "c": [ children ] }`; `a`, `x`, `c` omitted when empty; text stripped. Limits: depth 8, 256 elements, 64 attributes per element, 2 048 characters per text or attribute value (longer is cut), and the tree serialised as JSON at most 16 384 bytes. Past any limit except the per-value cut: `"detail": null, "detailDropped": "size"` |

   ```json
   { "type": "cot", "seq": 12, "uid": "…", "cot": "a-h-G", "how": "h-g-i-g-o", "lat": 46.8126, "lon": -71.2058,
     "hae": 61.2, "ce": 9999999.0, "le": 9999999.0, "time": "2026-11-16T15:04:05Z", "start": "…", "stale": "…",
     "callsign": "R 1",
     "detail": { "t": "detail", "c": [ { "t": "contact", "a": { "callsign": "R 1" } },
                                        { "t": "remarks", "x": "two sentries at the gate" } ] } }
   ```

2. **Hostile XML.** Before parsing, an event whose bytes contain `<!DOCTYPE` or `<!ENTITY` (any case) is dropped
   and counted; an event longer than 262 144 bytes is dropped and counted. `split_events` already caps the
   buffer. The counts are printed once a minute when they changed (`[gateway] dropped N events`), never per event.
3. **Numbering and replay.** A class `EventRing(size=256)`: `add(message) -> seq` (1, 2, 3, … for the life of the
   process) and `after(seq) -> [messages]` (those with a greater number still held, in order). Every `cot`
   message is given `seq` and added before it is broadcast. A page message `{"t": "replay", "after": <int>}` is
   answered, to that page only, with the held messages after that number. A page that never asks gets what it
   gets today.
4. **`{"t": "keyframe"}`** from a page calls `reset_video()` (a viewer that dropped frames asks for a fresh one).
5. **`{"type": "tak", "connected": true|false}`** is sent to every page when ATAK connects to or leaves the
   Cursor-on-Target port, and to a page when it connects.
6. **`--record-cot DIR`**: each accepted event's raw XML is also written to `DIR/<seq>-<type>.xml` (the type with
   anything but letters, digits and `-` replaced by `_`). For building test fixtures.

**Tests** (`python3 -m unittest phone/local/test_gateway.py`), each a new case:

- A marker event with `<detail><contact callsign="R 1"/><remarks>two sentries</remarks></detail>` parses to the
  tree above; `hae` 61.2; a point without `hae` gives `null`.
- A detail 9 levels deep, one with 300 elements, and one whose JSON exceeds 16 384 bytes each give
  `detail: null, detailDropped: "size"` and the rest of the message intact. A 5 000-character remark is cut to 2 048.
- An event containing `<!DOCTYPE` and one containing `<!entity` are dropped; the next event in the same buffer
  is still parsed.
- `EventRing(3)`: after adding five messages `after(0)` returns numbers 3, 4, 5; `after(4)` returns 5; `after(9)` returns none.
- The recorded file name for sequence 7 and type `a-h-G` is `7-a-h-G.xml`; for type `b/../x` it is `7-b____x.xml`.

**Proof.** With a device running (`phone/local/run.sh`, under `flock /tmp/opus-emulator.lock`): drop a marker
with a remark in ATAK and send it; the gateway's page message carries the remark in `detail`. If no device can be
run, say so: the unit tests then stand alone.

**Done.** Tests green; `phone/README.md` lists every new key and message; `docs/CONTRACTS.md` "Phone gateway" row
names the date.

---

## PL-3. `opus-scenario/1`: validator, runtime, vectors

**Goal.** `docs/SCENARIO-FORMAT.md` exists as code that any host can use, with vectors another implementation
can be checked against.

**Owns.** `scenario/**` (new, at the repository root: `validate.js`, `run.js`, `text.js`, `test/*.test.js`,
`vectors/*.json`, `package.json` with `"type": "module"`), `engine/host/mission.js` and
`engine/host/scenarios/*.json`, `phone/scenarios/*.json`, `phone/demo.js` (the lines that load a scenario).
Depends on GAMEPLAY-PARITY G.

**Design.** Pure modules: no DOM, no three.js, no engine import, no timer. They import nothing outside `scenario/`.

```js
// scenario/validate.js
validateScenario(data, { extent, toGame }) -> { scenario, errors: string[] }
//   extent: { minX, maxX, minZ, maxZ } of the scene; toGame(lat, lon) -> { x, z } (for places given as lat, lon)
//   scenario: the normalised form (places in game metres, development-shape `when` rewritten, defaults filled)
// scenario/text.js
resolveText(text, lang) -> string           // SCENARIO-FORMAT 2, "Text"; applied to every command by run.js
// scenario/run.js
createRun(scenario, { lang = 'en', maxSpeed = 12, slack = 4, margin = 5, extent }) -> run
run.deploy(t)            -> { deploy: { at, cmds }, progress }
run.pos(t, { x, z })     -> { accepted: boolean, out: Message[] }      // bounds as SESSION-PROTOCOL 4, rule 4
run.event(t, kind, data) -> Message[]
run.cot(t, cot)          -> Message[]       // cot: the gateway's message, with x, z in game metres added by the caller
run.tick(t)              -> Message[]       // timers: rules with `after`, `time` triggers, `within`, zone `seconds`
run.standing()           -> ScenarioCommand[]   // `clear`, then everything that stands: for a resume
run.state()              -> { playing, done, total, objectives, breaches, seconds(t) }
```

`t` is seconds since the host's own start, given by the caller on every call: the runtime holds no clock.
`Message` is a host-to-client message of the protocol without `seq` (`{ t: 'cmd', cmd }`, `{ t: 'progress', … }`,
`{ t: 'debrief', … }`); the caller numbers commands. Rules fire in file order; a rule's commands are queued at
`t + after` and released by the first call at or after that time.

`engine/host/mission.js` becomes an adapter: load, `validateScenario`, `createRun`, feed it from `world.on(…)` and
`world.snapshot().self` five times a second, call `tick` every 0.25 s from the page's own timer, apply what comes
out with `world.apply`. The phone demo feeds `run.cot`. The three development scenarios are rewritten in the
format (same places, same words, same order of events), each gaining `format`, `id`, `objectives`.

**Tests.**

- `validate.test.js`: the example of `SCENARIO-FORMAT.md` 2 is valid; each of these is one error naming its
  subject: no `format`; an objective with two checks; a `reached` naming a mark no command places; a place
  outside the extent; an unknown check kind (message contains the kind); `after` naming a missing objective;
  a file of 300 rules.
- `text.test.js`: `resolveText({ en: 'a', fr: 'b' }, 'fr')` is `b`; lang `de` gives `a`; a string is itself.
- `vectors.test.js` runs every file in `scenario/vectors/` as section 8 of the format describes. Vectors to
  write, one file each: `reached`, `reached-refused-away` (the `interact` arrives while the bounded position is
  40 m off: no progress), `used`, `zone` (with `seconds: 3`: met at the fourth second, not before), `cot-place`,
  `cot-self`, `cot-count-uid` (the same `uid` twice counts once of `count: 2`), `killed`, `after` (evidence
  before the first objective is not kept), `within` (late evidence does not count), `rule-after` (commands
  released by `tick` at `t + after`, not before), `rule-zone-leave`, `pos-teleport` (a 200 m jump is not accepted
  and `breaches` is 1), `standing` (after an `unmark`, `standing()` holds `clear` and the marks that remain).
- `engine/test/mission-host.test.js` (from item G) stays green on the converted scenarios.

**Proof.** `engine/tools/play.mjs test` and `old-quebec` exit 0; `phone/tools/check-phone.mjs` exits 0.

**Done.** Tests green; `SCENARIO-FORMAT.md` status says what is built; `engine/host/mission.js` has no scenario
logic of its own (`grep -n "rules\|when" engine/host/mission.js` finds nothing).

---

## PL-4. A reference host and mission client

**Goal.** A developer runs one command and plays a scenario over a real socket, with a host that follows every
rule of the protocol that does not need a login.

**Owns.** `host/**` (new, at the repository root: `server.mjs`, `ws.mjs`, `client/session.js`,
`client/mission.js`, `index.html`, `test/*.test.js`), one section in `README.md`. Depends on PL-3.

**Design.**

- `host/server.mjs` (Node 22, standard library only): serves the repository's files on `127.0.0.1:<port>`
  (default 9765) and upgrades `/session/<id>` to a WebSocket. `host/ws.mjs` is the WebSocket server side in
  about 150 lines (RFC 6455: the handshake with `node:crypto`, text frames, masking, ping/pong, close; frames
  over 64 KiB close the socket). No package: `AGENTS.md` rule 9; a WebSocket frame codec is small and is not a
  parser of hostile input here (loopback only). The server refuses to bind anything but a loopback address.
- Catalogue: `GET /catalogue` lists `scenario/…` files given on the command line
  (`node host/server.mjs engine/host/scenarios/*.json`): `[{ id, title, brief, minutes, objectives: [{ id, text }] }]`.
  `POST /sessions { scenario }` answers `{ session, ws }`.
- One session object per id: a `createRun` (PL-3), a `seq` counter, the socket, and a 0.25 s `setInterval` that
  calls `tick`. It implements `hello` (closing 4406 on a mismatch with `CONTRACTS`), `start`, `pos`, `event`,
  `refused`, `resume` (`deploy { resumed: true, elapsed, cmds: run.standing() }`), `debrief`. `phone` reports
  from the page go to `run.cot` and `fallback-phone` is listed in `debrief.unverified`: this host has no phone
  side of its own (rule 6).
- `host/client/session.js` (socket, reconnect with `hello { resume: true }`, `seq` order, drops a repeated
  number) and `host/client/mission.js` (ready screen with the objective texts, Deploy, tracker, debrief), both on
  the world API only. `host/index.html`: catalogue, then the game.

**Tests** (`node --test host/test/`): the frame codec round-trips 0, 125, 126, 65 535 and 65 536 byte payloads and
refuses an unmasked client frame; a session over a real loopback socket plays the `reached` vector's inputs and
receives its outputs with rising `seq`; a second `hello { resume: true }` on a new socket gets
`deploy { resumed: true }` whose `cmds` start with `clear`; a `hello` with `protocol: 'x'` is closed with 4406;
no message sent in a whole run contains the keys `check`, `places`, `rules`, `when` or `radius` outside a `mark`
command (rule 2).

**Proof.** A headless browser (`flock /tmp/opus-heavy.lock`) opens `host/index.html`, deploys the test scenario,
walks to the mark, and the debrief shows; a picture of the tracker and of the debrief, looked at.

**Done.** Tests and proof; `docs/SESSION-PROTOCOL.md` status says a host here speaks it; `docs/ARCHITECTURE.md`
"In this repository today" updated.

---

## PL-5. The skill-tree format and viewer (waits for the maintainer)

**Blocked on a decision**: whether the tree's structure and format are published here (`../DECISIONS.md`, "For
the maintainer"). If yes:

**Goal.** An author can define skills for their own scenes and see them as a tree.

**Owns.** `docs/SKILL-TREE-FORMAT.md`, `skills/**` (new: `validate.js`, `layout.js`, `viewer.js`, `viewer.css`,
`demo.html`, `test/*.test.js`, `sets/example.json`).

**Design.** The format is `opus-skill-tree/1` exactly as the private product writes it: a set file
`{ format, set, name, extends?, sources?, branches?, levels?: [{ number, name, description, skills: [skill] }], skills?: [skill] }`
with `skill = { id: "<set>:<local>", number?, title, text, level?, branch, icon, requires: [id], references?: [{ source, note, section?, page? }], scenario? }`.
Rules (each a validator error): an id is `<set>:` plus its own part and is unique; an add-on set names
`extends` and never redefines a skill of the set it extends; every `requires` exists; no cycle; a skill's level
is not below a prerequisite's. Never in a tree file: how a skill is checked, which missions practise it, anyone's
progress. `validate.js` and `layout.js` (tiers by level, lanes by branch) are pure; `viewer.js` takes
`(element, tree, stateOf)` where `stateOf(id)` is `'done' | 'available' | 'locked' | undefined`.
The files are written fresh here from this description (`AGENTS.md` rule 7); the maintainer supplies the core
tree file himself if it is to be published.

**Tests.** The five validator rules, one failing file each; layout puts a skill to the right of every
prerequisite; the demo page renders the example set (headless picture, looked at).

---

## PL-6. "Write your first scenario"

**Goal.** A developer goes from a clone to their own mission in Old Quebec in under an hour, by following a page.

**Owns.** `docs/guide/FIRST-SCENARIO.md`, `scenario/examples/first.json`. Depends on PL-4.

**Design.** Six steps, each ending in something to see: run the reference host; read the example scenario; find
coordinates (open `engine/dev.html`, walk, read `world.snapshot().self` and the grid on the HUD); add an
objective with a `zone` check and a rule that spawns a threat when it is met; add a second language; run the
vectors. The guide's commands are copied from a terminal session that worked, not written from memory.

**Tests.** `scenario/examples/first.json` validates and has a vector that completes it. **Proof.** A fresh clone
in a temporary folder, the guide followed literally by the executing agent, the debrief picture attached.

## What stays with the planning model

Review of PL-2's limits and of PL-3's runtime against `SCENARIO-FORMAT.md` (a contract every host will copy);
any change to the format that the runtime shows is needed (fix the document in the same change, additively).

## What only a person can judge

Whether the guide reads well to someone who has never seen the repository.
