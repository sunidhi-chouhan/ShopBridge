-- Additive only: no data is removed or rewritten.
-- Order lifecycle: widen the allowed statuses (existing values stay valid).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('placed', 'packed', 'shipped', 'delivered', 'completed'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Per-user reading language for automatic translation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT;

-- Support resolution outcome.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Shared demo environment: current reset epoch + audit log of resets.
CREATE TABLE IF NOT EXISTS demo_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_resets (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  client TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL,
  detail TEXT
);
