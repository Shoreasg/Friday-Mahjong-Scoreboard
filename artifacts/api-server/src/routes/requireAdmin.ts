import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";

function userIdFor(req: Request): string | null {
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  return typeof claimUserId === "string"
    ? claimUserId
    : (auth?.userId ?? null);
}

/**
 * Sends the established authorization response and returns the Clerk user ID
 * for configured administrators.
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

  const adminEmails = new Set(
    process.env.ADMIN_EMAILS
      ?.split(",")
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  if (adminEmails.size === 0) {
    req.log.error("ADMIN_EMAILS is not configured");
    res.status(500).json({ error: "Admin access is not configured" });
    return null;
  }

  const user = await clerkClient.users.getUser(userId);
  const isAdmin = user.emailAddresses.some(({ emailAddress }) =>
    adminEmails.has(emailAddress.trim().toLocaleLowerCase()),
  );
  if (!isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return userId;
}