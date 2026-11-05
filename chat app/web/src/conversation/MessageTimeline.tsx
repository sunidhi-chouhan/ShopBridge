import type { ChatLine } from "../chat/nexconn";
import { copy } from "../copy";
import { EmptyState } from "../ui/StateView";
import { isSystemEvent } from "./format";
import { MessageItem } from "./MessageItem";
import { SystemEvent } from "./SystemEvent";

export function MessageTimeline({
  lines,
  selfId,
  names,
  roles,
  animateNew,
  targetLanguage,
  autoTranslate,
  sharedFailureNotice = false,
}: {
  lines: ChatLine[];
  selfId: string;
  names: Record<string, string>;
  roles?: Record<string, string>;
  animateNew: boolean;
  targetLanguage: string;
  autoTranslate: boolean;
  sharedFailureNotice?: boolean;
}) {
  if (lines.length === 0) {
    return <EmptyState compact inset title={copy.emptyChat} scene="inbox" />;
  }

  return (
    <ol className="messages" aria-live="polite">
      {lines.map((line) => {
        if (isSystemEvent(line.text)) {
          return <SystemEvent key={line.id} line={line} animate={animateNew} />;
        }
        return (
          <MessageItem
            key={line.id}
            line={line}
            mine={line.senderId === selfId}
            name={names[line.senderId] ?? copy.name}
            role={roles?.[line.senderId]}
            animate={animateNew}
            targetLanguage={targetLanguage}
            autoTranslate={autoTranslate}
            sharedFailureNotice={sharedFailureNotice}
          />
        );
      })}
    </ol>
  );
}
