import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReservationEvent } from "@workspace/api-client-react";
import { getReservationViewModel } from "./reservation-view-model.ts";

type ReservationState = Pick<
  ReservationEvent,
  "status" | "callerState" | "allowedActions" | "waiting"
>;

function makeEvent(overrides: Partial<ReservationState> = {}): ReservationState {
  return {
    status: "open",
    callerState: "none",
    allowedActions: {
      join: true,
      leave: false,
      edit: false,
      cancel: false,
      retryNotification: false,
    },
    waiting: [],
    ...overrides,
  };
}

describe("reservation detail view state", () => {
  it("shows the join action for an eligible account and leave for an enrolled account", () => {
    const open = makeEvent();
    assert.equal(getReservationViewModel(open).canJoin, true);
    assert.equal(getReservationViewModel(open).canLeave, false);

    const waiting = makeEvent({
      callerState: "waiting",
      allowedActions: { ...open.allowedActions, join: false, leave: true },
      waiting: [
        {
          enrollmentId: 22,
          displayName: "Current user",
          isCaller: true,
          joinedAt: "2026-10-20T12:00:00.000Z",
          position: 3,
        },
      ],
    });
    const waitingView = getReservationViewModel(waiting);
    assert.equal(waitingView.canJoin, false);
    assert.equal(waitingView.canLeave, true);
    assert.equal(waitingView.callerWaitPosition, 3);
  });

  it("locks started and cancelled events even when stale permissions claim actions are available", () => {
    const staleActions = {
      join: true,
      leave: true,
      edit: true,
      cancel: true,
      retryNotification: false,
    };
    const started = getReservationViewModel(
      makeEvent({ status: "started", allowedActions: staleActions }),
    );
    assert.equal(started.lockReason, "This event has started. Reservations and time changes are locked.");
    assert.equal(started.canJoin, false);
    assert.equal(started.canLeave, false);
    assert.equal(started.canEdit, false);
    assert.equal(started.canCancel, false);

    const cancelled = getReservationViewModel(
      makeEvent({ status: "cancelled", allowedActions: staleActions }),
    );
    assert.equal(
      cancelled.lockReason,
      "This event is cancelled. Its participant history is preserved, but seats can no longer change.",
    );
    assert.equal(cancelled.canJoin, false);
    assert.equal(cancelled.canLeave, false);
    assert.equal(cancelled.canEdit, false);
    assert.equal(cancelled.canCancel, false);
  });

  it("does not expose creator/admin controls when the API denies them", () => {
    const view = getReservationViewModel(makeEvent());
    assert.equal(view.canEdit, false);
    assert.equal(view.canCancel, false);

    const managerView = getReservationViewModel(
      makeEvent({
        allowedActions: {
          join: true,
          leave: false,
          edit: true,
          cancel: true,
          retryNotification: true,
        },
      }),
    );
    assert.equal(managerView.canEdit, true);
    assert.equal(managerView.canCancel, true);
  });
});
