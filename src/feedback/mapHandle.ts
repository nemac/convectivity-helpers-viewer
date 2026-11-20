// The one MapLibre map, handed over by MapView so feedback mode can turn a
// click into a place, put pins on the map and fly to a comment, without
// MapView knowing anything about feedback. MapView calls setFeedbackMap(m)
// once the map is made and setFeedbackMap(null) when it is removed.
import { useSyncExternalStore } from "react";
import type { Map } from "maplibre-gl";

let current: Map | null = null;
const listeners = new Set<() => void>();

export function setFeedbackMap(m: Map | null) {
  if (m === current) return;
  current = m;
  listeners.forEach((l) => l());
}
export function getFeedbackMap(): Map | null { return current; }

export function useFeedbackMap(): Map | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
  );
}

// Whether the drawing tool is on. While it is, every click on the map is a
// corner of the drawing, Alt or not, and none is feedback's. MapView sets it
// for as long as drawing lasts.
let drawingNow = false;
export function setFeedbackDrawing(on: boolean) { drawingNow = on; }
export function feedbackDrawing(): boolean { return drawingNow; }
