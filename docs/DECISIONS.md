# Decisions

One entry per decision: the context, what was decided, what follows, and what was rejected. Newest last. The
maintainer's own decisions are recorded where they were taken (`AGENTS.md`; the last section of each plan in
`plans/`); this file holds the design decisions that follow from them.

## O-1. Six contracts, additive within a major, one constant each (2026-11-16)

**Context.** Products copy this repository at a commit. Until now only the scene format said how it may change;
the world API, the protocol, content packs and the gateway's messages changed by habit.
**Decision.** `CONTRACTS.md`: every contract has an identifier with a major, changes additively inside it,
refuses a major it does not know with a message, and has one constant in code tied to the document by a test.
**Consequence.** A product that copies a later commit of the same major changes nothing on its side.
**Rejected.** Semantic-version tags per contract: six version numbers nobody would keep true, for one consumer.

## O-2. The scenario format is open; the registry of check kinds is open-ended (2026-11-16)

**Context.** No scenario format existed: development hosts read an ad-hoc shape, and whether the checks would
be published was undecided. Authors outside need to write and run missions; a product needs checks and places
that are not published.
**Decision.** `SCENARIO-FORMAT.md` (`opus-scenario/1`): stage, objectives, checks and triggers in one file; five
check kinds and six trigger kinds specified and implemented here; a host may implement more kinds and refuses a
scenario that uses one it lacks. Two implementations are kept honest by conformance vectors, not by sharing code.
**Consequence.** A scenario written here plays on any host. A product's own kinds and its own scenarios stay its
own, in the same format.
**Rejected.** (a) One implementation of every check, published and imported by products: it publishes the part a
product is paid for. (b) A closed format: nobody outside could write a mission. (c) A second, private format for
hardened missions: two formats to learn and to keep in step.

## O-3. Text in a scenario is per language, resolved by the host (2026-11-16)

**Context.** Mission text was one language, in data; the engine shows whatever string a command carries.
**Decision.** Any text in a scenario is a string or a map of language to string; the host resolves it before a
command is sent. The engine and the world API are unchanged.
**Rejected.** Language tables in the client: the client would hold text for objectives it has not been given yet.

## O-4. Scene grants are HTTP authorisation, not protocol messages (2026-11-16)

**Context.** The protocol reserved `need` and `grant` for handing out a chunked scene piece by piece.
**Decision.** A chunk is an ordinary request under `scene.url`; a hardened host answers 403 until the session's
bounded position is near enough. The reserved kinds are withdrawn (nothing ever spoke them).
**Consequence.** The browser's HTTP cache works; a reference host serves plain files; the client needs one rule
(a 403 on a chunk means "not yet").
**Rejected.** Socket messages carrying signed links: a second delivery path, and nothing a request cannot do.

## O-5. One gateway, and it stays a loopback tool (2026-11-16)

**Context.** The gateway existed twice (here and in a private product), had no authentication, dropped a
Cursor-on-Target event's `<detail>`, and lost events while no page was connected.
**Decision.** `phone/local/gateway.py` is the only gateway. It passes the whole event as a bounded tree, numbers
events and replays them on request, and refuses XML with a document type. It keeps listening on loopback only
and gains no authentication: whoever runs phones for other people puts its own authenticated door in front, in
the phone's own network namespace.
**Rejected.** Tokens and TLS in the gateway: every deployment would configure them differently, and a
loopback-only tool with a door in front is easier to reason about than a network service with options.

## O-6. Vector layers of a chunk stay JSON in the container header (2026-11-16)

**Context.** The format describes fixed-size binary records with a shared vertex pool; the engine's reader and
the test-scene writer use JSON records inside the container's header.
**Decision.** `"type": "json"` is a permanent section type. The builder writes it. Binary records remain allowed
by the format and are not scheduled.
**Consequence.** One record shape in both packagings; chunk size is watched by the 600 KB budget.
**Rejected.** Writing the binary records now: a second encoding to test in two languages, for a size gain HTTP
compression mostly gives already.

## O-7. Lifted modules are pinned by tests before they are rewritten (2026-11-16)

**Context.** Eight engine modules were cut from a stand-in game and are to be rewritten; how they feel is what
the gameplay bar is measured against.
**Decision.** `plans/ENGINE-SCALE.md` K7 fixes each module's measurable behaviour first; K8 rewrites one module
at a time against those tests, smallest and most felt first, each judged by a person before the old file goes.
**Rejected.** Rewriting in place, or all at once: no way to tell a change of feel from a bug.

## O-8. Threat figures: lifted machines, procedural people, no gore (2026-11-16)

**Context.** Threats were boxes. The maintainer decided threats are machines and people, that the stand-in's two
machine rigs are wanted, that human figures are our own procedural ones for now, and that a hit on a person shows
as a flinch, a spoiled aim, a limp and damage by zone, without blood.
**Decision.** A figure is a module of `threats/figures/` named by `body.figure`, driven by a view of the threat each
frame (`figures/index.js`: root, lens, update, muzzle, fired, hit, die, setFar, zones). The machines are the lifted
rig builder and rigs (`rigs.js`, by `lift.cjs`) with their animation cut by hand from their behaviour
(`quadruped.js`, `quadcopter.js`). The person (`person.js`) is ours, on the same builder: 18 bones, rigid skinning,
joints worked out each frame (planted feet, IK arms on the rifle), looks from the pack. Hit volumes are capsules
along the bones; zones and reactions are pack data. Voices are synthesised (`audio/voice.js`).
**Consequence.** A CC0 humanoid model can later be one more figure behind the same contract, named by the pack,
once a loader and its licence are decided. `threats.js` holds no geometry.
**Rejected.** The `saltline-ghoul` fork's mesh and voices (provenance unknown, evidence of a commercial game,
`plans/FORK-REUSE.md` A2). Blood, decals and dismemberment. Keyframed clips for the person: no source, and the
machines already move procedurally.

## For the maintainer

| # | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| 1 | Publish the skill-tree format and viewer here | Format and viewer; format only; neither | Format and viewer, with an example set. The core tree file itself is a separate choice | `plans/PLATFORM.md` PL-5 |
| 2 | Licence of this repository | Apache-2.0, MIT, GPLv3, none yet | — (his) | A tagged release |
| 3 | A source of human figures and animation, and of vehicle models | Artists; a licensed library; none | — (a purchase). People are procedural for now (O-8); a model would plug in as one more figure | Human threats beyond the procedural figure; parked vehicles |
