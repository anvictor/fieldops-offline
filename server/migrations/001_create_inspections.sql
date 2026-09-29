CREATE TABLE inspections (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
