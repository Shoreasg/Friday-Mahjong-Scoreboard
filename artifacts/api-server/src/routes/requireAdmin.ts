import { clerkClient, getAuth } from "@clerk/express";
import { adminsTable, db } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { Request, Response } from "express";

export function userIdFor(req: Request): string | null {
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  return typeof claimUserId === "string"
    ? claimUserId
    : (auth?.userId ?? null);
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

/**
 * The permanent super-admin allowlist. Env-only and never editable from the
 * UI, so lockout is structurally impossible: there is no self-demotion case
 * and no "can super admin A revoke super admin B" question to get wrong.
 */
function envAdminEmails(): Set<string> {
  return new Set(
    process.env.ADMIN_EMAILS
      ?.split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

export function isSuperAdminEmail(emails: string[]): boolean {
  const adminEmails = envAdminEmails();
  return emails.some((email) => adminEmails.has(normalizeEmail(email)));
}

/**
 * Regular admin OR super admin. A super admin is always also a regular
 * admin. Deliberately a plain SELECT with no cache: requireAdmin already
 * makes an outbound clerkClient.users.getUser() call on every admin
 * request, which dominates this indexed lookup by orders of magnitude, and
 * skipping a cache keeps revocation instant.
 */
export async function isAdminEmail(emails: string[]): Promise<boolean> {
  if (isSuperAdminEmail(emails)) return true;

  const normalized = emails.map(normalizeEmail);
  const [granted] = await db
    .select({ email: adminsTable.email })
    .from(adminsTable)
    .where(inArray(adminsTable.email, normalized));
  return Boolean(granted);
}

async function emailsFor(userId: string): Promise<string[]> {
  const user = await clerkClient.users.getUser(userId);
  return user.emailAddresses.map(({ emailAddress }) => emailAddress);
}

/** Signed-in users only, but never 403s -- reports admin status instead. */
export async function currentAdminStatus(
  userId: string,
): Promise<{ isAdmin: boolean; isSuperAdmin: boolean }> {
  const emails = await emailsFor(userId);
  return {
    isAdmin: await isAdminEmail(emails),
    isSuperAdmin: isSuperAdminEmail(emails),
  };
}

/**
 * Sends the established authorization response and returns the Clerk user ID
 * for configured administrators (the ADMIN_EMAILS allowlist or the admins
 * table).
 */
export async function requireAdmin(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = userIdFor(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (envAdminEmails().size === 0) {
    req.log.error("ADMIN_EMAILS is not configured");
    res.status(500).json({ error: "Admin access is not configured" });
    return null;
  }

  const emails = await emailsFor(userId);
  if (!(await isAdminEmail(emails))) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return userId;
}

/**
 * Like requireAdmin, but only the env-configured super-admin allowlist
 * qualifies. Granting, revoking, and browsing the Clerk user directory are
 * super-admin-only so a regular admin can't grant themselves more admins.
 * Returns the matched ADMIN_EMAILS entry too, for auditing who granted what.
 */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
): Promise<{ userId: string; email: string } | null> {
  const userId = userIdFor(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const adminEmails = envAdminEmails();
  if (adminEmails.size === 0) {
    req.log.error("ADMIN_EMAILS is not configured");
    res.status(500).json({ error: "Admin access is not configured" });
    return null;
  }

  const emails = await emailsFor(userId);
  const matchedEmail = emails
    .map(normalizeEmail)
    .find((email) => adminEmails.has(email));
  if (!matchedEmail) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return { userId, email: matchedEmail };
}
