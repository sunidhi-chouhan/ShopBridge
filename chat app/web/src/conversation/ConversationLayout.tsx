import type { ReactNode } from "react";

export function ConversationLayout({
  list,
  thread,
  mobileThread,
  title,
  lede,
  actions,
  meta,
}: {
  list: ReactNode;
  thread: ReactNode;
  mobileThread: boolean;
  title: string;
  lede: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className={mobileThread ? "conv-workspace is-mobile-thread" : "conv-workspace"}>
      <header className="conv-workspace-mast">
        <div className="conv-workspace-mast-row">
          <div className="conv-workspace-mast-copy">
            <p className="kicker">Inbox</p>
            <h1 className="conv-workspace-title">{title}</h1>
            <p className="lede">{lede}</p>
            {meta ? <div className="conv-workspace-meta">{meta}</div> : null}
          </div>
          {actions ? <div className="conv-workspace-actions">{actions}</div> : null}
        </div>
      </header>
      <div className="conv-split">
        <div className="conv-pane-list">{list}</div>
        <div className="conv-pane-thread">{thread}</div>
      </div>
    </div>
  );
}
