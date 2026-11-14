---
title: "ADR-0016: Record video of Live with a ScreenCaptureKit helper"
status: Accepted
date: 2026-11-14
---

# ADR-0016: Record video of Live with a ScreenCaptureKit helper

**Status:** Accepted.

## Context

The harness captured stills only (`screencapture -l`). Proof of something that changes over
time, a control that moves or a label that changes, came as bursts of stills: a folder of
pictures, with the moment of the change between two of them or missed. One video shows it.

A check starts a recording, acts, and stops it, so it must know when the recording has started,
and a run that fails or is killed must still leave the video of what happened up to then. The
harness runs checks on a second Mac over ssh, with no new permissions or installs there.

## Decision

1. **A Swift helper records with ScreenCaptureKit** (`harness/video.swift`, built with `swiftc`
   like the harness's other helpers) and writes the file through `SCRecordingOutput`: H.264 in
   a `.mov`, at most 30 frames a second, the pointer included. It says when the file has
   started, and stops on SIGINT, SIGTERM or SIGHUP, after a length of time, or when the process
   that started it ends, finishing the file each time.
2. **Live's main window by default,** or another of Live's windows by its id, recorded alone as
   `screencapture -l` captures it: behind other windows, without harness-computer-use's border
   and pill. **The whole main display on request,** for what the window leaves out: the border,
   the pill, other apps.
3. **The display is woken before a recording and kept on during it.** A recording made while it
   sleeps holds its last picture.
4. **macOS 15 or later,** where `SCRecordingOutput` exists; an older Mac is refused with that
   reason before anything is built.
5. **An agent checks a video by its frames:** the helper also saves the frame at a given time
   as a PNG, so an agent that can't watch a video sees what it shows.

## Considered

- **`screencapture -v`,** stock and able to record one window. It says nothing when it has
  started (about 0.4 s after launch, measured), leaves no file at all when it ends by SIGTERM
  or SIGKILL, cuts the file short silently where the display went to sleep, and, started with
  the display asleep, waited until it woke and then kept a fraction of a second.
- **ScreenCaptureKit with `AVAssetWriter`.** A killed recorder leaves a damaged file unless the
  movie is written in fragments, and then loses the last fragment; it was also nearly twice
  the size. A file written through `SCRecordingOutput` was whole after the recorder was killed.
- **A recording command in the click helper (`device-ui.swift`).** Every change to it would
  need the click helper's in-Live gates, for code that moves no pointer.

## Consequences

- About 0.1 MB a second for Live's window on a 2x display, measured with Live idle or playing;
  more movement costs more.
- A plug-in's own window shows only while Live is in front (ADR-0008), so recording it needs
  Live in front throughout.
- Developer tools are needed on the Mac that records, as for the click helper.
