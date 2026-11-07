-- Additive only. Seller price offers (validated server-side) and shipment details for tracking cards.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_total DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_amount DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS eta TEXT;
