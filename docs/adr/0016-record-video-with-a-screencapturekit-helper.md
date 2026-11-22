---
title: "ADR-0016: Record video of Live with a ScreenCaptureKit helper"
status: Accepted
date: 2026-11-14
---

# ADR-0016: Record video of Live with a ScreenCaptureKit helper

**Status:** Accepted.

## Context

The harness captured stills only (`screencapture -l`). Proof of something that changes over
time, a control that moves or a label that changes, came as bursts of stills. Each was a
folder of pictures, with the moment of the change between two of them or missed. One video
shows it. This is for any project's checks, as stills are, not a part of harness-computer-use.

A check starts a recording, acts, and stops it, so it must know when the recording has started,
and a run that fails or is killed must still leave the video of what happened up to then. The
harness runs checks on a second Mac over ssh, with no new permissions or installs there.

A still or a video is proof shown once to the person who asked for it, not part of a
project. Kept in a project's repo it needs a folder and a `.gitignore` line in every project,
and it marks every run log as made with uncommitted changes.

## Decision

1. **A Swift helper records with ScreenCaptureKit** (`harness/video.swift`, built with `swiftc`
   like the harness's other helpers) and writes the file through `SCRecordingOutput`: H.264 in
   a `.mov`, at most 30 frames a second, the pointer included. It says when the file has
   started, and stops on SIGINT, SIGTERM or SIGHUP, after a length of time, when the process
   that started it ends, or, when that process's stderr is a pipe or a socket, when nothing
   reads it any more, as when the ssh session of a run on the remote ends, finishing the file
   each time. It runs in a session of its own, so Ctrl-C on a run reaches the run, which stops
   it. A recording around a command ends after the command, not at Ctrl-C. The command runs in
   a session of its own too, each signal the run gets reaches the command's whole process
   group once, and what the command leaves in its group is ended as the command ends.
2. **Live's main window by default,** or another of Live's windows by its id, recorded alone as
   `screencapture -l` captures it, behind other windows and without harness-computer-use's
   border and pill. **The whole main display on request,** for what the window leaves out:
   the menus, dialogs and other windows that open over it, each a window of its own, the
   border, the pill, other apps. A window recording ends when its window closes, and its
   result says so.
3. **The display is woken before a recording, after the helper is built, and kept on during
   it.** A recording made while it sleeps holds its last picture.
4. **macOS 15 or later,** where `SCRecordingOutput` exists; an older Mac is refused with that
   reason before anything is built.
5. **An agent checks a video by its frames.** The helper also saves the frame at a given time
   as a PNG, so an agent that can't watch a video sees what it shows.
6. **Captures given no path go to a folder of the harness's own in the system temp folder,**
   `ableton-harness-captures` (`harness/captures.js`), apart from the harness's temp folder,
   which a relaunch empties; this applies to stills too. A path the caller gives is used as
   given, and nothing deletes it, unless it is in that folder. macOS doesn't clear unused
   files from the temp folder within days (on macOS 26 its clean-up is set to 3 days, and
   files older than that by both their times were still there after its daily runs), so each
   capture saved there deletes, once it is saved, the captures there older than 7 days. A
   capture is written in a hidden folder there and moved out once it is finished, a video by
   its helper, so `remote.sh` brings back the remote's finished captures to this Mac's
   folder, overwriting nothing, and leaves one still being written.

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
- **Captures in a project's `tests/live/captures/`,** brought back by `remote.sh` like logs.
  Every project would need the folder kept out of git, and an untracked capture marked each
  run log as made with uncommitted changes.
- **A mark beside a video being recorded, naming its recorder's process,** for `remote.sh`
  to leave it. A process id reused by another process kept a finished video marked; a hidden
  folder needs no process id.
- **`remote.sh` stopping the remote's recordings itself on Ctrl-C or SIGTERM,** from a shell
  trap. zsh ran the trap only once its ssh had ended, which SIGTERM sent to `remote.sh` alone
  doesn't do, and moving the run's logs and captures then took them from a check still
  writing them. The recorder watching the run's stderr needs neither.

## Consequences

- The size is the encoder's choice, since `SCRecordingOutput` takes no bit rate. Measured with
  Live idle or playing, on a 2x display: Live's window about 0.1 MB a second and the display
  0.2 on an Intel Mac, 0.46 and 0.75 on an Apple-silicon one; a recording run to the 10-minute
  cap reaches about 280 MB for a window and 450 MB for the screen there. More movement costs
  more.
- A capture left in the captures folder is deleted once a capture is saved there more than 7
  days after it; one to keep is moved out of it, or made at a path of the person's from the
  start.
- A helper killed itself, rather than its run, leaves a whole video, but one it was writing
  in the captures folder stays under its hidden name there until the prune deletes it.
- A plug-in's own window shows only while Live is in front (ADR-0008), so recording it needs
  Live in front throughout.
- Developer tools are needed on the Mac that records, as for the click helper.
