---
title: "ADR-0021: Hold a drag still between two moves"
status: Accepted
date: 2026-11-22
---

# ADR-0021: Hold a drag still between two moves

**Status:** Accepted. Extends ADR-0013 from one move to two with a pause between them, in
Live's window only.

## Context

A drag of ADR-0013 makes one move and releases the button about 50 ms after it. A device's own
view can act on what happens while the button stays down. It may send an edit on every drag
event and commit on the release. A check then has to prove that a drag held still partway,
then moved again before the release, is still one edit (for example, one undo step in Live).
A press of `device-ui.js` takes seconds, so two drags can't make the gesture. The pause and the
second move have to come from the same call of the helper, with the button down throughout
(ADR-0019's reason for a double-click).

## Decision

1. **One call, one gesture.** `ui.drag(name, { up, right }, { hold, then: { up, right } })`:
   the first move, the button held down and the pointer still for `hold` ms, then the move
   `then`, then the release. It passes the same checks before the button goes down as any drag
   (Info View, Stop), and none between the moves. Once the button is down the control has the
   mouse (ADR-0013).
2. **Each move is one drag event, placed from the press point.** The first is at the press
   point plus the first move, and the second at the press point plus both moves. Each carries
   its own move in its delta fields. The events are not placed from where the pointer is when
   the second is posted. A control may move the pointer back (a knob of one of Live's devices
   does). The gesture posted then would depend on the control, and its end couldn't be
   checked before the button goes down. The button comes up where the pointer then is, as in
   ADR-0013.
3. **Bounded before anything moves.** Each move is bounded as a drag of ADR-0013 (whole points,
   at least 1 on its longer axis, at most 400 on either), and both ends must be on screen. The
   hold is in whole ms from 1 to 2000. The hold keeps the person's mouse, and holds of up to
   about a second are what such checks need.
4. **Stop during the hold ends the gesture at once.** The button comes up where the pointer is,
   without waiting out the hold, and there is no second move. The helper exits as a drag that
   had happened (ADR-0012), saying that its first move had and its second hadn't, and the error
   says `done`, since what the first move did happened. An ending signal (an interrupt, quit,
   hangup, or termination signal) during the hold brings the button up too, at once, before the
   helper ends by it. Stop once the second move is posted ends it as any drag stopped after its
   move.

## Consequences

- `harness/checks/pointer-guards.js` covers the gesture's events and the pause between them, its
  refusals, and Stop and an ending signal during the hold.
- A knob of one of Live's own devices counts every drag event from the press point
  (`harness/live-notes.md`), so a held drag turns it by the first move and then again by both.
  The gesture is for views that read where the pointer is, or how far it moved.
- A plug-in's own window (ADR-0008) still takes one-move drags only. There, `drag` refuses
  the option.
