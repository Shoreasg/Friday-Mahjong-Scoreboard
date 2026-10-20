import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationEventsTable } from "./reservation-events";
import { reservationEnrollmentsTable } from "./reservation-enrollments";

export const reservationNotificationsTable = pgTable("reservation_notifications", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => reservationEventsTable.id),
  kind: text("kind").notNull(),
  enrollmentId: integer("enrollment_id").references(() => reservationEnrollmentsTable.id),
  deduplicationKey: text("deduplication_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimToken: text("claim_token"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  failureCode: text("failure_code"),
}, (t) => [
  check("reservation_notification_kind", sql`${t.kind} in ('created','promoted','cancelled')`),
  check("reservation_notification_status", sql`${t.status} in ('pending','processing','sent','failed')`),
  check("reservation_notification_delivery", sql`((${t.status} = 'sent') = (${t.sentAt} is not null)) and ((${t.status} = 'sent') = (${t.providerMessageId} is not null))`),
  check("reservation_notification_claim", sql`((${t.status} = 'processing') = (${t.claimToken} is not null)) and ((${t.status} = 'processing') = (${t.claimedAt} is not null))`),
  check("reservation_notification_attempts", sql`${t.attempts} >= 0`),
]);
export const insertReservationNotificationSchema = createInsertSchema(reservationNotificationsTable).omit({ id: true, createdAt: true });
export type InsertReservationNotification = z.infer<typeof insertReservationNotificationSchema>;
export type ReservationNotificationRecord = typeof reservationNotificationsTable.$inferSelect;
