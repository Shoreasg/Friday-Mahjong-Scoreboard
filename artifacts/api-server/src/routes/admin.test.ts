import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[] = [];
  const insertResults: unknown[] = [];
  const deleteResults: unknown[] = [];

  function chain(result: unknown) {
    const c: {
      from: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => unknown;
    } = {
      from: vi.fn(),
      where: vi.fn(),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    c.from.mockReturnValue(c);
    c.where.mockReturnValue(c);
    return c;
  }

  const db = {
    select: vi.fn(() => chain(selectResults.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () => insertResults.shift() ?? []),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => deleteResults.shift() ?? []),
      })),
    })),
  };

  return {
    selectResults,
    insertResults,
    deleteResults,
    getUser: vi.fn(),
    getUserList: vi.fn(),
    db,
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: { getUser: mocks.getUser, getUserList: mocks.getUserList },
  },
  clerkMiddleware:
    () =>
    (req: { headers: Record<string, string | undefined>; testAuth?: unknown }, _res: unknown, next: () => void) => {
      const userId = req.headers["x-test-user"];
      req.testAuth = userId ? { userId, sessionClaims: { userId } } : {};
      next();
    },
  getAuth: (req: { testAuth?: unknown }) => req.testAuth ?? {},
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: mocks.db };
});

import app from "../app";

const superAdminUserId = "super-admin-user";
const tableAdminUserId = "table-admin-user";
const viewerUserId = "viewer-user";
const superAdminEmail = "super@example.com";
const tableAdminEmail = "table-admin@example.com";
const viewerEmail = "viewer@example.com";

let server: Server;
let baseUrl: string;

async function request(path: string, init: RequestInit = {}, userId?: string) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (userId) headers.set("x-test-user", userId);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  process.env.ADMIN_EMAILS = superAdminEmail;
  vi.clearAllMocks();
  mocks.selectResults.length = 0;
  mocks.insertResults.length = 0;
  mocks.deleteResults.length = 0;
  mocks.getUser.mockImplementation(async (userId: string) => {
    const email =
      userId === superAdminUserId
        ? superAdminEmail
        : userId === tableAdminUserId
          ? tableAdminEmail
          : viewerEmail;
    return { emailAddresses: [{ emailAddress: email }] };
  });
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("GET /me", () => {
  it("rejects signed-out callers", async () => {
    const response = await request("/api/me");

    expect(response.status).toBe(401);
  });

  it("reports super admin status without touching the admins table", async () => {
    const response = await request("/api/me", {}, superAdminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isAdmin: true, isSuperAdmin: true });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("reports table-granted admin status", async () => {
    mocks.selectResults.push([{ email: tableAdminEmail }]);

    const response = await request("/api/me", {}, tableAdminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isAdmin: true, isSuperAdmin: false });
  });

  it("reports non-admin status for everyone else", async () => {
    mocks.selectResults.push([]);

    const response = await request("/api/me", {}, viewerUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isAdmin: false, isSuperAdmin: false });
  });
});

describe("GET /admin/admins", () => {
  it("rejects signed-out callers", async () => {
    const response = await request("/api/admin/admins");

    expect(response.status).toBe(401);
  });

  it("rejects non-admin callers", async () => {
    mocks.selectResults.push([]);

    const response = await request("/api/admin/admins", {}, viewerUserId);

    expect(response.status).toBe(403);
  });

  it("lists env-derived and table-granted admins, deduping an email in both", async () => {
    process.env.ADMIN_EMAILS = `${superAdminEmail},${tableAdminEmail}`;
    const grantedAt = new Date("2026-09-20T00:00:00Z");
    mocks.selectResults.push([
      { email: tableAdminEmail, grantedBy: superAdminEmail, grantedAt },
    ]);

    const response = await request("/api/admin/admins", {}, superAdminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { email: superAdminEmail, source: "env", grantedBy: null, grantedAt: null },
      {
        email: tableAdminEmail,
        source: "table",
        grantedBy: superAdminEmail,
        grantedAt: grantedAt.toISOString(),
      },
    ]);
  });
});

describe("POST /admin/admins", () => {
  it("rejects signed-out callers", async () => {
    const response = await request("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("rejects a regular (table-granted, non-super) admin", async () => {
    const response = await request(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: "new@example.com" }) },
      tableAdminUserId,
    );

    expect(response.status).toBe(403);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("rejects a plain viewer", async () => {
    const response = await request(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: "new@example.com" }) },
      viewerUserId,
    );

    expect(response.status).toBe(403);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("grants admin access, recording the granting super admin", async () => {
    const grantedAt = new Date("2026-09-20T00:00:00Z");
    mocks.insertResults.push([
      { email: "new@example.com", grantedBy: superAdminEmail, grantedAt },
    ]);

    const response = await request(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: " New@Example.com " }) },
      superAdminUserId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      email: "new@example.com",
      source: "table",
      grantedBy: superAdminEmail,
      grantedAt: grantedAt.toISOString(),
    });
  });

  it("rejects an empty email", async () => {
    const response = await request(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: "   " }) },
      superAdminUserId,
    );

    expect(response.status).toBe(400);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });
});

describe("DELETE /admin/admins/:email", () => {
  it("rejects signed-out callers", async () => {
    const response = await request("/api/admin/admins/someone@example.com", {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("rejects a regular (table-granted, non-super) admin", async () => {
    const response = await request(
      "/api/admin/admins/someone@example.com",
      { method: "DELETE" },
      tableAdminUserId,
    );

    expect(response.status).toBe(403);
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("revokes a granted admin", async () => {
    mocks.deleteResults.push([{ email: tableAdminEmail }]);

    const response = await request(
      `/api/admin/admins/${encodeURIComponent(tableAdminEmail)}`,
      { method: "DELETE" },
      superAdminUserId,
    );

    expect(response.status).toBe(204);
  });

  it("rejects revoking an ADMIN_EMAILS entry", async () => {
    const response = await request(
      `/api/admin/admins/${encodeURIComponent(superAdminEmail)}`,
      { method: "DELETE" },
      superAdminUserId,
    );

    expect(response.status).toBe(400);
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for an admin that was never granted", async () => {
    mocks.deleteResults.push([]);

    const response = await request(
      "/api/admin/admins/never-granted@example.com",
      { method: "DELETE" },
      superAdminUserId,
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /admin/clerk-users", () => {
  it("rejects signed-out callers", async () => {
    const response = await request("/api/admin/clerk-users");

    expect(response.status).toBe(401);
  });

  it("rejects a regular (table-granted, non-super) admin", async () => {
    const response = await request("/api/admin/clerk-users", {}, tableAdminUserId);

    expect(response.status).toBe(403);
    expect(mocks.getUserList).not.toHaveBeenCalled();
  });

  it("lists signed-up users with their primary email and full name", async () => {
    mocks.getUserList.mockResolvedValue({
      data: [
        {
          id: "user_1",
          primaryEmailAddressId: "email_1",
          emailAddresses: [
            { id: "email_1", emailAddress: "alice@example.com" },
            { id: "email_2", emailAddress: "alice-alt@example.com" },
          ],
          firstName: "Alice",
          lastName: "Chen",
        },
        {
          id: "user_2",
          primaryEmailAddressId: "email_3",
          emailAddresses: [{ id: "email_3", emailAddress: "bob@example.com" }],
          firstName: null,
          lastName: null,
        },
      ],
    });

    const response = await request("/api/admin/clerk-users", {}, superAdminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "user_1", email: "alice@example.com", name: "Alice Chen" },
      { id: "user_2", email: "bob@example.com", name: null },
    ]);
  });
});
