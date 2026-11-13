---
title: "ADR-0011: Choose a menu item by its text"
status: Accepted
date: 2026-11-13
---

# ADR-0011: Choose a menu item by its text

**Status:** Accepted. Extends ADR-0004 decision 3 to the items of a menu a control opens.

## Context

A menu in a device's panel, such as Auto Filter's LFO waveform, opens a window of its own over
Live's (window layer 101) listing its items. The Info View names the menu, not its items, so a
click on an item has no Info View to confirm it.

## Decision

1. **The menu is pressed as any control,** once the Info View names it.
2. **The item is confirmed by its text.** The harness captures the menu's window, reads its
   items with text recognition, and clicks the one item whose text is the item asked for, in
   the middle of its row. No match, or more than one, closes the menu with Escape and refuses.
3. **The click goes to the menu's window,** with ADR-0004's check that it is topmost at the
   point, and Stop (ADR-0009) is honoured before it.

## Consequences

- Items with the same text in one menu can't be chosen.
- Text recognition misreads some characters (0 and O, 1 and I or l); the harness compares
  them as it does device titles.
