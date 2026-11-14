---
title: "ADR-0012: Show when the harness holds the mouse, and stop it from the pill whatever fails"
status: Accepted; in decision 5, what Stop takes down and when it says that the mouse is free superseded by ADR-0015
date: 2026-11-13
---

# ADR-0012: Show when the harness holds the mouse, and stop it from the pill whatever fails

**Status:** Accepted; in decision 5, what Stop takes down and when it says that the mouse is
free superseded by ADR-0015. Supersedes ADR-0009. Extends ADR-0006.

## Context

The harness's clicks with real mouse events, with the dialog that asks for them (ADR-0004,
ADR-0006, ADR-0008), together are **harness-computer-use**. After Allow, the run may take the
pointer at any moment until it ends, and nothing on screen says whether it still can: the person
at the Mac doesn't know when the mouse is theirs again.

ADR-0009 showed a border for that, with a Stop that sent the run a signal. Three things failed
in use. The helper that posts the mouse events never saw the signal, so a press under way ran
to its end after the notification said the mouse was free. The border's program was built
after Allow, so it showed seconds late, and a border that never showed went unnoticed. And
Stop could fail, leaving a run that still clicked.

## Decision

1. **A purple border around every screen while a run holds the mouse,** a soft glow in from the
   edges that slowly breathes, with a frosted pill at the top naming harness-computer-use and
   the run, from Allow until the run's process ends, then a notification that the mouse is free.
   A program of its own (`computer-use-overlay.swift`) draws it and watches the run's process,
   so it goes also when the run crashes or is killed. The dialog and the notification are titled
   harness-computer-use. The dialog says the glow will show or, when the border's program
   couldn't be built, that nothing on screen will show it and that there will be no Stop.
2. **Only where the run asked.** The click host doesn't ask, and no one watches it.
3. **The click guard skips the border.** Its windows cover the screen above every app and let
   every click through; the check that the window aimed at is topmost at the point (ADR-0004,
   ADR-0008) leaves out windows with the border's title owned by its program, and nothing else.
   The pill is a window of its own that takes clicks, so the guard refuses a point under it.
4. **The border only informs.** The run builds the border's program before it asks, and after
   Allow waits for the border to say its windows are on screen. A run that can't show it (the
   build fails, the program ends, or it says nothing for 5 s) warns and clicks anyway, and so
   does a run whose border goes while the run goes on and wasn't stopped: the person allowed
   the clicks, not the border.
5. **Stop on the pill takes the mouse back, whatever fails.** The run keeps a click token: a
   file that exists while the run may click, in a folder of its own, named to the border and
   to every helper the run starts. Stop removes the token, takes the border down and says the
   mouse is free. The helper posts a mouse event only while it can tell that the run wasn't
   stopped: the token can be read, and its folder can be written to and searched, so that
   Stop can remove it. Anything else counts as stopped: a token that is gone or can't be
   read, a folder that is gone or can't be written to or searched. The run reads the token
   the same way before each press.
   The helper also posts only while the run that started it lives: a run that a signal
   killed leaves its token behind, and the border then says that the mouse is free. If
   the token is still there after Stop tried to remove it, Stop signals the run instead
   (SIGUSR2), also when the run reads as stopped just then, as with a folder that can't be
   written to: what made it so may pass, and the token would let the run click again. On
   that signal the run counts itself stopped, whatever its token says, passes the signal on
   to a helper it has running, which stops as after Stop, and carries on: a check fails at
   the press that throws and still cleans up, over OSC, which needs no pointer. The border
   stays up until the run has ended, by itself or, 10 s after the signal, killed; a killed
   run's helpers stop because their run is gone. Only then does Stop say that the mouse is
   free. Stop has no outcome in which the run still clicks.
6. **A stopped press throws, and says what it had done.** Once the run is stopped the helper
   posts nothing but the release of a button it holds: a press under way stops before its
   hover, before its click or before a drag's move, and a drag stopped before its move ends
   with the button up where the pointer then is, the press point unless the mouse was moved.
   The press under way throws as stopped, and so does every later press of the run. If only
   the release was left, the click or the drag has happened: the press still throws as
   stopped, and its error says that it happened (`done`), so that whatever made the press
   clears up what the click did (ADR-0014). The run isn't killed, unless it outlasts the 10 s
   of decision 5's last resort: a check fails at the press that throws and still runs its
   cleanup, where a kill would leave its tracks in Live. A stopped run takes nothing more from the person: it
   doesn't bring Live to the front either.

## Considered

- **A marker file that Stop creates.** No marker then reads as not stopped, so a folder that
  is gone, a folder that can't be written to and a full disk each leave a Stop without effect,
  unless more checks stand in for the marker. A token that Stop removes fails the other way:
  every loss reads as stopped, and removing a file asks less of the system than creating one.
- **The life of the border's program as the token.** The border only informs (decision 4), so
  a border that dies mustn't stop the run.
- **A signal from the pill as the only way.** It reaches the helper that runs then and no
  later one, unless the run acts on it too, which a run busy in its own code doesn't. It
  stays as the last resort, with a kill behind it.
- **Killing the run at once in the last resort.** A killed run leaves its tracks in Live,
  and its cleanup needs no pointer, so the run is told to stop first and killed only if it
  doesn't end.
- **SIGTERM or SIGINT as the last resort's signal.** A run that handled either would no
  longer end by it, for Ctrl-C and for whatever else sends it. SIGUSR2 has no other meaning
  to the run or to node (SIGUSR1 starts node's debugger), nothing but Stop sends it, and it
  ends a run that doesn't handle it.
- **A shorter or a longer wait before the kill.** It is how long a run that doesn't act on
  the signal can still click, so it is as short as a stopped run's end allows. A press
  gives up its reads of Live's window at once on Stop, but the run's process ends only when
  the read it left running does, measured at 1.8 to 3.4 s after Stop. A stopped
  run otherwise first finishes the step it is in, since it throws at its next click:
  `choose` reads its open menu to the end, which took 2.4 s, and a run stopped as that read
  began ended about 3 s after Stop, the 0.3 s of deleting its tracks included. 5 s left too
  little room for a check with more to undo; 10 s is about three times what was measured.

## Consequences

- The border lasts the whole run, not each click: between clicks the run can take the pointer
  again, so the mouse is free only once the run ends.
- Captures of a window (`screencapture -l`) don't include it; a capture of the whole screen does.
- A window given the border's title by a program whose name starts like the border's would be
  skipped too: the guard stops accidents, as ADR-0006's dialog does, not a program set on
  clicking.
- After a change to the helper or the border, a run's first press builds both before the
  dialog: about 11 s, and 25 s or more with an empty module cache. The border is on screen
  about 1.4 s after Allow.
- A run with no desktop session can't show the dialog either, so it is refused before the
  border matters.
- Stop needs nothing from the run while it can remove the token: the helper reads the token
  itself, so a run busy in its own code is stopped as fast as an idle one. The last resort
  does need the run, to act on the signal: until a run that doesn't is killed, 10 s later, it
  can still click, and the border stays up.
- An event the helper was about to post when Stop came is still posted: the post follows the
  helper's look at the token at once, and nothing orders the two against Stop's removal of
  it. The notification that the mouse is free comes about 0.3 s after the removal.
- A Stop that comes while Live is being activated still finds Live brought to the front: the
  run looks for Stop once more just before it tells Live to activate, not after. The Escape
  that closes a menu after Stop is typed by the script that finds Live in front, in one go.
- A run stops clicking when anything else removes its token or the token's folder: it can't
  tell that it wasn't stopped. Its error says what it found, so for a token that something
  else removed it says, as after Stop, that the run was stopped from its pill.
- A click whose button was down when Stop came completes, since its release is the one event
  still posted, and so does a drag whose move was already posted. A drag stopped before its
  move is a click on the control: the button went down at the press point and came up where
  the pointer then was. Its error doesn't say `done`, since the drag didn't happen.
- A run killed in Stop's last resort leaves its tracks in Live. That includes a run that
  stopped clicking when told to and then went on for more than 10 s.
- A helper outlives its run only to release a button it holds: a press that hadn't reached
  its click when the run was killed doesn't click.
- An interrupt, quit, hangup or termination signal that reaches the helper while it holds the
  button, such as Ctrl-C or Ctrl-\ on the run, is held back until the helper has released the
  button, which it then does at once. It then dies by that signal, except after a quit
  signal, where it exits with status 131: the system writes a crash report for a program
  that dies by one, and a release that went as designed is no crash. A kill (SIGKILL) or a
  crash of the helper still leaves the button held.
