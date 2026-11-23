---
title: "ADR-0019: Double-click and Shift-click"
status: Accepted
date: 2026-11-21
---

# ADR-0019: Double-click and Shift-click

**Status:** Accepted. Extends ADR-0004 from a click to a double-click and a Shift-click, in
Live's window only.

## Context

A device's own views can act on a double-click (for example, deleting a point) or on a click with Shift
held (a variant of a button's action). harness-computer-use only clicked, so a check had to post
these events itself, outside the harness's checks and its Stop (ADR-0012). A press of
`device-ui.js` takes about 9 s on an Intel Mac (macOS 26), so two presses can't make a double-click.
The gesture has to be one call of the helper. A modifier key posted as a key event stays held
for every app until its release is posted, and a mouse event posted with its modifiers cleared
lets go of keys a person holds (`harness/live-notes.md`).

## Decision

1. **One press, one gesture.** `ui.press(name, [item], { double: true })` and
   `{ shift: true }`, not both, after the same checks as a click (Info View, Stop). The helper
   posts the whole gesture in one call.
2. **A double-click is two clicks at one point.** The second press comes 0.1 s after the first
   release and carries click count 2, as a person's does. There is no new check between them.
   Stop after the first click ends the gesture there. The helper exits as for a click that had
   happened (ADR-0012), saying that its first click had.
3. **Shift is a key held, not a flag.** The helper posts Shift's key down after the aim, just
   before the button, and posts its release after the button's. So the mouse events, built
   from the keyboard's state, carry Shift, and so does the keyboard's state an app may read
   instead. The helper holds back ending signals (an interrupt, quit, hangup, or termination
   signal) from Shift's press on, as it does from the button's. Every way the helper ends
   (Stop, a signal, a failure) posts Shift's release.

## Consequences

- `harness/checks/pointer-guards.js` covers both gestures, Stop during them, and that no modifier is
  left held.
- A plug-in's own window (ADR-0008) still takes plain clicks only.
- While the helper holds Shift, about 0.15 s, a person's stop key (ADR-0017) carries Shift too,
  and the overlay's claim may not take it as the key. Stop on the pill works throughout. That
  is not checked.
