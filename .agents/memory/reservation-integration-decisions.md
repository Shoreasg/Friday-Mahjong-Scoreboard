---
name: Reservation integration decisions
description: Cross-task boundaries for the reservation UI and notification worker.
---

Keep reservation success independent of Telegram availability; delivery work must not be called inside a booking transaction.

**Why:** The backend is intentionally shipped before the UI and delivery worker, and a Telegram outage must never prevent reserving a seat or make a successful reservation look unsuccessful.

**How to apply:** The UI reports booking results separately from notification state. Delivery integrations consume persisted intents and must not treat pending as sent. Public routes, request-retry rules, worker ownership, and event-link requirements are handed off in `docs/reservations.md`.
