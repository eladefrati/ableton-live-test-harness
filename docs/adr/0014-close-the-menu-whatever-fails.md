---
title: "ADR-0014: Choose a menu item by its text, and close the menu whatever fails"
status: Accepted; extended by ADR-0017
date: 2026-11-13
---

# ADR-0014: Choose a menu item by its text, and close the menu whatever fails

**Status:** Accepted. Extended by ADR-0017. Supersedes ADR-0011. Extends ADR-0004 decision 3 to the items of a menu
a control opens.

## Context

A menu in a device's panel, such as Auto Filter's LFO waveform, opens a window of its own over
Live's (window layer 101) listing its items. The Info View names the menu, not its items, so a
click on an item has no Info View to confirm it.

ADR-0011 closed the menu only when no item, or more than one, matched. Any other failure after
the menu opened left it open over Live, and so did Stop (ADR-0012). It also said nothing of
the icon some rows start with, which text recognition reads as a word before the row's text,
or not at all.

## Decision

1. **The menu is pressed as any control,** once the Info View names it.
2. **The item is confirmed by its text.** The harness captures the menu's window, reads its
   items with text recognition, and clicks the one item whose text is the item asked for, in
   the middle of its row. A row's text is taken from the column the menu's rows start their
   texts in, the left edge most rows have a word at. A word left of it is left out as the
   row's icon, whatever it reads, and the start of a row's own text never is.
3. **The click goes to the menu's window,** with ADR-0004's check that it is topmost at the
   point, and Stop (ADR-0012) is honoured before it.
4. **Whatever fails once the menu's control was clicked, the menu is closed with Escape,** and
   nothing more is clicked: no match or more than one, a menu that didn't open, a failed
   click, Stop. That holds too when Stop caught the click that opened the menu with only its
   release left. The click happened, its press throws as stopped (ADR-0012 decision 6), and
   the menu it opened is closed. When Stop caught the click on the item that way, the item
   was chosen and the menu has closed by itself, so nothing is typed. After Stop the Escape
   is typed only while Live is still in front, and Live isn't brought there. A stopped run
   takes nothing more from the person, the front included.

## Consequences

- Items with the same text in one menu can't be chosen.
- A menu whose rows don't start their texts in one column is matched by its rows' whole text
  only.
- Text recognition misreads some characters (0 and O, 1 and I or l); the harness compares
  them as it does device titles.
- After Stop, a menu stays open if the person has already brought another app to the front.
