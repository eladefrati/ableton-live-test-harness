---
title: "ADR-0003: Build plug-in sets instead of saving them through Live"
status: Accepted
date: 2026-11-02
---

# ADR-0003: Build plug-in sets instead of saving them through Live

**Status:** Accepted

## Context

An Audio Unit with more than 64 parameters lists only "Device On" over the LOM until they
are added in Configure mode, a UI gesture (`harness/live-notes.md`), and is back in that
state after every relaunch. A project's checks need Live relaunched after each plug-in build anyway:
Live loads an AU's code once per launch.

`exposePluginParameters` (plugin.js) got around this by saving the open set with File >
Save Live Set As, writing the parameters into a copy of the file, and opening the copy. The
save types into Live's Save panel with System Events keystrokes, which go to the frontmost
app, so it takes the user's focus, and a click elsewhere at the wrong moment takes the keys.

Opening a set with `open -a`, as `openSet` and `relaunch.js` did, also brought Live forward.

Measured in Live 12.4.25b1 and Suite 12.4.3 (2026-11-02):

- Live opens a set holding an `AuPluginDevice` with no plug-in state (an empty `Preset`),
  no preset references, and slots filled as Live fills them (parameter i in pair i). It lists every
  parameter, and they reach the plug-in: a plug-in's checks passed on such a set.
- The device block can come from another plug-in. AUDelay's block (`aufx`, one input bus),
  with another plug-in's codes and names put in, ran that plug-in, of another type and bus
  count; its checks passed.
- Live doesn't come forward when a set is opened through `NSWorkspace` with
  `OpenConfiguration.activates` false. That holds for a running Live and for a cold launch.
  It did come forward with `open -a` and with `open -g -a`.
- A set naming a component that isn't installed opens without a dialog as an
  `AuPluginDevice` that lists every parameter in the file. Only value strings tell it
  apart: an enum reads "0" where the plug-in says "Off".

## Decision

1. **The harness writes the set itself.** A fixture, `harness/sets/au-plugin.als`, is
   `empty.als` with AUDelay's device block on its MIDI track: no plug-in state, no preset
   references, every slot free, pointee ids consistent with `NextPointeeId`. A builder in
   `plugin.js` copies it into a temp folder and fills in the target plug-in's codes and
   names. It then fills the slots from the AU's own `ParameterList` and `ParameterInfo`,
   read by a helper (`harness/au-parameters.swift`): the parameter at index i of the list
   into pair i, as Live does, its default as Live normalizes it as `Manual`
   (`harness/live-notes.md`).
2. **The plug-in is found by name in its component's `Info.plist`** (`AudioComponents`,
   `name` "Maker: Name"), under `~/Library/Audio/Plug-Ins/Components`,
   `/Library/Audio/Plug-Ins/Components` and `/System/Library/Components` (where AUDelay
   is). Only effects count (`aufx`, `aumf`); the builder refuses unless exactly one matches
   and `auval -v` validates it, since Live would load a missing one silently.
3. **Sets open without bringing Live forward.** `openSet` and `relaunch.js` open through
   `NSWorkspace` with activation off. No harness step types into Live to get a plug-in's
   parameters.
4. **`relaunch.js --plugin <name>` starts Live on the built set**, so a check after a
   relaunch finds the plug-in on track 0 with its parameters listed.
5. **`exposePluginParameters` refuses to replace a set the harness didn't make:** it opens
   a built set only if the open set is in the harness's temp folder, checked just before the
   open, because opening answers "Save changes?" with Don't Save, and the LOM can't tell
   whether the user's set has unsaved work.

## Consequences

- Checks on a plug-in run with Live behind other windows, and relaunches no longer take
  focus.
- The opened set holds only the plug-in, and its song is the fixture's (120 BPM). Before
  this, `exposePluginParameters` kept the rest of the open set, tempo included. Checks that
  build their own tracks (`audio.js`) are unaffected; a check that needs a tempo sets it
  after the call.
- A plug-in with no enum parameter can't be told from a stand-in by its value strings; it
  is checked on its parameter count alone.
- The plug-in starts with no saved state, from its own defaults, whatever was loaded
  before. Each parameter's `Manual` value in the file is its default from `ParameterInfo`,
  so Live shows what the plug-in holds.
- The harness compiles its helper with `swiftc` (Xcode or the Command Line Tools) and keeps
  the binary between runs.
- Instruments (`aumu`) are untested and refused until a project needs them. VST3 plug-ins
  are refused too: their parameter IDs need a VST3 host to read.
- A plug-in with more than 128 parameters is refused: the device has 128 pairs of slots.
- The fixture is tied to Live's set format, like `empty.als`.

## Alternatives considered

- **Bring Live forward before each batch of keystrokes and keep typing:** reliable but takes the user's
  focus and leaves a race with their clicks.
- **Post keys to Live's process (`CGEventPostToPid`):** untested. Accessibility sees
  nothing inside the Save panel's Go to Folder sheet, which suggests it is drawn by another
  process the keys wouldn't reach.
- **Raise `-_PluginAutoPopulateThreshold` in Options.txt:** it changes the user's own Live,
  and Live's own population can leave parameters out (`harness/live-notes.md`).
- **A set kept by each project with its plug-in loaded:** a file per project, made with a
  Save As, whose saved state can drift from the build. The fixture needs none of that.
- **Ranges from auval's Values line:** what the builder first did. Its display text can't be
  turned back into raw values, and its order isn't Live's (`harness/live-notes.md`).
- **A project's own plug-in block as the template:** works, but ties the harness to one
  plug-in. AUDelay ships with macOS.
