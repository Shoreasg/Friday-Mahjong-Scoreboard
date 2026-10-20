import type { Pool, PoolClient } from "pg";

export class ReservationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export interface ReservationActor { userId: string; displayName: string; isAdmin: boolean }
export interface ReservationTime { date: string; startTime: string }
export type ReservationCommand =
  | { kind: "create"; date: string; startTime: string; enrollCreator: boolean }
  | { kind: "edit"; eventId: number; date: string; startTime: string }
  | { kind: "join" | "leave" | "cancel"; eventId: number }
  | { kind: "retry"; eventId: number; notificationId: number };
interface EventRow {
  id: number; creator_user_id: string; creator_display_name: string;
  starts_at: Date; cancelled_at: Date | null; created_at: Date;
}
interface EnrollmentRow {
  id: number; user_id: string; display_name: string; seat: number | null; joined_at: Date;
}
interface NotificationRow {
  id: number; kind: "created" | "promoted" | "cancelled";
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number; sent_at: Date | null; failure_code: string | null; created_at: Date;
}

/** Singapore is UTC+08:00 with no daylight-saving transitions. Round-trip rejects invalid dates. */
export function singaporeInstant(input: ReservationTime): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    throw new ReservationError(400, "INVALID_TIME", "Use a real YYYY-MM-DD date and HH:mm start time in Asia/Singapore");
  }
  const instant = new Date(`${input.date}T${input.startTime}:00+08:00`);
  if (!Number.isFinite(instant.getTime()) ||
      new Date(instant.getTime() + 8 * 3600_000).toISOString().slice(0, 16) !== `${input.date}T${input.startTime}`) {
    throw new ReservationError(400, "INVALID_TIME", "Invalid Singapore calendar date");
  }
  return instant;
}

export function safeReservationName(value: string | null | undefined): string {
  // Never fall back to an email, username, account identifier or credential.
  const name = value?.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return name && !name.includes("@") ? name.slice(0, 80) : "Mahjong player";
}

export class ReservationStore {
  constructor(private pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async event(client: PoolClient, id: number, lock = false): Promise<EventRow> {
    const { rows } = await client.query<EventRow>(
      `SELECT * FROM reservation_events WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id],
    );
    if (!rows[0]) throw new ReservationError(404, "EVENT_NOT_FOUND", "Event not found");
    return rows[0];
  }

  private async now(client: PoolClient): Promise<Date> {
    // Unlike transaction_timestamp(), clock_timestamp() advances while waiting for a row lock.
    return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
  }

  private manager(event: EventRow, actor: ReservationActor) {
    if (event.creator_user_id !== actor.userId && !actor.isAdmin) {
      throw new ReservationError(403, "MANAGER_REQUIRED", "Only the creator or an admin can manage this event");
    }
  }

  private open(event: EventRow, now: Date) {
    if (event.cancelled_at) throw new ReservationError(409, "EVENT_CANCELLED", "Event is cancelled");
    if (event.starts_at <= now) throw new ReservationError(409, "EVENT_STARTED", "Event has already started");
  }

  private async intent(client: PoolClient, eventId: number, kind: string, enrollmentId?: number) {
    await client.query(
      `INSERT INTO reservation_notifications(event_id,kind,enrollment_id,deduplication_key)
       VALUES ($1,$2,$3,$4) ON CONFLICT (deduplication_key) DO NOTHING`,
      [eventId, kind, enrollmentId ?? null, `${eventId}:${kind}:${enrollmentId ?? ""}`],
    );
  }

  private async detail(client: PoolClient, event: EventRow, actor: ReservationActor) {
    const { rows: members } = await client.query<EnrollmentRow>(
      "SELECT * FROM reservation_enrollments WHERE event_id=$1 AND left_at IS NULL ORDER BY id", [event.id],
    );
    const { rows: notifications } = await client.query<NotificationRow>(
      "SELECT * FROM reservation_notifications WHERE event_id=$1 ORDER BY id", [event.id],
    );
    const now = await this.now(client);
    const open = !event.cancelled_at && event.starts_at > now;
    const manage = event.creator_user_id === actor.userId || actor.isAdmin;
    const mine = members.find((m) => m.user_id === actor.userId);
    const participant = (m: EnrollmentRow) => ({
      enrollmentId: m.id, displayName: safeReservationName(m.display_name),
      isCaller: m.user_id === actor.userId, joinedAt: m.joined_at.toISOString(),
    });
    const local = new Date(event.starts_at.getTime() + 8 * 3600_000).toISOString();
    return {
      id: event.id,
      date: local.slice(0, 10), startTime: local.slice(11, 16), timeZone: "Asia/Singapore" as const,
      startsAt: event.starts_at.toISOString(), createdAt: event.created_at.toISOString(),
      cancelledAt: event.cancelled_at?.toISOString() ?? null,
      status: event.cancelled_at ? "cancelled" as const : open ? "open" as const : "started" as const,
      capacity: 4 as const, creator: { displayName: safeReservationName(event.creator_display_name), isCaller: event.creator_user_id === actor.userId },
      confirmed: members.filter((m) => m.seat !== null).sort((a, b) => a.seat! - b.seat!).map((m) => ({ ...participant(m), seat: m.seat! })),
      waiting: members.filter((m) => m.seat === null).map((m, i) => ({ ...participant(m), position: i + 1 })),
      callerState: !mine ? "none" as const : mine.seat === null ? "waiting" as const : "confirmed" as const,
      allowedActions: { join: open && !mine, leave: open && !!mine, edit: open && manage, cancel: !event.cancelled_at && manage, retryNotification: manage && notifications.some((n) => n.status === "failed") },
      notifications: notifications.map((n) => ({
        id: n.id, kind: n.kind, status: n.status, attempts: n.attempts,
        createdAt: n.created_at.toISOString(), sentAt: n.sent_at?.toISOString() ?? null,
        // Do not expose raw provider errors or message/claim tokens.
        failureCode: n.status === "failed" ? "DELIVERY_FAILED" : null,
        canRetry: manage && n.status === "failed",
      })),
    };
  }

  async get(id: number, actor: ReservationActor) {
    // The event row lock also makes participant/notification snapshots consistent with mutations.
    return this.transaction(async (client) => this.detail(client, await this.event(client, id, true), actor));
  }

  async list(actor: ReservationActor) {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: number }>("SELECT id FROM reservation_events ORDER BY starts_at,id");
      const events = [];
      // Always lock in ascending ID order, not presentation order, to avoid list/list deadlocks.
      for (const { id } of [...rows].sort((a, b) => a.id - b.id)) {
        events.push(await this.detail(client, await this.event(client, id, true), actor));
      }
      return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
    });
  }

  async mutate(actor: ReservationActor, requestKey: string, command: ReservationCommand) {
    const fingerprint = JSON.stringify(command);
    return this.transaction(async (client) => {
      // All code takes request lock before event lock; collisions only serialize unrelated requests.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`reservation:${actor.userId}:${requestKey}`]);
      const receipt = (await client.query<{ fingerprint: string; event_id: number }>(
        "SELECT * FROM reservation_requests WHERE user_id=$1 AND request_key=$2", [actor.userId, requestKey],
      )).rows[0];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new ReservationError(409, "IDEMPOTENCY_CONFLICT", "Use a new Idempotency-Key for a different operation");
        return this.detail(client, await this.event(client, receipt.event_id, true), actor);
      }
      let event: EventRow;
      if (command.kind === "create") {
        const startsAt = singaporeInstant(command);
        if (startsAt <= await this.now(client)) throw new ReservationError(400, "START_NOT_FUTURE", "Start time must be in the future (Asia/Singapore)");
        event = (await client.query<EventRow>(
          "INSERT INTO reservation_events(creator_user_id,creator_display_name,starts_at) VALUES($1,$2,$3) RETURNING *",
          [actor.userId, safeReservationName(actor.displayName), startsAt],
        )).rows[0]!;
        if (command.enrollCreator) {
          await client.query("INSERT INTO reservation_enrollments(event_id,user_id,display_name,seat) VALUES($1,$2,$3,1)", [event.id, actor.userId, safeReservationName(actor.displayName)]);
        }
        await this.intent(client, event.id, "created");
      } else {
        event = await this.event(client, command.eventId, true);
        const now = await this.now(client);
        if (command.kind === "retry") {
          this.manager(event, actor);
          const notification = (await client.query<NotificationRow>(
            "SELECT * FROM reservation_notifications WHERE id=$1 AND event_id=$2 FOR UPDATE", [command.notificationId, event.id],
          )).rows[0];
          if (!notification) throw new ReservationError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
          if (notification.status !== "failed") throw new ReservationError(409, "NOT_RETRYABLE", "Only failed notifications can be retried");
          await client.query("UPDATE reservation_notifications SET status='pending',failure_code=NULL WHERE id=$1", [notification.id]);
        } else if (command.kind === "cancel") {
          this.manager(event, actor);
          if (!event.cancelled_at) {
            event = (await client.query<EventRow>("UPDATE reservation_events SET cancelled_at=clock_timestamp() WHERE id=$1 RETURNING *", [event.id])).rows[0]!;
            await this.intent(client, event.id, "cancelled");
          }
        } else if (command.kind === "edit") {
          this.manager(event, actor);
          this.open(event, now); // Check the OLD start, so a time edit cannot reopen it.
          const startsAt = singaporeInstant(command);
          if (startsAt <= now) throw new ReservationError(400, "START_NOT_FUTURE", "Start time must be in the future (Asia/Singapore)");
          event = (await client.query<EventRow>("UPDATE reservation_events SET starts_at=$2 WHERE id=$1 RETURNING *", [event.id, startsAt])).rows[0]!;
        } else {
          this.open(event, now);
          const mine = (await client.query<EnrollmentRow>("SELECT * FROM reservation_enrollments WHERE event_id=$1 AND user_id=$2 AND left_at IS NULL", [event.id, actor.userId])).rows[0];
          if (command.kind === "join" && !mine) {
            const seats = (await client.query<{ seat: number }>("SELECT seat FROM reservation_enrollments WHERE event_id=$1 AND left_at IS NULL AND seat IS NOT NULL", [event.id])).rows.map((r) => r.seat);
            const seat = [1, 2, 3, 4].find((s) => !seats.includes(s)) ?? null;
            await client.query("INSERT INTO reservation_enrollments(event_id,user_id,display_name,seat) VALUES($1,$2,$3,$4)", [event.id, actor.userId, safeReservationName(actor.displayName), seat]);
          } else if (command.kind === "leave" && mine) {
            await client.query("UPDATE reservation_enrollments SET left_at=clock_timestamp(),seat=NULL WHERE id=$1", [mine.id]);
            if (mine.seat !== null) {
              const promoted = (await client.query<{ id: number }>(
                `UPDATE reservation_enrollments SET seat=$2 WHERE id=(
                 SELECT id FROM reservation_enrollments WHERE event_id=$1 AND left_at IS NULL AND seat IS NULL ORDER BY id LIMIT 1
                ) RETURNING id`, [event.id, mine.seat],
              )).rows[0];
              if (promoted) await this.intent(client, event.id, "promoted", promoted.id);
            }
          }
        }
      }
      await client.query("INSERT INTO reservation_requests(user_id,request_key,fingerprint,event_id) VALUES($1,$2,$3,$4)", [actor.userId, requestKey, fingerprint, event.id]);
      return this.detail(client, event, actor);
    });
  }
}
