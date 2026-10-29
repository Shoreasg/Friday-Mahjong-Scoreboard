# Mahjong admin and session dark-mode contrast check

## Changes

- Raised the dark destructive text color to 74% lightness. It measures 6.05:1 against tile surfaces and 4.78:1 against muted surfaces; black text on its filled status background measures 8.32:1.
- Kept the existing dark input borders, which measure 14.74:1 against tile surfaces.
- Changed compact session forms to two numeric fields per row on narrow screens and three from the `sm` breakpoint upward.
- The light theme is unchanged.

## Screens and states reviewed

| Screen or state | Desktop | Mobile | Review |
| --- | --- | --- | --- |
| Admin page header and admin-only tools | Reviewed | Reviewed | Source review; authenticated preview unavailable |
| Telegram broadcast, attendance poll and confirmation dialogs | Reviewed | Reviewed | Source review of form text, controls and shared dialog colors |
| Webhook status and URL entry | Reviewed | Reviewed | Source review of status badges, error text and input |
| Admin list and grant-user picker | Reviewed | Reviewed | Source review of row text, picker and control colors |
| Session create/edit sheet | Reviewed | Reviewed | Source review of fields, player picker, notes and sticky actions |
| Allocation totals, validation errors, base-pot lock confirmation | Reviewed | Reviewed | Dark semantic color and foreground-pair review |
| Protected admin and session pages in a signed-in dark-mode browser | Not available | Not available | Preview browser is signed out; authentication was left intact |

The protected pages were reviewed from their components, theme tokens and responsive breakpoints, but were not visually captured in an authenticated dark-mode session.
