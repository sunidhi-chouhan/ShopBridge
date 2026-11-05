import { Button } from "./Button";
import { QtyStepper } from "./QtyStepper";

function BagMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M6 8h12l-.9 12.2a1 1 0 0 1-1 .8H7.9a1 1 0 0 1-1-.8L6 8z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7.5" />
    </svg>
  );
}

export function PurchaseBar({
  quantity,
  max,
  onQuantityChange,
  onViewBag,
  pending = false,
  added = false,
  held = false,
}: {
  quantity: number;
  max: number;
  onQuantityChange: (value: number) => void;
  onViewBag: () => void;
  pending?: boolean;
  added?: boolean;
  held?: boolean;
}) {
  const addLabel = held ? "Held" : added ? "Added" : "Add to bag";

  return (
    <div className="purchase-bar">
      <QtyStepper
        value={quantity}
        min={held ? 0 : 1}
        max={Math.max(max, held ? 0 : 1)}
        onChange={onQuantityChange}
        disabled={held}
        label="Quantity"
      />
      <Button type="submit" pending={pending} added={added} disabled={held || quantity < 1}>
        {held ? null : added ? <CheckMark /> : <BagMark />}
        {addLabel}
      </Button>
      <Button type="button" variant="secondary" onClick={onViewBag}>
        View bag
      </Button>
    </div>
  );
}
