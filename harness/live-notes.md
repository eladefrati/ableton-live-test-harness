# Notes from Live

How Live behaves under the harness, found by running it. Read this when Live does something
unexpected.

## Dialogs

- Live's dialogs show over the LOM while open (`open_dialog_count`, message, button count)
  and OSC keeps working, but their buttons have no names there or over Accessibility. In
  "Save changes to ... before closing?" the buttons are 0 Don't Save, 1 Cancel, 2 Save. In
  "Would you like to delete the temporary files in .../<time> Temp Project?", asked after
  it on quitting a set never saved that recorded audio, they are 0 leave them, 1 Cancel, 2
  Delete. "This action will stop audio. Proceed?" (0 Cancel, 1 OK) comes when a set is
  opened while the transport plays and the open set has no unsaved changes; stopped, Live
  doesn't ask.
- A dialog is a window of its own, with no title: with "Save changes?" open, `cli.js
  windows` listed it (405 x 123 points) in front of two full-size windows, one untitled and
  one with the set's name. `cli.js capture --window <id>` captured it with its message and
  buttons; the main window's capture doesn't show it (Live 12.4.25b1, 2026-11-11).
- After a kill, Live starts at "Live unexpectedly quit... Would you like to recover your
  work?" (No, Yes). It isn't a LOM dialog, takes keys only with Live frontmost, and Escape
  doesn't answer it. Live asks while its recovery data (`CrashRecoveryInfo.cfg`, `Undo`,
  `BaseFiles` in its preferences folder) is there; `CrashDetection.cfg`, which reads
  "Running" while Live runs and is gone after a clean quit, doesn't decide it. With the
  data moved into `Crash`, Live starts with a new set and doesn't ask. `open -a` fails with
  error -600 for a few seconds after a kill.
- While Live starts, AbletonOSC can answer while the LOM still reports a dialog with no
  message; it is gone a second later.
- After File > New Live Set (`clickMenu`) with unsaved changes, the LOM can't read or press
  Live's "Save changes?" dialog: it reports no message and no buttons. `saveSetAs` into a
  temp folder first. `openSetAndWait`'s path (opening a file) does get the message.

## Saving and opening sets

- Live's Save panel counts as an open dialog over the LOM (no message, no buttons), and
  some requests fail while it is open (a fresh track's input routing reads ""). `saveSetAs()`
  closes the panel with Escape if it fails, and says so in its error if the panel stays
  open: Accessibility can't press its Cancel.
- A click in another app just after File > Save Live Set As... can bring that app forward
  after Live has come to the front (measured 2026-11-20: 200 ms after the click, the other
  app was in front once `activate` had seen Live there). Keys typed then go to that app, and
  a save failed so, waiting for Go to Folder. `typeInLive` looks for Live in front in the
  script that types.
- With the app that was in front put back right after File > Save Live Set As... and Live
  brought forward again to type, the panel lost the typed name and folder in about one run
  of three, though it took Command-A, Go to Folder and Return (2026-11-20). `saveSetAs`
  keeps Live in front from the click until the file is written.
- Live's Save panel takes keys about a second after it appears, and Go to Folder's
  highlighted suggestion lags the typed path: Return half a second after typing went to
  the previous temp folder. `saveSetAs` waits for both. Go to Folder lists the folder that
  holds the typed one, and with 15,857 entries there (the system temp folder) it was still
  "Loading..." when Return was pressed, which was lost: `saveSetAs` presses Return again
  until the sheet closes, and saves into a folder under the harness's own small
  `ableton-harness/`. Accessibility shows only that the sheet is open, nothing in it. With
  Live's windows on another Space, Live comes to the front without them: Accessibility
  lists no windows and `saveSetAs` can't find or close its panel. Keep Live on the Space the harness runs on.
- AbletonOSC keeps running across opening another set.
- `relaunch.js` and `quit.js` empty the harness's temp folder, where every set the harness
  saves or starts Live on is, while they hold UDP 11001, the port a check holds while it
  runs. So `quit.js` refuses while another client runs, also when Live isn't running.
- A new Live writes one `Temp Project` folder in `~/Music/Ableton/Live Recordings`, named
  for a time some seconds after it started, and records into it a set never saved or one
  saved outside a Live project (a lone `.als`). Quitting asks about deleting it only for a
  set never saved.

## Menus and windows

- Live updates its menus' check marks about a second after a change; `setToggle()` waits.
- Edit > Undo names a change made over OSC "Custom Action"; the same change made in the UI
  gets its own name (a track rename: "Track Name"). Checks of undo step names must make
  the change in the UI.
- `macos.js` addresses Live's process as "Live", which Suite and Beta share: run one Live at
  a time.
- Live and Max take posted mouse events (`CGEvent`, HID tap) like a real mouse. Over a
  transparent `live.tab` above a `v8ui` with `ignoreclick`, both the Info View and the click
  reach the tab (on the remote Mac, 2026-11-08). The Info View's title is on the same row as
  the device titles, and it changes when the pointer moves.
- Over a knob of one of Live's own devices the Info View names the parameter, not always as
  the LOM does: Auto Filter's Frequency knob reads "Filter Frequency", and its Rate knob
  "LFO Frequency" while the LFO's rate is in Hz. A click on a knob, with no drag, leaves its
  value alone; on Auto Filter's LFO or envelope knobs it switches the display's strip to
  that section (remote Mac, Live 12.4.25b1, 2026-11-11).
- A chooser in a device's panel (Auto Filter's LFO Wave) opens its menu as a window of its
  own over Live's, at window layer 101 (88 x 122 points), its rows read by text recognition
  with each icon as a word before the row's text ("w Wander"). In 8 captures the same icon
  read differently from one to the next ("/" and "N"; "^", "A" and "•"), and one row's
  wasn't read in 3. The icons' words began 4 to 8 points from the menu's left edge, once 18,
  and the rows' texts 22 to 24. `choose` takes a row's text from the column the texts begin
  in, so "H" doesn't match the row read "JF S& H", with its icon or without. The Info View
  names the chooser ("LFO Waveform"), not the rows. Over Auto Filter's filter display, its frequency dot included, the
  Info View reads only "Device" (remote Mac, Live 12.4.25b1, 2026-11-13).
- After Escape closed a menu, the Info View stayed blank while the pointer moved within the
  control that had opened it (3 points); moved onto it from 15 points away, it named it again.
  `device-ui.swift`'s hover starts 15 points left of the point and 10 above it, 18 points
  away (remote Mac, Live 12.4.25b1, 2026-11-13).
- Posted drags turn controls like the mouse (ADR-0013). A knob of one of Live's own devices
  has 126 steps over its range and turns one step per point the pointer moves up, starting
  from the nearest step: from 0.5, 62 points up gave 0.9921 and 63 gave 1.0, and from 0, 126
  gave 1.0 (Auto Filter's Frequency, Resonance and Dry/Wet). The knob reads one thing from a
  drag event, its position in whole points against the point where the button went down:
  for every drag event it adds the vertical part of that distance to the value and, when
  the event has a vertical part, moves the pointer back to the press point (it did after
  none of the 20 events of a drag to the right). It reads neither the delta fields (10
  events at the press point, each with a delta of 1 up, turned nothing, and a path turned
  the same with its delta fields zeroed) nor the sideways part (20 right turned nothing). A
  half point rounds toward the bottom of the screen: from a press point ending in .5, 0.4 of
  a point up turned a whole step, so a drag is given in whole points and a fraction is
  refused (remote Mac, Live 12.4.25b1, 2026-11-13).
- So a path of drag events, each measured from the press point, over-turns Live's knob: 10
  up as 10 events a point apart turned 1 + 2 + ... + 10 = 55 steps, and 60 left and 10 up, as
  60 events, turned it from 0.5 to the top. That is how 40 points had taken Frequency to the
  ends of its range. One drag event at the end turned the knob by the distance: 10 up 10
  steps, 60 left and 10 up 10 steps, 40 up 40 steps. `device-ui.swift` posts that one event,
  with the whole distance in its delta fields, and releases the button where the pointer
  then is: the press point on Live's knob after a move with a vertical part, the end after
  any other and on the controls below (remote Mac, Live 12.4.25b1, 2026-11-13).
- Controls that read where the pointer is ended at the same value for a path and for one
  event: a JUCE editor's horizontal slider (100 left took it from 1.0 to 0.3388, with 30 up
  too), the Dry/Wet Mix slider of AUDelay's editor (10 right, 0.5 to 0.7145) and a Max for
  Live device's number box (10 down, 16 % down). None of them read the delta fields or moved
  the pointer during the drag (remote Mac, Live 12.4.25b1, 2026-11-13).
- A Max for Live number box (`live.numbox`, -100 to 100 %) turns in 2-point steps, however
  the drag is posted: 10, 20, 30 and 40 points turned it 16, 31, 47 and 63 % either way, but
  5 points 9 or 10 % down and 6 or 7 % up, and 15 points 25 or 26 % down and 22 % up. A drag
  of 3 points moved it neither way, which the 2-point steps don't explain; why is unknown.
  Pressing at a fraction of a point (0, 0.25, 0.49, 0.51, 0.75) gave the same change for a
  10-point drag (remote Mac, Live 12.4.25b1, 2026-11-13). A check drags a number box by a
  multiple of 10 points, the distances measured to turn it the same either way; shorter
  even distances were not measured.
- A drag too short to move the pointer (`0 -1e-15`) crashed the helper after the button went
  down and left it held. A drag under 1 point on its longer axis is now refused (remote Mac,
  2026-11-13).
- A held drag (ADR-0021) keeps the button down and posts nothing for its hold, then a second
  drag event at the press point plus both moves. Its second move is refused as any drag's
  move is, and so is a hold that isn't whole ms from 1 to 2000, before the pointer moves.
  Stop or an ending signal during the hold brings the button up at once, not at the hold's
  end: the helper looks for both every 10 ms while it holds.
- A helper ended by SIGTERM or SIGQUIT while a drag held the button left it held.
  `device-ui.swift` now holds SIGINT, SIGQUIT, SIGTERM and SIGHUP back while the button is
  down: it posts the button up where the pointer is, then dies by that signal. A helper that
  fails with the button down releases it the same way before it exits. A crash or SIGKILL
  still leaves the button held. macOS writes a crash report for a helper that dies by
  SIGQUIT (`device-ui-<hash>-<time>.ips` in `~/Library/Logs/DiagnosticReports`): a run of
  `checks/pointer-guards.js` left one. After a SIGQUIT it held back the helper now exits
  with status 131 instead, and a run of the check left none (remote Mac, 2026-11-13).
- While a Max device's Map button waits for a target, the Info View still names the knob
  under the pointer on a device on another track, and the click makes the mapping: Auto
  Filter's Frequency, Dry/Wet and Resonance, with `settleMs` 1000 (remote Mac, 2026-11-11).
  Not tried with both devices on one track.
- The browser and the Info View can show a device's name in the same window as its title
  bar, left of 240 points.
- The status bar, along the bottom of Live's window, shows the selected track's name and the
  selected device's, right-aligned, and a short device name ("Device-dev") was read there as
  a second title (Live 12.4.25b2, on the remote Mac, 2026-11-19). The status bar is the bottom
  37 points of the window.
- Live draws a hand right after the title of the device a Control Surface controls. The
  text reader's first read of a device's title had no hand; every read after a press read
  "Device 2030.11.08.1" as ") Device 2030.11.08.1\", the hand on the end of the last word,
  every time (remote Mac, 2026-11-19). The cause is not known: `DeviceUi.locate()` selects
  the device over OSC before every read, the first too, so selecting it is not what changed.
  The likely source, unverified: AbletonOSC's `Manager` subclasses
  `ableton.v2.control_surface.ControlSurface`, which sets up a device provider, and the
  names in Live 12's compiled `device_provider.pyc` (`_appoint_device_from_song`,
  `__on_selected_device_changed`) suggest it appoints the selected device.
- Live cuts a title too long for its device short with an ellipsis: a folded AUDelay's title
  bar reads "AUD..."; unfolded, the device is wider and it reads "AUDelay" (remote Mac,
  2026-11-11).
- Where the text recognizer puts the start of a device's title is off by up to a few points,
  by the title and by where the device is: from its title's reading, the same Utility's panel
  corner came out 2.0 points right of its body's edge in Live's window as the first device on
  a track and 0.7 points left as the second, and Erosion's 0.1 left; Erosion's title read 2.2
  points left of where Accessibility puts its text (2 pixels per point, Live 12.4.25b2,
  2026-11-21); and a Max device's panel was captured 2 points in from where it was expected
  (remote Mac). Accessibility's frame of the device's
  group in Device Detail doesn't move with the title: in Live's window the device's body
  starts 1 point right of it and 18 below, for Erosion, Utility, Auto Filter and Saturator in
  a row, for the plug-in AUDelay and for the Max device Max Audio Effect alike, also after
  Device Detail scrolled to another device, and the title's text 4 points below its top. A Max
  device's presentation starts 2 points right of its body: Example Transpose's number box,
  at 8, 8 in the patch, was drawn from 2 points right of where the body's edge put it, and
  exactly at 8 points down (remote Mac). The first device on a track had a 2-point dark
  outline left of its body there, and none on the local Mac. `device-ui.js` finds the panel
  from that frame (ADR-0020).
- A plug-in's title bar has two more buttons before its title than a Max or Live device's:
  Unfold Device Parameters and the one that opens the plug-in's window, 32 points in all. Over
  AUDelay's controls the Info View reads "Device Activator", "Unfold Device Parameters" and
  "Assignable X-Y Control", and a click on the activator turns Device On off (remote Mac,
  2026-11-11). The plug-in's own window is reached apart from the device view: below.
- Live 12.4 names much of its main window over Accessibility, unlike its dialogs: the
  Control Bar's controls, the browser's lists, and in Device Detail one group per device of
  the selected track, titled with the device's name and holding its title-bar buttons, a
  plug-in's "Show/Hide Plug-In Window" checkbox among them (value 1 while the window is
  open). The checkbox takes AXPress, which opens and closes the window as a click does, with
  Live in the background too (remote Mac, Live 12.4.25b1, 2026-11-13).
- A plug-in's own window is titled `<device>/<track>` ("Plugin/1-MIDI"), floats at window
  layer 3, and holds Live's 19-point title bar above the plug-in's editor, which
  Accessibility shows as the window's one group, with the editor's frame. It is off screen,
  though open, while Live is in the background and while the display sleeps; it returns
  when Live comes to the front with the display on. A click posted while it was hidden went
  to Live's main window under it, a row of the browser (remote Mac, Live 12.4.25b1,
  2026-11-13): `device-ui.swift` checks the window is topmost at the point just before
  the click, and again after the hover.
- A click on a JUCE plug-in's editor goes in at once, with Live's main window the key one:
  one click on a generic editor's toggle turned its parameter on, a second off, read back
  over the LOM; on the main Mac, clicks on three keys of a custom editor's segmented control
  each set its choice parameter to the key clicked. Accessibility showed the generic editor's slider and toggle without their
  labels, so it can't confirm the control under the pointer as the Info View does in the
  device view (ADR-0008); a plug-in's own components name themselves only if the plug-in
  gives them names (not tried).
- A plug-in's own window floats over Live's main window, at window layer 3, where a check of
  the normal (layer 0) windows doesn't see it: a click aimed at the device view under it would
  go to the plug-in. `device-ui.swift` refuses a click unless the window aimed at is topmost
  among the windows of every layer below the cursor's (remote Mac, Live 12.4.25b1, 2026-11-13).
  The one exception is harness-computer-use's purple border (ADR-0012), at the screen-saver
  layer (1000) over every app, which lets clicks through. macOS reports its program's name cut
  short to 32 characters, so the guard matches the start of it with the border's title.
  A click's hover takes about 240 ms, and a window shown over the point in that time took the
  click, so every click and drag checks again after its hover, before the button goes down
  (remote Mac, 2026-11-13). A window that reports no layer counts among them, as a normal
  window (layer 0): the guard had taken it for one at the cursor's layer and left it out, so
  that one over the point would have gone unseen. No window was seen to report no layer, and
  none could be made to (not reproduced).
- Live shows a plug-in's window only while the plug-in's track is selected: with two tracks
  of one name, each with AUDelay, opening the second's window, which selects its track, left
  one window of that title on screen, and the click guard, finding one, clicked; once that
  track was deleted, the first's window wasn't on screen either (remote Mac, Live 12.4.25b1,
  2026-11-14). So two windows of one title, which the guard refuses, can't be put on screen
  by the harness, which opens a window only for a device whose name is the only one on its
  track. AUDelay's window is 484 x 274 points, with its editor, 444 x 80, at the bottom, 194
  points below the window's top. Moved to the screen's top through Accessibility, the window
  stopped below the menu bar, 30 points down: the editor can't come under
  harness-computer-use's pill.
- While a notification banner shows, from any app, Notification Center holds a transparent
  window the size of the screen at layer 21, gone about 4 s after the banner appeared; the
  click guard read it as covering the point and refused (main Mac, macOS 26, 2026-11-13). The
  guard now waits up to 10 s for it to go before it checks the point, and refuses after that.
  harness-computer-use's own notification at the end of a run brings it up too. A helper
  waiting for it to go leaves the wait once the run is stopped, posting nothing: stopped 1 s
  into the wait it exited 0.12 s later, and left alone it waited 4.9 s and clicked (remote
  Mac, 2026-11-13). `checks/pointer-target.swift` reports its window only once no cover is
  up, so that a case of the check doesn't start under the banner of the case before. On the
  remote Mac the cover went 5.3 s after a notification was posted (one run), and a second
  notification, started 2.5 to 4.5 s after the first, kept it up with no gap until 5.3 to
  5.4 s after the second was posted, in 5 of 5 (the window list read every 20 ms, the
  display kept on; macOS 26, 2026-11-14).
- harness-computer-use's pill is a window of its own (title "harness-computer-use pill"), a
  non-activating panel that takes a click on its Stop without taking the front. Unlike the
  glow, the click guard doesn't skip it: a point under the pill is refused, with an error
  that names the pill.
- Stop on the pill removes the run's click token, a file `device-ui.swift` must be able to
  open for reading, in a folder it must be able to write to, before every mouse event it
  posts but a button-up (ADR-0012). A helper started after Stop posted
  nothing, and one stopped while a drag held the button, before its move, posted the button
  up at the press point and no drag event: each exited with status 3. One stopped while a
  click held the button posted the button up, so the click happened, and one stopped after
  its drag's move did too, so the drag happened: with only the release left, each exited
  with status 4, saying that the click or the drag had happened, its button-up reaching the
  check's window 73 to 81 ms after the token was removed in the click, 52 to 70 ms in the
  drag, in three runs (`checks/pointer-guards.js`, remote Mac, 2026-11-13). That press
  throws with `done` on its error, and the run's next press throws too.
- Any other loss of the token counts as stopped, since the helper can't tell that the run
  wasn't. With the token's folder removed, with the folder made unwritable (mode 500, where
  Stop couldn't remove the token) and with the token unreadable (mode 000), a helper started
  then posted nothing and exited with status 3, saying which it was. One waiting under a
  notification's cover left the wait 0.12 s after the folder was removed, and 0.18 s after
  it was made unwritable (`checks/pointer-guards.js`, remote Mac, 2026-11-13).
- Stop pressed on the pill through Accessibility (AXPress on its Stop button, as
  `checks/press-stop.swift` does) was taken as a click on it: the overlay removed the token,
  said Stopped 0.09 s after the press was started and was gone 0.3 s later, once its
  notification was posted. The press itself returned -25204 (cannot complete) in 2 of 2, as
  the overlay ended before it answered (remote Mac, macOS 26, 2026-11-13). While the
  overlay waited for a run that ignored the signal of its last resort, below, the press
  returned 1.6 s after it was started, the overlay still up, in 5 of 5, with -25204 the
  once that was read (remote Mac, macOS 26, 2026-11-14).
- With the token's folder unwritable (mode 500), where Stop couldn't remove the token, the
  overlay said Stopped all the same, the run reading as stopped just then (remote Mac,
  macOS 26, 2026-11-13). It said so 0.07 s after the press was started and left the token
  and the run in place, where the token would let the run click again once the folder
  could be written to. Stop now goes by whether the token went, removed by it or gone
  already, with its folder or without, not by whether the run can read it: a token still
  there takes Stop's last resort, below.
- A real click posted on the pill's Stop, the button down and up as mouse events at its
  place, stops the run as the Accessibility press does: the token went 5 and 15 ms after
  the button came up, and a press that waited under a notification's cover threw 208 and
  251 ms after that, with no mouse event of the helper's after (remote Mac, Live 12.4.25b1,
  2026-11-13).
- Stop pressed on the pill through Accessibility removed the token 71 to 123 ms after the
  press was started, in 20 presses: longer than a click's 70 ms hold, so a press started
  when the button goes down finds the click over. For a press that lands inside a gesture,
  the check's window suspends the helper (SIGSTOP) at one of its events, and the check lets
  it go on (SIGCONT) once the token is gone, which it did within 5 ms. Suspended at the
  first move of a click's hover, the helper posted nothing more and had exited with status
  3 by 11 to 14 ms after the token went, once the 120 ms pause it was suspended in had run
  out: a sleep runs on while its process is suspended, and isn't cut short when the process
  is let go on (a 2 s `usleep` in perl, suspended for 0.2 s, took 2.00 s in 3 of 3; one of
  0.3 s, suspended past its end, returned when let go on). That first move is slow to
  arrive: a hover's two moves, posted 120 ms apart, reached the window 84 to 113 ms apart
  in 20 hovers. Suspended with a click's button down, it posted the button up, which
  reached the window 9 to 19 ms after the token went, and exited with status 4. Suspended
  with a drag's button down, before its move, it posted the button up at the press point,
  which reached the window 3 to 18 ms after the token went, and no drag event, and exited
  with status 3. The overlay said Stopped 2 to 18 ms after the token went. When the token
  went is its folder's modification time: the check's window, which takes the time just
  after it removes a token itself, read 0.02 to 0.13 ms later than that time, in 12 of 12.
  Four runs (`checks/pointer-guards.js`, remote Mac, macOS 26, 2026-11-14).
- Ctrl-C typed into the terminal of a run (a pty) while its helper held the button reached
  the helper as SIGINT: the button came up 6 ms after it in a click, and 15 ms in a drag,
  before the drag's move. In the drag, where the run caught the signal and went on, the
  helper then died by SIGINT; in the click the run died by SIGINT, and its helper was gone
  (remote Mac, 2026-11-13).
- A run killed by a signal sent to it alone (SIGTERM) left its click token behind: it removes
  the token's folder only on a normal exit. The border went 0.54 s after the kill, with the
  notification that the mouse was free, and the helper that run had started, which could
  still read the token, waited out a notification's cover and posted two moves, the button
  down and the button up 5.4 s after the border went (remote Mac, Live 12.4.25b1,
  2026-11-13). `device-ui.swift` now posts only while the process that started it is still
  its parent: a run that has ended counts as stopped. A helper waiting under a
  notification's cover was gone 0.16 to 0.21 s after its run was killed, with no mouse event
  posted, and the overlay said that the run had ended 0.16 to 0.20 s after the kill; one
  holding a drag's button, before its move, posted the button up, which reached the check's
  window 74 to 80 ms after the kill, and no drag event, in three runs
  (`checks/pointer-guards.js`, remote Mac, 2026-11-13). In Live, a helper waiting under a
  notification's cover was gone 0.12 s after its run was killed by SIGTERM and 0.28 s after
  SIGKILL, and posted nothing; the border went 0.55 s after the kill in both (remote Mac,
  Live 12.4.25b1, 2026-11-14).
- A helper whose run had ended before the helper began has process 1 for a parent from its
  first instruction, and no change of parent to go by. It counts its run as ended from
  that: it posted nothing and exited with status 3, saying that its run had ended. With
  that look taken out it clicked: two moves, the button down and up, and status 0.
  `checks/run-orphaned.swift` starts the helper suspended (`POSIX_SPAWN_START_SUSPENDED`)
  from a process that then ends, and lets it go on once process 1 is its parent. Only a
  parent can wait for a process, so it reads the helper's exit status from the kernel's
  event queue (`EVFILT_PROC` with `NOTE_EXITSTATUS`), which gave it for a process of the
  same user that wasn't its child (`checks/pointer-guards.js`, remote Mac, macOS 26,
  2026-11-14).
- In Live, a token removed 4 and 5 ms after the button of `choose`'s opening click went down
  left that click to complete: the release was the one mouse event after, `choose` threw as
  stopped with `done`, the menu was closed and the chooser's value unchanged. A press
  stopped while it waited for the Info View, with another app in front by then, threw
  without bringing Live forward (remote Mac, Live 12.4.25b1, 2026-11-13).
- When the token was still there after Stop tried to remove it (its folder unwritable, or
  the user-immutable flag on the token, `chflags uchg`), Stop ended the run's helper and
  the run by signal: SIGTERM, and SIGKILL for a run still there 2 s later. The run died
  before its clean-up. With the folder unwritable it had died 0.07 to 0.08 s after the press
  was started, and with the token immutable and a helper waiting under a notification's
  cover 0.10 to 0.11 s after, its helper gone and no mouse event posted, in three runs each
  (`checks/pointer-guards.js`, remote Mac, 2026-11-13 and 14). In Live, with a real click
  posted on Stop after a press had thrown for the unwritable folder, the run died by
  SIGTERM about 0.03 s after the button came up, in 2 of 2, and left its track in Live; no
  mouse event followed, also once the folder could be written to again (remote Mac, Live
  12.4.25b1, 2026-11-14).
- Stop's last resort now sends the run SIGUSR2 and keeps the border up until the run has
  ended; a run still there 10 s after the signal is killed (ADR-0012 says why that signal,
  and why 10 s). On the signal the run counts itself stopped, whatever its token says,
  passes the signal on to the helpers it has running, and goes on, so that a check fails at
  the press that throws and still cleans up; `device-ui.swift` handles the signal from its
  start and stops as after Stop. With the token immutable and a helper waiting under a
  notification's cover, the helper had exited with status 3 0.11 to 0.12 s after the press
  was started, with no mouse event posted, and the check's run, which ends once its helper
  has, 0.12 to 0.13 s after; the overlay said Stopped 0.03 to 0.04 s after the run's end.
  With the folder unwritable and no helper running, the run had ended 0.08 to 0.09 s after
  the press was started, and the overlay said Stopped 0.04 to 0.06 s later. A run that
  ignored the signal was killed 5.10 to 5.15 s after the press was started, when a run was
  given 5 s; its helper, kept under the cover by a second notification, was gone within
  0.11 s of the kill with no mouse event posted, and the overlay said that the run was ended
  0.05 to 0.07 s after the kill. The helper of a run that doesn't act on the signal is free
  to click until the kill (ADR-0012). Four runs each (`checks/pointer-guards.js`, remote
  Mac, 2026-11-14).
- A run is now given 10 s. A stopped run finishes the step it is in before it throws, at
  its next click: in Live, a run stopped as it began to read a menu `choose` had opened took
  2.3 and 2.4 s over the read, and ended 4.2 and 4.6 s after Stop, 1.5 and 1.8 s of which
  were a wait the proof had added; 5 s left too little room for its clean-up (remote Mac,
  Live 12.4.25b1, 2026-11-14).
- A press no longer waits for its reads of Live's window to end once stopped: Stop during
  the read that finds the device, or the Info View's after the hover, rejects the press
  within 0.1 s, and the read, which posts nothing, ends on its own. In Live, a press stopped
  during the Info View read threw 1.54 s after Stop, as the 2.6 s read ended; with the
  change, 40 and 67 ms after Stop during that read and 24 ms during the one that finds the
  device, with the reads ending 1.8 to 3.4 s later and no mouse event after Stop (remote
  Mac, Live 12.4.25b1, 2026-11-14). `choose`'s read of its open menu still ends first.
- In Live, with a real click posted on Stop and the token's folder unwritable, a run whose
  click waited under a notification's cover threw as stopped from its pill, deleted its
  track and ended by itself, with status 0, 0.42 and 0.49 s after the click, and no mouse
  event followed; with the user-immutable flag on the token, which the helper could still
  read, the same, 0.49 s after. A run stopped as `choose` read the menu it had opened
  closed the menu, left the chooser's value as it was, deleted its track and ended 2.1 and
  2.4 s after the click. The border went 0.5 to 0.6 s after the run's end. A run that
  ignored the signal was killed 10.0 s after the click and left its track in Live; no mouse
  event followed (remote Mac, Live 12.4.25b1, 2026-11-14).
- In Live, Stop's last resort during a drag: the run's helper suspended (SIGSTOP) as its
  drag's button went down on one of Auto Filter's knobs, before its move, the user-immutable
  flag set on the token, and Stop pressed on the pill through Accessibility, as
  `checks/pointer-guards.js` presses it inside a gesture (a real click would post a
  button-down of its own while the helper held the button). The run had the signal 105 and
  124 ms after the press was started, the pill then reading Stopping with the glow up. Let
  go on 0.38 and 0.44 s after the press, the helper posted the button up at the press point
  11 and 2 ms later and no drag event, and the drag threw as stopped, without `done`. The
  knob's value was unchanged; the run deleted its track and ended by itself, with status 0,
  0.90 and 0.87 s after the press, and the pill and the glow went together 0.36 and 0.41 s
  after the run's end. Frequency dragged 10 points up and Dry/Wet 12 down (remote Mac, Live
  12.4.25b1, macOS 26, 2026-11-14).
- After Stop the pill now stays, its button reading Stopping with a light going round it,
  until the run's process has ended, and only then does the overlay say Stopped and notify
  (ADR-0015); over a run that goes on it stays 10 s, as the next entry records. Before, it
  took everything down as soon as it had removed the token, and in
  its last resort it waited for the run on its main thread: asked through Accessibility
  for its button a few seconds into that wait, it gave no answer, where it now gives
  "Stopping". In Live, with a real click posted on Stop while a press's click waited under
  a notification's cover: the token went 2 and 16 ms after the click's button came up, the
  run posted no mouse event after it, the glow was off the screen 29 and 55 ms after it,
  the run ended by itself 0.53 and 0.61 s after it, its track deleted, and the pill went
  1.04 and 1.01 s after it, 0.4 to 0.5 s after the run's end, while the notification was
  posted. With the user-immutable flag on the token the glow stayed up with the pill: the
  run ended 0.49 s after the click, and both went 1.03 and 1.04 s after it. A run that
  ignored the signal was killed 10.01 and 10.02 s after the click, and both went 0.5 s
  later; its helper, which could still read the token, posted its click 4.0 and 2.9 s
  after Stop, once the notification's cover had gone, the cost ADR-0012 states. The glow's
  windows stayed on screen 0.3 s after they were ordered out (315 ms) until their closing
  animation was turned off (37 and 45 ms). The pointer, left over the pill by the click,
  was an arrow 4.2 and 6.9 s into the last resort's wait, and so it was with the overlay as
  it was before, 5.1 and 7.9 s in (`screencapture -C`; that it shows a wait cursor when
  there is one wasn't tried). Remote Mac, Live 12.4.25b1, macOS 26, 2026-11-14.
- A stopped run that goes on no longer keeps the pill up for as long as it runs: when Stop
  removed the token and the run is still going 10 s later, the overlay goes, notifying that
  the run was stopped and is still running, and kills nothing (ADR-0015). Before, it was
  still up 15 s after Stop over such a run (`checks/pointer-guards.js`). In Live, with a
  real click posted on Stop while a press's click waited under a notification's cover, and
  a run that then went on for 20 s: the token went 11 ms after the click's button came up
  and the glow 56 ms after it; the pill, asked 0.2, 5 and 9 s in, was up alone, its button
  reading Stopping, and went 10.40 s after the click; the banner then read "Stopped: (the
  run) won't click again, and is still running. The mouse is yours."; the run posted no
  mouse event after Stop, was warned of no lost border, and ended by itself 20.44 s after
  the click, its track deleted (remote Mac, Live 12.4.25b1, macOS 26, 2026-11-14).
- Stop pressed before the overlay had said that its windows were on screen took the glow
  down, so the overlay never found all its windows listed: it ended with status 1 two
  seconds after it began to look, with no notification, and its run would have warned that
  it clicks with no border. It now leaves the glow out once Stop has removed the token,
  says shown when the pill is listed, and stays as it does after any Stop. Seen with a copy
  of the overlay that looks for its windows once a second, where it looks every 0.05 s, and
  Stop pressed through Accessibility before its first look, twice. Which windows to wait
  for can't be taken from `NSWindow.isVisible`: a copy that took its own glow down without
  Stop, and one that hid its app 0.2 s in, which left none of its windows listed, both said
  shown that way with the token still there. Both now end as not shown, with status 1
  (remote Mac, 2026-11-14).
- A helper sent that signal itself stopped as after Stop. One waiting under a
  notification's cover exited with status 3 4 to 13 ms later. One holding a click's button
  posted the button up 6 to 8 ms after the signal, which cuts the hold short (73 to 81 ms
  after a token removed at the same point), and exited with status 4, the click having
  happened. One holding a drag's button, before its move, posted the button up 5 to 13 ms
  after the signal and no drag event, and exited with status 3. Four runs each
  (`checks/pointer-guards.js`, remote Mac, 2026-11-14).
- `computer-use-overlay` took any whole number for the process id of its run. Started with
  0 and with -1 it said `shown` and was still up 2 s later, once each: signal 0, by which
  it watches its run, had failed for neither. Stop's last resort signals that id, and
  kills it if it is still there 10 s later, and to `kill`, 0 is the caller's own process
  group and -1 every process the user may signal (not tried). The overlay now refuses an
  id of 0 or below as it refuses one that is no number: its usage on stderr, nothing on
  stdout and exit status 1, 10 to 18 ms after it was started, in 10 starts
  (`checks/pointer-guards.js` and the overlay started by hand, remote Mac, macOS 26,
  2026-11-14).
- A run that couldn't remove its token's folder as it ended, the folder being unwritable,
  ended with status 1 and node's `ENOTEMPTY` error on stderr, whatever its own result: the
  removal threw as the process ended. Seen in Live in 2 of 2 runs that Stop's last resort
  had stopped and that had cleaned up (remote Mac, Live 12.4.25b1, 2026-11-14). The folder
  is now left there, and the run ends with its own status, saying nothing (unit tests,
  remote Mac, 2026-11-14).
- Stop pressed once the run has ended says that the run has ended, not Stopped, though the
  token's removal reads as stopped. The overlay looks for its run every 0.25 s and then says
  the same by itself, so a press that comes late proves nothing: with Stop's own look for
  the run taken out, a press started after the run's end said Stopped in 1 of 5, and one made
  as soon as the run had gone (`press-stop <pid> <run>`) in 5 of 5 (remote Mac, 2026-11-13).
- A run that has ended and that its parent hasn't waited for stays in the process table (a
  zombie: `ps` gives its state as `Z`, and as `Z+` for one in a terminal's foreground, as
  under `script`) and still answers signal 0, which is how the overlay
  looked for its run. Over such a run the overlay was still up 3 s after the run's end, and
  with a token that Stop couldn't remove it went on waiting for a run that its own signal
  had ended. `sysctl` gives such a process's state (5, `SZOMB`), where `proc_pidinfo` fails
  with `ESRCH` as for one that is gone. The overlay now reads the state too, and said that
  the run had ended, or Stopped, within 3 s (`checks/pointer-guards.js`, remote Mac,
  macOS 26, 2026-11-14). So the process that started a run can read what the overlay says
  of the run's end before it hears of that end itself. A script held up for 0.4 s as it
  ended its run read the overlay's words first in 12 of 12 runs, 0.02 to 0.4 ms before the
  run's exit reached it, once on the millisecond before; left idle, it heard of the exit
  first, 0.12 to 0.18 s before the words, in 4 of 4. `checks/pointer-guards.js`, which
  fails an overlay that says a run was stopped before the run has ended, allows the words
  10 ms (remote Mac, 2026-11-14).
- `Process.waitUntilExit()` runs the run loop while it waits. Waiting that way for its
  notification, an overlay whose Stop had just ended the run, or was pressed as the run
  ended, had its timer fire meanwhile and notified a second time that the run had ended. It
  now waits without running the run loop, and notified once (remote Mac, macOS 26,
  2026-11-13).
- A run has one click token: every border it shows is given the same one, and the run names
  it to each helper it starts, in that helper's environment (`HARNESS_COMPUTER_USE_TOKEN`),
  and nowhere else. A run once wrote the name of the file its Stop used into its own
  environment, which every process it started inherited: a run started that way took the
  other run's Stop for its own and gave that file to its helper, and a second border in one
  run was given a file of its own, after which the run no longer read the first (unit tests,
  remote Mac, 2026-11-13). A token named in the environment a run starts with neither stops
  the run nor reaches its helper.
- harness-computer-use's stop key, Control-Option-Command-Space, is a system hot key that the
  overlay registers (`RegisterEventHotKey`), with no permission asked (ADR-0017). Probed
  with a program that registered it and a stand-in app in front, the keys posted as events
  (`CGEvent`): the program got the key whether its modifiers were posted as key presses of
  their own or only as flags of the key, and the app in front got the modifiers but not the
  key; once the program had ended, the app got the key. It came with a mouse button held
  down in the front app's window, 2 ms after it was posted, the button-up arriving after,
  and with secure input on in the front app. Claimed by two programs it went to both, with
  no error to either, and claimed against Spotlight's ⌘Space it went to the program and
  Spotlight opened too; that was without the exclusive option, with which the overlay now
  claims the key (below). A claimed
  plain Escape caught an Escape posted with no modifiers; the harness types its Escape, to
  close a menu, through System Events, which wasn't tried (remote Mac, macOS 26,
  2026-11-15). Not tried: a real keyboard.
- The overlay's exclusive claim on the stop key: with one overlay up, a second's claim was
  refused (`eventHotKeyExistsErr`), its pill showed no key and its Stop still stopped its
  run, and one press of the key stopped only the first run. An overlay killed with SIGKILL
  gave the key up: the app in front got the next press, and so did one that had said its
  last words and still waited for its notification (`checks/pointer-guards.js`, 63 of 63 in
  286 s, remote Mac, macOS 26, 2026-11-15). With a program holding the key without the
  exclusive option first, the overlay's claim wasn't refused, and a press went to the
  overlay alone, which took it as Stop, the other program getting nothing, in 2 of 2: a
  program that holds the key the ordinary way doesn't block the overlay and loses the key
  while the overlay holds it; one that holds it exclusively makes the claim fail.
- The stop key in Live, posted as key events with Live in front while a press's click waited
  under a notification's cover: the token went 228 and 251 ms after the presser was
  started, its own start included, the glow 280 and 282 ms after, the run ended by itself
  768 and 778 ms after, its track deleted and the control's value unchanged, and the pill
  went 1.21 and 1.25 s after; no mouse event of the run's came after the key. Once the
  overlay had gone, the key pressed with Live in front didn't start Live's transport, in 2
  of 2 (remote Mac, Live 12.4.25b1, macOS 26, 2026-11-15). Pressed as the key's events
  carrying the modifiers as flags, with their release posted after: the token went 197 ms
  after the presser was started, the glow 232 ms, the run's end 716 ms, the pill 1.19 s,
  the transport again not started, and no modifier left held (one run, the same day).
- Posting the whole stop key chord every 10 ms, about 800 events a second, held up the
  overlay's start: it said "stopping" 3.5 s after it was started, once, and nothing within
  4 s, once, where it otherwise said "shown" after 1.03 to 1.15 s. Holding the modifiers and
  tapping only the key every 20 ms, it said "stopping" after 0.76 and 0.79 s and "shown"
  after 1.23 and 1.30 s, the key taken before its windows showed (remote Mac, 2026-11-15).
- The wait for no modifier key held, before the Escape after Stop, read the modifiers posted
  as key events: with them held 1 s from 0.1 s before the wait began it said none was held
  1.06 s in; held 2.5 s with a limit of 0.5 s it said one was, 0.69 s in; with none held,
  0.22 s in, its script's start included (remote Mac, 2026-11-15).
- A click the helper posts while modifier keys are held carries them: with Control, Option
  and Command held (posted as key events) for 1 s and the helper's click started 200 ms in,
  its button-down and button-up both carried all three in 2 of 2, and its hover's two moves
  in 1 of 2, carrying none in the other; with nothing held, none, in 2 of 2 (remote Mac, macOS 26, 2026-11-15). A person
  pressing the stop key holds its modifiers first, so a click in flight then can reach Live
  as a Control-Option-Command click. The Escape that closes a menu after Stop now waits until
  no modifier is held, for 2 s at most, and isn't typed if one still is (ADR-0017).
  `checks/pointer-guards.js` measured it again with a click, a drag and Shift alone: every
  event, the hover's two moves included, carried the modifiers held, and the keyboard's
  state, read by the target window as each event arrived, still read them held; with
  nothing held, none either way (one run, the same day).
- Trap: a posted mouse event with its modifiers cleared lets go of the modifiers held, for
  every app, keys held on a real keyboard included. With the helper clearing the modifier flags on every mouse event, keeping
  only the non-coalesced flag, its events carried none while Control, Option and Command, or
  Shift alone, were held (posted as key events), but the keyboard's state
  (`CGEventSource.flagsState(.combinedSessionState)`, read by the target window as each event
  arrived) read none held from the hover's first move to the button-up, in a click and a
  drag. The same came of events made from a private event source (`.privateState`), and of
  events made from the HID system state and posted at the session tap instead of the HID
  tap (`checks/pointer-guards.js`, one run each, remote Mac, macOS 26, 2026-11-15). So the
  helper builds its events from the keyboard's state as they are, carrying what is held.
  With Shift and Option held on a real keyboard, one mouse move made from the HID system
  state, its modifiers cleared and posted at the HID tap, at the pointer's position: before
  it the HID system table, the combined session table and AppKit
  (`NSEvent.modifierFlags`) all read shift and option, and the event as made carried them;
  100 ms and 1 s after it all three read none, the keys still held. So the HID table itself
  reads the keys let go, and stays so for at least 1 s while they are held (once, on another
  Mac, 2026-11-15). The private source and the session tap were measured only with
  modifiers held by posted key events.
- Which modifiers change a drag on one of Live's own knobs: Auto Filter's Dry/Wet, dragged
  10 points up from 0.5 by `device-ui.js` with a modifier held (posted as key events by
  `checks/press-key.swift`), the helper's events carrying it. Nothing held turned 10 steps
  (0.5 to 0.5794), Shift 1 step (0.5079), Command 10 steps, and Control and Option none
  (0.5 both); no menu was left on screen after (one run each, remote Mac, Live 12.4.25b1,
  macOS 26, 2026-11-15).
- Trap: a posted key event (`CGEvent` from the HID system state, at the HID tap) that carries
  modifiers as its flags leaves them held, for every app and every later posted event, until
  their release is posted. After `press-key` pressed F13 that way with Control, Option and
  Command, the system read all three as held; once their release was posted, none. The key
  cases of `checks/pointer-guards.js` had left them held that way, and the next check,
  `checks/editor-guards.js`, failed its two `drag-editor` cases: a drag that should have
  moved Dry/Wet Mix from 0.5 to 0.7145 moved it to 0.5021, the step a drag takes with a
  modifier held (remote Mac, macOS 26, 2026-11-15). `press-key` now posts the release
  however it ends but SIGKILL, and `pointer-guards.js` fails a key case, naming them, that
  leaves a modifier held, and lets them go.
- With no window server, as for a process with no desktop session, a program gets no session
  (`CGSessionCopyCurrentDictionary()` is nil), no screens, and windows that say they are
  visible and never show, all with no error; `display dialog` fails there with -1713, "No
  user interaction allowed". So a run there is refused at the dialog (ADR-0006), and
  `computer-use-overlay.swift` checks the session and ends with the reason, 0.4 s after it
  started (the window server's service denied with `sandbox-exec`; remote Mac, macOS 26,
  2026-11-13).
- The window server lists the border's windows 0.6 to 1.4 s after its program starts (14
  starts), which is when the program prints `shown`; the run waits for that before its first
  click. A border started while the display sleeps makes its windows then, and draws them
  once the display wakes (remote Mac, macOS 26, 2026-11-13).
- When the border's program couldn't be built (a copy of the harness with a line in
  `computer-use-overlay.swift` that isn't Swift), a run on a machine told it wasn't the click
  host warned that it couldn't show its border, giving the compiler's command and first
  error, and then asked. The dialog, titled harness-computer-use, read "harness-computer-use
  wants to click in Live on this Mac for <script>. It moves the pointer until the run ends.
  Nothing on screen will show that it may take the pointer, and there will be no Stop.",
  with Don't Allow, the default, and Allow (read through Accessibility, and captured). Don't
  Allow refused the run's clicks and Allow let them, with no border's program started. With
  the border built, the same dialog read "... It moves the pointer until the run ends, while
  a purple glow shows around the screen." (remote Mac, macOS 26, 2026-11-14).
- A mouse event posted as the last thing a program does is lost: a button-up posted just
  before exit left the button held in 3 of 3 runs, and with 100 ms between the post and the
  exit it came up in 2 of 2. `device-ui.swift` waits 100 ms after every button-up, a stopped
  or signalled helper's included (remote Mac, macOS 26, 2026-11-13).
- The window server doesn't list a window an app has just ordered front until the app's run
  loop has run: it was listed neither at once nor 30 ms later in 8 of 8 starts, and was by
  the run loop's first timer, 50 to 70 ms after the loop started. A click posted in between
  was refused with Live's window, the one under it, named as the window at the point.
  `checks/pointer-target.swift` reports its window once it is listed (remote Mac, macOS 26,
  2026-11-13).
- After Stop on the pill, `choose` closes a menu it had opened only while Live is still in
  front, and doesn't bring Live there: a stopped run takes nothing more from the person, the
  front included. Escape typed with Live in front, and no activation, closed a chooser's menu
  (remote Mac, Live 12.4.25b1, 2026-11-13). A press stopped while it read the Info View
  brought Live to the front once more before it threw. `device-ui.js` now refuses to bring
  Live forward once the run is stopped, for a press and for a capture of a plug-in's window
  alike, without asking to click (unit tests, remote Mac, 2026-11-13).
- With another app in front, a Stop that landed after that refusal had looked for it and
  before Live was told to activate still left Live in front (remote Mac, Live 12.4.25b1,
  2026-11-14). The run now looks again just before it tells Live to activate, once the
  display is woken and Live looked up, and, where it brings Live forward to type Escape,
  once more before the key. A Stop that lands after the last look still finds Live brought
  forward (ADR-0012). The Escape after Stop is typed by the one script that finds Live in
  front; it was a look and then a keystroke, which went to whatever app had come forward
  between the two. A capture of a plug-in's window gives the front back to the app that
  had it only if it brought Live forward: one refused after Stop gave it back all the same,
  which activated that app if Live was in front by then (unit tests, remote Mac,
  2026-11-14). In Live, with another app in front and Stop pressed by a real click once a
  press's bringing Live forward had begun, the press threw and that app stayed in front, in
  2 of 2 (remote Mac, Live 12.4.25b1, 2026-11-14).
- While the remote Mac's display sleeps, `screencapture -l` fails with "could not create image from
  window", and the session reports the screen locked until the display wakes.
- A video (`video.js`, ADR-0016) records a window as `screencapture -l` captures it: behind
  other windows, without harness-computer-use's border and pill, the pointer included; Live
  in the background shows its title bar inactive. While the display sleeps a recording gets
  no frames: a display put to sleep 3 s into a 10 s recording left a 10 s video whose
  picture stopped at 3 s. A ScreenCaptureKit recorder, the kind `video.swift` is, started
  with the display asleep made no file, so `video.js` wakes the display first; and the
  helper keeps the display from sleeping while it records, though only from idle sleep: a
  display put to sleep on purpose (`pmset displaysleepnow`) during a recording of the helper's
  still slept, and the video froze from then on, which `checks/video-record.js` catches by
  comparing frames (remote Mac, macOS 26.7, Live 12.4.25b1, 2026-11-14). The forced sleep
  took effect late: sent 2.7 s or 3.3 s into a 4 s recording of Live's window, it left no
  two frames alike up to 0.25 s before the end, in 2 of 2.
- An ssh session that ends, its local ssh killed as Ctrl-C on `remote.sh` kills it, sends
  the command it ran no signal: the command runs on, and only the other end of its stdout
  and stderr is gone. With the helper watching the run's stderr, a `cli.js video --seconds
  60` whose ssh was killed about 11 s in stopped then, leaving a whole 9.95 s video (remote
  Mac, macOS 26.7, 2026-11-14).
- `screencapture` refuses a file name that starts with a dot ("cannot write file to intended
  destination") and still exits 0; a file in a hidden folder it writes (remote Mac, macOS
  26.7, 2026-11-14).
- `screencapture` also exits 0, saying the same on stderr, when the file's folder doesn't
  exist or can't be written; in a folder that can't be written, a file already at the path
  stays as it was. `cli.js capture` printed such a path as saved, with exit 0, in 3 of 3
  (remote Mac, macOS 26.7.1, 2026-11-17). `captureWindow` now has `screencapture` write beside
  the file and replaces the file only once that is there, so each of the three throws
  `DeviceUiError` naming the file, exits 1 from `cli.js`, and leaves a file already there as
  it was. A read-only file in a folder that can be written is replaced, as `screencapture`
  alone replaced it. The file it writes beside is `<name>-capturing-<random>.png`, `<name>` the
  file's name without its extension and `<random>` 8 hex digits new for each capture, in the
  same folder, so two captures at once never share it and a later capture never takes one a
  killed run left for its own: a run killed while it captures can leave it there. Beside a path the caller gave, nothing deletes it; for a capture in the
  captures folder it is in the `.unfinished` folder, whose prune deletes it once it is 7 days
  old and another capture is saved there. `startCapture` makes a missing folder first, for
  `cli.js capture`, `plugin-window`, `video` and `video-frame` alike, so they fail only on a
  folder that can't be written; one it can't make, under a folder that can't be written,
  throws an error naming the file before anything is captured. `captureWindow` called with a
  path of its own still throws on a missing folder.
- openrsync with `--remove-source-files`, failing on one listed file it couldn't read, copied
  the other file it was given but didn't delete its source, and exited non-zero; `remote.sh`
  names what it copied, and a later run finds that name already here (remote Mac, macOS 26.7,
  2026-11-15).
- macOS checks a new program the first time it runs: a new shell script took 0.60 to 0.67 s
  from its start to its first line, in 9 of 9, and a link to one that had already run 0.01 to
  0.02 s, in 8 of 8 (remote Mac, macOS 26.7, 2026-11-15). The unit tests run their stand-ins
  through Node or make them once a file; `device-ui.test.js` runs its one before any test
  times a stand-in.
- `ui.capture` crops its capture of Live's window with the helper's `crop`, as a capture of
  a plug-in's editor does, no longer with `sips`. The helper's crop gave its PNG no
  resolution, which reads as 72 dpi, where the capture has 144 and a crop by `sips` kept
  it: a plug-in's editor came out 888 x 160 px at 72 dpi, and Auto Filter's panel, cropped
  by `sips`, 900 x 384 px at 144. The crop now gives its PNG the capture's resolution, and
  both came out at 144 dpi, the same sizes in pixels (`sips -g dpiWidth`; remote Mac, Live
  12.4.25b1, 2026-11-14). It takes its rectangle in points and rounds each edge to a pixel:
  with the left edge and the width each rounded, a rectangle inside the image could end a
  pixel past its edge and be refused. A device whose frame isn't wholly inside Live's
  window is refused before anything is captured, with an error that names it and says to
  bring it into view (unit tests; not made to happen in Live).
- A Live started while the display slept never redrew its window: with the LOM at 2 tracks,
  captures of the window and of the whole screen showed the 1 track it opened with, and
  waking the display, bringing Live to the front and resizing its window changed nothing.
  Started with the display on, the same steps drew every change. `relaunch.js` keeps the
  display on until Live is up (`keepDisplayOn` in `macos.js`); a Live started otherwise
  while the display slept needs a relaunch (remote Mac, Live 12.4.25b1, 2026-11-11).

## Tracks and devices

- New MIDI tracks get the devices of Live's default MIDI track template; `createMidiTrack()`
  removes them so they can't alter a recording.
- A property that doesn't apply to a track or a clip raises in the LOM (`fold_state` on a
  track that isn't a group); AbletonOSC answers nil for it, and `trackData()` passes that on
  as null (`fold_state` read null on a MIDI track, Live 12.4.25b1, 2026-11-11). The harness
  refuses rather than guess: `recordArrangement()` when a track that can be armed reads no
  `arm`, `arrangementClips()` when a clip reads no value for one of its properties, and
  both when a reply isn't whole rows.
- `createTrack()` makes MIDI and audio tracks only and refuses another kind: a return track
  isn't among the song's tracks, so the last of those would be renamed and stripped instead.
- New audio tracks get the devices of Live's default audio track template, as MIDI tracks
  do; `createAudioTrack()` removes them.
- A Max for Live device's parameters arrive seconds after the device; `loadDevice()` waits.
  A Max device with no parameters lists only Device On, and nothing else the harness reads
  (its name, `is_active`, `class_name`) changes once it has loaded (Live 12.4.25b2,
  2026-11-20), so `loadDevice()` can't tell it has loaded: pass `{ parameters: 0 }`. In that
  version a Max device's parameters were there at the first read, also on the first Max
  device after a relaunch.
  Their names are the short names, which can repeat within a device. Live lists the visible
  (automated) parameters after "Device On" sorted by long name, which
  `parameterIndices()` uses to map long names to indices. Stored Only parameters are not
  in the list and cannot be set. The sort order is presumably Max's `parameter_order`
  attribute at its default of 0 (not verified); a device that sets it breaks the mapping,
  which `parameterIndices()` then reports.
- The browser lists `.amxd` devices without the extension.
- Live crashes loading an `.amxd` whose patcher has a `project` without a `searchpath`: Max
  reads it unchecked while it builds the device (seen in Live 12.4.25b1).
- A track whose MIDI From source is deleted can no longer be armed or disarmed ("The Track
  in question cannot be armed!"): delete the recording track before its source.
- Live's input routing list follows a track rename a tick later, and the routing setter
  only logs an unknown name; use `setInputRouting()`, which waits and checks.
- A From is picked by track name, and reads back as that name whichever of two tracks so
  named it came from (Live 12.4.25b2, 2026-11-20). A set still holding an earlier rig's
  tracks so recorded those tracks. `setInputRouting()` refuses a name two other tracks hold,
  so `signalTracks` fails in such a set: delete the old tracks first.
- Loading a device from the browser selects its track.
- A MIDI source the harness makes (`midi.js`) was a MIDI input within 2 s, Track on by
  default. With Remote turned on for it once, Live keeps that after the port closes and
  reopens and after a relaunch (Live 12.4.25b2, remote Mac, 2026-11-21).
- `device-ui.js` presses work in MIDI Map and Key Map Mode: the Info View still names the
  control. A press then a CC maps the control; a press then a key, typed with Live in front,
  maps it to the key, and the key toggles the parameter between its ends (Auto Filter, same
  version).
- The text recognizer, run over Live's whole window, can miss the Info View's title or read
  it wrong while Live shows it plainly. After a Max device's checks had loaded it, saved a
  preset and so on in one Live session, "Rate" over a knob of it read as nothing with MIDI
  Map Mode off and as "nate", its top 4.5 points below the device title's, with it on; after a
  relaunch it read "Rate". Read from a crop of the Info View's title row only, it read
  "Rate" in both modes, every time (remote Mac, Live 12.4.25b2, 2026-11-21). `device-ui.js`
  reads the Info View from that crop after its hover.
- `-EnableArmOnSelection` is an optional Options.txt entry; without it, none of this
  applies. With it, the arm follows the selection: while a track is armed, selecting another
  moves the arm to it; with no track armed, selecting a track arms nothing (Live 12.4.16,
  2026-11-10). Loading an instrument armed its track (2026-10-31): `signalTracks` disarms the source track after loading its
  instrument, or `recordArrangement` refuses. Loading a MIDI effect onto a track, with no
  track armed, armed nothing.
- `/live/view/set/selected_track` once left the selection unchanged, with no error sent or
  logged: after a track had been armed, recorded in the Arrangement (`recordArrangement`)
  and disarmed, setting another track and then `sync()` still read the old track from
  `/live/view/get/selected_track`, and the Detail View still showed it. Live was frontmost
  in Arrangement view (Live 12.4.16, 2026-11-09). The same steps on a Live whose window
  wasn't redrawing (it showed none of the changes) selected the track every time, so the
  cause is not known.
  `/live/view/set/selected_device` on a device of the wanted track selected that track.
  Read `get/selected_track` back after setting it. `/live/browser/load` does: it refuses,
  loading nothing, when the track it selected isn't the selected one.
- A value listener left on a parameter by an earlier session kept sending after its client
  was gone (`stop_listen` answered "Observer not connected"). Its updates arrive on
  `/live/device/get/parameter/value`, the address a `parameter/value` query answers on, so
  every such query returned the listened parameter's value; the `parameters/value` list was
  unaffected. Queries answered right again once the device holding the listener (a Utility)
  was deleted. Found 2026-11-03.

## Recording and timing

- Note times from `/live/clip/get/notes` and `/live/arrangement_clip/get/notes` are in the
  clip's own time. `songNotes()` places an Arrangement clip's notes in song beats, including
  loop repeats.
- Live's note range is a start pitch and a count of pitches: 0 and 127 cover pitches 0 to
  126. A time range is a start and a length, and a note can sit anywhere in a clip's time:
  one placed at -9000 or 20000 beats is kept there. So with no arguments, the note queries
  read every note with `Clip.get_all_notes_extended()`, and `/live/clip/remove/notes`
  removes them by their ids, rather than through a fixed range: the old one, pitches 0 and
  127 from -8192 for 16384 beats, left out notes at pitch 127, before -8192 or from 8192 on. On 387 notes
  at every pitch, at times from -9000 to 20000, `get_all_notes_extended()` returned all of
  them, in a Session and an Arrangement clip, in `get_notes_extended()`'s order, pitch then
  time, which the callers rely on (Live 12.4.25b2, remote Mac, 2026-11-19).
- A relocation ends an Arrangement recording: setting `current_song_time` while Live records
  (or `/live/song/jump_by`) turns Record off and Play goes on from the new place, so the take
  ends at the jump. Read 0.15 s after a jump from beat 4 to 20, `record_mode` was off and
  Play on, and the MIDI take ended at beat 4.4; the same with `jump_by` 16 (this Mac, Live
  12.4.25b2, 2026-11-21); an audio take ended the same way on the remote Mac.
  `recordArrangement()` throws when Record is off after a `during` action or at the end, rather
  than return a short take. A loop's end doesn't end the take. To record across a jump, record
  in the Session: fire a clip slot on the armed track and relocate while it records.
- Play starts from the start marker, `Song.start_time`; `recordArrangement()` sets it to
  `start` and leaves cue points alone. Setting `current_song_time` while stopped doesn't
  move the marker, Stop while stopped puts it back at 0, and turning `record_mode` on while
  stopped starts Play at once, so the marker goes first. Don't reach a start through a cue
  point: in some sets a cue point added while stopped snaps to the bar.
- `start_playing` while Live plays restarts Play from the start marker (beat 1.516 jumped
  back to 0.186). `recordArrangement()` used to send it right after `record_mode`, and when
  an audio buffer ran between the two, the take recorded that buffer, then the restart:
  from sample 129 on it sat one buffer (128 samples) late against its file (3 takes of 200,
  on both Macs, Live 12.4.25b2, 2026-11-20). It now sends `start_playing` only if
  `record_mode` didn't start Play.
- While any track's Session clip is active (`playing_slot_index` 0 or more, even with the
  transport stopped), Live starts Play from the bar at or before the start marker: bars of
  4 x numerator / denominator beats from beat 0 (time signature changes in the Arrangement
  are not seen). `recordArrangement()` then refuses a start off a bar line, naming the bar
  Live would use: start on a bar line, stop the clips, or record from 0. One set, after a
  crash, started at the marker instead. Stop while the transport is stopped leaves the
  clip active (measured in Live 12.4.15b7), so the Stop
  `recordArrangement()` sends before Play doesn't change this.
- With Automation Arm on, a parameter changed while Live records (a `during` action) is
  written as automation on the device's track and replays later. `recordArrangement()`
  turns Automation Arm off while it records, or on with `automation: true`, to write
  automation, and puts it back as it was afterwards. Live writes it with no track armed
  (`checks/automation-record.js`, on the remote Mac, Live 12.4.25b2, 2026-11-21).
- Live records audio as WAV at the record bit depth (see "Record bit depth" in `README.md`) and the
  audio device's rate, into the set's `Samples/Recorded`, named
  `<track> 0001 [<date> <time>].wav`; `file_path` of the
  Arrangement clip gives it. The take starts at the recording's start: notes at beats 0, 1,
  2 began within 3 samples of their beat at 120 BPM. A track whose input is another
  track's Post FX and monitoring In passes that signal without being armed.
- Overlapping notes of the same pitch in a clip came back shortened once (inferred to be
  Live trimming the overlap); keep test fixtures free of same-pitch overlaps.

## Plug-ins

- A plug-in rebuilt while Live runs: Live keeps playing the build it loaded until it
  relaunches. Seen twice: on the remote Mac (2026-10-31), a check after a fix failed exactly
  as before until a relaunch; on the main Mac (2026-11-01), a run played the old build while
  the first load after a relaunch played the new one. That Live keeps the old binary mapped
  is inferred. A plug-in installed while Live runs is listed only after Settings > Plug-Ins >
  Rescan or a relaunch. `relaunch.js --plugin` names the component it loaded and when its
  code was built.
- A plug-in's parameters are DeviceParameters only when it has at most 64 (Ableton's help
  documents the Options.txt entry `-_PluginAutoPopulateThreshold`, default 64, range 1 to
  128; forum reports say it is unreliable for AU and VST3; not tried here, as it needs a
  Live restart). Above that, Live lists only "Device On" (and sometimes "Bypass") until
  parameters are added in Configure mode. A plug-in with more than 64 showed this (Live 12.4.25b1).
  So `loadDevice()` takes a plug-in's count once it has held for a second, even at 1, where
  a Max for Live device must also list more than Device On.
- Live keeps a plug-in's configured parameters in the set: the device's `ParameterList`
  holds 128 pairs of slots, a `PluginFloatParameter` (Id 2i) then a `PluginEnumParameter`
  (Id 2i+1), each with a `ParameterId` (the AU parameter ID, -1 when free), a
  `ParameterName`, a `VisualIndex` (the order Live lists them in), a `Manual` value and,
  for enums, a `LastItemCount`. Live puts the parameter at index i of the AU's
  `ParameterList` in pair i, in the slot of its kind, and leaves the other empty (seen for
  a plug-in Live populated itself); its own population lists them in that order
  (2026-11-03). Filling slots that way and reopening the set makes Live list them, settable
  over the LOM (`plugin.js`). Filled instead into the first free slot of each kind, so a
  float and an enum shared a pair, every parameter read back in Live but some floats never
  reached the plug-in: with one plug-in, one float did not while another did (measured
  2026-10-31).
  `Manual` is the value Live shows, not read from the plug-in nor pushed into it at load
  (a float with `Manual` below its default showed the `Manual` while the plug-in held its
  default, 2026-11-03): normalized 0..1 for a float
  (AUDelay's 50 % Dry/Wet is 0.5, its -99.9..99.9 % Feedback at 50 % is 0.75), on a log
  scale for one flagged Display Logarithmic (its 10..22050 Hz Lowpass at 15000 Hz is 0.95), an item index
  for an enum; unfilled it reads 0.1234567687. An enum slot left at `LastItemCount` 1 reads
  every value as 0. An unconfigured device keeps a slot named "Bypass" with ID -1 in
  slot 1. Over the LOM, a plug-in float's value is normalized too (AUDelay's Dry/Wet takes
  0..1, not 0..100), and its `value_string` can be that number, not the plug-in's text
  (a time parameter reads a number such as "0.43", not its text).
- Live's own population can leave parameters out: for AUDelay it listed 3 of its 4 (not
  Delay Time, flagged Not Real Time); written into the set, Delay Time is listed too.
- `auval -v <type> <subtype> <manufacturer>` lists an AU's parameters with their IDs,
  units ("Parameter Type": Indexed and Boolean are enums; Generic, Percent, Seconds, Hertz
  and the rest are floats), ranges, defaults and value strings, but clump by clump, not in
  the AU's `ParameterList` order, and with ranges and defaults as the plug-in's display
  text when it supplies one (a parameter that is 0 to 1 raw prints times in ms and s),
  so `plugin.js` reads them from the AU instead. The codes are in the set file's
  `AuPluginInfo` as integers. Live's `class_name` for an AU is `AuPluginDevice`.
- `Song.move_device` moves a device to another track, keeping the instance: a plug-in kept
  its parameters and state across moves. An effect after an instrument on a MIDI track
  can't take audio input there, so `audio.js` moves it to an audio track.
- While a track's input is silent, Live zeroes a plug-in's output in whole blocks once that
  output is quiet, and the plug-in's reported tail does not stop it. Seen 2026-11-01
  (Live 12.4.25b1, VST3, 44.1 kHz) with a plug-in fed bursts of noise: the recording drops
  to exact zero in runs of 12928 to 13184 samples (about 0.3 s), each starting on a
  512-sample boundary, while the input is silent between bursts and the plug-in's output is
  a decaying tail under 2e-6 (about -114 dBFS); an offline render matches everywhere else.
  The plug-in passes its output through unchanged, and reporting a tail (0.25 s tried)
  changed nothing. The level is not a fixed floor: seen 2026-11-13 (Live 12.4.25b1, VST3,
  48 kHz, 32-bit float), another plug-in's recording equalled its offline render to the
  bit through a 50 ms noise burst and into a slow 20 Hz tail with the input silent, then
  read exact zeros where the render read up to 6.0e-6 (about -104 dBFS), the largest
  difference at the same sample (9504 after the signal starts) on two runs. A check that
  skips recorded zeros where the render is quiet needs its floor above the loudest output
  Live has zeroed. The rule Live applies is not known.

## Logs and settings

- Places are in `Library.cfg` in Live's preferences folder, one file per Live version. Two
  entries with one `Id` make Live reject the whole file as corrupt, and AbletonOSC then
  doesn't answer (2026-11-08). Live renumbers the `Id`s between launches, so an `Id` can't
  be kept. `add-place.js` makes the edit.
- A build copied into a Places folder while Live runs is listed within seconds: 2.2 s by
  `cp` and by `remote.sh`'s rsync, 4.3 s with the display asleep (remote Mac, 2026-11-11).
  One earlier run (2026-11-11), on a Live started before `relaunch.js` kept the display
  on, didn't find a new build until a relaunch; whether that Live started while the display
  slept (see "Menus and windows") isn't known.
- Live logs every Max console message to `~/Library/Preferences/Ableton/Live <version>/Log.txt`
  (the version without a Beta's build, e.g. `Live 12.4.25b1`), appended to at each launch
  after an `info: Started: Live <version>` line, as
  `<local time, microseconds>: error: Message from Max:  <text>`. A gen~ codebox
  that fails to compile ("declarations must come before any expressions") leaves a device
  that loads, answers OSC and outputs silence, with the reason only there (found 2026-10-31).
- Live keeps its settings in `Preferences.cfg` in its preferences folder, a binary file
  `settings.js` reads (its layout is at the top of that file, worked out from Live
  12.2 to 12.4.25b1's files). Bit Depth is `SongPrefData.RecordBitDepth`: 1 is 24-bit
  and 2 is 32-bit float, matched with the takes Live recorded at each (2026-11-01); 0 for
  16-bit is inferred, not seen. Live writes the file when its Settings window closes, not
  when a setting changes: a sample rate changed with Settings open was in the file only
  once it closed (2026-11-05); `recordSignal` checks the takes' own headers in case it lags.
  The file holds the sample rate as `SongAgent.AudioInOut.AudioInOutData.SampleRate` (a
  float, in Hz), named `SelectedSampleRate` from the 12.4.15 betas on, outside the
  `PreferenceMembers` that `readSetting` finds.
- Live logs its sample rate to `Log.txt` (`info: Audio In Out: Sample Rate: 48000`) each
  time its audio engine starts: at launch, and within a second of a change in Settings,
  with Settings still open. Changes from 44100 to 48000 and back matched the output
  device's rate (2026-11-05); the remote Mac's 12.4.16 logs the same line. Live starts a new
  `Log.txt` from time to time (one 12.4.25b1 log began 2026-11-03); whether it does
  while running isn't known, and `sampleRate()` throws when the log has no such line.
