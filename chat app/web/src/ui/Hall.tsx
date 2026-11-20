import { LiveCursors, type CursorSpec } from "./flair";

/** The three people in every order conversation, roaming like a multiplayer canvas. */
const CURSORS: CursorSpec[] = [
  { name: "Asha", note: "· buyer · हिन्दी", color: "#c2563f", path: { x: [6, 30, 18, 40], y: [64, 80, 90, 72] }, duration: 13 },
  { name: "Meera", note: "· seller · English", color: "#3c6e71", path: { x: [44, 56, 38, 52], y: [12, 26, 20, 8] }, duration: 15 },
  { name: "Kabir", note: "· support", color: "#6b4fa0", path: { x: [52, 58, 48, 60], y: [62, 48, 80, 70] }, duration: 17 },
];

export function Hall({ paused }: { paused: boolean }) {
  return (
    <div className="hall-scene" aria-hidden="true">
      <div className="hall-glow" />
      <div className="arch-row">
        <span className="arch" />
        <span className="arch is-center" />
        <span className="arch" />
      </div>
      <LiveCursors paused={paused} cursors={CURSORS} />
    </div>
  );
}
