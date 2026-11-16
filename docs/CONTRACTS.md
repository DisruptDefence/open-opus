# Contracts and their versions

Open OPUS is used through six contracts. This page is the one list of them: what each is called, where it is
specified, what guards it, and how it may change. A product built on Open OPUS pins a commit of this
repository and is safe as long as these rules hold.

| Contract | Identifier | Specified in | Guarded by | State |
|---|---|---|---|---|
| World API | `world.version === 1` | `WORLD-API.md` | `engine/test/world-api.test.js` | Built |
| Scene format | `"format": "opus-scene/1"`, `formatMinor` | `SCENE-FORMAT.md` | `engine/test/scene.test.js`, the builder's tests | Built (single file); chunked packaging read, not written by the builder |
| Content pack | `"format": "opus-content/1"` | `CONTENT-PACK.md` (arrives with `plans/GAMEPLAY-PARITY.md` item C) | `engine/test/content.test.js` | In progress |
| Session protocol | `"protocol": "opus-session/1"` | `SESSION-PROTOCOL.md` | The conformance vectors of `SCENARIO-FORMAT.md` 8, once a host here speaks it | Draft; spoken by a private host, by nothing in this repository yet |
| Scenario format | `"format": "opus-scenario/1"` | `SCENARIO-FORMAT.md` | Conformance vectors (`plans/PLATFORM.md` item PL-3) | Draft, decided 2026-11-16; not built here |
| Phone gateway | the message kinds of `phone/README.md`, "What flows" | `phone/README.md` | `phone/local/test_gateway.py`, `phone/test/stream-screen.test.js` | Built; additions planned (`plans/PLATFORM.md` PL-2) |

A seventh, the skill-tree format (`opus-skill-tree/1`), exists in a private product. Whether it is published
here is the maintainer's decision (`plans/PLATFORM.md` PL-5).

## The rules of change

1. **Additive within a major.** A new member, command, event, message kind, record field at the end, enum value
   or optional key keeps the identifier. A reader ignores what it does not know and never fails on it.
   The scene format also raises `formatMinor`; the others list the addition under a date in their "Status".
2. **A major changes only when an old reader would misread.** Then the new major is a new identifier
   (`opus-scene/2`), the engine reads both for at least one tagged release, and the change is the maintainer's
   decision (`AGENTS.md`).
3. **Both ends say what they speak.** A client's `hello` lists its protocol, world version and scene majors; a
   host that has nothing in common closes with code 4406 and a reason (`SESSION-PROTOCOL.md` 3.3). A scene, a
   content pack and a scenario each carry their `format`; a reader refuses a major it does not know with a
   message that names it.
4. **The document changes in the same commit as the code**, and the contract's test gains a case.
5. **One constant per contract in code.** `engine/index.js` exports `CONTRACTS` (item PL-1), and a test compares
   it with the table above, so the table cannot drift from the code.
6. **The version of the whole is the commit.** Until releases are tagged, a product names the commit it copied.
   A tag, when there is one, is `vYYYY.MM.DD` and changes none of the identifiers above.

## How a product survives a change here

A product copies `engine/`, `phone/` and `scenes/` at a commit (`ARCHITECTURE.md`, "Using the engine in a
product") and records that commit and a hash of every copied file. Nothing here reaches the product until it
copies again, and its own tests then run against the new copy before it is accepted. Rules 1 to 3 mean that a
copy taken later in the same major needs no change on the product's side; rule 2 means a major is seen coming.
