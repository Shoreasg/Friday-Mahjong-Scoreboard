import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

// Fail closed: bootstrap exclusively inside a throwaway schema before importing the application pool.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for reservation integration tests");
const schema = `reservation_it_${randomUUID().replaceAll("-", "")}`;
const bootstrap = new pg.Pool({ connectionString: url });
try {
  await bootstrap.query(`CREATE SCHEMA "${schema}"`);
} finally {
  await bootstrap.end();
}
process.env.DATABASE_URL = `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
const { pool, ReservationStore, singaporeInstant, safeReservationName } = await import("@workspace/db");
const { reconcileReservations } = await import("./reconcile-reservations");
await reconcileReservations();
await reconcileReservations(); // The actual post-merge command is repeatable.
const store = new ReservationStore(pool);
type Actor = import("@workspace/db").ReservationActor;
const actor = (userId: string, isAdmin = false): Actor => ({ userId, displayName: `Player ${userId}`, isAdmin });
const creator = actor("creator");
const future = { date: "2099-06-01", startTime: "20:00" };
const create = (enrollCreator = false) => store.mutate(creator, randomUUID(), { kind: "create", ...future, enrollCreator });
const action = (user: Actor, eventId: number, kind: "join" | "leave" | "cancel") => store.mutate(user, randomUUID(), { kind, eventId });
beforeEach(async () => {
  await pool.query("TRUNCATE reservation_requests,reservation_notifications,reservation_enrollments,reservation_events RESTART IDENTITY");
});
afterAll(async () => {
  await pool.end();
  const cleanup = new pg.Pool({ connectionString: url });
  try { await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); }
  finally { await cleanup.end(); }
});

describe("reservation storage and serialized transitions (real PostgreSQL)", () => {
  it("reconciles additively without touching existing session or player tables", async () => {
    const ddl = await readFile(new URL("../../lib/db/src/reservation-schema.sql", import.meta.url), "utf8");
    expect(ddl).not.toMatch(/\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema]);
    expect(tables.rows.map((r) => r.tablename).sort()).toEqual([
      "reservation_enrollments", "reservation_events", "reservation_notifications", "reservation_requests",
    ]);
  });
  it("interprets Singapore times, validates dates, and refuses non-future creation", async () => {
    expect(singaporeInstant(future).toISOString()).toBe("2099-06-01T12:00:00.000Z");
    for (const date of ["2099-02-29", "2099-04-31", "2099-00-01", "invalid"]) {
      expect(() => singaporeInstant({ date, startTime: "20:00" })).toThrow();
    }
    expect(() => singaporeInstant({ date: future.date, startTime: "24:00" })).toThrow();
    await expect(store.mutate(creator, randomUUID(), { kind: "create", date: "2020-01-01", startTime: "20:00", enrollCreator: false })).rejects.toMatchObject({ code: "START_NOT_FUTURE" });
    expect((await pool.query("SELECT * FROM reservation_events")).rows).toHaveLength(0);
  });
  it("defaults enrollment off at the API boundary; explicit enrollment is atomically first", async () => {
    const empty = await create();
    expect(empty.confirmed).toEqual([]);
    expect(empty.callerState).toBe("none");
    expect(empty.notifications).toEqual([expect.objectContaining({ kind: "created", status: "pending", sentAt: null })]);
    const enrolled = await create(true);
    expect(enrolled.confirmed).toEqual([expect.objectContaining({ seat: 1, isCaller: true })]);
    expect(enrolled.callerState).toBe("confirmed");
    expect(enrolled.timeZone).toBe("Asia/Singapore");
  });
  it("serializes simultaneous bookings: exactly four seats and deterministic FIFO IDs", async () => {
    const event = await create();
    await Promise.all(Array.from({ length: 30 }, (_, i) => action(actor(`user${i}`), event.id, "join")));
    const result = await store.get(event.id, creator);
    expect(result.confirmed.map((m) => m.seat)).toEqual([1, 2, 3, 4]);
    expect(result.waiting).toHaveLength(26);
    expect(result.waiting.map((m) => m.enrollmentId)).toEqual([...result.waiting.map((m) => m.enrollmentId)].sort((a, b) => a - b));
    expect(result.waiting.map((m) => m.position)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(result.notifications).toHaveLength(1); // Joins do not notify.
  });
  it("deduplicates concurrent creation/joins and rejects key reuse for changed inputs", async () => {
    const key = randomUUID();
    const command = { kind: "create" as const, ...future, enrollCreator: true };
    const results = await Promise.all(Array.from({ length: 10 }, () => store.mutate(creator, key, command)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const eventId = results[0]!.id;
    const joinKey = randomUUID();
    await Promise.all(Array.from({ length: 15 }, (_, i) =>
      store.mutate(actor("same"), i % 2 ? joinKey : randomUUID(), { kind: "join", eventId })));
    expect((await store.get(eventId, creator)).confirmed).toHaveLength(2);
    await expect(store.mutate(creator, key, { ...command, enrollCreator: false })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await pool.query("SELECT * FROM reservation_events")).rows).toHaveLength(1);
  });
  it("promotes only the earliest active waiters once when departures race or repeat", async () => {
    const event = await create();
    for (let i = 0; i < 8; i++) await action(actor(`p${i}`), event.id, "join");
    await Promise.all([
      action(actor("p0"), event.id, "leave"), action(actor("p1"), event.id, "leave"),
      action(actor("p0"), event.id, "leave"), action(actor("p1"), event.id, "leave"),
    ]);
    const result = await store.get(event.id, creator);
    expect(result.confirmed.map((p) => p.displayName).sort()).toEqual(["Player p2", "Player p3", "Player p4", "Player p5"]);
    expect(result.waiting.map((p) => p.displayName)).toEqual(["Player p6", "Player p7"]);
    expect(result.notifications.filter((n) => n.kind === "promoted")).toHaveLength(2);
    expect(result.notifications.every((n) => n.status === "pending" && n.sentAt === null)).toBe(true);
  });
  it("waiting departures preserve order, rejoin appends and old leave retries cannot remove the new entry", async () => {
    const event = await create();
    for (let i = 0; i < 7; i++) await action(actor(`p${i}`), event.id, "join");
    const key = randomUUID();
    await store.mutate(actor("p4"), key, { kind: "leave", eventId: event.id });
    await action(actor("p4"), event.id, "join");
    await store.mutate(actor("p4"), key, { kind: "leave", eventId: event.id });
    const result = await store.get(event.id, creator);
    expect(result.waiting.map((p) => p.displayName)).toEqual(["Player p5", "Player p6", "Player p4"]);
    expect(result.notifications).toHaveLength(1);
  });
  it("enforces creator/admin management and prevents time edits from reopening started events", async () => {
    const event = await create();
    await expect(store.mutate(actor("other"), randomUUID(), { kind: "edit", eventId: event.id, ...future })).rejects.toMatchObject({ status: 403 });
    await expect(action(actor("other"), event.id, "cancel")).rejects.toMatchObject({ status: 403 });
    await store.mutate(actor("admin", true), randomUUID(), { kind: "edit", eventId: event.id, date: "2099-07-01", startTime: "22:00" });
    await pool.query("UPDATE reservation_events SET starts_at=clock_timestamp() WHERE id=$1", [event.id]);
    for (const kind of ["join", "leave"] as const) {
      await expect(action(creator, event.id, kind)).rejects.toMatchObject({ code: "EVENT_STARTED" });
    }
    await expect(store.mutate(creator, randomUUID(), { kind: "edit", eventId: event.id, ...future })).rejects.toMatchObject({ code: "EVENT_STARTED" });
    const result = await store.get(event.id, creator);
    expect(result.allowedActions).toMatchObject({ join: false, leave: false, edit: false, cancel: true });
    expect((await action(actor("admin", true), event.id, "cancel")).status).toBe("cancelled");
  });
  it("evaluates cutoff AFTER waiting for the event lock, not at transaction start", async () => {
    const event = await create(true);
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT * FROM reservation_events WHERE id=$1 FOR UPDATE", [event.id]);
      const contender = action(actor("late"), event.id, "join");
      // Observe the blocked row lock instead of relying on a timing sleep.
      for (let i = 0; i < 100; i++) {
        const blocked = await holder.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM reservation_events WHERE id=%' AND pid<>pg_backend_pid()");
        if (blocked.rowCount) break;
        if (i === 99) throw new Error("Contender did not reach the row lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await holder.query("UPDATE reservation_events SET starts_at=clock_timestamp() WHERE id=$1", [event.id]);
      await holder.query("COMMIT");
      await expect(contender).rejects.toMatchObject({ code: "EVENT_STARTED" });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });
  it("persists cancellation once; concurrent operations cannot promote after cancellation", async () => {
    const event = await create(true);
    for (let i = 0; i < 5; i++) await action(actor(`p${i}`), event.id, "join");
    await Promise.all([action(creator, event.id, "cancel"), action(creator, event.id, "cancel"), action(actor("p0"), event.id, "leave").catch((e) => {
      expect(e.code).toBe("EVENT_CANCELLED");
    })]);
    const snapshot = await store.get(event.id, creator);
    const count = snapshot.notifications.length;
    await expect(action(actor("new"), event.id, "join")).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    await expect(action(creator, event.id, "leave")).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    expect((await store.get(event.id, creator)).notifications).toHaveLength(count);
    expect(snapshot.notifications.filter((n) => n.kind === "cancelled")).toHaveLength(1);
    expect(snapshot.status).toBe("cancelled");
    expect(snapshot.allowedActions).toMatchObject({ join: false, leave: false, edit: false, cancel: false });
  });
  it("keeps safe names and account IDs private in list/detail responses", async () => {
    const event = await store.mutate({ ...creator, displayName: "private@example.com" }, randomUUID(), { kind: "create", ...future, enrollCreator: true });
    expect(safeReservationName("\nNice\u0000 Name")).toBe("Nice Name");
    expect(event.creator.displayName).toBe("Mahjong player");
    expect(JSON.stringify(await store.list(actor("reader")))).not.toMatch(/user_id|userId|private@|creator_user|claim_token|provider_message/);
    expect((await store.get(event.id, actor("reader"))).allowedActions.edit).toBe(false);
  });
  it("requeues only failed notifications for managers without claiming delivery", async () => {
    const event = await create();
    const notificationId = event.notifications[0]!.id;
    const retry = { kind: "retry" as const, eventId: event.id, notificationId };
    await expect(store.mutate(creator, randomUUID(), retry)).rejects.toMatchObject({ code: "NOT_RETRYABLE" });
    await pool.query("UPDATE reservation_notifications SET status='failed',failure_code='raw secret error' WHERE id=$1", [notificationId]);
    expect((await store.get(event.id, creator)).notifications[0]).toMatchObject({ canRetry: true, failureCode: "DELIVERY_FAILED" });
    await expect(store.mutate(actor("other"), randomUUID(), retry)).rejects.toMatchObject({ status: 403 });
    const result = await store.mutate(actor("admin", true), randomUUID(), retry);
    expect(result.notifications[0]).toMatchObject({ status: "pending", sentAt: null, failureCode: null, canRetry: false });
    await expect(store.mutate(creator, randomUUID(), { ...retry, notificationId: 9999 })).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
    await pool.query("UPDATE reservation_notifications SET status='sent',sent_at=clock_timestamp(),provider_message_id='123' WHERE id=$1", [notificationId]);
    await expect(store.mutate(creator, randomUUID(), retry)).rejects.toMatchObject({ code: "NOT_RETRYABLE" });
  });
  it("enforces seat/account uniqueness and never marks an unacknowledged message sent", async () => {
    const event = await create(true);
    for (const [userId, seat] of [["duplicate-seat", 1], ["creator", 2], ["out-of-range", 5]]) {
      await expect(pool.query("INSERT INTO reservation_enrollments(event_id,user_id,display_name,seat) VALUES($1,$2,'X',$3)", [event.id, userId, seat])).rejects.toThrow();
    }
    await expect(pool.query("UPDATE reservation_notifications SET status='sent' WHERE event_id=$1", [event.id])).rejects.toThrow();
  });
  it("rolls back bookings, departures and promotions if intent persistence fails", async () => {
    const event = await create(true);
    for (let i = 0; i < 4; i++) await action(actor(`p${i}`), event.id, "join");
    await pool.query(`CREATE FUNCTION reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intent failure'; END $$;
      CREATE TRIGGER reject_intent BEFORE INSERT ON reservation_notifications FOR EACH ROW EXECUTE FUNCTION reject_intent()`);
    try {
      await expect(action(creator, event.id, "leave")).rejects.toThrow("intent failure");
      await expect(create(true)).rejects.toThrow("intent failure");
      expect((await pool.query("SELECT * FROM reservation_events")).rowCount).toBe(1);
      const result = await store.get(event.id, creator);
      expect(result.callerState).toBe("confirmed");
      expect(result.waiting).toHaveLength(1);
      expect(result.notifications).toHaveLength(1);
    } finally {
      await pool.query("DROP TRIGGER reject_intent ON reservation_notifications; DROP FUNCTION reject_intent()");
    }
  });
});
