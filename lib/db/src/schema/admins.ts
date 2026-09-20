import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Regular admins granted through the UI. Super admins live permanently in
// the env-only ADMIN_EMAILS allowlist instead -- see requireAdmin.ts. This
// table intentionally has no role column: it only ever holds regular admins.
export const adminsTable = pgTable("admins", {
  email: text("email").primaryKey(),
  grantedBy: text("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAdminSchema = createInsertSchema(adminsTable).omit({
  grantedAt: true,
});

export type InsertAdmin = z.infer<typeof insertAdminSchema>;
export type AdminRecord = typeof adminsTable.$inferSelect;
