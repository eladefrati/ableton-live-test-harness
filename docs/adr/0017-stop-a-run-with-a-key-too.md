---
title: "ADR-0017: Stop a run with a key too"
status: Accepted
date: 2026-11-15
---

# ADR-0017: Stop a run with a key too

**Status:** Accepted. Extends ADR-0012 and ADR-0015.

## Context

Stop on the pill takes the mouse back from a run of harness-computer-use (ADR-0012, ADR-0015).
But the run and the person share one pointer: while a gesture is under way the run holds it,
so reaching Stop means competing with the run for the pointer. A key needs no pointer.

## Decision

1. **A key presses Stop.** While the border's program runs, Control-Option-Command-Space is
   Stop on its pill: the press is sent as the pill's button sends a click, through its action
   to its target, so it does all that Stop does, in the same order. The token goes first; in
   Stop's last resort the run is signalled first. Then the pill reads Stopping, with the same cap and last resort
   (ADR-0012, ADR-0015). Once Stop is pressed, by the key or on the pill, the key does nothing
   more, as a press on Stopping does nothing.
2. **The border's program claims it, exclusively, with no permission.** It registers a
   system hot key (`RegisterEventHotKey`, exclusive) once the pill is made, before its
   windows show, and holds it until it ends, giving it up first as it does. The key then goes
   to it and to no app or other program: Live doesn't get it while a run shows its pill, and
   gets it again once the border's program has ended. A program that holds the key
   exclusively already, as another run's border does, keeps it, and the claim fails; one that
   holds it the ordinary way doesn't stop the claim, and gets no press while the border's
   program holds the key. A program that tries to register the key while a run shows
   its pill fails, and one that registers it only once, as it starts, stays without it after
   the run.
3. **The key is a choice, not a constraint.** One constant in `computer-use-overlay.swift`
   holds its key code and modifiers. The words the dialog uses and the hint on the pill are
   made from that constant, and so is the key that `checks/pointer-guards.js` presses. It is
   Space, which is in one place on every keyboard layout, with three modifiers that nothing
   in Live's shortcut list uses together. The harness never types Control, so it can't
   press the key itself (see Consequences).
4. **The pill and the dialog name it.** The pill shows ⌃⌥⌘Space, dim, before its Stop button.
   When the border was built, the dialog that asks for the clicks (ADR-0006) says that Stop on
   the pill, or the key the pill shows, takes the mouse back, and names the key. The dialog
   comes before the key is claimed, so it doesn't promise it: a pill whose key couldn't be
   claimed shows none. When it wasn't, the dialog says that there will
   be no Stop and no stop key.
5. **A key that can't be claimed only goes without saying so on the pill.** The pill then
   leaves its hint out, and the run warns and clicks on: Stop on the pill still stops it. So
   it is for a second run on the Mac while a first shows its pill: one press stops the first
   run only.

## Considered

- **A shared claim.** Without the exclusive option a key claimed by two programs goes to
  both, with no error to either: another program's action on the key would happen with
  every Stop, a second run's pill would stop with the first's, and neither could be told.

- **A global key monitor, an event tap or the keyboard's raw input.** Each needs
  Accessibility or Input Monitoring for the border's program. The program is built again
  under a new name after every change to it, so a grant wouldn't last. A monitor also passes
  the key on to Live.
- **The pill taking keys.** It would take the front from Live, which every click needs in
  front (ADR-0004).
- **Escape.** The harness types it to close a menu, and a claimed Escape catches the one it
  types: the run would stop itself and leave the menu open. It is also Live's key for closing
  a window and cancelling an entry. Escape with modifiers is next to Force Quit (⌘⌥Esc).
- **Period, or a letter.** Each moves between keyboard layouts, so the hint would name a key
  that some keyboards don't have in that place.

## Consequences

Probed on the remote Mac (macOS 26), with a stand-in app in front and keys posted as events
(`CGEvent`):

- The key reached the program that registered it whether its modifiers were posted as their
  own key presses or only as flags of the key, and the app in front got the modifiers but not
  the key. Once that program had ended, the app in front got the key.
- It worked with a mouse button held down in the front app's window, the button-up still
  coming after, and with secure input on in the front app.
- Claimed without the exclusive option, a key claimed by two programs went to both, with no
  error to either; claimed against Spotlight's ⌘Space, it went to the program and Spotlight
  opened too. Spotlight's key is one of macOS's own shortcuts, not a hot key a program
  registers, and the exclusive option isn't expected to keep it out; that wasn't tried.
- A claimed plain Escape (key code 53) caught an Escape posted with no modifiers.
- With Live in front, the key stopped a run as Stop on the pill does, and once the border's
  program had gone it didn't start Live's transport (live-notes.md).
- With a program holding the key the ordinary way, the border's program still claimed it,
  and a press went to the border's program alone; with another border's program holding it,
  the claim failed (live-notes.md).

Not proven:

- A press on a real keyboard. Posted events take the same path through the window server,
  but only posted ones were tried.
- That System Events, as the harness types Escape, posts it as the probe did, and so would be
  caught by a claimed Escape.
- macOS's default shortcuts: only the remote Mac's settings were read, where nothing else
  answered the key.

Also:

- What the harness types was read from its code, every System Events `keystroke` and
  `key code` line: Escape, Return, ⌘A, ⌘⇧G, a set's name and a folder's path. Only ⌘A and
  ⌘⇧G carry modifiers. Text should be typed with at most the modifiers a character needs on
  the keyboard layout, which never include Control; that wasn't tried.
- A run with no border has no key either: the key belongs to the border's program.
- A person reaches the key with its modifiers held first, and the run's clicks carry
  whatever modifiers are held as they are posted: on the remote Mac a click the helper
  posted 200 ms into a 1 s hold of Control, Option and Command carried all three, on its
  button-down and button-up, where one with nothing held carried none. So a click already
  in flight when the key is pressed can reach Live as a Control-Option-Command click, and
  its release will, whenever the key comes while the helper holds the button: Live may take
  it as another gesture, a Control-click opening a context menu. Clearing the modifiers on
  the helper's events was tried: the events carried none, but the system then read the
  modifiers as let go, for every app (live-notes.md). With keys held on a real keyboard,
  tried once for events made from the HID system state and posted at the HID tap, even the
  HID system table read them let go, for at least 1 s while they were held; a private
  event source and the session tap were tried only with modifiers held by posted key
  events. The helper builds its events as
  before; that cost stands. The Escape that closes a menu after Stop
  (ADR-0014), which the person may still be holding the modifiers for, waits until none is
  held, for 2 s at most. If one still is, it isn't typed, and the run warns that the menu may
  stay open: a modified Escape may be another shortcut, Option-Command-Escape being Force
  Quit. If the modifiers can't be read, it is typed, with a warning.
