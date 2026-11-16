// The engine's public entry. A host page imports from here and nowhere else in the engine:
//   openWorld(...)               boots the engine on a scene and returns the world API (docs/WORLD-API.md) at once
//   packageSource / jsonSource   where a scene comes from (a package folder, or the single-file profile)
//   createHud                    the complete HUD (modules: { hud: createHud }); createDevHud a plain overlay for development;
//   createNullHud                draws nothing. A product may supply its own through `modules.hud`
export { openWorld } from './src/world/open.js';
export { DEFAULT_PACK } from './src/content/default.js'; // the content pack the engine ships with (docs/CONTENT-PACK.md)
export { ScenarioCommandError } from './src/director/command-error.js'; // what world.apply() throws
export { packageSource, jsonSource } from './src/scene/source.js';
export { createDevHud } from './src/hud/dev-hud.js';
export { createNullHud } from './src/hud/hooks.js';
export { createHud } from './src/hud/hud.js'; // the complete HUD, fed by the engine's events and the content pack (hud.words, hud.elements)
