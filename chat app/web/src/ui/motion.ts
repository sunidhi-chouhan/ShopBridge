import { useReducedMotion, type Transition, type Variants } from "motion/react";

export const easeOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const rise: Transition = { duration: 0.7, ease: easeOut };

export function useMotionOn(): boolean {
  return useReducedMotion() !== true;
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: rise },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};
