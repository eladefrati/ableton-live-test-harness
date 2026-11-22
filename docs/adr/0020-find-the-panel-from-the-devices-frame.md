---
title: "ADR-0020: Find the panel from the device's frame in Device Detail"
status: Accepted
date: 2026-11-21
---

# ADR-0020: Find the panel from the device's frame in Device Detail

**Status:** Accepted. Supersedes the second sentence of ADR-0004 decision 4: the panel is no
longer found by reading the device's title.

## Context

`device-ui.js` found a device's panel from where the text recognizer put the start of the
device's title in a capture of Live's window, plus a fixed offset, and a plug-in's further
offset for its two extra title-bar buttons. That start is off by up to a few points, by the
title and by where the device is (`harness/live-notes.md`): the same device gave corners 2.0
points right and 0.7 left of its body's edge, and a Max device's capture came out 2 points
off.
Presses moved by as much as captures did, and points measured on one device carried the error
of its title's reading. Live's Accessibility tree, which the harness already reads for a
plug-in's window button (ADR-0008), has a group per device of the selected track in Device
Detail, titled with the device's name, whose frame doesn't move with the title.

## Decision

1. **The panel's corner is the device's frame's corner plus a fixed offset** of 3 points right
   and 18 down, for Live's own devices, Max devices and plug-ins alike. In captures of Live's
   window the device's body starts 1 point right of the frame and 18 below it, and a Max
   device's presentation 2 points further in, where a control's rectangle starts from. The Info View's row is found from the frame's
   top, 4 points above the title's text.
2. **The device is found by its name among the selected track's devices** in Device Detail;
   no device or two of that name is refused, as a title not on screen or on it twice was.
3. **Nothing is read to find the panel,** so a press reads only the Info View's row.

## Consequences

- Device Detail must be shown and the terminal app must have Accessibility, as for a plug-in's
  window.
- Points measured from the old corner move. Auto Filter's were taken again from its controls'
  Accessibility frames. A project's own measured points (`controls`) may be off by the
  reading error their measurement carried.
- Two devices of one name on a track are refused, though the old reading could tell them apart
  when only one was on screen.
