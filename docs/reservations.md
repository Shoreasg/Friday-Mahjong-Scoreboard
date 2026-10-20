# Reservation backend contract

Foundation for [GitHub #39](https://github.com/Shoreasg/Friday-Mahjong-Scoreboard/issues/39)
and [#40](https://github.com/Shoreasg/Friday-Mahjong-Scoreboard/issues/40), under
[#38](https://github.com/Shoreasg/Friday-Mahjong-Scoreboard/issues/38).
This does not implement reservation screens, Telegram delivery, or bot commands.
The epic remains open. No production publishing or database writes are part of this work.

## Public operations

All endpoints require an authenticated Clerk session, including list and detail.
The same-origin session cookie is already handled by the existing app; never send
an account ID, email, or roster player ID in a reservation request.

| Operation ID / generated hook | Method and path (under `/api`) |
| --- | --- |
| `listReservationEvents` / `useListReservationEvents` | `GET /reservation-events` |
| `getReservationEvent` / `useGetReservationEvent` | `GET /reservation-events/{eventId}` |
| `createReservationEvent` / `useCreateReservationEvent` | `POST /reservation-events` |
| `updateReservationEvent` / `useUpdateReservationEvent` | `PATCH /reservation-events/{eventId}` |
| `joinReservationEvent` / `useJoinReservationEvent` | `POST /reservation-events/{eventId}/join` |
| `leaveReservationEvent` / `useLeaveReservationEvent` | `POST /reservation-events/{eventId}/leave` |
| `cancelReservationEvent` / `useCancelReservationEvent` | `POST /reservation-events/{eventId}/cancel` |
| `retryReservationNotification` / `useRetryReservationNotification` | `POST /reservation-events/{eventId}/notifications/{notificationId}/retry` |

Creation accepts `{ date: "2099-06-01", startTime: "20:00", enrollCreator?: false }`.
An omitted `enrollCreator` becomes false. Editing requires both `date` and
`startTime`, without `enrollCreator`. Other mutations take no body. Extra body
fields are rejected. IDs are positive signed 32-bit integers.

Dates and 24-hour `HH:mm` times are interpreted in **Asia/Singapore**, UTC+08:00,
not the browser/server's local timezone. The example above is
`2099-06-01T12:00:00.000Z`. Impossible calendar dates are rejected. The response
includes local `date`, `startTime`, `timeZone` and an unambiguous `startsAt`.

Creation returns 201; all other operations return 200. Mutations return the
**current full event**, including queue and notification states. Repeated
creation with the same request key also returns 201 for the original event.
`ReservationEventResultResponse` is the generated mutation/detail response alias
of `ReservationEvent`; list returns `ReservationEvent[]`.

### Request retries

Every mutation requires an **`Idempotency-Key` UUID header**. Generate one per
logical user action, retain it for transport retries, and use a new one for the
next deliberate action. Keys are scoped to the authenticated account across
all reservation operations. Same key + different normalized operation/input
returns 409 `IDEMPOTENCY_CONFLICT`.

Orval's fetch client passes custom headers via request options, not a positional
header argument. Use plain header objects (not `Headers` instances, because
generated JSON requests spread the headers object):

```ts
const key = crypto.randomUUID(); // create once for this action, not on each retry
await createReservationEvent(
  { date: "2099-06-01", startTime: "20:00", enrollCreator: false },
  { headers: { "Idempotency-Key": key } },
);
await joinReservationEvent(eventId, {
  headers: { "Idempotency-Key": crypto.randomUUID() },
});
```

Generated hooks accept the same options through
`{ request: { headers: { "Idempotency-Key": key } } }`. Rotate the key for each
new action, including each new event a reusable form creates. Do not install
one permanent key for the lifetime of a mounted mutation hook.

Receipts persist in the database. A replay never reapplies a change, even after
leave/rejoin, cancellation, or start. It returns the current event, not a stale
snapshot. New join/leave requests at or after start fail, even if they would
otherwise be no-ops. Duplicate fresh-key joins/leaves before start are harmless.
Failed transactions do not leave receipts.

### Response and client caching

`ReservationEvent` includes:

- `confirmed`: at most four `ReservationConfirmedParticipant`s, ordered by seat.
- `waiting`: `ReservationWaitingParticipant`s, ordered by server enrollment ID,
  with contiguous one-based `position`.
- Participants expose `enrollmentId`, a safe display-name snapshot, `isCaller`
  and `joinedAt`; never account IDs or emails. Missing/unsafe names use
  `"Mahjong player"`. These are not roster players.
- `creator`: safe `displayName` and `isCaller`.
- `callerState`: `none`, `confirmed`, or `waiting`.
- `status`: `open`, `started`, or `cancelled`; cancellation takes precedence.
- `allowedActions`: `join`, `leave`, `edit`, `cancel`, `retryNotification`.
- `notifications`: actual `pending | processing | sent | failed` states,
  attempts, timestamps, safe `failureCode` and per-intent `canRetry`.

List includes started/cancelled events and sorts by `startsAt`, then ID.
An event lock keeps each response internally consistent. Actions are advisory
snapshots: permissions and time are rechecked on every mutation.

Use the generated query-key factories, not hand-built keys:

- `getListReservationEventsQueryKey()` → `["/api/reservation-events"]`
- `getGetReservationEventQueryKey(eventId)` → `["/api/reservation-events/${eventId}"]`

After a mutation invalidate both list and affected detail. Clear account-scoped
query data on sign-out/account changes (these URL keys do not contain identity),
and use finite staleness/polling or focus refetch so another account's booking is
visible. Mutation keys are the operation names, such as
`["joinReservationEvent"]`; they do not invalidate queries automatically.

### Errors and permissions

Errors are JSON `{ error: string, code: ReservationErrorCode }`:

| HTTP | Codes |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_TIME`, `START_NOT_FUTURE` |
| 401 | `UNAUTHORIZED` |
| 403 | `MANAGER_REQUIRED` |
| 404 | `EVENT_NOT_FOUND`, `NOTIFICATION_NOT_FOUND` |
| 409 | `EVENT_STARTED`, `EVENT_CANCELLED`, `IDEMPOTENCY_CONFLICT`, `NOT_RETRYABLE` |

Infrastructure failures propagate as server errors, never as successful empty
results or fake delivery. Existing application-wide origin/auth/body-parser
errors retain their existing behavior.

Any signed-in account creates or reserves its own seat. Only the creator or an
existing admin (current Clerk emails against `ADMIN_EMAILS` or `admins`) may
edit, cancel or retry delivery. Editing checks the **old** start as well as the
new future start, so it cannot reopen a started event. Cancellation is allowed
even after start, is persisted rather than deleted, and retains the last
participant lists/history. There is no uncancel or reassignment operation.

## Atomic queue rules

Each mutation acquires an account/request-key advisory transaction lock, then
the event row lock. All membership changes, promotions, receipts and notification
intents commit or roll back together. Server `clock_timestamp()` is checked
**after acquiring the event lock**; transaction start time must not be used for
the cutoff because it is stale after lock contention.

Enrollment IDs are allocated under the event lock and define FIFO, not client
timestamps. A partial unique account index allows at most one active entry;
seat range checks plus a partial unique event/seat index enforce at most four
confirmed seats even if another writer bypasses the store. Waiting entries
have null seats. Leaving marks an entry inactive, preserving history. Rejoin
allocates a new ID at the back. A confirmed departure atomically frees the seat
and promotes the smallest active waiting ID; waiting departures do not promote.
Cancelled events reject joins/leaves and never perform further promotions.

## Notification delivery integration boundary

The reservation store **only writes intents**; it neither imports the Telegram
client nor requires its configuration. No network calls happen inside booking
transactions. Exactly these transitions create an intent:

- creation → `created`, including when creator enrollment is off;
- promotion → `promoted`, with the promoted `enrollment_id`;
- first cancellation → `cancelled`.

Ordinary joins/departures and time edits do not notify. Creation/cancellation
deduplicate per event; promotion deduplicates per enrollment. Rejoining creates
a new enrollment and can later produce a distinct promotion.

The stable integration surface is the `reservation_notifications` table,
exported `reservationNotificationsTable`/`ReservationNotificationRecord`, and
the event/enrollment records referenced by its foreign keys. A later worker
owns claiming and delivery; **no dispatcher or scheduling loop exists yet**.
It should use this protocol without changing the public API:

1. Claim `pending` intents transactionally, locking the event before the intent
   if both are needed (the same lock order as retry). Multiple workers must use
   row locks/`SKIP LOCKED`, not read-then-update outside a transaction.
2. Set `processing`, a fresh unpredictable `claim_token`, `claimed_at` and
   increment `attempts` together. Commit before calling Telegram.
3. Resolve event/current Singapore start and, for promotion, the referenced
   enrollment. Use safe names, never emails. Detect obsolete promotions
   (event cancelled or enrollment no longer confirmed); fail them with a safe
   machine code rather than announcing an invalid seat. An unconfigured URL or
   Telegram connection must fail delivery explicitly, without affecting seats.
4. Only after Telegram acknowledges a real message, compare-and-set the matching
   `processing` row and claim token to `sent`, recording `sent_at` and
   `provider_message_id`, clearing both claim fields. On failure set `failed`,
   record a safe `failure_code`, and clear both claim fields. Never persist
   raw Telegram response bodies, bot tokens or other secrets as failure text.
5. Define a lease timeout before implementing recovery. Expired processing
   claims must be recovered with token fencing; a stale worker cannot acknowledge
   a newer claim. A timeout after Telegram accepted a message but before saving
   the acknowledgement is inherently ambiguous: Telegram has no exactly-once
   delivery key. Do not promise exactly-once messaging or silently auto-retry
   ambiguous outcomes; expose failed delivery and use the explicit retry path.

Database checks enforce matching sent/acknowledgement fields and matching
processing/claim fields. Public failure text is always the safe
`DELIVERY_FAILED`, never the internal failure detail or provider message ID.
Public retry only changes `failed → pending`; it does not send, reset attempts,
modify membership, or mark success. Pending/processing/sent retries return 409.

### Event URL requirement for the UI and Telegram tasks

Reserve **`/app/reservations/{eventId}`** as the scoreboard's event detail route.
The downstream UI must support direct navigation and preserve that destination
through sign-in. That screen does not exist in this backend-only task.

The delivery worker must build an absolute HTTPS URL to that route from a
trusted, explicitly configured public app origin (derive the origin from the
existing `SCOREBOARD_URL` if reusing it). Do not use an inbound Host header,
temporary development domain, or API route as the production link. Preserve
any artifact deployment prefix if the scoreboard stops being root-mounted.
Until a valid public URL and detail route are available, creation delivery
must remain pending or explicitly fail, never claim a working link was sent.
For development use an explicitly configured reachable development URL only.
Existing session announcements, Telegram polling and bot webhook behavior
remain unchanged.

## Development schema and verification

`lib/db/src/reservation-schema.sql` is the additive reconciliation mirrored by
the four Drizzle reservation schema files. `scripts/src/reconcile-reservations.ts`
runs it in a transaction under a migration lock. The command:

```sh
pnpm --filter @workspace/scripts run reconcile:reservations
```

creates only the four reservation tables, their constraints and indexes. It is
repeatable and does not rename, truncate, delete or backfill anything. It does
not enroll roster players or connect historical scored sessions to accounts.
The standard `scripts/post-merge.sh` runs it after install and before the
existing reconciliation/push/seed steps. Those existing steps are unchanged.
No production migration or production data operation is included; review the
normal release schema process separately before eventual production deployment.

Focused checks:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/scripts run test
pnpm --filter @workspace/scripts run test:integration
```

Real PostgreSQL tests run the actual reconciliation twice in a temporary,
randomly named schema, redirect the application pool there before import, and
drop that schema afterward. They do not modify shared session/player data.
They exercise concurrent bookings, duplicate requests, racing promotions,
queue rejoin, cancellation, permission boundaries, lock-wait cutoff and intent
failure rollback. Route tests cover authentication and generated validators.
Browser/UI/Telegram-delivery journeys belong to the already queued tasks.

### Recorded results for this implementation

- API code generation completed successfully.
- Full workspace `pnpm run typecheck` passed.
- API tests: **145 passed**, including 7 new reservation route tests.
- Script unit tests: **14 passed**.
- Real PostgreSQL integration tests: **28 passed**, including 14 new reservation tests.
- Additive development reconciliation completed successfully. The full existing
  post-merge push/seed sequence was not run manually; its reservation command
  was run directly, and repeatability was verified in the isolated schema tests.
- Restarted the managed API workflow successfully; `/api/healthz` returned 200
  and unauthenticated `/api/reservation-events` returned 401 with the documented
  JSON error. No Telegram delivery or browser reservation UI was exercised.

Known operational limitations: list currently returns all events and full
queues, with no pagination; reads use event row locks for consistent snapshots,
which favors correctness for this small group over high read throughput.
Idempotency receipts and enrollment history have no automatic retention policy.
No delivery worker, automatic retries or processing-lease recovery runs yet.
