import {
  GetCurrentUserResponse,
  GrantAdminBody,
  GrantAdminResponse,
  ListAdminsResponse,
  ListClerkUsersResponse,
  RevokeAdminParams,
} from "@workspace/api-zod";
import { clerkClient } from "@clerk/express";
import { adminsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  currentAdminStatus,
  requireAdmin,
  requireSuperAdmin,
  userIdFor,
} from "./requireAdmin";

const router: IRouter = Router();

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

function envAdminEmails(): Set<string> {
  return new Set(
    process.env.ADMIN_EMAILS
      ?.split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

router.get("/me", async (req, res): Promise<void> => {
  // Signed-in users only, but this never 403s: it reports admin status
  // rather than requiring it, so requireAdmin's response shapes don't fit.
  const userId = userIdFor(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const status = await currentAdminStatus(userId);
  res.json(GetCurrentUserResponse.parse(status));
});

router.get("/admin/admins", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const granted = await db
    .select({
      email: adminsTable.email,
      grantedBy: adminsTable.grantedBy,
      grantedAt: adminsTable.grantedAt,
    })
    .from(adminsTable);

  const grantedEmails = new Set(granted.map((row) => row.email));
  const envEntries = [...envAdminEmails()]
    .filter((email) => !grantedEmails.has(email))
    .map((email) => ({
      email,
      source: "env" as const,
      grantedBy: null,
      grantedAt: null,
    }));

  const tableEntries = granted.map((row) => ({
    email: row.email,
    source: "table" as const,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt.toISOString(),
  }));

  res.json(
    ListAdminsResponse.parse(
      [...envEntries, ...tableEntries].sort((a, b) => a.email.localeCompare(b.email)),
    ),
  );
});

router.post("/admin/admins", async (req, res): Promise<void> => {
  const granter = await requireSuperAdmin(req, res);
  if (!granter) return;

  const parsed = GrantAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const [record] = await db
    .insert(adminsTable)
    .values({ email, grantedBy: granter.email })
    .onConflictDoUpdate({
      target: adminsTable.email,
      set: { grantedBy: granter.email, grantedAt: new Date() },
    })
    .returning();

  if (!record) {
    res.status(500).json({ error: "Admin was not granted" });
    return;
  }

  res.status(201).json(
    GrantAdminResponse.parse({
      email: record.email,
      source: "table",
      grantedBy: record.grantedBy,
      grantedAt: record.grantedAt.toISOString(),
    }),
  );
});

router.delete("/admin/admins/:email", async (req, res): Promise<void> => {
  const revoker = await requireSuperAdmin(req, res);
  if (!revoker) return;

  const params = RevokeAdminParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const email = normalizeEmail(params.data.email);
  if (envAdminEmails().has(email)) {
    res.status(400).json({
      error: "That email is an ADMIN_EMAILS entry and can't be revoked from the UI",
    });
    return;
  }

  const [deleted] = await db
    .delete(adminsTable)
    .where(eq(adminsTable.email, email))
    .returning({ email: adminsTable.email });

  if (!deleted) {
    res.status(404).json({ error: "No such granted admin" });
    return;
  }

  res.sendStatus(204);
});

router.get("/admin/clerk-users", async (req, res): Promise<void> => {
  const requester = await requireSuperAdmin(req, res);
  if (!requester) return;

  const { data: users } = await clerkClient.users.getUserList({ limit: 500 });

  res.json(
    ListClerkUsersResponse.parse(
      users
        .map((user) => {
          const primary = user.emailAddresses.find(
            (address) => address.id === user.primaryEmailAddressId,
          );
          const email = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
          if (!email) return null;

          const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
          return { id: user.id, email, name };
        })
        .filter((user): user is NonNullable<typeof user> => user !== null),
    ),
  );
});

export default router;
