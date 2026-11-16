# Scenario format — `opus-scenario/1` (draft)

A scenario is a mission as data: where the player starts, what stands in the world, what happens when, the
objectives in words, and how each objective is checked. A session host reads it (`SESSION-PROTOCOL.md`); a client
never receives it.

**Status, 2026-11-16: decided, not built.** `engine/host/mission.js` still reads the earlier development shape
(`start`, `setup`, `rules` on `interact`); `plans/PLATFORM.md` item PL-3 builds this format and converts the
three development scenarios. Everything the development shape has keeps its meaning here, so the conversion adds
keys and changes none.

## 1. What is open and what a host may keep

The format, the kinds listed here and one implementation of them are open, so that anyone can write and run a
scenario. Two things are deliberately left to a host:

- **More kinds.** The check kinds and trigger kinds below are a registry, not a closed list. A host may
  implement kinds this document does not have. A scenario that uses a kind its host lacks is refused when it is
  loaded, with a message naming the kind; it is never half-played.
- **The scenarios themselves.** A published scenario is public, places and all. A host that needs a place to
  stay secret keeps that scenario to itself.

## 2. The file

```json
{
  "format": "opus-scenario/1",
  "id": "old-quebec-observation",
  "title": { "en": "Observation point", "fr": "Point d'observation" },
  "scene": { "id": "old-quebec" },
  "brief": { "en": "Sentries walk the streets to the north. Reach the observation point, then the pick-up." },
  "minutes": 5,
  "start": { "x": 0, "z": -60, "heading": 0 },
  "places": { "square": { "x": 79.5, "z": -85.9 } },
  "objectives": [
    { "id": "obs", "text": { "en": "Reach the observation point" }, "check": { "kind": "reached", "mark": "obs" } },
    { "id": "pickup", "text": { "en": "Reach the pick-up" }, "check": { "kind": "reached", "mark": "pickup" },
      "after": "obs" }
  ],
  "setup": [
    { "op": "say", "text": { "en": "Move north to the observation point" }, "seconds": 8 },
    { "op": "mark", "id": "obs", "kind": "objective", "label": { "en": "Observation point" }, "x": 0, "z": -68, "radius": 2.5 }
  ],
  "rules": [
    { "id": "to-pickup", "when": { "kind": "objective", "id": "obs" },
      "do": [ { "op": "unmark", "id": "obs" },
              { "op": "mark", "id": "pickup", "kind": "extraction", "label": { "en": "Pick-up" }, "x": 0, "z": -74, "radius": 2.5 } ] },
    { "id": "contact", "when": { "kind": "objective", "id": "obs" }, "after": 4,
      "do": [ { "op": "say", "channel": "warn", "text": { "en": "Contact" } },
              { "op": "spawn", "id": "w1", "kind": "sentry", "at": [[30, -110], [-25, -118]], "hidden": true, "alerted": true } ] }
  ],
  "end": { "when": "objectives", "result": "complete" }
}
```

| Key | Type | Meaning |
|---|---|---|
| `format` | string | `opus-scenario/1`. Required |
| `id` | `[a-z0-9][a-z0-9-]{0,39}` | Unique in a host's catalogue. Required |
| `title`, `brief` | text | Shown in the catalogue and the briefing |
| `scene` | `{ id, version? }` | The scene it is played on. `version` is one scene version or absent (any). Required |
| `minutes` | number | Expected length, for the catalogue |
| `start` | `{ x, z, y?, heading? }` | Where the player enters. Required |
| `places` | `{ <name>: { x, z } \| { lat, lon } }` | Named places the checks and triggers refer to. **Never sent to a client.** `lat`, `lon` are WGS 84 and are turned into game metres with the scene's georeference when the scenario is loaded; a place outside the scene's `extent` refuses the file |
| `objectives` | list | Section 3. At least one |
| `setup` | `[ScenarioCommand]` | What stands in the world at deploy (`WORLD-API.md`, "Scenario commands"). Sent in `deploy.cmds` |
| `rules` | list | Section 5 |
| `end` | `{ when: "objectives", result }` | Play ends with `result` once every objective is met. A rule may end play earlier with an `end` command. Default as shown |
| `skills` on an objective | `[string]` | Ids in a host's curriculum that meeting the objective is evidence for. Opaque to this format |

**Text** is a string, or an object of language tag to string (`{ "en": …, "fr": … }`). A host picks the
session's language, falling back to `en`, then to the first key. Wherever a command carries words (`say.text`,
`mark.label`, `mark.use.prompt`, `objective.text`) the scenario may give text in this form and the host
resolves it to a string before the command is sent: the engine only ever sees strings.

Positions are game metres (`SCENE-FORMAT.md` 2). Unknown keys are ignored. Limits a host enforces: 64 KiB per
file, 64 objectives, 256 rules, 256 commands per list.

## 3. Objectives

```json
{ "id": "report", "text": { "en": "Drop a hostile marker on the square and send it" },
  "check": { "kind": "cot", "type": "a-h", "near": "square", "radius": 35 },
  "count": 1, "after": "obs", "within": 600, "skills": ["core:1.5", "core:1.6"] }
```

| Key | Meaning |
|---|---|
| `id` | Unique in the scenario |
| `text` | What the trainee reads. It says what to do, never how it is checked |
| `check` | Exactly one check (section 4) |
| `count` | How many times the check must be met (default 1). Each kind says what counts as another time |
| `after` | The id of an objective that must be met first. Evidence that arrives earlier is not counted and is not kept |
| `within` | Seconds on the host's clock, from deploy (or from the moment `after` was met), in which it must be met. Later evidence does not count; the objective then stays unmet and the debrief says so |

Once met an objective stays met. The client is sent `id`, the resolved `text`, `count`, the number met and
`done`, and nothing else (`SESSION-PROTOCOL.md` 1).

## 4. Check kinds

| `kind` | Fields | Met when | Rests on |
|---|---|---|---|
| `reached` | `mark` | The player entered that mark (the world reported `interact` `reached`), the host placed it and has not removed it, and the host's bounded position is within the mark's radius plus 5 m | The bounded position |
| `used` | `mark` | The same, for a mark with `use`, on `interact` `used` | The bounded position; the hold itself is the client's word |
| `zone` | `place`, `radius`, `seconds?` | The bounded position has been within `radius` of the place (for `seconds` in a row, default 0). Nothing is drawn: this is how a hidden place is found | The bounded position |
| `cot` | `type?` (prefix), `near?` (`"self"` or a place), `radius?`, `self?` (boolean) | A Cursor-on-Target event from the TAK client whose type starts with `type`, lying within `radius` of the place (or of the bounded position for `"self"`). `self: true` means the device's own position report; `false` or absent means an item the trainee made and sent. With `count`, each distinct event `uid` counts once | The phone side, when the host takes reports there (`SESSION-PROTOCOL.md` 4, rule 5); the page's word in the in-page stand-in |
| `killed` | `id?` or `kind?` | The world reported that threat (or a threat of that kind) killed. With `count`, each id counts once | The client's word. A host lists `combat` in `debrief.unverified` when an objective of this kind was met |

A `mark` named by `reached` or `used` must be placed by some command of the scenario, or the file is refused.

## 5. Rules: what happens when

```json
{ "id": "contact", "when": { "kind": "objective", "id": "obs" }, "after": 4, "once": true, "do": [ … ] }
```

A rule fires when its trigger becomes true, waits `after` seconds on the host's clock (default 0), then its
commands are sent in order, each as one `cmd`. `once` (default true): it fires one time per run.
The host evaluates triggers; a client is never told one.

| `when.kind` | Fields | True when |
|---|---|---|
| `deploy` | — | Play begins. With `after`, a timed event |
| `objective` | `id` | That objective was met |
| `event` | `event`, and any fields of its payload to match | The world reported it (`interact`, `entity`, `state`; `WORLD-API.md`, "Events"). An `interact` counts only under the conditions of `reached` above. Others are the client's word |
| `zone` | `place`, `radius`, `leave?` | The bounded position entered (or, with `leave`, left) the circle |
| `cot` | as the `cot` check | Such an event arrived |
| `time` | `at` | That many seconds since deploy |

The development shape's `"when": { "event": "interact", "id": …, "action": … }` is read as
`{ "kind": "event", "event": "interact", … }`.

## 6. What a host does with it

1. **Load**: validate against this document; resolve `places`; refuse the file on any error, with one sentence.
2. **Deploy**: start the clock, send `deploy { at: start, cmds: setup }`, arm the `deploy` and `time` rules.
3. **Play**: bound every `pos`; evaluate checks and triggers on every accepted `pos`, world event and TAK
   report, and at least twice a second for timers; send the commands of rules that fire and `progress` when an
   objective moves. Keep a record of what stands (every `spawn`, `mark` and value it has sent and not removed),
   for a client that returns (`SESSION-PROTOCOL.md` 5).
4. **End**: when `end.when` holds or an `end` command was sent, stop the clock and send `debrief`.

## 7. What it does not have, on purpose

- No client-side logic, no expressions, no variables. If a mission needs a state machine, it is objectives with
  `after` and rules on `objective`.
- No reference to engine internals: a scenario touches the world only through scenario commands.
- No scoring weights or grades. A debrief is objectives met and time; what a host makes of that is its own.

## 8. Conformance vectors

A vector is a scenario, a list of timed inputs, and the outputs a host must produce, so that two implementations
of this document can be shown to agree:

```json
{ "scenario": { … },
  "steps": [
    { "t": 0,   "in": { "t": "start" },                              "out": [ { "t": "deploy" }, { "t": "progress", "done": 0 } ] },
    { "t": 3.0, "in": { "t": "pos", "x": 0, "z": -67 } },
    { "t": 3.0, "in": { "t": "event", "kind": "interact", "data": { "id": "obs", "action": "reached" } },
                "out": [ { "t": "progress", "done": 1 }, { "t": "cmd", "cmd": { "op": "unmark", "id": "obs" } } ] },
    { "t": 7.1, "tick": true,                                         "out": [ { "t": "cmd", "cmd": { "op": "say" } } ] }
  ] }
```

`in` is a client message, or `{ "cot": { … } }` for a TAK report as the gateway gives it; `tick` asks the host to
evaluate its timers at `t`. `out` lists the messages expected, in order; each is matched as a subset (keys given
must be equal, other keys are free). A step with no `out` must produce no `cmd` and no `progress`. The vectors
live in `scenario/vectors/` (item PL-3) and cover every kind of sections 4 and 5, a refused `interact` away from
the mark, `after`, `within`, and `count` with a repeated `uid`.
