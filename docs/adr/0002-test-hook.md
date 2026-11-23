---
title: "ADR-0002: A test hook in development builds of devices"
status: Accepted
date: 2026-10-18
---

# ADR-0002: A test hook in development builds of devices

**Status:** Accepted. Supersedes ADR-0001 decision 4.

## Context

Over the LOM a check can set a device's automated parameters and record its MIDI, but it
cannot read what the device shows: a status line, the result of an in-device check, the
item names of a menu that isn't a parameter. Nor can it press a control that isn't an automated parameter. A
`live.text` with `parameter_enable=0` is out of reach, and Visible (Not Stored) parameters
don't appear in `device.parameters` (found in Live 12.4). Checks that depend on these need
the user to look at the screen. Every device with a UI has the same gap.

Several instances of a device run at once: two of the same, or devices that work together.
A UDP port can have only one listener, so a device can't listen on a fixed port.

## Decision

1. **Reports go out over UDP as OSC**, to the harness on `127.0.0.1:11002`:
   `/hook/<topic> track_index device_index ...payload`. The indices are the device's own
   Live path, read at each report, so a check knows which instance spoke. Topics so far:
   `status <text>` (what the device's status line shows) and `check <pass 0|1> <summary>`
   (an in-device check's result). A device may add topics. Each project documents its own.
2. **The device side is `harness/max/hook.js`.** A project's build tool reads it from the
   harness at build time (`$LIVE_HARNESS`, default `~/dev/ableton-live-test-harness/harness`)
   and embeds it in development builds, so a development build needs the harness checked out
   to build, not to run.
3. **Commands go in through an automated parameter**, not a `[udpreceive]`. A check sets it
   over the LOM like any other parameter. A device that needs commands adds one automated
   menu parameter (for example "Command" with the items none and run check) and acts on its
   changes.
4. **Development builds only.** A project's build tool adds the outlet, the `[udpsend]`, and
   the command parameter in development builds. Release builds leave them out. Adopting the
   hook changes the device, so each project records it in its own ADR.

## Consequences

- Checks can wait for a status line or a check result instead of asking the user to read
  the screen, for any device that adopts the hook.
- A command parameter shows in Live's automation chooser and in undo history in development
  builds.
- The harness binds 11002 only when a check calls `openHooks()`. Like 11001, it takes one
  client at a time.
- Reports get no reply, so a check that waits for one times out if the device isn't a
  development build or doesn't send it.

## Alternatives considered

- **`[udpreceive]` per device for commands.** Instances collide on one port, and a port per
  instance would need discovery.
- **Visible (Not Stored) command parameter.** It is not visible to the LOM (Context).
- **Reading the UI with screenshots (computer use).** It is slow, layout-dependent, and can't
  tell instances apart reliably. It is kept for visual judgments only.
- **Max's `[send]` and `[receive]` to a harness device.** The harness would have to live
  inside the set as a device, and ADR-0001 rejects a device as the driver.
