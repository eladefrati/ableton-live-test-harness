---
title: "ADR-0022: Drag soon after a click"
status: Accepted
date: 2026-11-22
---

# ADR-0022: Drag soon after a click

**Status:** Accepted. Extends ADR-0013 and ADR-0021 with a click on another control a given
time before the drag, in Live's window only.

## Context

A device's own view may take a press that comes soon enough after a click, and near enough
to it, as the second click of a double-click, whatever the system's click count says. A
check then has to show what a press on another point does inside that time, and that time
can be well under half a second. Each press of `device-ui.js` reads the Info View first,
which takes seconds, so a press and a drag can't make the gesture. The click, the wait and
the drag have to come from one call of the helper (ADR-0019's reason for a double-click).

## Decision

1. **One call, one gesture.**
   `ui.drag(name, { up, right }, { after: { click, ms }, hold, then })`: a click on the
   control `click`, then, `ms` after its release, the drag of `name`, held as in ADR-0021
   when `hold` and `then` are given. Both controls are named controls with an Info View title,
   and both pass the checks of a press (Info View, Stop) before the click, the drag's control
   first. They must be on the same panel, in the same window. There is no check of the Info
   View between the click and the drag.
2. **The wait is measured from the click's release.** The helper posts the release, then a
   pointer move to the drag's point, checks that Live's window is still topmost there, waits
   until `ms` after the release, and presses. It doesn't hover there as a press does (two
   moves, about a quarter of a second), and it doesn't wait under a notification's banner,
   which would take the wait past `ms`: a window over the point then refuses the drag, saying
   that the click had happened. That refusal exits 1, as a refusal does, so its error has no
   `done`, and it is not checked. Both points are checked to be topmost before the click.
3. **The time is reported, not promised.** `ms` is whole ms from 1 to 2000. The helper posts
   the press at `ms` or as soon after it as it can, and `drag` resolves with
   `{ gapMs }`, the time it measured from the release to the press. A check that rests on the
   press being inside a time asserts on `gapMs`.
4. **The press carries click count 1.** It is a new press at another point, not a
   double-click's second press. What a view makes of it is the view's own reading of time
   and distance, which is what such a check is about.
5. **Stop after the click ends the gesture there.** Stop between the click's release and the
   drag's first move posts nothing more but the release of a button the drag's press holds,
   and the helper exits as a gesture that had happened (ADR-0012), saying that the click had
   and the drag hadn't. The error says `done`. An ending signal then ends the helper by that
   signal, after the same release. Stop or a signal after the first move ends the drag as a
   held drag's (ADR-0021).

## Consequences

- `harness/checks/pointer-guards.js` covers the gesture's events and the time between the
  release and the press, its refusals, and Stop at the click and during the drag's hold.
- A press with no hover before it, only one pointer move, lands on a control of one of
  Live's devices (`harness/live-notes.md`). `pointer-guards.js` sees only its own window.
- A plug-in's own window (ADR-0008) takes one-move drags only, and refuses `after` as it
  refuses `hold`.
