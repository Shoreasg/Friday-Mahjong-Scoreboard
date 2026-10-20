import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reservationSignInPath, safeReservationRedirect } from "./reservation-routing.ts";

describe("reservation sign-in routing", () => {
  it("preserves a valid event destination through sign-in", () => {
    const destination = "/app/reservations/42";
    const signInPath = reservationSignInPath(destination);
    assert.equal(signInPath, "/sign-in?redirect_url=%2Fapp%2Freservations%2F42");
    assert.equal(safeReservationRedirect(signInPath.slice(signInPath.indexOf("?"))), destination);
  });

  it("allows an event destination with its query string", () => {
    const destination = "/app/reservations/42?from=telegram";
    const search = `?redirect_url=${encodeURIComponent(destination)}`;
    assert.equal(safeReservationRedirect(search), destination);
  });

  it("preserves the reservations list destination", () => {
    assert.equal(safeReservationRedirect("?redirect_url=%2Fapp%2Freservations"), "/app/reservations");
  });

  it("rejects external, malformed, and non-reservation destinations", () => {
    assert.equal(safeReservationRedirect("?redirect_url=https%3A%2F%2Fevil.example"), undefined);
    assert.equal(safeReservationRedirect("?redirect_url=%2F%2Fevil.example"), undefined);
    assert.equal(safeReservationRedirect("?redirect_url=%2Fapp%2Fadmin"), undefined);
    assert.equal(safeReservationRedirect("?redirect_url=%2Fapp%2Freservations%2Fnot-an-id"), undefined);
  });
});
