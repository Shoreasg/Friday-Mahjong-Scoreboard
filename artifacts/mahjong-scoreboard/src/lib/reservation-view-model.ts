import type { ReservationEvent } from "@workspace/api-client-react";

type ReservationState = Pick<
  ReservationEvent,
  "status" | "callerState" | "allowedActions" | "waiting"
>;

export function getReservationViewModel(event: ReservationState) {
  const isOpen = event.status === "open";

  return {
    lockReason:
      event.status === "cancelled"
        ? "This event is cancelled. Its participant history is preserved, but seats can no longer change."
        : event.status === "started"
          ? "This event has started. Reservations and time changes are locked."
          : null,
    callerWaitPosition:
      event.waiting.find((person) => person.isCaller)?.position ?? null,
    canJoin: isOpen && event.allowedActions.join && event.callerState === "none",
    canLeave: isOpen && event.allowedActions.leave && event.callerState !== "none",
    canEdit: isOpen && event.allowedActions.edit,
    canCancel: isOpen && event.allowedActions.cancel,
  };
}
