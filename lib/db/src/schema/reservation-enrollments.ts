import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationEventsTable } from "./reservation-events";

export const reservationEnrollmentsTable = pgTable("reservation_enrollments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => reservationEventsTable.id),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  seat: integer("seat"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("reservation_active_account").on(t.eventId, t.userId).where(sql`${t.leftAt} is null`),
  uniqueIndex("reservation_active_seat").on(t.eventId, t.seat).where(sql`${t.leftAt} is null`),
  index("reservation_queue").on(t.eventId, t.id).where(sql`${t.leftAt} is null`),
  check("reservation_seat_range", sql`${t.seat} is null or ${t.seat} between 1 and 4`),
  check("reservation_left_seat", sql`${t.leftAt} is null or ${t.seat} is null`),
]);
export const insertReservationEnrollmentSchema = createInsertSchema(reservationEnrollmentsTable).omit({ id: true, joinedAt: true });
export type InsertReservationEnrollment = z.infer<typeof insertReservationEnrollmentSchema>;
export type ReservationEnrollmentRecord = typeof reservationEnrollmentsTable.$inferSelect;
