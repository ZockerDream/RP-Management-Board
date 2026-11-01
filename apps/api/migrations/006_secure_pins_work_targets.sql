ALTER TABLE properties ADD COLUMN door_pin_enc text;
ALTER TABLE users ADD COLUMN weekly_work_hours numeric(5, 2) NOT NULL DEFAULT 40
  CHECK (weekly_work_hours > 0 AND weekly_work_hours <= 168);
