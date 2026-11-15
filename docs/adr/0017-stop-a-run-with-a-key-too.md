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
   Stop on its pill: the press goes to the pill's button through the button's own action, so
   it does all that Stop does, in the same order. The token goes first; in Stop's last resort
   the run is signalled first. Then the pill reads Stopping, with the same cap and last resort
   (ADR-0012, ADR-0015). Once Stop is pressed, by the key or on the pill, the key does nothing
   more, as a press on Stopping does nothing.
2. **The border's program claims it, with no permission.** It registers a system hot key
   (`RegisterEventHotKey`) once the pill is made, before its windows show, and holds it until
   it ends. The key then goes to it and to no app: Live doesn't get it while a run shows its
   pill, and gets it again once the border's program has ended.
3. **The key is a choice, not a constraint.** One constant in `computer-use-overlay.swift`
   holds its key code and modifiers. The words the dialog uses and the hint on the pill are
   made from that constant, and so is the key that `checks/pointer-guards.js` presses. It is
   Space, which is in one place on every keyboard layout, with three modifiers that nothing
   in Live's shortcut list uses together. The harness never types Control, so it can't
   press the key itself (see Consequences).
4. **The pill and the dialog name it.** The pill shows ⌃⌥⌘Space, dim, before its Stop button.
   When the border was built, the dialog that asks for the clicks (ADR-0006) says that Stop on
   the pill, or the key, takes the mouse back. When it wasn't, the dialog says that there will
   be no Stop and no stop key.
5. **A key that can't be claimed only goes without saying so on the pill.** The pill then
   leaves its hint out, and the run warns and clicks on: Stop on the pill still stops it.

## Considered

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
- A key claimed by two programs went to both, with no error to either; claimed against
  Spotlight's ⌘Space, it went to the program and Spotlight opened too. So a clash with
  another app's shortcut can't be found: the other app's action happens as well. And one
  press stops every run on the Mac that shows a pill.
- A claimed plain Escape (key code 53) caught an Escape posted with no modifiers.

Not proven:

- A press on a real keyboard. Posted events take the same path through the window server,
  but only posted ones were tried.
- Live in front. Hot keys are taken before an event goes to any app, so the stand-in's result
  should hold for Live, but that wasn't tried.
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
