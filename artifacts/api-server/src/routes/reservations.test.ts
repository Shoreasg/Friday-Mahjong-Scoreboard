import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(), get: vi.fn(), list: vi.fn(), getUser: vi.fn(), isAdmin: vi.fn(),
}));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(),
  ReservationStore: class {
    mutate = mocks.mutate;
    get = mocks.get;
    list = mocks.list;
  },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: mocks.getUser } },
}));
vi.mock("./requireAdmin", () => ({
  userIdFor: (req: express.Request) => req.get("x-test-authenticated-user") ?? null,
  isAdminEmail: mocks.isAdmin,
}));
import reservationsRouter from "./reservations";
import { ReservationError } from "@workspace/db";
import { GetReservationEventResponse, ListReservationEventsResponse } from "@workspace/api-zod";

const result = {
  id: 1, date: "2099-06-01", startTime: "20:00", timeZone: "Asia/Singapore",
  startsAt: "2099-06-01T12:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
  cancelledAt: null, capacity: 4, status: "open",
  creator: { displayName: "Safe Name", isCaller: true }, confirmed: [], waiting: [],
  callerState: "none",
  allowedActions: { join: true, leave: false, edit: true, cancel: true, retryNotification: false },
  notifications: [{ id: 1, kind: "created", status: "pending", attempts: 0, createdAt: "2026-01-01T00:00:00.000Z", sentAt: null, failureCode: null, canRetry: false }],
};
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", reservationsRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port");
  base = `http://127.0.0.1:${address.port}/api/reservation-events`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ firstName: "Safe", lastName: "Name", emailAddresses: [{ emailAddress: "private@example.com" }] });
  mocks.isAdmin.mockResolvedValue(false);
  mocks.mutate.mockResolvedValue(result);
  mocks.get.mockResolvedValue(result);
  mocks.list.mockResolvedValue([result]);
});
function request(path = "", method = "GET", body?: unknown, signedIn = true, key: string | null = randomUUID()) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(signedIn ? { "x-test-authenticated-user": "session-user" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
describe("authenticated reservation API contract", () => {
  it("requires sign-in for every read and write, without querying participants", async () => {
    for (const [path, method] of [["", "GET"], ["/1", "GET"], ["", "POST"], ["/1", "PATCH"], ["/1/join", "POST"], ["/1/leave", "POST"], ["/1/cancel", "POST"], ["/1/notifications/1/retry", "POST"]]) {
      const response = await request(path, method, undefined, false);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "UNAUTHORIZED", error: "Sign-in required" });
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("validates list/detail response contracts and omits account and email fields", async () => {
    const list = await (await request()).json();
    expect(ListReservationEventsResponse.safeParse(list).success).toBe(true);
    const detail = await (await request("/1")).json();
    expect(GetReservationEventResponse.safeParse(detail).success).toBe(true);
    expect(JSON.stringify(list)).not.toContain("private@example.com");
    expect(mocks.get).toHaveBeenCalledWith(1, { userId: "session-user", displayName: "Safe Name", isAdmin: false });
  });
  it("defaults creator enrollment off and derives identity from the session only", async () => {
    const response = await request("", "POST", { date: "2099-06-01", startTime: "20:00" });
    expect(response.status).toBe(201);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { userId: "session-user", displayName: "Safe Name", isAdmin: false }, expect.any(String),
      { kind: "create", date: "2099-06-01", startTime: "20:00", enrollCreator: false },
    );
    expect(GetReservationEventResponse.parse(await response.json()).notifications[0]).toMatchObject({ status: "pending", sentAt: null });
    expect((await request("", "POST", { date: "2099-06-01", startTime: "20:00", userId: "victim" })).status).toBe(400);
    expect((await request("/1/join", "POST", { userId: "victim" })).status).toBe(400);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("rejects bad IDs, missing/invalid request keys, unknown fields and malformed times", async () => {
    for (const id of ["0", "-1", "1.5", "1x", "2147483648"]) expect((await request(`/${id}`)).status).toBe(400);
    for (const key of [null, "bad-key"]) {
      expect((await request("/1/join", "POST", undefined, true, key)).status).toBe(400);
    }
    for (const body of [{ date: "2099-01-01" }, { date: "2099-01-01", startTime: "25:00" }, { date: "2099-01-01", startTime: "20:00", enrollCreator: "true" }]) {
      expect((await request("", "POST", body)).status).toBe(400);
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("routes every mutation with typed IDs and generated validation", async () => {
    await request("", "POST", { date: "2099-06-01", startTime: "20:00", enrollCreator: true });
    await request("/1", "PATCH", { date: "2099-06-02", startTime: "21:00" });
    for (const kind of ["join", "leave", "cancel"]) expect((await request(`/1/${kind}`, "POST")).status).toBe(200);
    expect((await request("/1/notifications/2/retry", "POST")).status).toBe(200);
    expect(mocks.mutate.mock.calls.map((call) => call[2])).toEqual([
      { kind: "create", date: "2099-06-01", startTime: "20:00", enrollCreator: true },
      { kind: "edit", eventId: 1, date: "2099-06-02", startTime: "21:00" },
      { kind: "join", eventId: 1 }, { kind: "leave", eventId: 1 }, { kind: "cancel", eventId: 1 },
      { kind: "retry", eventId: 1, notificationId: 2 },
    ]);
  });
  it("preserves permission, cutoff, cancellation, missing-resource and retry error codes", async () => {
    for (const [status, code] of [[403, "MANAGER_REQUIRED"], [409, "EVENT_STARTED"], [409, "EVENT_CANCELLED"], [404, "EVENT_NOT_FOUND"], [409, "NOT_RETRYABLE"] ] as const) {
      mocks.mutate.mockRejectedValueOnce(new ReservationError(status, code, "Safe explanation"));
      const response = await request("/1/cancel", "POST");
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, error: "Safe explanation" });
    }
  });
  it("uses existing admin resolution and never uses emails as display names", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getUser.mockResolvedValue({ firstName: "private@example.com", lastName: null, emailAddresses: [{ emailAddress: "admin@example.com" }] });
    await request("/1");
    expect(mocks.isAdmin).toHaveBeenCalledWith(["admin@example.com"]);
    expect(mocks.get).toHaveBeenCalledWith(1, { userId: "session-user", displayName: "Mahjong player", isAdmin: true });
  });
});
