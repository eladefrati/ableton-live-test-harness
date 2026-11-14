---
title: "ADR-0013: Drag in one move of whole points"
status: Accepted
date: 2026-11-13
---

# ADR-0013: Drag in one move of whole points

**Status:** Accepted. Supersedes ADR-0010. Extends ADR-0004, ADR-0007 and ADR-0008 from clicks
to drags.

## Context

harness-computer-use only clicks. A knob or slider turns when the mouse is pressed on it, moved
and released, and a click with no movement leaves its value alone (a knob of one of Live's
devices, `harness/live-notes.md`). Setting a parameter over OSC proves the value reaches the
device, not that the control answers the mouse.

It is mainly for plug-ins. The harness already changes the values of Live's own devices over
OSC, and their controls are Live's; a plug-in's editor is the plug-in's own code, which only
the mouse exercises.

ADR-0010 moved the pointer in steps of one point. A knob of one of Live's own devices turned
further than the distance asked for, and further still with a sideways part: it counts every
drag event's distance from the press point, and it reads positions in whole points.

## Decision

1. **A drag is a press that moves.** The pointer goes to the control, the same checks as for a
   click pass there (ADR-0004's Info View in Live's window, ADR-0008's editor checks in a
   plug-in's window, and Stop, ADR-0012), then the button goes down, the pointer moves the
   distance given in one move, to the end, and the button comes up where the pointer then
   is. One move, not a path of steps: for every drag event, a knob of one of Live's own
   devices adds that event's distance from the press point and, when the event has a
   vertical part, moves the pointer back there, so a path measured from the press point is
   counted again at each step, and the knob turns further the more events the drag has
   (`harness/live-notes.md`). By the time the button comes up, Live has moved the pointer
   back to the press point after a move with a vertical part; after any other, and on other
   controls, it is at the end.
2. **The distance is given in points, not as a value.** How far a control turns per point is
   up to each device and plug-in, so the harness doesn't aim at a value. Up and right are
   positive.
3. **Evidence still comes from Live** (ADR-0004 decision 5): the parameter read back after the
   drag, which shows that it moved and which way.
4. **The drag is bounded, and in whole points.** At least 1 point on its longer axis and at
   most 400 on either, and its end must be on screen. A fraction of a point is refused:
   Live's knob reads positions in whole points, so what a fraction turned would depend on
   the fraction the press point happens to have.

## Consequences

- Only the start is checked: once the button is down the control has the mouse, wherever the
  pointer goes.
- A drag can't set an exact value; a check that needs one sets it over OSC and drags only to
  prove the mouse turns the control.
- The one drag event carries its movement as well as its position, for controls that read
  how far the mouse moved rather than where it is: the whole distance, in its delta fields.
- A control that needs to see the pointer pass through places on the way doesn't get them.
  None of the four kinds measured does: a knob of one of Live's devices, a JUCE editor's
  slider, the slider of Apple's AUDelay editor and a Max for Live device's number box
  (`harness/live-notes.md`).
