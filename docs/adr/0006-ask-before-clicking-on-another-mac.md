---
title: "ADR-0006: Clicks on another Mac after asking"
status: Accepted
date: 2026-11-11
---

# ADR-0006: Clicks on another Mac after asking

**Status:** Accepted. Supersedes ADR-0004 decision 2 and ADR-0005 decision 3.

## Context

`device-ui.js` refuses to click anywhere but the click host, because a click takes the
pointer from whoever is using the Mac (ADR-0004, ADR-0005). A check run on the Mac someone
works at can't press hidden controls, so that person presses them by hand.

## Decision

1. **On any machine but the click host, a run's first click asks first,** with a macOS
   dialog (`osascript display dialog`): "`<script>` wants to click in Live on this Mac. It
   moves the pointer until the check ends." The buttons are Don't Allow, the default, and
   Allow. It gives up after 2 minutes.
2. **Allow covers the rest of that run.** Don't Allow or no answer refuses, as before.
3. **The click host doesn't ask.** No flag or variable skips the dialog; the click host
   still comes from `harness/local.json` only.

## Consequences

- Someone has to be at the Mac: an unattended run there waits 2 minutes, then fails.
- The dialog takes the front; the harness brings Live back before each click, as it already
  did.
- A script could press Allow through System Events, so the dialog stops accidents, not a
  program set on clicking.
- Opening a device's UI and reading its panel's text (`ui.text`) no longer needs the click
  host: neither moves the pointer.
