import {
  date,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mahjongSessionsTable = pgTable("mahjong_sessions", {
  id: serial("id").primaryKey(),
  playedOn: date("played_on", { mode: "string" }).notNull(),
  rounds: integer("rounds").notNull(),
  totalAmount: doublePrecision("total_amount").notNull(),
  winnerName: text("winner_name").notNull(),
  notes: text("notes"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertMahjongSessionSchema = createInsertSchema(
  mahjongSessionsTable,
).omit({ id: true, createdAt: true });

export type InsertMahjongSession = z.infer<
  typeof insertMahjongSessionSchema
>;
export type MahjongSessionRecord =
  typeof mahjongSessionsTable.$inferSelect;