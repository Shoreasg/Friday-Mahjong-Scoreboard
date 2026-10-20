import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationEventsTable } from "./reservation-events";

// Durable idempotency receipts. No credentials or response payloads.
export const reservationRequestsTable = pgTable("reservation_requests", {
  userId: text("user_id").notNull(),
  requestKey: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  eventId: integer("event_id").notNull().references(() => reservationEventsTable.id),
}, (t) => [primaryKey({ columns: [t.userId, t.requestKey] })]);
export const insertReservationRequestSchema = createInsertSchema(reservationRequestsTable);
export type InsertReservationRequest = z.infer<typeof insertReservationRequestSchema>;
export type ReservationRequestRecord = typeof reservationRequestsTable.$inferSelect;
