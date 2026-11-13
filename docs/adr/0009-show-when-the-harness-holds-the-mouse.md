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

1. **A purple border around every screen while a run holds the mouse,** with a label naming the
   run, from Allow until the run's process ends, then a notification that the mouse is free. A
   program of its own (`computer-use-overlay.swift`) draws it and watches the run's process, so
   it goes also when the run crashes or is killed. The dialog says the border will show.
2. **Only where the run asked.** The click host doesn't ask, and no one watches it.
3. **The click guard skips the border.** Its windows cover the screen above every app and let
   every click through; the check that the window aimed at is topmost at the point (ADR-0004,
   ADR-0008) leaves out windows with the border's title owned by its program, and nothing else.
4. **It only informs.** A run that can't show it warns and clicks anyway: the person allowed the
   clicks, not the border.

## Consequences

- The border lasts the whole run, not each click: between clicks the run can take the pointer
  again, so the mouse is free only once the run ends.
- Captures of a window (`screencapture -l`) don't include it; a capture of the whole screen does.
- A window given the border's title by a program whose name starts like the border's would be
  skipped too: the guard stops accidents, as ADR-0006's dialog does, not a program set on
  clicking.
