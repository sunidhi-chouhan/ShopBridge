import type { Language } from "../../../shared/types";
import type { ChatLine } from "../chat/nexconn";
import { t } from "../i18n";
import { EmptyState } from "../ui/StateView";
import { MessageItem } from "./MessageItem";
import { SystemEvent } from "./SystemEvent";

export function MessageTimeline({
  lines,
  selfId,
  names,
  roles,
  languages,
  animateNew,
  targetLanguage,
  autoTranslate,
  sharedFailureNotice = false,
}: {
  lines: ChatLine[];
  selfId: string;
  names: Record<string, string>;
  roles?: Record<string, string>;
  languages?: Record<string, Language | null | undefined>;
  animateNew: boolean;
  targetLanguage: Language;
  autoTranslate: boolean;
  sharedFailureNotice?: boolean;
}) {
  if (lines.length === 0) {
    return <EmptyState compact inset title={t(targetLanguage, "noMessages")} scene="inbox" />;
  }

  // role="log": screen readers announce additions politely without re-reading history.
  return (
    <ol className="messages" role="log" aria-live="polite" aria-relevant="additions">
      {lines.map((line) => {
        if (line.system) {
          return (
            <SystemEvent
              key={line.id}
              line={line}
              animate={animateNew}
              targetLanguage={targetLanguage}
              autoTranslate={autoTranslate}
            />
          );
        }
        return (
          <MessageItem
            key={line.id}
            line={line}
            mine={line.senderId === selfId}
            name={names[line.senderId] ?? "ShopBridge"}
            role={roles?.[line.senderId]}
            senderLanguage={languages?.[line.senderId] ?? undefined}
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
