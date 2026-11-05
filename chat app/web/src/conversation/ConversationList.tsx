import type { ConversationView } from "../../../shared/types";
import { SearchField } from "../ui/SearchField";
import { ConversationListItem } from "./ConversationListItem";

export type ConversationFilter = "all" | "unread" | "support";

export function ConversationList({
  items,
  selectedId,
  query,
  unread,
  previews,
  filter,
  totalCount,
  onQueryChange,
  onFilterChange,
  onSelect,
}: {
  items: ConversationView[];
  selectedId: string | null;
  query: string;
  unread: Record<string, number>;
  previews: Record<string, string>;
  filter: ConversationFilter;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: ConversationFilter) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="conv-list" aria-label="Conversations">
      <div className="conv-list-toolbar">
        <SearchField
          id="conversation-search"
          label="Search conversations"
          placeholder="Search by order, product or name"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="conv-filter-row" role="group" aria-label="Filter conversations">
          {(
            [
              ["all", "All"],
              ["unread", "Unread"],
              ["support", "Support"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "conv-filter is-active" : "conv-filter"}
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="conv-list-count meta">
          {items.length === totalCount
            ? `${totalCount} conversation${totalCount === 1 ? "" : "s"}`
            : `${items.length} of ${totalCount}`}
        </p>
      </div>
      <div className="conv-list-scroll">
        {items.length === 0 ? (
          <p className="meta conv-list-empty">No conversations match that search.</p>
        ) : (
          <ul className="conv-list-ul">
            {items.map((item) => (
              <li key={item.id}>
                <ConversationListItem
                  item={item}
                  selected={item.id === selectedId}
                  unread={unread[item.id] ?? 0}
                  preview={previews[item.id] ?? ""}
                  onSelect={() => onSelect(item.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
