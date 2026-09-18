import {
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A seat references its player by id only. The player's name lives on the
// players row, so renaming a player is reflected in every past session.
export type PlayerBalance = {
  playerId: number;
  endingAmount: number;
  zhaHuCount: number;
  xieXieKaiXiangCount: number;
};

export const mahjongSessionsTable = pgTable("mahjong_sessions", {
  id: serial("id").primaryKey(),
  playedOn: date("played_on", { mode: "string" }).notNull(),
  rounds: integer("rounds").notNull(),
  // Whole dollars the session was played for across all four players. The
  // four ending amounts must sum to it exactly (see @workspace/session-rules).
  basePot: integer("base_pot").notNull(),
  playerBalances: jsonb("player_balances")
    .$type<PlayerBalance[]>()
    .notNull()
    .default([]),
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