# The session protocol — `opus-session/1` (draft)

A mission is run by a **session host**. The game in the browser is a client of it: it draws, moves and reports;
the host holds the scenario, decides what happens and keeps the score. This document is the contract between
the two. Any program that speaks it can host a mission, and any client that speaks it can play one.

**Status, 2026-11-15: draft.** Nothing in this repository speaks it over a socket yet. `engine/host/mission.js`
is an in-page stand-in: it reads a small development scenario and calls `apply()` directly, with no socket. The
scenario format (what a host reads to know the mission) is not specified; see "Not in this document".

## 1. Who knows what

| | Host | Client |
|---|---|---|
| The scenario: objectives and how each is checked, triggers, what spawns where and when | holds it | **never receives it** |
| The clock and the score | owns them | displays what it is sent |
| The scene (the place) | grants it | loads and draws it |
| Movement, shooting, threat reactions | bounds what is reported | runs them, every frame |
| What the trainee did in the TAK client | receives it from the phone side | is not in the path |

A client is never told:

- how an objective is checked: no condition, no radius, no place, no type to match;
- a trigger, or anything that has not happened yet (a later spawn, a later message, a later objective);
- where something is before the host places, spawns or marks it;
- anything about a mission other than the one in play, beyond what the host's catalogue shows.

The client is given words and consequences: objective texts, commands at the moment they take effect, progress,
the debrief. A recording of one session therefore holds what that player saw, and nothing else.

## 2. Lifecycle

```
catalogue ──► briefing ──► session opened ──► socket ──► hello ──► mission, scene
                                                           │
                                             start ◄───────┘  (the trainee presses Deploy)
                                               │
                                             deploy ──► play: pos, event, phone ⇄ cmd, progress
                                               │
                                             debrief ──► next mission, or back to the catalogue
```

1. **Catalogue and briefing.** Before any socket the host offers its missions (grouped in campaigns) and, for
   one mission, a briefing: the story, the threat, the objective texts, the skills practised. How this is
   offered is the host's business (a web API, a file list). It follows the table above: texts only.
2. **Opening a session.** The trainee chooses a mission; the host creates a session for that person and that
   mission and answers with a session id and the address of the session socket. A session belongs to one person.
3. **The socket.** The client connects and sends `hello`. The host answers `mission` and `scene`, and `progress`.
4. **Deploy.** When the trainee presses Deploy (a click: the browser needs one for the pointer and for sound),
   the client sends `start`. The host resets the objectives, starts its clock and sends `deploy`. The client
   calls `world.start({ at })`.
5. **Play.** The client reports (`pos`, `event`, `phone`). The host sends `cmd` when something happens in the
   scenario and `progress` when an objective moves.
6. **Debrief.** When the host decides the mission is over it sends `cmd` with an `end` command and then
   `debrief`. The session stays open: `start` again plays the mission again from the beginning.

A socket may drop and come back during any step; section 5.

## 3. Messages

WebSocket text frames, one JSON object per frame, UTF-8. Every message has `t`, its kind. A receiver ignores a
kind it does not know and fields it does not know, and never fails on a malformed frame. A host may drop frames
larger than 64 KiB. Positions are game metres (`x` east, `z` south, `y` up; `SCENE-FORMAT.md` 2).

### 3.1 Client to host

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `protocol: "opus-session/1"`, `world: 1`, `scenes: ["opus-scene/1"]`, `phone: "tak" \| "fallback" \| "none"`, `resume?: true` | First message on every connection. What the client speaks and which phone screen it has: a real TAK client, a fallback screen, or none. `resume`: section 5 |
| `start` | — | The trainee pressed Deploy, or deploys again after dying or finishing |
| `pos` | `x`, `y`, `z`, `heading`, `speed` | The player, five times a second while the world's state is `playing`. From `world.snapshot().self` |
| `event` | `kind`, `data` | Something the world reported through `world.on(...)`: `state` (died, paused), `entity` (a threat was killed), `interact` (a mark was reached). `data` is the event's payload |
| `phone` | `action`, `data` | Something the trainee did on a **fallback** phone screen (opened a tool, dropped a marker). `data` holds plain values only. A real TAK client is not reported this way (section 4) |
| `refused` | `seq` | The command with this number could not be applied (`apply()` threw) |

### 3.2 Host to client

| `t` | Fields | Meaning |
|---|---|---|
| `mission` | `session`, `id`, `title`, `objectives: [{ id, text, count }]`, `phone: "tak" \| "fallback"` | What is being played, in words. `phone` is the screen the host will score for this session; it is the host's decision, not an echo of `hello` |
| `scene` | `format`, `url` | The scene to load: the address of a client manifest (or of a single-file scene) the client may fetch. Sent before `deploy` |
| `deploy` | `at: { x, z, y?, heading? }`, `cmds?: [ScenarioCommand]` | Play begins. The client applies `cmds` (what stands in the world at this moment), then calls `world.start({ at })` |
| `cmd` | `seq`, `cmd: ScenarioCommand` | Apply this now: `world.apply(cmd)`. `seq` rises by one per session; the client applies in order and drops a number it has already applied |
| `progress` | `objectives: [{ id, text, count, n, done }]`, `done`, `total`, `playing` | The state of every objective. Sent after `hello`, after `deploy` and whenever one moves |
| `debrief` | `id`, `title`, `objectives`, `done`, `total`, `seconds`, `unverified?: [string]`, `next?: { id, title }` | The result. `seconds` is on the host's clock. `unverified` names what the result rests on that the host could not check (section 4) |

`ScenarioCommand` is defined in `WORLD-API.md`. The protocol carries commands; it does not interpret them.

### 3.3 Closing

The host closes with code `4401` when the connection is not authenticated and `4404` when there is no such
session for this person. Someone else's session and a missing one are answered the same way.

## 4. What a host must do

1. **Authenticate, and bind a session to one person.** How (a login, a local token) is the host's own business.
2. **Hold the scenario.** Send texts and commands only, never a check, a trigger or a future event (section 1).
   A hidden place (a contact to find) is never sent as a `mark`: the host judges it from `pos`. A `mark` is for
   what the player is meant to see, and its radius is then visible anyway.
3. **Own the clock.** It starts when the host sends `deploy` and stops when the host decides the mission ended.
4. **Treat every client message as a claim.** Type it and bound it before use. `pos` must lie inside the
   scene's play area and be reachable from the previous one at no more than the fastest movement speed plus a
   tolerance; a position that fails is not used for scoring and the breach is kept with the result. `event`
   and `phone` are plausibility-checked at most (kills no greater than spawns).
5. **Take TAK reports from the phone side.** With a real TAK client, what the trainee shares leaves the phone as
   Cursor-on-Target to an endpoint the host controls. It does not pass through the browser, and the client is
   not asked about it. The position the phone is fed as its GPS comes from the host's bounded `pos`, not from
   the browser directly.
6. **Say what the result rests on.** A fallback screen has no host-side truth: everything in `phone` is the
   browser's word. A host either does not score such a session, or scores it and lists `fallback-phone` in
   `debrief.unverified`. The same for `position` when bounds were breached.
7. **Rebuild the world for a client that returns** (section 5).
8. **Refuse what it cannot serve** (a `hello` with no protocol or scene format in common) by closing with a
   reason, not by sending something the client will misread.

A **reference host** runs on the author's own machine with the files beside it; rules 1 and 4 to 6 protect
nothing there and may be trivial. A **hardened host** implements all of them. Both send the same messages.

## 5. Reconnecting

The session outlives its socket. On a new connection the client sends `hello` again and the host answers
`mission`, `scene` and `progress`.

A reloaded page has lost its world while the mission is still in play. It must not send `start`, which would
begin the mission again. It sends `hello` with `resume: true`; the host answers with `deploy` at the last
bounded position, with `cmds` holding everything that stands (live spawns, marks, time of day), and continues
`seq` from where it was. A host that cannot rebuild answers `progress` with `playing: false`, and the trainee
deploys again from the beginning.

While the socket is down the client shows that progress is not being counted. It does not queue reports.

## 6. What a client must do

- Reach the game through the world API only (`WORLD-API.md`).
- Apply commands in `seq` order, as they arrive, and keep none for later.
- Show objective state as sent. It decides nothing about objectives, time or score.
- Send `start` only from a user gesture.

## Not in this document

- **The scenario format**: the file a host reads (objectives and their checks, triggers, anchors used). Not
  specified. Whether one open format and one open implementation of the checks exist is a maintainer decision.
- **Scene grants.** A hardened host hands out a chunked scene piece by piece (`SCENE-FORMAT.md` 9). The message
  kinds `need` (client) and `grant` (host) are reserved for it and not yet specified. Until then `scene.url`
  names something the client fetches whole.
- **More than one player.** A session is one person. Collaboration is meant to go through a TAK server, not
  through this socket.
