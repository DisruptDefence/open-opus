// Synthetic images for the tests: RGBA arrays built by hand.
export function image(w, h, fn) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y); const i = (y * w + x) * 4; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255; }
  return a;
}
/** Blue sky on top 40 %, a textured (checker, warm) middle, grey ground on the bottom 30 %. */
export function street(w = 80, h = 60) {
  return image(w, h, (x, y) => {
    if (y < h * 0.4) return [150, 185, 235];
    if (y >= h * 0.7) return [128, 128, 128];
    return (x + y) % 2 ? [190, 120, 80] : [90, 30, 20];
  });
}
