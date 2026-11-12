---
title: "ADR-0004: Press device controls with real mouse events"
status: Accepted; decision 2 superseded by ADR-0005, then ADR-0006
date: 2026-11-08
---

# ADR-0004: Press device controls with real mouse events

**Status:** Accepted; decision 2 superseded by ADR-0005, then ADR-0006

## Context

Some controls can't be reached over the LOM: a `live.text` hidden from Live, one with
`parameter_enable=0`. Others can, but setting a parameter doesn't show that a mouse click
lands on the control, as with a transparent `live.tab` over a drawing. A command parameter
(ADR-0002) enters below the mouse, so it proves only the wiring, and it changes the build. The
`verify-ableton` skill forbade clicking inside Live by screen coordinates, because a blind click can hit anything
and takes the pointer from whoever is using the Mac.

## Decision

1. **Real mouse events.** `harness/device-ui.js` posts them through `CGEvent`, with a Swift
   helper, on the unmodified build.
2. **On the remote Mac only.** It refuses on any other machine: nobody uses that Mac's
   pointer.
3. **Never blind.** A click goes out only if the screen is unlocked, Live is frontmost, its
   main window is the topmost window at the point, and with the pointer on the point, Live's
   Info View names the control. Otherwise nothing is clicked.
4. **Positions come from the build.** A control's rectangle, and its Info View title, are
   read from the `.amxd`. The panel is found by reading the device's title in a capture of
   Live's window.
5. **Evidence comes from Live,** not from having sent the click: a parameter's value, the
   track's meter or a recording, or the text the device shows.
6. **Panel text is read from captures of Live's window** (`ui.text`). Unlike a click, it has
   no Info View check: it rests on the device being selected and its title being unique on
   screen.

## Consequences

- A check takes Live's front and the pointer while it runs.
- The Info View must be visible, Live's zoom at 100%, the device in view with its title
  unique on screen, and each pressed control must have an `annotation_name`. Anything else
  is refused, not guessed.
- All the items of a `live.tab` share one Info View title, so which item was hit is shown
  only by the evidence.
- ADR-0002 kept screenshots for visual judgments because they are layout-dependent and
  can't tell instances apart; here the device is selected first, a repeated title is
  refused, and the Info View confirms each target. The hook remains the way to read a
  development build's state.
