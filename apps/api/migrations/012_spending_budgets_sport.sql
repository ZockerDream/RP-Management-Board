CREATE TABLE spending_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name text NOT NULL,
  budget_id uuid REFERENCES budgets ON DELETE CASCADE,
  category_id uuid REFERENCES categories ON DELETE CASCADE,
  limit_amount numeric(14, 2) NOT NULL CHECK (limit_amount > 0),
  period_type text NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON spending_budgets (owner_user_id);

CREATE TABLE sport_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  sport_type text NOT NULL DEFAULT 'run' CHECK (sport_type IN ('run', 'swim', 'bike')),
  name text NOT NULL,
  checkpoints integer NOT NULL DEFAULT 0 CHECK (checkpoints >= 0),
  distance_km numeric(8, 2) CHECK (distance_km >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sport_routes (team_id);

CREATE TABLE sport_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES sport_routes ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  score numeric(10, 2) NOT NULL CHECK (score >= 0),
  duration_seconds integer CHECK (duration_seconds >= 0),
  checkpoints_reached integer CHECK (checkpoints_reached >= 0),
  note text NOT NULL DEFAULT '',
  achieved_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sport_scores (route_id, score DESC);
CREATE INDEX ON sport_scores (user_id);
