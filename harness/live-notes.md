# Notes from Live

This file records how Live behaves under the harness, as found by running it. Read this file when
Live does something unexpected.

## Dialogs

- Live's dialogs show over the LOM while open (`open_dialog_count`, message, button count)
  and OSC keeps working, but their buttons have no names there or over Accessibility. In
  "Save changes to ... before closing?" the buttons are 0 Don't Save, 1 Cancel, 2 Save (Live
  12.4). In "Would you like to delete the temporary files in .../<time> Temp Project?", asked after
  it on quitting a set never saved that recorded audio, they are 0 leave them, 1 Cancel, 2
  Delete. "This action will stop audio. Proceed?" (0 Cancel, 1 OK) comes when a set is
  opened while the transport plays and the open set has no unsaved changes; stopped, Live
  doesn't ask (both Live 12.4.25b1).
- A dialog is a window of its own, with no title: with "Save changes?" open, `cli.js
  windows` listed it (405 x 123 points) in front of two full-size windows, one untitled and
  one with the set's name. `cli.js capture --window <id>` captured it with its message and
  buttons; the main window's capture doesn't show it (Live 12.4.25b1).
- After a kill, Live starts at "Live unexpectedly quit... Would you like to recover your
  work?" (No, Yes). It isn't a LOM dialog, takes keys only with Live frontmost, and Escape
  doesn't answer it. Live asks while its recovery data (`CrashRecoveryInfo.cfg`, `Undo`,
  `BaseFiles` in its preferences folder) is there; `CrashDetection.cfg`, which reads
  "Running" while Live runs and is gone after a clean quit, doesn't decide it. With the
  data moved into `Crash`, Live starts with a new set and doesn't ask (Live 12.4.25b1).
  `relaunch.js` and `quit.js` move that data into `Crash` after a kill or a crash. `open -a`
  fails with error -600 for a few seconds after a kill, and `relaunch.js` retries a failed
  start for 15 s.
- While Live starts, AbletonOSC can answer while the LOM still reports a dialog with no
  message; it is gone a second later. `relaunch.js` waits for it to go.
- After File > New Live Set (`clickMenu`) with unsaved changes, the LOM can't read or press
  Live's "Save changes?" dialog. It reports no message and no buttons. `saveSetAs` into a
  temp folder first. `openSetAndWait`'s path (opening a file) does get the message.

## Saving and opening sets

- Live's Save panel counts as an open dialog over the LOM (no message, no buttons), and
  some requests fail while it is open (a fresh track's input routing reads ""). `saveSetAs()`
  closes the panel with Escape if it fails, and says so in its error if the panel stays
  open. Accessibility can't press its Cancel.
- A click in another app just after File > Save Live Set As... can bring that app forward
  after Live has come to the front (200 ms after the click, the other app was in front once
  `activate` had seen Live there). Keys typed then go to that app, and
  a save failed so, waiting for Go to Folder. `typeInLive` looks for Live in front in the
  script that types.
- With the app that was in front put back right after File > Save Live Set As... and Live
  brought forward again to type, the panel lost the typed name and folder in about one run
  of three, though it took Command-A, Go to Folder and Return. `saveSetAs`
  keeps Live in front from the click until the file is written.
- Live's Save panel takes keys about a second after it appears, and Go to Folder's
  highlighted suggestion lags the typed path: Return half a second after typing went to
  the previous temp folder. `saveSetAs` waits for both. Go to Folder lists the folder that
  holds the typed one, and with 15,857 entries there (the system temp folder) it was still
  "Loading..." when Return was pressed, which was lost. `saveSetAs` presses Return again
  until the sheet closes, and saves into a folder under the harness's own small
  `ableton-harness/`. Accessibility shows only that the sheet is open, nothing in it. With
  Live's windows on another Space, Live comes to the front without them. Accessibility
  lists no windows and `saveSetAs` can't find or close its panel. Keep Live on the Space the harness runs on.
- AbletonOSC keeps running across opening another set.
- `relaunch.js` and `quit.js` empty the harness's temp folder, where every set the harness
  saves or starts Live on is, while they hold UDP 11001, the port a check holds while it
  runs. So `quit.js` refuses while another client runs, also when Live isn't running.
- Lives of several editions and versions can be installed side by side, each with its own
  preferences folder. `relaunch.js` and `add-place.js` use the Live named by `--app`,
  `--suite` or `"app"` in `harness/local.json`, then, for `relaunch.js` only, the running
  Live, then the only one in `/Applications`, and refuse to guess between several.
- A new Live writes one `Temp Project` folder in `~/Music/Ableton/Live Recordings`, named
  for a time some seconds after it started, and records into it a set never saved or one
  saved outside a Live project (a lone `.als`). Quitting asks about deleting it only for a
  set never saved (Live 12.4.25b1). `relaunch.js` and `quit.js` delete the Temp Projects
  the quitting Live made.

## Menus and windows

The entries in this section were measured in Live 12.4 (12.4.25 betas) on macOS 26. Times
were measured on an Intel Mac, unless an entry says otherwise.

- Live updates its menus' check marks about a second after a change; `setToggle()` waits.
- Edit > Undo names a change made over OSC "Custom Action"; the same change made in the UI
  gets its own name (a track rename: "Track Name"). Checks of undo step names must make
  the change in the UI.
- `macos.js` addresses Live's process as "Live", which Suite and Beta share, so run one Live
  at a time.

### The pointer, the Info View and controls

- Live and Max take posted mouse events (`CGEvent`, HID tap) like a real mouse. Over a
  transparent `live.tab` above a `v8ui` with `ignoreclick`, both the Info View and the click
  reach the tab. The Info View's title is on the same row as the device titles, and it
  changes when the pointer moves.
- Over a knob of one of Live's own devices the Info View names the parameter, not always as
  the LOM does: Auto Filter's Frequency knob reads "Filter Frequency", and its Rate knob
  "LFO Frequency" while the LFO's rate is in Hz. A click on a knob, with no drag, leaves its
  value alone; on Auto Filter's LFO or envelope knobs it switches the display's strip to
  that section.
- A chooser in a device's panel (Auto Filter's LFO Wave) opens its menu as a window of its
  own over Live's, at window layer 101. Text recognition reads each row's icon as a word
  before the row's text ("w Wander"), reads the same icon differently from one capture to
  the next, and now and then misses a row's. The icons' words begin 4 to 18 points from the
  menu's left edge and the rows' texts 22 to 24, so `choose` takes a row's text from the
  column the texts begin in: "H" doesn't match the row read "JF S& H". The Info View names
  the chooser ("LFO Waveform"), not the rows. Over Auto Filter's filter display, its
  frequency dot included, the Info View reads only "Device".
- After Escape closed a menu, the Info View stayed blank while the pointer moved within the
  control that had opened it (3 points); moved onto it from 15 points away, it named it
  again. `device-ui.swift`'s hover starts 15 points left of the point and 10 above it.
- While a Max device's Map button waits for a target, the Info View still names the knob
  under the pointer on a device on another track, and the click makes the mapping (Auto
  Filter's Frequency, Dry/Wet and Resonance, with `settleMs` 1000). Not tried with both
  devices on one track.
- A knob of one of Live's own devices has 126 steps over its range and turns one step per
  point the pointer moves up, from the nearest step: from 0.5, 62 points up gave 0.9921
  and 63 gave 1.0. For every drag event it adds the vertical distance of the event's
  position from the press point, in whole points, to its value, and then, if that distance
  isn't 0, moves the pointer back to the press point. It reads neither the delta fields nor
  the sideways part, and a half point rounds toward the bottom of the screen. So a path of
  drag events over-turns it (10 events a point apart up turned 1 + 2 + ... + 10 = 55 steps),
  and one event at the end turns it by the distance. `device-ui.swift` posts that one event,
  with the whole distance in its delta fields, and releases the button where the pointer
  then is: the press point on Live's knob after a move with a vertical part, the end after
  any other and on other controls (ADR-0013). A drag is given in whole points; a fraction is
  refused, and so is a drag under 1 point on its longer axis, since such a drag crashes the
  helper with the button down.
- Controls that read where the pointer is end at the same value for a path and for one
  event, and neither read the delta fields nor move the pointer during the drag: a JUCE
  editor's horizontal slider (100 left took it from 1.0 to 0.3388), the Dry/Wet Mix slider
  of AUDelay's editor (10 right, 0.5 to 0.7145) and a Max for Live number box.
- A Max for Live number box (`live.numbox`, -100 to 100 %) turns in 2-point steps, however
  the drag is posted: 10, 20, 30 and 40 points turned it 16, 31, 47 and 63 % either way,
  but 5 points 9 or 10 % down and 6 or 7 % up, and 15 points 25 or 26 % down and 22 % up. A
  drag of 3 points moved it neither way, which the 2-point steps don't explain. Pressing at
  a fraction of a point gave the same change. A check drags a number box by a multiple of
  10 points, the distances measured to turn it the same either way; shorter even distances
  were not measured.
- Which modifiers change a drag on one of Live's own knobs (Auto Filter's Dry/Wet, 10 points
  up from 0.5, the helper's events carrying the modifier): nothing held turned 10 steps,
  Shift 1, Command 10, and Control and Option none.
- A held drag (ADR-0021) keeps the button down and posts nothing for its hold, then a second
  drag event at the press point plus both moves. Its second move is refused as any drag's
  move is, and so is a hold that isn't whole ms from 1 to 2000, before the pointer moves.
  Stop or an ending signal during the hold brings the button up at once. The helper looks
  for both every 10 ms while it holds. On Auto Filter's Resonance a drag 5 up, held 400 ms,
  then 5 up more turned 15 steps, where one drag 10 up turned 10. The knob counted the first
  event's 5 points, moved the pointer back to the press point, then counted the second
  event's 10 points from there. So a held drag over-turns Live's knob, as ADR-0021 says
  (Live 12.4.25b2).
- `device-ui.swift` holds SIGINT, SIGQUIT, SIGTERM and SIGHUP back while the button is down.
  It posts the button up where the pointer is, then dies by that signal. After SIGQUIT it
  exits with status 131 instead, as macOS writes a crash report for a process that dies by
  it. A helper that fails with the button down releases it the same way. A crash or
  SIGKILL still leaves the button held.

### Device titles and panels

Since ADR-0020 the harness finds a device from its Accessibility frame and reads no title as
text.

- The browser and the Info View can show a device's name in the same window as its title
  bar, left of 240 points.
- The status bar, along the bottom 37 points of Live's window, shows the selected track's
  name and the selected device's, right-aligned, and a short device name was read there as a
  second title (Live 12.4.25b2).
- Live draws a hand right after the title of the device a Control Surface controls. The
  text reader's first read of a device's title had no hand; every read after a press read
  the title as ") <title>\", the hand on the end of the last word. The cause is not known.
  The device was selected over OSC before every read, the first too, so selecting it is not
  what changed. The likely source, unverified: AbletonOSC's `Manager`
  subclasses `ableton.v2.control_surface.ControlSurface`, which sets up a device provider,
  and the names in Live 12's compiled `device_provider.pyc` (`_appoint_device_from_song`,
  `__on_selected_device_changed`) suggest it appoints the selected device.
- Live cuts a title too long for its device short with an ellipsis: a folded AUDelay's title
  bar reads "AUD..."; unfolded, the device is wider and it reads "AUDelay".
- Where the text recognizer puts the start of a device's title is off by up to a few points,
  by the title and by where the device is: from its title's reading, the same Utility's
  panel corner came out 2.0 points right of its body's edge as the first device on a track
  and 0.7 points left as the second, and Erosion's title read 2.2 points left of where
  Accessibility puts its text (Live 12.4.25b2, a 2x display). Accessibility's frame of the
  device's group in Device Detail doesn't move with the title. In Live's window the device's
  body starts 1 point right of it and 18 below, for Erosion, Utility, Auto Filter and
  Saturator, for the plug-in AUDelay and for the Max device Max Audio Effect alike, also
  after Device Detail scrolled to another device, and the title's text 4 points below its
  top. A Max device's presentation starts 2 points right of its body. The first device on a
  track had a 2-point dark outline left of its body on an Intel Mac and none on an
  Apple-silicon one. `device-ui.js` finds the panel from that frame (ADR-0020).
- A plug-in's title bar has two more buttons before its title than a Max or Live device's:
  Unfold Device Parameters and the one that opens the plug-in's window, 32 points in all.
  Over AUDelay's buttons the Info View reads "Device Activator", "Unfold Device Parameters"
  and "Assignable X-Y Control", and a click on the activator turns Device On off.
- Live 12.4 names much of its main window over Accessibility, unlike its dialogs: the
  Control Bar's controls, the browser's lists, and in Device Detail one group per device of
  the selected track, titled with the device's name and holding its title-bar buttons, a
  plug-in's "Show/Hide Plug-In Window" checkbox among them (value 1 while the window is
  open). The checkbox takes AXPress, which opens and closes the window as a click does, with
  Live in the background too.

### Plug-in windows and the click guard

- A plug-in's own window is titled `<device>/<track>` ("Plugin/1-MIDI"), floats at window
  layer 3, and holds Live's 19-point title bar above the plug-in's editor, which
  Accessibility shows as the window's one group, with the editor's frame. It is off screen,
  though open, while Live is in the background and while the display sleeps; it returns
  when Live comes to the front with the display on. A click posted while it was hidden went
  to Live's main window under it.
- A click on a JUCE plug-in's editor goes in at once, with Live's main window the key one:
  one click on a generic editor's toggle turned its parameter on, a second off, and clicks
  on three keys of a custom editor's segmented control each set its choice parameter (on an
  Apple-silicon Mac). Accessibility showed the generic editor's slider and toggle without
  their labels, so it can't confirm the control under the pointer as the Info View does in
  the device view (ADR-0008); a plug-in's own components name themselves only if the
  plug-in gives them names (not tried).
- Because a plug-in's window floats at layer 3, a check of the normal (layer 0) windows
  doesn't see it, and a click aimed at the device view under it would go to the plug-in.
  `device-ui.swift` refuses a click unless the window aimed at is topmost among the windows
  of every layer below the cursor's, and counts a window that reports no layer as a normal
  one (none was seen to). The one exception is harness-computer-use's border (ADR-0012), at
  the screen-saver layer (1000) over every app, which lets clicks through; macOS reports its
  program's name cut short to 32 characters, so the guard matches the start of it with the
  border's title. A click's hover takes about 240 ms, and a window shown over the point in
  that time took the click, so every click and drag checks again after its hover, before
  the button goes down.
- Live shows a plug-in's window only while the plug-in's track is selected: with two tracks
  of one name, each with AUDelay, opening the second's window left one window of that title
  on screen, and once that track was deleted, the first's window wasn't on screen either. So
  two windows of one title, which the guard refuses, can't be put on screen by the harness,
  which opens a window only for a device whose name is the only one on its track. AUDelay's
  window is 484 x 274 points, with its editor, 444 x 80, at the bottom. Moved to the
  screen's top through Accessibility, the window stops below the menu bar, 30 points down,
  so the editor can't come under harness-computer-use's pill.
- While a notification banner shows, from any app, Notification Center holds a transparent
  window the size of the screen at layer 21, gone about 4 s after the banner appeared on an
  Apple-silicon Mac and 5.3 s after on an Intel one; a second notification in that time
  keeps it up until about 5.3 s after the second. The
  click guard waits up to 10 s for it to go before it checks the point, and refuses after
  that; a helper waiting for it leaves the wait once the run is stopped, posting nothing.
  harness-computer-use's own notification at the end of a run brings it up too.
  `checks/pointer-target.swift` reports its window only once no cover is up.
- harness-computer-use's pill is a window of its own (title "harness-computer-use pill"), a
  non-activating panel that takes a click on its Stop without taking the front. Unlike the
  glow, the click guard doesn't skip it. A point under the pill is refused, with an error
  that names the pill.

## Stop, the stop key, and the window server

### Stop

- Stop on the pill removes the run's click token, a file `device-ui.swift` must be able to
  open for reading, in a folder it must be able to write to, before every mouse event it
  posts but a button-up (ADR-0012). A helper that finds it gone posts nothing more, or only
  the button-up if the button is down. It exits with status 3 when nothing happened (a drag
  stopped before its move is released at the press point with no drag event), and with
  status 4 when the click or the drag happened and only the release was left. The button-up
  reached the check's window 50 to 80 ms after the token went. A press whose helper exits
  with status 4 throws with `done` on its error, one with status 3 without it, and the
  run's next press throws too.
- Any other loss of the token counts as stopped, since the helper can't tell that the run
  wasn't: its folder removed or made unwritable, or the token unreadable.
- Stop pressed through Accessibility (AXPress on its Stop button, as
  `checks/press-stop.swift` does) is taken as a click on it, as is a real click posted on
  it. The press returns -25204 (cannot complete) when the overlay ends before it answers,
  and during Stop's last resort it returns about 1.6 s after it was started, the overlay
  still up. It removed the token 71 to 123 ms after the press was started, longer than a
  click's 70 ms hold, so `checks/pointer-guards.js` has `checks/pointer-target.swift
  --freeze` suspend the helper (SIGSTOP) at one of its events to land Stop inside a gesture,
  and lets it go on (SIGCONT) once the token is gone. A sleep runs on while its process is suspended, and isn't cut short when the process
  is let go on.
- Stop goes by whether the token went, removed by it or gone already, not by whether the run
  can read it. A token still there (its folder unwritable, or the token user-immutable,
  `chflags uchg`) takes Stop's last resort, which sends the run SIGUSR2 and keeps the border up
  until the run has ended, and kills a run still there 10 s after the signal (ADR-0012 says
  why that signal, and why 10 s); a killed run dies before its clean-up and leaves its
  tracks in Live. On the signal the run counts itself stopped, passes the signal on to the
  helpers it has running, and goes on, so that a check fails at the press that throws and
  still cleans up; a helper sent the signal stops as after Stop. A stopped run finishes the
  step it is in before it throws: one stopped as it began to read a menu `choose` had opened
  ended 4.2 and 4.6 s after Stop, 1.5 and 1.8 s of which were a wait added for the
  measurement, so a kill 5 s after the signal leaves too little room for its clean-up. The helper of a run that doesn't act on the signal is free to click
  until the kill.
- After an ordinary Stop the glow goes at once and the pill stays alone; after Stop's last
  resort the glow stays with it. The pill stays, its button reading Stopping with a light
  going round it, until the run's process has ended, and only then does the overlay say
  Stopped and notify (ADR-0015). Over a run still going 10 s after Stop removed its token,
  the overlay goes, notifying that the run was stopped and is still running, and kills
  nothing. The glow's windows stay on screen 0.3 s after they are ordered out while their
  closing animation is on, so the overlay turns it off.
- A run killed by a signal sent to it alone (SIGTERM) leaves its click token behind, since a
  run removes the token's folder only on a normal exit. So `device-ui.swift` posts only while
  the process that started it is still its parent. A run that has ended counts as stopped,
  and a helper waiting under a notification's cover is gone about 0.2 s after its run is
  killed. A helper whose run ended before it began has process 1 for a parent from its
  first instruction, and counts its run as ended from that. `checks/run-orphaned.swift`
  starts the helper suspended (`POSIX_SPAWN_START_SUSPENDED`) from a process that then
  ends, and reads its exit status from the kernel's event queue (`EVFILT_PROC` with
  `NOTE_EXITSTATUS`), which gives it for a process of the same user that isn't one's child.
- Ctrl-C typed into the terminal of a run (a pty) while its helper holds the button reaches
  the helper as SIGINT, and the button comes up within 15 ms.
- A run that can't remove its token's folder as it ends, the folder being unwritable, leaves
  the folder and ends with its own status. An error thrown as the process ends becomes the
  run's exit status (node's `ENOTEMPTY`, status 1), so the run ignores a failure to remove
  the folder.
- Stop pressed before the overlay has said that its windows are on screen leaves the glow
  out, and the overlay says `shown` once the pill is listed, since the glow's windows, taken
  down, are never listed. An overlay that doesn't find its windows listed ends
  with status 1 two seconds after it began to look, with no notification, and its run warns
  that it clicks with no border. Which windows to wait for can't be taken from
  `NSWindow.isVisible`, which read visible for windows the window server didn't list.
- `computer-use-overlay` refuses a process id of 0 or below. Stop's last resort signals that
  id, and to `kill` 0 is the caller's own process group and -1 every process the user may
  signal.
- Stop pressed once the run has ended says that the run has ended, not Stopped. The overlay
  looks for its run every 0.25 s and then says the same by itself.
- A run that has ended and that its parent hasn't waited for stays in the process table as a
  zombie (`ps` gives its state as `Z`) and still answers signal 0. `sysctl` gives its state
  (5, `SZOMB`), where `proc_pidinfo` fails with `ESRCH` as for one that is gone, so the
  overlay reads the state too. The process that started a run can therefore read what the
  overlay says of the run's end before it hears of that end itself, by under a millisecond,
  when it is busy as the run ends (left idle, it heard of the end first);
  `checks/pointer-guards.js` allows the words 10 ms.
- `Process.waitUntilExit()` runs the run loop while it waits, so a timer can fire meanwhile:
  an overlay waiting that way for its notification notified twice. The overlay waits for its
  notification without running the run loop.
- A run has one click token. Every border it shows is given the same one, and the run names
  it to each helper it starts, in that helper's environment (`HARNESS_COMPUTER_USE_TOKEN`),
  and nowhere else, so a token named in the environment a run starts with neither stops the
  run nor reaches its helper.
- After Stop, `choose` closes a menu it had opened only while Live is still in front, and
  doesn't bring Live there; Escape typed with Live in front, with no activation, closes a
  chooser's menu. `device-ui.js` refuses to bring Live forward once the run is stopped, for
  a press and for a capture of a plug-in's window alike. It looks again just before it tells
  Live to activate and, where it brings Live forward to type Escape, once more before the
  key, which the one script that finds Live in front types. A Stop that lands after the last
  look still finds Live brought forward (ADR-0012). A capture of a plug-in's window gives
  the front back to the app that had it only if it brought Live forward.
- A press doesn't wait for its reads of Live's window to end once stopped. Stop during the
  read that finds the device, or the Info View's after the hover, rejects the press within
  0.1 s, and the read, which posts nothing, ends on its own. `choose`'s read of its open
  menu still ends first.

### The stop key and modifiers

- harness-computer-use's stop key, Control-Option-Command-Space, is a system hot key that
  the overlay registers (`RegisterEventHotKey`), with no permission asked (ADR-0017). With
  keys posted as events, the overlay got the key whether its modifiers came as key presses
  of their own or only as flags of the key, and the app in front got the modifiers but not
  the key, also with a mouse button held down in its window and with secure input on.
  Claimed without the exclusive option by two programs it goes to both, and against
  Spotlight's Command-Space to the program and Spotlight. The overlay claims it exclusively.
  A second overlay's claim is refused (`eventHotKeyExistsErr`), its pill shows no key and
  its Stop still stops its run; a program holding the key the ordinary way doesn't block the
  overlay and loses the key while the overlay holds it, and one holding it exclusively makes
  the claim fail. An overlay killed with SIGKILL gives the key up, and so does one that has
  said its last words and still waits for its notification. Pressed with Live in front, the
  key doesn't start Live's transport. Pressed during the overlay's start, the key is taken
  before its windows show; posting the whole chord about 800 times a second held up the
  start by seconds. A claimed plain Escape caught an Escape posted with no modifiers. Not
  tried: a real keyboard, and whether a claimed Escape catches the Escape the harness types
  through System Events.
- A click the helper posts while modifier keys are held carries them, and a person pressing
  the stop key holds its modifiers first, so a click in flight then can reach Live as a
  Control-Option-Command click. The Escape that closes a menu after Stop waits until no
  modifier is held, for 2 s at most, and isn't typed if one still is (ADR-0017).
- Trap: a posted mouse event with its modifiers cleared lets go of the modifiers held, for
  every app, keys held on a real keyboard included. With the helper clearing them and
  modifiers held by posted key events, its events carried none, but the keyboard's state
  (`CGEventSource.flagsState(.combinedSessionState)`) read none held from the hover's first
  move to the button-up; the same came of events from a private event source and of events
  posted at the session tap, both measured only with modifiers held by posted key events.
  With keys held on a real keyboard, one such move left the HID system table, the combined
  session table and AppKit reading none held for at least 1 s, the keys still down (on an
  Apple-silicon Mac). So the helper builds its events from the HID system state, carrying
  what is held.
- Trap: a posted key event (`CGEvent` from the HID system state, at the HID tap) that
  carries modifiers as its flags leaves them held, for every app and every later posted
  event, until their release is posted: a drag then turned a slider by the step it takes
  with a modifier held. `press-key` posts the release however it ends but SIGKILL, and
  `pointer-guards.js` fails a key case that leaves a modifier held, naming it, and lets it
  go.

### The window server and captures

- With no window server, as for a process with no desktop session, a program gets no session
  (`CGSessionCopyCurrentDictionary()` is nil), no screens, and windows that say they are
  visible and never show, all with no error; `display dialog` fails there with -1713, "No
  user interaction allowed". So a run there is refused at the dialog (ADR-0006), and
  `computer-use-overlay.swift` checks the session and ends with the reason.
- The window server lists the border's windows 0.6 to 1.4 s after its program starts, which
  is when the program prints `shown`; the run waits for that before its first click. A
  border started while the display sleeps makes its windows then, and draws them once the
  display wakes.
- When the border's program can't be built, a run on a machine that isn't the click host
  warns that it can't show its border, with the compiler's command and first error, and its
  dialog says "Nothing on screen will show that it may take the pointer, and there will be
  no Stop and no stop key." Don't Allow, the default, refuses the run's clicks, and Allow lets them, with no
  border.
- A mouse event posted as the last thing a program does is lost: a button-up posted just
  before exit left the button held, and with 100 ms between the post and the exit it came
  up. `device-ui.swift` waits 100 ms after every button-up.
- The window server doesn't list a window an app has just ordered front until the app's run
  loop has run, 50 to 70 ms after the loop starts; a click posted in between was refused
  with the window under it named as the window at the point. `checks/pointer-target.swift`
  reports its window once it is listed.
- While the display sleeps, `screencapture -l` fails with "could not create image from
  window", and the session reports the screen locked until the display wakes. `device-ui.js`
  wakes the display before a capture or a press, and the helper waits up to 3 s for the lock
  flag to clear (`requireUnlocked`).
- A Live started while the display slept never redrew its window: with the LOM at 2 tracks,
  captures of the window and of the whole screen showed the 1 track it opened with, and
  waking the display, bringing Live to the front and resizing its window changed nothing.
  Started with the display on, the same steps drew every change. `relaunch.js` keeps the
  display on until Live is up (`keepDisplayOn` in `macos.js`); a Live started otherwise
  while the display slept needs a relaunch (Live 12.4.25b1).
- A video (`video.js`, ADR-0016) records a window as `screencapture -l` captures it: behind
  other windows, without harness-computer-use's border and pill, the pointer included; Live
  in the background shows its title bar inactive. While the display sleeps a recording gets
  no frames, and a ScreenCaptureKit recorder, the kind `video.swift` is, started with the
  display asleep makes no file, so `video.js` wakes the display first. The helper keeps the
  display from idle sleep while it records, but a display put to sleep on purpose (`pmset
  displaysleepnow`) still sleeps, up to about a second late, and the video freezes from then
  on, which `checks/video-record.js` catches by comparing frames.
- An ssh session that ends, its local ssh killed as Ctrl-C on `remote.sh` kills it, sends
  the command it ran no signal. The command runs on, and only the other end of its stdout
  and stderr is gone. A `cli.js video` whose ssh was killed stops then, as its helper
  watches the run's stderr, and leaves a whole video.
- `screencapture` refuses a file name that starts with a dot ("cannot write file to intended
  destination") and still exits 0; a file in a hidden folder it writes. It also exits 0,
  saying the same on stderr, when the file's folder doesn't exist or can't be written, and a
  file already at the path stays as it was. So `captureWindow` has `screencapture` write
  `<name>-capturing-<random>.png` beside the file (`<random>` 8 hex digits new for each
  capture) and replaces the file only once that is there. Each case throws `DeviceUiError`
  naming the file, `cli.js` exits 1, and a file already there is left as it was. A
  read-only file in a folder that can be written is replaced. A run killed while it captures
  can leave the file beside a path the caller gave, where nothing deletes it; in the
  captures folder it is in the `.unfinished` folder, whose prune deletes it once it is 7
  days old and another capture is saved there. `startCapture` makes a missing folder first,
  for `cli.js capture`, `plugin-window`, `video` and `video-frame` alike; one it can't make
  throws an error naming the file before anything is captured. `captureWindow` called with
  a path of its own still throws on a missing folder.
- `ui.capture` crops its capture of Live's window with the helper's `crop`, as a capture of
  a plug-in's editor does. The crop gives its PNG the capture's resolution (144 dpi on a 2x
  display); without it the PNG read as 72 dpi. It takes its rectangle in points and rounds
  each edge to a pixel, so a rectangle inside the image can't end a pixel past its edge. A
  device whose frame isn't wholly inside Live's window is refused before anything is
  captured, with an error that names it and says to bring it into view (unit tests; not made
  to happen in Live).
- openrsync with `--remove-source-files`, failing on one listed file it couldn't read,
  copied the other file it was given but didn't delete its source, and exited non-zero;
  `remote.sh` names what it copied, and a later run finds that name already on this Mac.
- macOS checks a new program the first time it runs: a new shell script took 0.60 to 0.67 s
  from its start to its first line, and a link to one that had already run 0.01 to 0.02 s.
  The unit tests run their stand-ins through Node or make them once a file;
  `device-ui.test.js` runs its one before any test times a stand-in.

## Tracks and devices

- New MIDI tracks get the devices of Live's default MIDI track template; `createMidiTrack()`
  removes them so they can't alter a recording.
- A property that doesn't apply to a track or a clip raises in the LOM (`fold_state` on a
  track that isn't a group); AbletonOSC answers nil for it, and `trackData()` passes that on
  as null (`fold_state` read null on a MIDI track, Live 12.4.25b1). The harness
  refuses rather than guess: `recordArrangement()` when a track that can be armed reads no
  `arm`, `arrangementClips()` when a clip reads no value for one of its properties, and
  both when a reply isn't whole rows.
- `createTrack()` makes MIDI and audio tracks only and refuses another kind. A return track
  isn't among the song's tracks, so the last of those would be renamed and stripped instead.
- New audio tracks get the devices of Live's default audio track template, as MIDI tracks
  do; `createAudioTrack()` removes them.
- A Max for Live device's parameters arrive seconds after the device; `loadDevice()` waits.
  A Max device with no parameters lists only Device On, and nothing else the harness reads
  (its name, `is_active`, `class_name`) changes once it has loaded (Live 12.4.25b2), so
  `loadDevice()` can't tell it has loaded. Pass `{ parameters: 0 }`. In Live 12.4.25b2
  a Max device's parameters were there at the first read, also on the first Max device after
  a relaunch. The version the delay was seen in isn't recorded.
  Their names are the short names, which can repeat within a device. Live lists the visible
  (automated) parameters after "Device On" sorted by long name, which
  `parameterIndices()` uses to map long names to indices. Stored Only parameters are not
  in the list and cannot be set. The sort order is presumably Max's `parameter_order`
  attribute at its default of 0 (not verified); a device that sets it breaks the mapping,
  which `parameterIndices()` then reports.
- The browser lists `.amxd` devices without the extension.
- Live crashes loading an `.amxd` whose patcher has a `project` without a `searchpath`. Max
  reads it unchecked while it builds the device (seen in Live 12.4.25b1).
- A track whose MIDI From source is deleted can no longer be armed or disarmed ("The Track
  in question cannot be armed!"). Delete the recording track before its source.
- Live's input routing list follows a track rename a tick later, and the routing setter
  only logs an unknown name; use `setInputRouting()`, which waits and checks.
- A From is picked by track name, and reads back as that name whichever of two tracks so
  named it came from (Live 12.4.25b2), so a set holding tracks of an earlier check's names
  records those. `setInputRouting()` refuses a name two other tracks hold, so
  `signalTracks` fails in such a set. Delete the old tracks first.
- Loading a device from the browser selects its track.
- A MIDI source the harness makes (`midi.js`) was a MIDI input within 2 s, Track on by
  default. With Remote turned on for it once, Live keeps that after the port closes and
  reopens and after a relaunch (Live 12.4.25b2).
- `device-ui.js` presses work in MIDI Map and Key Map Mode. The Info View still names the
  control. A press then a CC maps the control; a press then a key, typed with Live in front,
  maps it to the key, and the key toggles the parameter between its ends (Auto Filter, Live
  12.4.25b2).
- The text recognizer, run over Live's whole window, can miss the Info View's title or read
  it wrong while Live shows it plainly: in a Live that had run a device's checks for a
  while, a knob's name read as nothing with MIDI Map Mode off and as a misspelling with it
  on, and read right again after a relaunch. Read from a crop of the Info View's title row only, it read right in both
  modes, every time (Live 12.4.25b2). `device-ui.js`
  reads the Info View from that crop after its hover.
- `-EnableArmOnSelection` is an optional Options.txt entry; without it, none of this
  applies. With it, the arm follows the selection. While a track is armed, selecting another
  moves the arm to it; with no track armed, selecting a track arms nothing (Live 12.4.16).
  Loading an instrument armed its track. `signalTracks` disarms the source track after loading its
  instrument, or `recordArrangement` refuses. Loading a MIDI effect onto a track, with no
  track armed, armed nothing.
- `/live/view/set/selected_track` once left the selection unchanged, with no error sent or
  logged: after a track had been armed, recorded in the Arrangement (`recordArrangement`)
  and disarmed, setting another track and then `sync()` still read the old track from
  `/live/view/get/selected_track`, and the Detail View still showed it (Live 12.4.16, in
  Arrangement view). The cause is not known.
  `/live/view/set/selected_device` on a device of the wanted track selected that track.
  Read `get/selected_track` back after setting it. `/live/browser/load` does, and refuses,
  loading nothing, when the track it selected isn't the selected one.
- A value listener left on a parameter by an earlier session kept sending after its client
  was gone (`stop_listen` answered "Observer not connected"). Its updates arrive on
  `/live/device/get/parameter/value`, the address a `parameter/value` query answers on, so
  every such query returned the listened parameter's value; the `parameters/value` list was
  unaffected. Queries answered right again once the device holding the listener (a Utility)
  was deleted. The harness doesn't guard against such a listener.

## Recording and timing

- Note times from `/live/clip/get/notes` and `/live/arrangement_clip/get/notes` are in the
  clip's own time. `songNotes()` places an Arrangement clip's notes in song beats, including
  loop repeats.
- Live's note range is a start pitch and a count of pitches: 0 and 127 cover pitches 0 to
  126. A time range is a start and a length, and a note can sit anywhere in a clip's time:
  one placed at -9000 or 20000 beats is kept there. So with no arguments, the note queries
  read every note with `Clip.get_all_notes_extended()`, and `/live/clip/remove/notes`
  removes them by their ids, rather than through a fixed range. On 387 notes
  at every pitch, at times from -9000 to 20000, `get_all_notes_extended()` returned all of
  them, in a Session and an Arrangement clip, in `get_notes_extended()`'s order, pitch then
  time, which the callers rely on (Live 12.4.25b2).
- A relocation ends an Arrangement recording. Setting `current_song_time` while Live records
  (or `/live/song/jump_by`) turns Record off and Play goes on from the new place, so the take
  ends at the jump. Read 0.15 s after a jump from beat 4 to 20, `record_mode` was off and
  Play on, and the MIDI take ended at beat 4.4; the same with `jump_by` 16, and an audio take
  ended the same way (Live 12.4.25b2).
  `recordArrangement()` throws when Record is off after a `during` action or at the end, rather
  than return a short take. A loop's end doesn't end the take. To record across a jump, record
  in the Session. Fire a clip slot on the armed track and relocate while it records.
- Play starts from the start marker, `Song.start_time`; `recordArrangement()` sets it to
  `start` and leaves cue points alone. Setting `current_song_time` while stopped doesn't
  move the marker, Stop while stopped puts it back at 0, and turning `record_mode` on while
  stopped starts Play at once, so the marker goes first. Don't reach a start through a cue
  point. In some sets a cue point added while stopped snaps to the bar.
- `start_playing` while Live plays restarts Play from the start marker (beat 1.516 jumped
  back to 0.186). When an audio buffer runs between `record_mode` and `start_playing`, the
  take records that buffer before the restart. From sample 129 on, such a take sat one
  buffer (128 samples) late against its file (3 takes of 200, on an Intel and an
  Apple-silicon Mac, Live 12.4.25b2). So `recordArrangement()` sends `start_playing` only if
  `record_mode` didn't start Play.
- While any track's Session clip is active (`playing_slot_index` 0 or more, even with the
  transport stopped), Live starts Play from the bar at or before the start marker, in bars of
  4 x numerator / denominator beats from beat 0 (time signature changes in the Arrangement
  are not seen). `recordArrangement()` then refuses a start off a bar line, naming the bar
  Live would use. Start on a bar line, stop the clips, or record from 0. Stop while the transport is stopped leaves the
  clip active (measured in Live 12.4.15b7), so the Stop
  `recordArrangement()` sends before Play doesn't change this.
- With Automation Arm on, a parameter changed while Live records (a `during` action) is
  written as automation on the device's track and replays later. `recordArrangement()`
  turns Automation Arm off while it records, or on with `automation: true`, to write
  automation, and puts it back as it was afterwards. Live writes it with no track armed
  (`checks/automation-record.js`, Live 12.4.25b2).
- Live records audio as WAV at the record bit depth (see "Record bit depth" in `README.md`) and the
  audio device's rate, into the set's `Samples/Recorded`, named
  `<track> 0001 [<date> <time>].wav`; `file_path` of the
  Arrangement clip gives it. The take starts at the recording's start: notes at beats 0, 1,
  2 began within 3 samples of their beat at 120 BPM. A track whose input is another
  track's Post FX and monitoring In passes that signal without being armed.
- Overlapping notes of the same pitch in a clip came back shortened once (inferred to be
  Live trimming the overlap); keep test fixtures free of same-pitch overlaps. The default
  test clip in `device-checks.js` has none, and the harness checks no other fixture for them.

## Plug-ins

- When a plug-in is rebuilt while Live runs, Live keeps playing the build it loaded until it
  relaunches: a check after a fix failed exactly as before until a relaunch, and a run played
  the old build while the first load after a relaunch played the new one. That Live keeps the old binary mapped
  is inferred. A plug-in installed while Live runs is listed only after Settings > Plug-Ins >
  Rescan or a relaunch. `relaunch.js --plugin` names the component it loaded and when its
  code was built.
- A plug-in's parameters are DeviceParameters only when it has at most 64 (Ableton's help
  documents the Options.txt entry `-_PluginAutoPopulateThreshold`, default 64, range 1 to
  128; not tried here, as it needs a Live restart). Above that, Live lists only "Device On" (and sometimes "Bypass") until
  parameters are added in Configure mode. A plug-in with more than 64 showed this (Live 12.4.25b1).
  So `loadDevice()` takes a plug-in's count once it has held for a second, even at 1, where
  a Max for Live device must also list more than Device On.
- Live keeps a plug-in's configured parameters in the set. The device's `ParameterList`
  holds 128 pairs of slots, a `PluginFloatParameter` (Id 2i) then a `PluginEnumParameter`
  (Id 2i+1), each with a `ParameterId` (the AU parameter ID, -1 when free), a
  `ParameterName`, a `VisualIndex` (the order Live lists them in), a `Manual` value and,
  for enums, a `LastItemCount`. Live puts the parameter at index i of the AU's
  `ParameterList` in pair i, in the slot of its kind, and leaves the other empty (seen for
  a plug-in Live populated itself); its own population lists them in that order. Filling slots that way and reopening the set makes Live list them, settable
  over the LOM (`plugin.js`). Filled instead into the first free slot of each kind, so a
  float and an enum shared a pair, every parameter read back in Live but some floats never
  reached the plug-in: with one plug-in, one float did not while another did.
  `Manual` is the value Live shows, not read from the plug-in nor pushed into it at load. A
  float with `Manual` below its default showed the `Manual` while the plug-in held its
  default. The value is normalized 0..1 for a float
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
  output is quiet, and the plug-in's reported tail does not stop it. Seen in Live 12.4.25b1
  (VST3, 44.1 kHz) with a plug-in fed bursts of noise: the recording drops
  to exact zero in runs of 12928 to 13184 samples (about 0.3 s), each starting on a
  512-sample boundary, while the input is silent between bursts and the plug-in's output is
  a decaying tail under 2e-6 (about -114 dBFS); an offline render matches everywhere else.
  The plug-in passes its output through unchanged, and reporting a tail (0.25 s tried)
  changed nothing. The level is not a fixed floor: in Live 12.4.25b1 (VST3, 48 kHz, 32-bit
  float), another plug-in's recording equalled its offline render to the
  bit through a 50 ms noise burst and into a slow 20 Hz tail with the input silent, then
  read exact zeros where the render read up to 6.0e-6 (about -104 dBFS), the largest
  difference at the same sample (9504 after the signal starts) on two runs. A check that
  skips recorded zeros where the render is quiet needs its floor above the loudest output
  Live has zeroed. The rule Live applies is not known.

## Logs and settings

- Places are in `Library.cfg` in Live's preferences folder, one file per Live version. Two
  entries with one `Id` make Live reject the whole file as corrupt, and AbletonOSC then
  doesn't answer. Live renumbers the `Id`s between launches, so an `Id` can't
  be kept. `add-place.js` makes the edit.
- A build copied into a Places folder while Live runs is listed within seconds: 2.2 s by
  `cp` and by `remote.sh`'s rsync, 4.3 s with the display asleep. A Live can also miss a new
  build until a relaunch, for a reason not known.
- Live logs every Max console message to `~/Library/Preferences/Ableton/Live <version>/Log.txt`
  (the version without a Beta's build, such as `Live 12.4.25b1`), appended to at each launch
  after an `info: Started: Live <version>` line, as
  `<local time, microseconds>: error: Message from Max:  <text>`. A gen~ codebox
  that fails to compile ("declarations must come before any expressions") leaves a device
  that loads, answers OSC and outputs silence, with the reason only there. `cli.js max-log`
  prints these messages since a given time or since Live started.
- Live keeps its settings in `Preferences.cfg` in its preferences folder, a binary file
  `settings.js` reads (its layout is at the top of that file, worked out from Live
  12.2 to 12.4.25b1's files). Bit Depth is `SongPrefData.RecordBitDepth`: 1 is 24-bit
  and 2 is 32-bit float, matched with the takes Live recorded at each; 0 for
  16-bit is inferred, not seen. Live writes the file when its Settings window closes, not
  when a setting changes: a sample rate changed with Settings open was in the file only
  once it closed. `recordSignal` checks each take's bit depth in its WAV header in case the
  file lags the setting.
  The file holds the sample rate as `SongAgent.AudioInOut.AudioInOutData.SampleRate` (a
  float, in Hz), named `SelectedSampleRate` from the 12.4.15 betas on, outside the
  `PreferenceMembers` that `readSetting` finds.
- Live logs its sample rate to `Log.txt` (`info: Audio In Out: Sample Rate: 48000`) each
  time its audio engine starts: at launch, and within a second of a change in Settings,
  with Settings still open. Changes from 44100 to 48000 and back matched the output
  device's rate; Live 12.4.16 logs the same line. Live starts a new `Log.txt` from time to
  time; whether it does while running isn't known, and `sampleRate()` throws when the log has no such line.
