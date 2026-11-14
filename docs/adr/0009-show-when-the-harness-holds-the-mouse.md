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
   edges that slowly breathes, with a frosted pill at the top naming harness-computer-use and
   the run, from Allow until the run's process ends, then a notification that the mouse is free.
   A program of its own (`computer-use-overlay.swift`) draws it and watches the run's process,
   so it goes also when the run crashes or is killed. The dialog and the notification are titled
   harness-computer-use, and the dialog says the glow will show.
2. **Only where the run asked.** The click host doesn't ask, and no one watches it.
3. **The click guard skips the border.** Its windows cover the screen above every app and let
   every click through; the check that the window aimed at is topmost at the point (ADR-0004,
   ADR-0008) leaves out windows with the border's title owned by its program, and nothing else.
4. **It only informs.** The run builds the border's program before it asks, and after Allow
   waits for the border to say its windows are on screen. A run that can't show it (the build
   fails, the program ends, or it says nothing for 5 s) warns and clicks anyway, and so does
   a run whose border goes while it goes on: the person allowed the clicks, not the border.
5. **Stop on the pill takes the mouse back.** It creates the run's stop marker, a file the run
   named when it started the border, takes the border down, and then says the mouse is free.
   The helper that posts the mouse events checks the marker before every event but the
   release of a button it holds. Once the marker exists it posts nothing but that release: a
   press under way stops before its hover, before its click or before a drag's move, and a
   drag stopped before its move ends with the button up where the pointer then is, the press
   point unless the mouse was moved. The press under way throws, unless only its release was
   left: then the click or the drag has happened, and the press resolves. Every later press
   of the run throws. The run isn't killed: a check fails at the press that throws and still
   runs its cleanup, where a kill would leave its tracks in Live. The pill is a window of its
   own that takes clicks, so the click guard refuses a point under it.

## Consequences

- The border lasts the whole run, not each click: between clicks the run can take the pointer
  again, so the mouse is free only once the run ends.
- Captures of a window (`screencapture -l`) don't include it; a capture of the whole screen does.
- A window given the border's title by a program whose name starts like the border's would be
  skipped too: the guard stops accidents, as ADR-0006's dialog does, not a program set on
  clicking.
- After a change to the helper or the border, a run's first press builds both before the
  dialog: about 11 s, and 25 s or more with an empty module cache. The border is on screen
  about 1.4 s after Allow.
- A run with no desktop session can't show the dialog either, so it is refused before the
  border matters.
- Stop needs nothing from the run: the helper reads the marker itself, so a run busy in its
  own code is stopped as fast as an idle one.
- A click whose button was down when Stop came completes, since its release is the one event
  still posted, and so does a drag whose move was already posted. Such a press resolves, so
  the run knows it happened: one that opened a menu with it goes on to close the menu
  (ADR-0011). A drag stopped before its move is a click on the control, and throws: the
  button went down at the press point and came up where the pointer then was.
- An interrupt, quit, hangup or termination signal that reaches the helper while it holds the
  button, such as Ctrl-C or Ctrl-\ on the run, is held back until the helper has released the
  button, which it then does at once. A kill (SIGKILL) or a crash of the helper still leaves
  the button held.
