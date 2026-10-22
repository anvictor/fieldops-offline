-- Retain retired identities permanently: offline CREATE replay may arrive arbitrarily late.
CREATE TABLE inspection_tombstones (
  id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
