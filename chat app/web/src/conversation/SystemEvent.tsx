import { motion } from "motion/react";
import type { ChatLine } from "../chat/nexconn";
import { easeOut, useMotionOn } from "../ui/motion";
import { formatMessageTime, systemEventCopy } from "./format";

export function SystemEvent({ line, animate }: { line: ChatLine; animate: boolean }) {
  const motionOn = useMotionOn();
  return (
    <motion.li
      className="message is-update"
      initial={motionOn && animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easeOut }}
    >
      <span className="who">
        System
        <span className="when"> · {formatMessageTime(line.sentTime)}</span>
      </span>
      <p>{systemEventCopy(line.text)}</p>
    </motion.li>
  );
}
