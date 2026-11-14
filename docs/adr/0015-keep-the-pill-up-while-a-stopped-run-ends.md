---
title: "ADR-0015: Keep the pill up, reading Stopping, while a stopped run ends"
status: Accepted
date: 2026-11-14
---

# ADR-0015: Keep the pill up, reading Stopping, while a stopped run ends

**Status:** Accepted. Supersedes, in ADR-0012 decision 5, what Stop takes down and when it
says that the mouse is free.

## Context

Stop on the pill removes the run's click token, and from then on the run clicks no more
(ADR-0012). The border's program then took everything down at once and said that the mouse
was free. The run went on meanwhile: it fails at the press that throws and still cleans up,
and its process ended 1.8 to 3.4 s after Stop. So the pill went while the run was still
winding down, and nothing on screen said when it had ended.

In Stop's last resort, where the token can't be removed and the run is signalled instead,
the border did stay until the run had ended. But its program waited for that on its main
thread, for up to 11 s, so the pill could show nothing of it.

## Decision

1. **After Stop the pill stays, reading Stopping, until the run's process has ended, for
   10 s at most.** On every Stop, not in the last resort alone. Its button reads Stopping in
   place of Stop, a light goes round the button, and pressing it again does nothing. A run
   whose token is gone and that is still running 10 s after Stop is left running: the pill
   goes, and nothing is killed. In the last resort the run still there after its 10 s is
   killed (ADR-0012), and the pill goes once it has ended.
2. **The token still goes first.** Stop removes the token, or in its last resort signals the
   run, before anything on the pill changes: the run stops clicking as fast as it did.
3. **The glow goes once the run can click no more.** At once when the token is gone; in the
   last resort, where the run can click until it has ended, together with the pill.
4. **Stop says that the mouse is free when the pill goes,** in the one notification: that
   the run was stopped, once it has ended, or that it was stopped and is still running,
   when the pill goes without it.
5. **The border's program waits for the run's end without holding up its main thread,** in
   the last resort too: it looks for the run on a timer, so the light keeps moving and the
   program still answers Accessibility, which it didn't while it waited.

## Considered

- **The notification at once, as before, and the pill going quietly later.** A banner that
  says Stopped would show over a pill that reads Stopping.
- **The glow kept up with the pill.** The glow says that the run may take the pointer, which
  a run whose token is gone can't. Its going is also what answers the press on Stop at once.
- **Ending a run that goes on long after Stop.** A run whose token is gone can't click, and
  a kill would leave its tracks in Live (ADR-0012), so only the last resort kills.
- **The pill kept up for as long as the run goes on.** A run that hangs or is suspended
  would keep the pill, its button spent, above every Space for good, and Stopping stops
  being true of a run that carries on with something else.

## Consequences

- The notification that the mouse is free comes when the pill goes, when the run has ended
  or 10 s after Stop, not 0.3 s after the token's removal. Until then the glow's going and
  the pill say that Stop was taken.
- A run that goes on after Stop keeps the pill up, reading Stopping, for 10 s. After that
  nothing on screen shows that it is still running: the notification said so, and the run
  can't click.
- The pill still takes clicks while it reads Stopping, so the click guard still refuses a
  point under it.
