// Sends keyboard focus back to a sensible place when the thing that had it
// closes or is replaced: the control that opened it, or the map. Done a frame
// later, once React has drawn the new state, and without scrolling. `target`
// may be a function, read only then, for an element that is not drawn yet.
export function focusLater(target: HTMLElement | null | undefined | (() => HTMLElement | null | undefined)) {
  requestAnimationFrame(() => {
    const el = typeof target === "function" ? target() : target;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  });
}

// The map itself (its canvas is the "Map" region and a Tab stop), inside `root`.
export const mapCanvas = (root: ParentNode | null | undefined) =>
  root?.querySelector<HTMLElement>("canvas.maplibregl-canvas") ?? null;
