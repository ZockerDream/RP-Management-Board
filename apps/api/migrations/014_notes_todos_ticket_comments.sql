CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 150),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL)),
  CHECK (title <> '' OR body <> '')
);
CREATE INDEX ON notes (owner_user_id);
CREATE INDEX ON notes (team_id);

CREATE TABLE todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
  due_date date,
  done_at timestamptz,
  done_by uuid REFERENCES users ON DELETE SET NULL,
  last_reminder text,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE INDEX ON todos (owner_user_id);
CREATE INDEX ON todos (team_id);
CREATE INDEX ON todos (due_date) WHERE done_at IS NULL AND due_date IS NOT NULL;

CREATE TABLE bug_report_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id bigint NOT NULL REFERENCES bug_reports ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON bug_report_comments (report_id, created_at);
