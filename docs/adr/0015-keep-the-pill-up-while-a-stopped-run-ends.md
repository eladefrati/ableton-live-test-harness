---
title: "ADR-0015: Keep the pill up, reading Stopping, while a stopped run ends"
status: Accepted; extended by ADR-0017
date: 2026-11-14
---

# ADR-0015: Keep the pill up, reading Stopping, while a stopped run ends

**Status:** Accepted. Extended by ADR-0017. Supersedes, in ADR-0012 decision 5, what Stop
takes down and when it says that the mouse is free.

## Context

Stop on the pill removes the run's click token, and from then on the run clicks no more
(ADR-0012). The overlay then took everything down at once and said that the mouse was free.
The run went on meanwhile. It fails at the press that throws and still cleans up, and its
process ended 1.8 to 3.4 s after Stop. So the pill closed before the run had ended, and
nothing on screen said when it ended.

In Stop's last resort, where the token can't be removed and the run is signalled instead,
the border did stay until the run had ended. But the overlay waited for that on its main
thread, for up to 11 s, so the pill could show nothing of the wait.

## Decision

1. **After Stop the pill stays, reading Stopping, while the run ends, for 10 s at most when
   the token is gone.** It does so on every Stop, not in the last resort alone. Its button
   reads Stopping in place of Stop, a light goes round the button, and pressing it again does
   nothing. A run whose token is gone and that is still running 10 s after Stop is left
   running. The pill closes, and nothing is killed. In the last resort, the run still there
   after its 10 s is killed (ADR-0012), and the pill closes once the run has ended, a second
   later at most.
2. **The token is still removed first.** Stop removes the token, or in its last resort
   signals the run, before anything on the pill changes, so the run stops clicking as fast as
   it did.
3. **The glow closes once the run can click no more.** It closes at once when the token is
   gone. In the last resort, where the run can click until it has ended, it closes together
   with the pill.
4. **Stop says that the mouse is free when the pill closes,** in the one notification. The
   notification says that the run was stopped, once it has ended. It says that the run was
   stopped and is still running, when the pill closes before the run has ended. After the
   last resort's kill, it says that the run was ended (ADR-0012).
5. **The overlay waits for the run's end without holding up its main thread,** in the last
   resort too. It looks for the run on a timer, so the light keeps moving and the overlay
   still answers Accessibility. It didn't answer Accessibility while it waited.

## Alternatives considered

- **The notification at once, as before, and the pill closing quietly later.** A banner that
  says Stopped would show over a pill that reads Stopping.
- **The glow kept up with the pill.** The glow says that the run may take the pointer, and
  a run whose token is gone can't take it. The glow closing at once is also what shows that
  Stop was pressed.
- **Ending a run that goes on long after Stop.** A run whose token is gone can't click, and
  a kill would leave its tracks in Live (ADR-0012), so only the last resort kills.
- **The pill kept up for as long as the run goes on.** A run that hangs or is suspended
  would keep the pill, its button doing nothing, above every Space permanently. Stopping also
  stops being true of a run that carries on with something else.

## Consequences

- The notification that the mouse is free comes when the pill closes, when the run has ended
  or 10 s after Stop, not 0.3 s after the token's removal. Until then, the glow closing and
  the pill show that Stop was taken.
- A run that goes on after Stop keeps the pill up, reading Stopping, for 10 s. After that
  nothing on screen shows that it is still running. The notification said so, and the run
  can't click.
- The pill still takes clicks while it reads Stopping, so the click guard still refuses a
  point under it.
