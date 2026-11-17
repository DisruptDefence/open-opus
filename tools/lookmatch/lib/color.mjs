// Colour: sRGB bytes -> linear -> CIE XYZ (D65) -> CIELAB (D65 white). Pure; the one conversion every measure uses.
const WHITE = [0.95047, 1, 1.08883];

export const srgbToLinear = (v8) => { const c = v8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const linearToSrgb8 = (l) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };

const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) * 27 / 24389);

/** Linear sRGB (0..1 each) to [L*, a*, b*]. */
export function linearToLab(r, g, b) {
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const fx = f(X / WHITE[0]), fy = f(Y / WHITE[1]), fz = f(Z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** sRGB bytes to [L*, a*, b*]. */
export const srgb8ToLab = (r, g, b) => linearToLab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));

/** [L*, a*, b*] to linear sRGB (may fall outside 0..1 for colours the display cannot show). */
export function labToLinear(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = WHITE[0] * finv(fx), Y = WHITE[1] * finv(fy), Z = WHITE[2] * finv(fz);
  return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
}
export const labToHex = (L, a, b) => '#' + labToLinear(L, a, b).map((v) => linearToSrgb8(v).toString(16).padStart(2, '0')).join('');
/** L* to relative luminance Y (0..1). */
export const lstarToY = (L) => (L > 8 ? ((L + 16) / 116) ** 3 : L * 27 / 24389);
/** Hue angle in degrees, 0..360, of (a*, b*). */
export const hueDeg = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
