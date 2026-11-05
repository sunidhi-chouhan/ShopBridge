import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useMotionOn } from "./motion";

const orbitEase: [number, number, number, number] = [0.45, 0.05, 0.55, 0.95];

const spheres = [
  { id: "a", duration: 8.8, delay: 0, x: [0, 32, 10, -28, 0], y: [0, -26, 16, -12, 0], scale: [1, 1.08, 0.94, 1.05, 1] },
  { id: "b", duration: 4.5, delay: 0.12, x: [52, 14, -48, 30, 52], y: [-32, 30, 12, -42, -32], scale: [1, 0.88, 1.12, 0.92, 1] },
  { id: "c", duration: 3.3, delay: 0.35, x: [-64, -14, 40, -46, -64], y: [-10, -44, 20, 30, -10], scale: [1, 1.16, 0.86, 1.08, 1] },
  { id: "d", duration: 5.6, delay: 0.18, x: [34, 70, 16, -22, 34], y: [48, 12, -32, 40, 48], scale: [0.9, 1.14, 1, 0.84, 0.9] },
  { id: "e", duration: 3.15, delay: 0.5, x: [-28, 26, -48, 12, -28], y: [44, 20, -20, 52, 44], scale: [1, 0.82, 1.18, 0.9, 1] },
];

export function Hall({ paused }: { paused: boolean }) {
  const motionOn = useMotionOn();
  const scene = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!motionOn || paused) return;
    const onMove = (event: PointerEvent) => {
      const box = scene.current?.getBoundingClientRect();
      if (!box) return;
      setTilt({
        x: ((event.clientX - box.left) / box.width - 0.5) * 36,
        y: ((event.clientY - box.top) / box.height - 0.5) * 20,
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [motionOn, paused]);

  const live = motionOn && !paused;

  return (
    <div className="hall-scene" ref={scene} aria-hidden="true">
      <div className="hall-glow" />
      <div className="arch-row">
        <span className="arch" />
        <span className="arch is-center" />
        <span className="arch" />
      </div>
      <div className={`orb-cluster${live ? "" : " is-still"}`}>
        <motion.div
          className="orb-tilt"
          animate={live ? { x: tilt.x, y: tilt.y } : { x: 0, y: 0 }}
          transition={{ type: "spring", stiffness: 48, damping: 14, mass: 0.65 }}
        >
          {spheres.map((sphere) => (
            <motion.span
              key={sphere.id}
              className={`sphere sphere-${sphere.id}`}
              animate={
                live
                  ? { x: sphere.x, y: sphere.y, scale: sphere.scale }
                  : { x: sphere.x[0], y: sphere.y[0], scale: sphere.scale[0] }
              }
              transition={
                live
                  ? { duration: sphere.duration, delay: sphere.delay, repeat: Infinity, ease: orbitEase }
                  : { duration: 0.4 }
              }
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
