---
title: "ADR-0007: Press any device or plug-in at measured points"
status: Accepted
date: 2026-11-11
---

# ADR-0007: Press any device or plug-in at measured points

**Status:** Accepted. Extends ADR-0004 decision 4 beyond Max for Live devices.

## Context

ADR-0004 takes a control's position from the device's `.amxd`, so only a Max for Live
device can be pressed. A check sometimes has to click another device: a Max device's Map
button waits for a click on the parameter to map, such as one of Auto Filter's knobs. Live's
own devices and plug-ins have no build to read positions from.

## Decision

1. **Points measured in Live.** A device without a build is pressed at points the check
   gives, each a control's centre in points from the panel's corner (the same corner as a Max
   device's), with the Info View title to expect there.
2. **The harness keeps the points it has measured,** by the device's class name, with its
   panel's width: Auto Filter's knobs first. A device opened with neither a build nor points
   uses them, and is refused if the harness has none.
3. **The Info View check stays.** A point is clicked only if the Info View names the expected
   control, as in ADR-0004 decision 3; a point without a title is refused.

## Consequences

- Measured points hold for one layout: a Live version that redraws a device, or another
  zoom, moves them. The Info View check turns a moved point into a refusal, not a wrong
  click; the points are then measured again.
- A control whose Info View title changes with the device's state (Auto Filter's Rate knob
  names a different parameter in each LFO mode) can be pressed only in the state measured.
