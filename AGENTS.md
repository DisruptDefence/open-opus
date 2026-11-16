# Working on Open OPUS — instructions for agents and people

This file is the single set of instructions for this repository. A coding agent reads it in full before its
first change. Where it and another document disagree, this file wins and the other document gets fixed.

## Model

**Plan and review on Claude Fable 5.2 (`claude-fable-5-2`); execute on Fable or Sonnet by the kind of work.**

- The session that plans, briefs, reviews and merges runs on Fable 5.2 (`claude --model claude-fable-5-2`).
- **Fable also executes** anything open-ended or judged by eye or by design sense: engine internals, scene
  detail, gameplay, architecture and formats, security, reviews.
- **Sonnet 5.5 (`claude-sonnet-5-5`, `model: "sonnet"`) executes** work a brief fully determines: wiring an
  existing module into a page, sync and vendoring scripts, mechanical refactors, test updates, translations,
  document corrections, merges. Its brief names the files, the steps, the tests that must pass and the proof
  required, and a Fable session checks the result by running it before it is merged.
- When in doubt, Fable. Never a smaller model than Sonnet.

## What this is

Open OPUS is a browser game engine and SDK for tactical training: a first-person game in real places, where
the trainee completes objectives with a real TAK client on an in-game phone. This repository is the open side:
engine (`engine/`), world API, scene format, the scene builder (`tools/build-scene.py`), scenes (`scenes/`), the
in-game phone (`phone/`: host, placeholder screen, viewer and local gateway for a real ATAK), and later a
reference host.

It is for **developers**: people building scenes, scenarios, skills and hosts on the engine. It is not a game
the public downloads to play. The in-game phone shows an honest placeholder by default and a **real ATAK**,
streamed from an Android the developer runs locally (`phone/README.md`), when one is connected. There is no
imitation of ATAK in this repository and none is to be written.

Read, in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md` — the three rules, the layout and the direction of imports
3. `docs/WORLD-API.md` — the contract
4. `docs/SCENE-FORMAT.md` — `opus-scene/1`
5. `docs/SESSION-PROTOCOL.md` — `opus-session/1` (draft): mission client and session host

## Priorities now (2026-11-16)

1. **The architecture is sound.** If you find it wrong or unworkable while building, say so and fix the
   document in the same change. Do not work around it silently.
2. **The engine works inside that architecture.** A mission plays on a scene loaded as data, driven only
   through the world API.
3. **A high bar for detail.** A generated scene must read as the real place at street level, not as boxes on a
   plane: buildings with roofs, floors, windows with depth, doors and varied materials; ground with surfaces,
   kerbs, stairs and real relief; walls and gates as structures; street furniture and varied trees; landmarks
   with their own massing; flattering light. All of it comes from open data and seeded rules, written by the
   scene builder, never by hand and never as code about one place. Detail scales down with the quality setting
   and with distance, and what is drawn is what collides.
4. **Gameplay at least as good as the game the engine came from.** Movement feel, aiming and shooting, damage
   and feedback, threats that perceive and fight, a real HUD, sound. `engine/docs/PARITY.md` (when present)
   lists what that game does, what the engine does, and the gaps in the order a player notices them.

**How detail and gameplay work is proven.** Fix a small set of viewpoints or situations first and keep them:
every change shows a before and an after from the same place (`photo mode`: no HUD, no weapon, a free camera).
State budgets and measure them before and after: scene size, triangles and draw calls per view, load time,
frame time at the lowest quality. A mission must still play end to end (`engine/tools/play.mjs`). Feel and
sound are judged by a person; say plainly what only a person can judge.

Everything else waits: more scenes, brand and menus, scenario tooling, the reference host.

## Rules

1. **One door.** Code outside the engine reaches the game through the world API only. If you need something
   it lacks, extend the API (additively, with a contract test) instead of reaching past it.
2. **Imports go down, never up** (table in `docs/ARCHITECTURE.md`). Pure modules (`geo`, `terrain`, `physics`,
   `nav`, `scene`) import neither three.js nor the DOM and are tested under Node.
3. **Data, not code.** A place is a scene package, a weapon or threat is a content pack, a mission is a
   scenario. Nothing about one place, one nation or one mission is written into engine code.
4. **Real coordinates.** Game metres are UTM metres from the scene's anchor. Never use a flat
   metres-per-degree approximation. Conversions are tested against the scene's check points.
5. **Open data only, with its licence.** Every source used by a scene is listed in its `attribution.json` with
   what it allows. No source that forbids redistribution or commercial use.
6. **ATAK is run, never taken apart.** No file, image, string or code extracted from an ATAK or plugin APK
   enters the git tree. The unmodified ATAK-CIV and plugin APKs the phone needs are attached to the
   `atak-5.8.0-civ` release of this repository as downloads; never commit an APK (`*.apk` is ignored).
7. **Nothing private.** This repository is public. No code, file or detail from a private repository, no
   credentials, no internal host names, no real operational data, no real units or named people. If your task
   brief came from a private repository, bring over only what you write yourself.
8. **Only code we may publish.** Every new file is our own work or carries a licence that allows
   redistribution, kept beside it (as `engine/vendor/three.LICENSE` is). One exception, decided by the
   maintainer, who handles its licensing: code cut out of the stand-in game's bundle by `engine/tools/lift.cjs`.
   Its modules are listed in `engine/tools/lift.config.json` and marked as lifted; more may be lifted the same
   way, and lifted code may be changed and improved. Lift mechanisms, never the stand-in's place, story,
   names, logos or look.
9. **Few dependencies.** three.js at run time and nothing else. Write the small thing yourself before adding a
   package; say why in the commit if you add one. Exceptions: security primitives and parsers of hostile input.
10. **No build step you do not need.** Plain ES modules that a browser loads directly.

## How to work

- **One topic per branch**, branched from `main`, in a worktree INSIDE the repository (`.worktrees/<topic>`,
  ignored by git), never in a folder beside it. Several agents at once: each in its own git worktree, each
  owning its own paths; never edit a path another agent owns. Say which paths you own before you start.
- **Verify by running, not by reading.** Unit tests for pure modules (`cd engine && node --test`; for the phone
  `node --test "phone/test/*.test.js"` and `python3 -m unittest phone/local/test_gateway.py`). For anything visible,
  load it in a headless browser, take a screenshot and look at it before you say it works.
- **A fix has a test** that fails without it. Test behaviour, not names.
- **One heavy job at a time** on a shared machine (test suites, builds, headless browsers).
- **Stop only what you started, by process id.** Never kill by name or pattern: other people's servers and
  phones run on the same machine. Bind servers to 127.0.0.1.
- **Commit messages name no tool or assistant** and carry no co-author line.
- **Commit small and often**, in plain sentences saying what changed and why. Never bypass a hook.
- **Do not push to `main` and do not change repository settings** unless the maintainer asked you to.
- **Update the document in the same change** when you change a contract, a format or the layout.

## Reporting back

Keep it short and factual: what you built, what you ran and what it showed, what you did not test, what you
found wrong in the architecture, and any decision you need from the maintainer. A red test is reported as red.

## Decisions that belong to the maintainer

Licence of this repository; anything that changes the world API or the scene format in a way an old reader
would misread; adding a run-time dependency; making anything public that was not.
