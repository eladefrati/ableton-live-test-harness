---
title: "ADR-0018: Send MIDI to Live through a port of the harness's own"
status: Accepted
date: 2026-11-21
---

# ADR-0018: Send MIDI to Live through a port of the harness's own

**Status:** Accepted.

## Context

A device's controls can be MIDI-mapped, and a check of a mapping needs MIDI to come into Live as
it would from a controller: Live takes a CC as a mapped control's value only from an input with
Remote on. The LOM can't send MIDI in. macOS has a built-in virtual bus (the IAC Driver), but it
is off until turned on in Audio MIDI Setup on each Mac, and any app can send on it or listen to
it.

## Decision

1. **A Swift helper makes a virtual MIDI source named Harness** (`harness/midi.swift`, built
   like the harness's other helpers) while a check holds it open, with a fixed unique ID, and
   sends the messages a check gives it. `midi.js` opens it and sends CCs and notes; `cli.js
   midi-port` holds it open with no check running.
2. **The user turns Remote on for it once per Mac,** in Live's Settings > Link, Tempo & MIDI,
   with the port held open, and Track on if checks send notes into tracks. Live keeps the
   setting after the port closes and after a relaunch (measured, Live 12.4.25b2).
3. **No IAC:** nothing to turn on in macOS, and no other app's messages on the port.

## Consequences

The harness can't turn Remote on, or read whether it is: a check whose CCs do nothing points
to the setting. One port named Harness at a time: two are two inputs of one name in Live.
