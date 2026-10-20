import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateReservationEventBody, CreateReservationEventHeader, GetReservationEventParams,
  GetReservationEventResponse, ListReservationEventsResponse, RetryReservationNotificationParams,
  UpdateReservationEventBody,
} from "@workspace/api-zod";
import { pool, ReservationError, ReservationStore, safeReservationName, type ReservationActor, type ReservationCommand } from "@workspace/db";
import { isAdminEmail, userIdFor } from "./requireAdmin";

const router: IRouter = Router();
const store = new ReservationStore(pool);

type Handler = (req: Request, res: Response, actor: ReservationActor) => Promise<void>;
function authenticated(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = userIdFor(req);
    if (!userId) {
      res.status(401).json({ error: "Sign-in required", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const user = await clerkClient.users.getUser(userId);
      const actor: ReservationActor = {
        userId,
        displayName: safeReservationName([user.firstName, user.lastName].filter(Boolean).join(" ")),
        isAdmin: await isAdminEmail(user.emailAddresses.map((e) => e.emailAddress)),
      };
      await handler(req, res, actor);
    } catch (error) {
      if (error instanceof ReservationError) {
        res.status(error.status).json({ error: error.message, code: error.code });
      } else {
        next(error);
      }
    }
  };
}

function invalid(): never {
  throw new ReservationError(400, "INVALID_INPUT", "Invalid request body, identifier or Idempotency-Key");
}
function eventId(req: Request): number {
  const parsed = GetReservationEventParams.safeParse(req.params);
  if (!parsed.success) return invalid();
  return parsed.data.eventId;
}
function requestKey(req: Request): string {
  const parsed = CreateReservationEventHeader.safeParse({ "Idempotency-Key": req.get("Idempotency-Key") });
  if (!parsed.success) return invalid();
  return parsed.data["Idempotency-Key"];
}
function noBody(req: Request) {
  if (req.body !== undefined && (req.body === null || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length > 0)) invalid();
}
async function mutate(req: Request, res: Response, actor: ReservationActor, command: ReservationCommand, status = 200) {
  const result = await store.mutate(actor, requestKey(req), command);
  res.status(status).json(GetReservationEventResponse.parse(result));
}

router.get("/reservation-events", authenticated(async (_req, res, actor) => {
  res.json(ListReservationEventsResponse.parse(await store.list(actor)));
}));
router.get("/reservation-events/:eventId", authenticated(async (req, res, actor) => {
  res.json(GetReservationEventResponse.parse(await store.get(eventId(req), actor)));
}));
router.post("/reservation-events", authenticated(async (req, res, actor) => {
  const parsed = CreateReservationEventBody.strict().safeParse(req.body);
  if (!parsed.success) return invalid();
  await mutate(req, res, actor, { kind: "create", ...parsed.data }, 201);
}));
router.patch("/reservation-events/:eventId", authenticated(async (req, res, actor) => {
  const parsed = UpdateReservationEventBody.strict().safeParse(req.body);
  if (!parsed.success) return invalid();
  await mutate(req, res, actor, { kind: "edit", eventId: eventId(req), ...parsed.data });
}));
for (const kind of ["join", "leave", "cancel"] as const) {
  router.post(`/reservation-events/:eventId/${kind}`, authenticated(async (req, res, actor) => {
    noBody(req);
    await mutate(req, res, actor, { kind, eventId: eventId(req) });
  }));
}
router.post("/reservation-events/:eventId/notifications/:notificationId/retry", authenticated(async (req, res, actor) => {
  noBody(req);
  const parsed = RetryReservationNotificationParams.safeParse(req.params);
  if (!parsed.success) return invalid();
  await mutate(req, res, actor, { kind: "retry", ...parsed.data });
}));

export default router;
