ALTER TABLE inspections ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

-- Permanent: offline retries can arrive after subsequent edits or deletion.
CREATE TABLE inspection_mutations (
  mutation_id uuid PRIMARY KEY,
  inspection_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('CREATE', 'UPDATE')),
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  response_status integer NOT NULL CHECK (response_status IN (200, 201))
);
