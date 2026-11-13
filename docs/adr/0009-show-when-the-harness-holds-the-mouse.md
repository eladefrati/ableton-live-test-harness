---
title: "ADR-0009: Show when the harness holds the mouse"
status: Accepted
date: 2026-11-13
---

# ADR-0009: Show when the harness holds the mouse

**Status:** Accepted. Extends ADR-0006.

## Context

The harness's clicks with real mouse events, with the dialog that asks for them (ADR-0004,
ADR-0006, ADR-0008), together are **harness-computer-use**. After Allow, the run may take the
pointer at any moment until it ends, and nothing on screen says whether it still can: the person
at the Mac doesn't know when the mouse is theirs again.

## Decision

1. **A purple border around every screen while a run holds the mouse,** a soft glow in from the
   edges that slowly breathes, with a frosted pill at the bottom naming harness-computer-use and
   the run, from Allow until the run's process ends, then a notification that the mouse is free.
   A program of its own (`computer-use-overlay.swift`) draws it and watches the run's process,
   so it goes also when the run crashes or is killed. The dialog and the notification are titled
   harness-computer-use, and the dialog says the glow will show.
2. **Only where the run asked.** The click host doesn't ask, and no one watches it.
3. **The click guard skips the border.** Its windows cover the screen above every app and let
   every click through; the check that the window aimed at is topmost at the point (ADR-0004,
   ADR-0008) leaves out windows with the border's title owned by its program, and nothing else.
4. **It only informs.** A run that can't show it warns and clicks anyway: the person allowed the
   clicks, not the border.
5. **Stop on the pill takes the mouse back.** It sends the run SIGUSR2 and takes the border
   down; from then on every press of the run is refused, before its hover and again before its
   click. The run isn't killed: a check fails at its next press and still runs its cleanup,
   where a kill would leave its tracks in Live. The pill is a window of its own that takes
   clicks, so the click guard refuses a point under it.

## Consequences

- The border lasts the whole run, not each click: between clicks the run can take the pointer
  again, so the mouse is free only once the run ends.
- Captures of a window (`screencapture -l`) don't include it; a capture of the whole screen does.
- A window given the border's title by a program whose name starts like the border's would be
  skipped too: the guard stops accidents, as ADR-0006's dialog does, not a program set on
  clicking.
