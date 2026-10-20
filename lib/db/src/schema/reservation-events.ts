import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reservationEventsTable = pgTable("reservation_events", {
  id: serial("id").primaryKey(),
  creatorUserId: text("creator_user_id").notNull(),
  creatorDisplayName: text("creator_display_name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertReservationEventSchema = createInsertSchema(reservationEventsTable).omit({ id: true, createdAt: true });
export type InsertReservationEvent = z.infer<typeof insertReservationEventSchema>;
export type ReservationEventRecord = typeof reservationEventsTable.$inferSelect;
