---
title: "ADR-0008: Reach a plug-in's own window"
status: Accepted
date: 2026-11-13
---

# ADR-0008: Reach a plug-in's own window

**Status:** Accepted. Extends ADR-0004 and ADR-0007 to the window a plug-in opens its editor in.

## Context

A plug-in's editor opens in a window of its own, not in Live's device view. To prove an editor in
Live, a check has to open that window, capture it and click inside it. The harness reached only
Live's main window: the plug-in's window floats above it (window layer 3), Live hides it while
Live is in the background or the display sleeps, and nothing opened it but a person clicking the
button on the device's title bar. ADR-0004 clicks only once Live's Info View names the control
under the pointer; a plug-in's window has no Info View, and a plug-in's controls need not name
themselves to Accessibility (a JUCE slider is exposed without its label, a custom component as
nothing at all).

## Decision

1. **Open and close it through Accessibility.** Live exposes each device in Device Detail with a
   "Show/Hide Plug-In Window" checkbox. With the device selected over OSC, the harness presses it
   with an Accessibility action, only when its value is not already the state wanted. No pointer
   moves. Exactly one device of that name must be shown, or it refuses.
2. **Find it by its title,** `<device>/<track>`, as exactly one of Live's windows; the editor is
   the window's Accessibility group named for the device, Live's title bar excluded.
3. **Wake the display and bring Live to the front** before capturing or clicking, since the
   window is on screen only then. A capture gives the front back to the app that had it.
4. **Click at points measured in the editor,** in points from its top left, given with the
   editor's size. With no Info View, the guarantee is containment: a click goes out only if the
   screen is unlocked, the editor is the size given, the point is inside it, and the plug-in's
   window is the topmost window at the point (ADR-0004's check, over every layer). ADR-0006's
   asking applies as to any click.
5. **Evidence still comes from Live** (ADR-0004 decision 5): the parameter the click should move,
   read over OSC.

## Consequences

- Weaker than the Info View check: a point that has drifted within an editor of the same size
  clicks another control of the plug-in under test, never anything outside it. The check's
  evidence shows it; the points are then measured again.
- A plug-in whose editor's size changes (a resizable editor, another scale) is refused until the
  check gives the new size and points.
- Opening relies on Live's Accessibility labels (Live 12.4); a Live that renames the checkbox is
  refused, not guessed at.
