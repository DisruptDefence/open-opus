// The prop kit: street furniture as procedural models by kind. Pure code. OWNED BY ITEM 8 of
// docs/plans/SCENE-DETAIL.md; the kit below is the placeholder of item 3 (empty: a scene's props are skipped, each
// unknown kind reported once).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   PROP_KIT[kind] = { build(soups, x, y, z, yaw, variant, style), collider }
//
//   kind      the word a scene's `props.kinds` uses: lamp_lantern, lamp_cobra, bench_slat, bollard_iron, hydrant, bin,
//             flagpole, cannon, plinth, fountain, post_box, sign_stop, bike_rack, rail_iron (plan, item 8).
//   build     writes ONE prop standing at (x, z) with its lowest point at y (the ground there, sidewalk included).
//   yaw       radians about +y as three.js turns: 0 faces grid north (-z), positive turns towards the west. The prop
//             faces (-sin yaw, -cos yaw) on the plan and its right hand is (cos yaw, -sin yaw). Model the prop in its
//             own frame (right, up, forward) and place it with soup.js box(), frame() or your own turn.
//   variant   a small integer from the scene (colour or form within the kind); 0 when the data says nothing.
//   style     the resolved style (style.js).
//   collider  null (nothing stops), or { r, h, nav } (an upright square of half-width r metres, h metres tall), or
//             { hw, hd, h, nav } (a box of half-width hw along the prop's right hand and half-depth hd along its
//             facing, turned with yaw). nav: true when the prop closes its nav cell (a bench, a cannon), false when a
//             walker and a bullet are stopped but paths go on beside it (a lamp post). scene/install.js makes the
//             solid from this, so the model must fill what the collider says and no more than 0.1 m beyond it.
//   Soups     at most three per kind: SOUP.iron, SOUP.timber, SOUP.trim, SOUP.lampGlass (style.js). Tints are linear
//             [r, g, b]. Smooth round parts: soup.js triN() with normals pointing away from the axis.
//   Winding   counter-clockwise seen from outside.
//   Group     `near` only: a prop is not drawn beyond the detail distance.
//   Budget    30 to 250 triangles a prop; <= 25 000 triangles of props a cell.
//   Must not  carry lettering, a logo or the flag of a real state; read the DOM or three.js.

export const PROP_KIT = {};
