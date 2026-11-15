# Working on Open OPUS — instructions for agents and people

This file is the single set of instructions for this repository. A coding agent reads it in full before its
first change. Where it and another document disagree, this file wins and the other document gets fixed.

## Model

**Use Claude Fable 5.2 (`claude-fable-5-2`) for all work in this repository.**

- Start the session on Fable 5.2. In Claude Code: `claude --model claude-fable-5-2`, or `/model` and pick Fable 5.2.
- Every subagent you spawn runs on Fable 5.2 as well: pass `model: "fable"` (or leave the model unset so it
  inherits yours). Do not hand engine, architecture, format or review work to a smaller model.
- If Fable 5.2 is not available to you, stop and say so. Do not carry on with another model.
- Through the API or the Agent SDK the model id is `claude-fable-5-2`.

## What this is

Open OPUS is a browser game engine and SDK for tactical training: a first-person game in real places, where
the trainee completes objectives with a real TAK client on an in-game phone. This repository is the open side:
engine, world API, scene format, tools, sample scenes, a reference host. Read, in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md` — the three rules and the direction of imports
3. `docs/WORLD-API.md` — the contract
4. `docs/SCENE-FORMAT.md` — `opus-scene/1`

## Priorities now (2026-11-15)

1. **The architecture is sound.** If you find it wrong or unworkable while building, say so and fix the
   document in the same change. Do not work around it silently.
2. **The engine works inside that architecture.** A mission plays on a scene loaded as data, driven only
   through the world API.

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
8. **Only code we may publish.** Every file is our own work or carries a licence that allows redistribution,
   kept beside it (as `engine/vendor/three.LICENSE` is). Code with no licence does not go in, in any form.
9. **Few dependencies.** three.js at run time and nothing else. Write the small thing yourself before adding a
   package; say why in the commit if you add one. Exceptions: security primitives and parsers of hostile input.
10. **No build step you do not need.** Plain ES modules that a browser loads directly.

## How to work

- **One topic per branch**, branched from `main`. Several agents at once: each in its own git worktree, each
  owning its own paths; never edit a path another agent owns. Say which paths you own before you start.
- **Verify by running, not by reading.** Unit tests for pure modules (`node --test`). For anything visible,
  load it in a headless browser, take a screenshot and look at it before you say it works.
- **A fix has a test** that fails without it. Test behaviour, not names.
- **One heavy job at a time** on a shared machine (test suites, builds, headless browsers).
- **Commit small and often**, in plain sentences saying what changed and why. Never bypass a hook.
- **Do not push to `main` and do not change repository settings** unless the maintainer asked you to.
- **Update the document in the same change** when you change a contract, a format or the layout.

## Reporting back

Keep it short and factual: what you built, what you ran and what it showed, what you did not test, what you
found wrong in the architecture, and any decision you need from the maintainer. A red test is reported as red.

## Decisions that belong to the maintainer

Licence of this repository; anything that changes the world API or the scene format in a way an old reader
would misread; adding a run-time dependency; making anything public that was not.
