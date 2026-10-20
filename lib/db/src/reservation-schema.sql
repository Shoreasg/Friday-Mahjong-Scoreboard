-- Additive, repeatable development reconciliation. Never modifies session/player data.
CREATE TABLE IF NOT EXISTS reservation_events (
  id serial PRIMARY KEY,
  creator_user_id text NOT NULL,
  creator_display_name text NOT NULL,
  starts_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservation_enrollments (
  id serial PRIMARY KEY,
  event_id integer NOT NULL CONSTRAINT reservation_enrollments_event_id_reservation_events_id_fk REFERENCES reservation_events(id),
  user_id text NOT NULL,
  display_name text NOT NULL,
  seat integer,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT reservation_seat_range CHECK (seat IS NULL OR seat BETWEEN 1 AND 4),
  CONSTRAINT reservation_left_seat CHECK (left_at IS NULL OR seat IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS reservation_active_account ON reservation_enrollments(event_id,user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reservation_active_seat ON reservation_enrollments(event_id,seat) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS reservation_queue ON reservation_enrollments(event_id,id) WHERE left_at IS NULL;
CREATE TABLE IF NOT EXISTS reservation_notifications (
  id serial PRIMARY KEY,
  event_id integer NOT NULL CONSTRAINT reservation_notifications_event_id_reservation_events_id_fk REFERENCES reservation_events(id),
  kind text NOT NULL,
  enrollment_id integer CONSTRAINT reservation_notifications_enrollment_id_reservation_enrollments_id_fk REFERENCES reservation_enrollments(id),
  deduplication_key text NOT NULL CONSTRAINT reservation_notifications_deduplication_key_unique UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token text,
  sent_at timestamptz,
  provider_message_id text,
  failure_code text,
  CONSTRAINT reservation_notification_kind CHECK (kind IN ('created','promoted','cancelled')),
  CONSTRAINT reservation_notification_status CHECK (status IN ('pending','processing','sent','failed')),
  CONSTRAINT reservation_notification_delivery CHECK (((status = 'sent') = (sent_at IS NOT NULL)) AND ((status = 'sent') = (provider_message_id IS NOT NULL))),
  CONSTRAINT reservation_notification_claim CHECK (((status = 'processing') = (claim_token IS NOT NULL)) AND ((status = 'processing') = (claimed_at IS NOT NULL))),
  CONSTRAINT reservation_notification_attempts CHECK (attempts >= 0)
);
CREATE TABLE IF NOT EXISTS reservation_requests (
  user_id text NOT NULL,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  event_id integer NOT NULL CONSTRAINT reservation_requests_event_id_reservation_events_id_fk REFERENCES reservation_events(id),
  PRIMARY KEY (user_id,request_key)
);
