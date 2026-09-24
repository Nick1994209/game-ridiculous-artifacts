import type { Rect, WorldMap } from "./protocol";
export const VIEW = {
  width: 1100,
  height: 650,
  chunk: 512,
  overscan: 150,
  interpolation: 120,
};
export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function cameraBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  map: Pick<WorldMap, "width" | "height">,
): Rect {
  return {
    x: Math.max(0, Math.min(map.width - w, x - w / 2)),
    y: Math.max(0, Math.min(map.height - h, y - h / 2)),
    w: Math.min(w, map.width),
    h: Math.min(h, map.height),
  };
}
export function renderWindow(view: Rect): Rect {
  return {
    x: view.x - VIEW.overscan,
    y: view.y - VIEW.overscan,
    w: view.w + 2 * VIEW.overscan,
    h: view.h + 2 * VIEW.overscan,
  };
}
export function chunkKeys(r: Rect) {
  const out: string[] = [];
  for (
    let x = Math.floor(r.x / VIEW.chunk);
    x <= Math.floor((r.x + r.w) / VIEW.chunk);
    x++
  )
    for (
      let y = Math.floor(r.y / VIEW.chunk);
      y <= Math.floor((r.y + r.h) / VIEW.chunk);
      y++
    )
      out.push(`${x}:${y}`);
  return out;
}
export class SpatialIndex<T extends Rect> {
  chunks = new Map<string, Set<T>>();
  constructor(items: T[]) {
    for (const item of items)
      for (const key of chunkKeys(item)) {
        if (!this.chunks.has(key)) this.chunks.set(key, new Set());
        this.chunks.get(key)!.add(item);
      }
  }
  query(window: Rect) {
    const set = new Set<T>();
    for (const key of chunkKeys(window))
      for (const item of this.chunks.get(key) ?? [])
        if (intersects(item, window)) set.add(item);
    return [...set];
  }
}
export function interpolate<T extends Rect & { id: string }>(
  now: T,
  previous: T | undefined,
  alpha: number,
): T {
  if (!previous) return now;
  return {
    ...now,
    x: previous.x + (now.x - previous.x) * alpha,
    y: previous.y + (now.y - previous.y) * alpha,
  };
}
