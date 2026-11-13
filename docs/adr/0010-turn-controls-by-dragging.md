---
title: "ADR-0010: Turn controls by dragging"
status: Accepted
date: 2026-11-13
---

# ADR-0010: Turn controls by dragging

**Status:** Accepted. Extends ADR-0004, ADR-0007 and ADR-0008 from clicks to drags.

## Context

harness-computer-use only clicks. A knob or slider turns when the mouse is pressed on it, moved
and released, and a click with no movement leaves its value alone (a knob of one of Live's
devices, `harness/live-notes.md`). Setting a parameter over OSC proves the value reaches the
device, not that the control answers the mouse.

It is mainly for plug-ins. The harness already changes the values of Live's own devices over
OSC, and their controls are Live's; a plug-in's editor is the plug-in's own code, which only
the mouse exercises.

## Decision

1. **A drag is a press that moves.** The pointer goes to the control, the same checks as for a
   click pass there (ADR-0004's Info View in Live's window, ADR-0008's editor checks in a
   plug-in's window, and Stop, ADR-0009), then the button goes down, the pointer moves the
   distance given in steps of one point, and the button comes up where it ends.
2. **The distance is given in points, not as a value.** How far a control turns per point is
   up to each device and plug-in, so the harness doesn't aim at a value. Up and right are
   positive.
3. **Evidence still comes from Live** (ADR-0004 decision 5): the parameter read back after the
   drag, which shows that it moved and which way.
4. **The drag is bounded.** At most 400 points either way, and its end must be on screen.

## Consequences

- Only the start is checked: once the button is down the control has the mouse, wherever the
  pointer goes.
- A drag can't set an exact value; a check that needs one sets it over OSC and drags only to
  prove the mouse turns the control.
- Each drag event carries its movement as well as its position, for controls that read how
  far the mouse moved rather than where it is.
