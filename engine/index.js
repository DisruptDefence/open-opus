// The engine's public entry. A host page imports from here and nowhere else in the engine:
//   openWorld(...)               boots the engine on a scene and returns the world API (docs/WORLD-API.md) at once
//   packageSource / jsonSource   where a scene comes from (a package folder, or the single-file profile)
//   createDevHud / createNullHud a plain overlay for development hosts; a product supplies its own through `modules.hud`
export { openWorld } from './src/world/open.js';
export { packageSource, jsonSource } from './src/scene/source.js';
export { createDevHud } from './src/hud/dev-hud.js';
export { createNullHud } from './src/hud/hooks.js';
