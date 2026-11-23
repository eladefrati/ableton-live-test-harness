---
title: "ADR-0001: Drive Live through our own fork of AbletonOSC"
status: Accepted; decision 1's local-only clause superseded by ADR-0005, decision 4 by ADR-0002, decision 5's opening of sets by ADR-0003
date: 2026-10-18
---

# ADR-0001: Drive Live through our own fork of AbletonOSC

**Status:** Accepted. Decision 1's local-only clause is superseded by ADR-0005, decision 4 by ADR-0002, and decision 5's opening of sets by ADR-0003.

## Context

Every in-Live acceptance check across projects that run in Live (Max for Live devices,
Live Extensions) is run by hand: build, load the device, set up tracks and routing,
play, record, read the result, and report back. The goal is for a coding agent to run these checks
itself, as part of a verification skill.

Live exposes the Live Object Model (LOM) to Python MIDI Remote Scripts. ideoforms/AbletonOSC
is such a script, exposing the LOM over OSC (UDP 11000 in, 11001 out). Upstream is dormant.
Its last commit, 0ca6821, is from 2025-11-19, and about 33 PRs are open. At that commit it has
gaps and bugs that hit our tests:

- Arrangement clips give no notes, and every timing check records to the Arrangement. Only
  open PR ideoforms/AbletonOSC#195 adds them.
- Devices can't be loaded from the browser. Only open PR ideoforms/AbletonOSC#204, which
  consolidates five others, adds that.
- `/live/clip_slot/*` writes a traceback to `Log.txt` on every call (ideoforms/AbletonOSC#212, PR ideoforms/AbletonOSC#213).
- `/live/clip/get/notes` fails above macOS's 9216-byte UDP datagram limit
  (`net.inet.udp.maxdgram`, ideoforms/AbletonOSC#88). A long recording is about 16 KB.
- Floats are sent as 32-bit. That is not a blocker, since at 120 BPM the error stays in
  microseconds for the first few hundred beats.
- The server binds to 0.0.0.0.

Some checks are outside the LOM entirely: a device's status text and a button that is
a `live.text` with `parameter_enable=0`, saving and reopening a set, Cmd-K and Cmd-M mapping,
and visual judgments.

## Decision

1. **Own fork of upstream, local only.** This repo is a clone of ideoforms/AbletonOSC with
   its history, base tagged `upstream-base` (0ca6821). It has no upstream remote and no
   GitHub remote. Upstream is dormant, so fetching from it has no expected value. The tag is
   enough to diff our changes. Changes go where they are needed, in upstream files or new
   ones.
2. **Installed as a symlink.** `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC` links
   to this repo, so edits reach Live without copying.
3. **Fork patches are not listed here.** `git diff upstream-base` shows them, and
   `docs/osc-api.md` shows the endpoints they add.
4. **Test hooks in development builds only.** Each device's build tool can add a `[udpsend]` that
   reports status lines and check results, tagged with the device's ID so several instances
   can share one port. Commands such as pressing a button go through a parameter the LOM
   can see, not a `[udpreceive]`, since several instances cannot listen on one port. That
   parameter is a Visible (Not Stored) `live.text`, which adds no undo step. Whether such
   parameters appear in `device.parameters` is to be verified first. Release builds leave
   the hooks out.
5. **AppleScript does what the LOM can't.** It saves, opens sets, and switches Key and MIDI
   Map Mode through Live's menus, and Save As also types into its panel. Computer use is only
   for screenshots and visual checks.

## Consequences

- AbletonOSC occupies one Control Surface slot, and only one process can listen on 11001.
- We own all maintenance, including breakage from future Live versions.

## Alternatives considered

- **Upstream as-is, pinned.** It fails on the gaps listed in Context.
- **jpatricknola/AbletonOSC.** It is 65 commits ahead and 0 behind, is tested, and documents
  every divergence. It has the clip_slot fix, loopback bind, browser loading, and
  `value_items`, but not Arrangement notes or large replies. It was rejected in favour of
  owning the code from upstream.
- **Other forks.** rohailaltaf, mrkarlos, and ClosetGeek-Git bring production-oriented
  features, session-ring and view work, or a switch away from OSC. None is closer to our
  needs.
- **Companion Remote Script beside upstream.** It duplicates the OSC server and listener
  code and takes a second Control Surface slot.
- **Own Remote Script from scratch.** It rebuilds what AbletonOSC already does well.
- **Max for Live driver device.** The Max for Live LOM has no browser, so the driver cannot
  load devices, and the driver would sit inside the set under test.
- **Live Extensions SDK.** It has no transport, no listeners, and no save. It is a test
  target, not a driver.
- **abletonosc-mcp.** It is a Go MCP server for music production, built on upstream plus its
  own patch. It is aimed at production, not testing, and a coding agent can drive a CLI
  directly.
