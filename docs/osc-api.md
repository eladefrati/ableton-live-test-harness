# OSC API

This page lists the OSC addresses AbletonOSC answers. "Usage" in the
[README](../README.md#usage) says how to reach them.

Setters and methods send no reply unless a row gives response params. Indexes count from 0.
`clip_index` is a clip slot's position on its track, which is also its scene's index.

## Application API

<details>
<summary>Addresses</summary>

### Application methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/test | | 'ok' | Show a confirmation message in Live, and send `ok` to `/live/test` |
| /live/application/press_current_dialog_button | button_index | | Press a button of the open dialog. "Save changes?": 0 Don't Save, 1 Cancel, 2 Save |
| /live/api/reload | | "ok", or "error", message | Reload every AbletonOSC module and register again the handlers listed in `abletonosc.HANDLERS`. A new handler module needs an import in `abletonosc/__init__.py`, an entry in that list, and a reload |
| /live/api/show_message | message | | Show a message in Live's status bar |

### Application getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/application/get/version | | major_version, minor_version | Query Live's version |
| /live/application/get/average_process_usage | | average_process_usage | Query Live's average CPU load |
| /live/application/get/open_dialog_count | | count | Query the number of Live dialogs open, such as "Save changes?" |
| /live/application/get/current_dialog_message | | message | Query the open dialog's text |
| /live/application/get/current_dialog_button_count | | count | Query the open dialog's number of buttons |
| /live/api/get/log_level | | log_level | Query the current log level. The default is `info` |

### Application setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/api/set/log_level | log_level | | Set the log level: `debug`, `info`, `warning`, `error`, or `critical` |

### Application status messages

AbletonOSC sends these messages without a request.

| Address | Response params | Description |
|:--------|:----------------|:------------|
| /live/startup | | Sent when AbletonOSC loads its handlers: when Live starts it, and on each `/live/api/reload` |
| /live/error | error_msg | Sent when AbletonOSC logs an error. For more diagnostics, see `logs/abletonosc.log` |
| /live/application/get/average_process_usage | | Sent with no value when AbletonOSC loads its handlers |

</details>

---

## Song API

`/live/song` addresses the open set as a whole. It starts and stops playback, creates and changes
scenes, creates cue points and jumps to them, and sets global values such as the tempo and the
metronome.

<details>
<summary>Addresses</summary>

### Song methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/song/capture_midi | | | Capture the MIDI played recently into a clip |
| /live/song/capture_and_insert_scene | | | Capture the playing clips into a new scene below the selected scene |
| /live/song/continue_playing | | | Resume playback from the playback position |
| /live/song/create_audio_track | index | | Create an audio track at `index` (-1 for the end of the list) |
| /live/song/create_midi_track | index | | Create a MIDI track at `index` (-1 for the end of the list) |
| /live/song/create_return_track | | | Create a return track |
| /live/song/create_scene | index | | Create a scene at `index` (-1 for the end of the list) |
| /live/song/cue_point/jump | cue_point | | Jump to a cue point, given its name or its index in the list of cue points |
| /live/song/cue_point/add_or_delete | | | Add a cue point at the playback position, or delete the one there |
| /live/song/cue_point/set/name | cue_point_index, name | | Rename a cue point, given its index |
| /live/song/delete_scene | scene_index | | Delete a scene |
| /live/song/delete_return_track | return_track_index | | Delete a return track |
| /live/song/delete_track | track_index | | Delete a track |
| /live/song/duplicate_scene | scene_index | | Duplicate a scene |
| /live/song/duplicate_track | track_index | | Duplicate a track |
| /live/song/export/structure | | 1 | Write the tracks, their clips, and their devices, with each device's parameters, to `abletonosc-song-structure.json` in the system's temporary folder |
| /live/song/force_link_beat_time | | | Move the Link timeline to Live's current beat time |
| /live/song/jump_by | time | | Move the playback position by `time` beats |
| /live/song/jump_to_next_cue | | | Jump to the next cue point |
| /live/song/jump_to_prev_cue | | | Jump to the previous cue point |
| /live/song/master_track/delete_device | device_index | | Delete a device from the Main track |
| /live/song/move_device | track_index, device_index, target_track_index, position | device_index | Move a device to `position` on another track, keeping the instance and its state. The reply is the device's new index |
| /live/song/redo | | | Redo the last undone operation |
| /live/song/re_enable_automation | | | Re-enable automation in all running Session clips |
| /live/song/set_or_delete_cue | | | Same as `/live/song/cue_point/add_or_delete` |
| /live/song/start_playing | | | Start playback |
| /live/song/stop_playing | | | Stop playback |
| /live/song/stop_all_clips | | | Stop all clips |
| /live/song/tap_tempo | | | Tap the Tap Tempo button once |
| /live/song/trigger_session_record | | | Trigger Session recording |
| /live/song/undo | | | Undo the last operation |

### Song properties

`/live/song/start_listen/<property>` listens to a property in the Getters table below. AbletonOSC
replies once with the current value, then sends `/live/song/get/<property>` with
`<property_value>` on each change. `/live/song/stop_listen/<property>` stops it. The Live Object
Model marks `can_redo` and `can_undo` as not observable, so listening to them fails with
`/live/error`.

The [Live Object Model's Song page](https://docs.cycling74.com/apiref/lom/song/) describes each
property and its values.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/song/get/arrangement_overdub | | arrangement_overdub | Query whether MIDI Arrangement Overdub is on |
| /live/song/get/back_to_arranger | | back_to_arranger | Query whether Back to Arrangement is lit |
| /live/song/get/can_redo | | can_redo | Query whether redo is available |
| /live/song/get/can_undo | | can_undo | Query whether undo is available |
| /live/song/get/clip_trigger_quantization | | clip_trigger_quantization | Query the clip trigger quantization |
| /live/song/get/current_song_time | | current_song_time | Query the song time, in beats |
| /live/song/get/groove_amount | | groove_amount | Query the groove amount |
| /live/song/get/is_ableton_link_enabled | | is_ableton_link_enabled | Query whether Ableton Link is on |
| /live/song/get/is_playing | | is_playing | Query whether the song is playing |
| /live/song/get/loop | | loop | Query whether the Arrangement loop is on |
| /live/song/get/loop_length | | loop_length | Query the loop length |
| /live/song/get/loop_start | | loop_start | Query the loop start |
| /live/song/get/metronome | | metronome | Query whether the metronome is on |
| /live/song/get/midi_recording_quantization | | midi_recording_quantization | Query the MIDI recording quantization |
| /live/song/get/nudge_down | | nudge_down | Query whether Nudge Down is pressed |
| /live/song/get/nudge_up | | nudge_up | Query whether Nudge Up is pressed |
| /live/song/get/punch_in | | punch_in | Query whether Punch-In is on |
| /live/song/get/punch_out | | punch_out | Query whether Punch-Out is on |
| /live/song/get/record_mode | | record_mode | Query the record mode |
| /live/song/get/root_note | | root_note | Query the root note (0=C to 11=B) |
| /live/song/get/scale_name | | scale_name | Query the scale name |
| /live/song/get/session_automation_record | | session_automation_record | Query whether Automation Arm is on |
| /live/song/get/session_record | | session_record | Query whether session record is on |
| /live/song/get/session_record_status | | session_record_status | Query the session record status |
| /live/song/get/signature_denominator | | signature_denominator | Query the time signature's denominator |
| /live/song/get/signature_numerator | | signature_numerator | Query the time signature's numerator |
| /live/song/get/song_length | | song_length | Query the song's Arrangement length, in beats |
| /live/song/get/start_time | | start_time | Query where Play starts (the start marker), in beats |
| /live/song/get/tempo | | tempo | Query the tempo, in BPM |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/song/set/arrangement_overdub | arrangement_overdub | | Set MIDI Arrangement Overdub (1=on, 0=off) |
| /live/song/set/back_to_arranger | back_to_arranger | | Set whether Back to Arrangement is lit (1=on, 0=off) |
| /live/song/set/clip_trigger_quantization | clip_trigger_quantization | | Set the clip trigger quantization |
| /live/song/set/current_song_time | current_song_time | | Set the song time, in beats |
| /live/song/set/groove_amount | groove_amount | | Set the groove amount |
| /live/song/set/is_ableton_link_enabled | is_ableton_link_enabled | | Set Ableton Link (1=on, 0=off) |
| /live/song/set/loop | loop | | Set the Arrangement loop (1=on, 0=off) |
| /live/song/set/loop_length | loop_length | | Set the loop length |
| /live/song/set/loop_start | loop_start | | Set the loop start |
| /live/song/set/metronome | metronome | | Set the metronome (1=on, 0=off) |
| /live/song/set/midi_recording_quantization | midi_recording_quantization | | Set the MIDI recording quantization |
| /live/song/set/nudge_down | nudge_down | | Set Nudge Down (1=on, 0=off) |
| /live/song/set/nudge_up | nudge_up | | Set Nudge Up (1=on, 0=off) |
| /live/song/set/punch_in | punch_in | | Set Punch-In (1=on, 0=off) |
| /live/song/set/punch_out | punch_out | | Set Punch-Out (1=on, 0=off) |
| /live/song/set/record_mode | record_mode | | Set the record mode |
| /live/song/set/root_note | root_note | | Set the root note (0=C to 11=B) |
| /live/song/set/scale_name | scale_name | | Set the scale name |
| /live/song/set/session_automation_record | session_automation_record | | Set Automation Arm (1=on, 0=off) |
| /live/song/set/session_record | session_record | | Set session record (1=on, 0=off) |
| /live/song/set/signature_denominator | signature_denominator | | Set the time signature's denominator |
| /live/song/set/signature_numerator | signature_numerator | | Set the time signature's numerator |
| /live/song/set/start_time | start_time | | Set where Play starts (the start marker), in beats |
| /live/song/set/tempo | tempo | | Set the tempo, in BPM |

### Cue point, scene, and track properties

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/song/get/cue_points | | name, time, ... | Query the song's cue points |
| /live/song/get/num_scenes | | num_scenes | Query the number of scenes |
| /live/song/get/scenes/name | [scene_index_min, scene_index_max] | [name, ...] | Query the scene names, optionally over a range |
| /live/song/get/num_tracks | | num_tracks | Query the number of tracks |
| /live/song/get/num_return_tracks | | num_return_tracks | Query the number of return tracks |
| /live/song/get/master_track/num_devices | | num_devices | Query the number of devices on the Main track |
| /live/song/get/file_path | | file_path | Query the open set's file, or "" if the set was never saved |
| /live/song/get/id | | id | Query an id that changes whenever Live opens a set, even the same file again |
| /live/song/get/device_parameter_counts | | [count, ...] | Query the parameter counts of every device on every track, in order. The counts are stable once Max for Live devices have loaded |
| /live/song/get/track_names | [track_index_min, track_index_max] | [name, ...] | Query the track names, optionally over a range. A `track_index_max` of -1 means through the last track |
| /live/song/get/track_data | track_index_min, track_index_max, property, ... | [value, ...] | Query the named properties of a range of tracks and of their clips, clip slots, and devices. A `track_index_max` of -1 means through the last track. The reply is one message, so it fails above the UDP datagram size limit. A property that doesn't apply to its object reads nil. The next section has the details |

#### Bulk track and clip data with `/live/song/get/track_data`

`/live/song/get/track_data` returns the named properties of a range of tracks, and of their clips,
clip slots, and devices, in one reply.

Each property has the form `track.<name>`, `clip.<name>`, `clip_slot.<name>`, or `device.<name>`.

For example:
```
/live/song/get/track_data 0 12 track.name clip.name clip.length
```

This queries tracks 0 to 11, and returns a long list of values:

```
[track_0_name, clip_0_0_name,   clip_0_1_name,   ... clip_0_7_name,
               clip_0_0_length, clip_0_1_length, ... clip_0_7_length,
 track_1_name, clip_1_0_name,   clip_1_1_name,   ... clip_1_7_name, ...]
```

### Beat events

After `/live/song/start_listen/beat`, AbletonOSC sends `/live/song/get/beat` with the beat number
as an int on each beat, and when the song time moves back.

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/song/start_listen/beat | | | Start sending `/live/song/get/beat` on each beat |
| /live/song/stop_listen/beat | | | Stop sending beat events |

</details>

---

## View API

`/live/view` addresses Live's user interface: the selected track, scene, clip, and device.

<details>
<summary>Addresses</summary>

### View getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/view/get/selected_scene | | scene_index | Query the selected scene's index |
| /live/view/get/selected_track | | track_index | Query the selected track's index |
| /live/view/get/selected_clip | | track_index, scene_index | Query the track index and scene index of the selected clip |
| /live/view/get/selected_device | | track_index, device_index | Query the selected device |

### View setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/view/set/selected_scene | scene_index | | Select a scene |
| /live/view/set/selected_track | track_index | | Select a track |
| /live/view/set/selected_clip | track_index, scene_index | | Select a clip |
| /live/view/set/selected_device | track_index, device_index | track_index, device_index | Select a device |

### View listeners

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/view/start_listen/selected_scene | | scene_index | Start listening to the selected scene. AbletonOSC replies once, then sends `/live/view/get/selected_scene` on each change |
| /live/view/start_listen/selected_track | | track_index | Start listening to the selected track. AbletonOSC replies once, then sends `/live/view/get/selected_track` on each change |
| /live/view/stop_listen/selected_scene | | | Stop listening to the selected scene |
| /live/view/stop_listen/selected_track | | | Stop listening to the selected track |

</details>

---

## Track API

`/live/track` addresses a track in the song's track list: an audio, MIDI, or group track. Return
tracks and the Main track can't be addressed here. It sets a track's mixer values (volume,
panning, sends, mute, and solo), listens for the playing clip slot, queries devices, and queries
the clips in the Arrangement.

To query the properties of several tracks at once, see
[Cue point, scene, and track properties](#cue-point-scene-and-track-properties).

<details>
<summary>Addresses</summary>

### Track methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/track/stop_all_clips | track_index | | Stop all clips on the track |
| /live/track/delete_device | track_index, device_index | | Delete the device at `device_index` |
| /live/track/delete_clip | track_index, clip_index | | Delete the clip in slot `clip_index` |
| /live/track/duplicate_clip_to_arrangement | track_index, clip_index, time | track_index, arrangement_clip_index | Copy the Session clip in slot `clip_index` into the Arrangement at beat `time`. The reply is the new clip's index |

### Track properties

`/live/track/start_listen/<property> <track_index>` listens to a property in the Getters table
below, except `send` and the routing properties. AbletonOSC replies once with the current value,
then sends `/live/track/get/<property>` with `<track_index> <property_value>` on each change.
`/live/track/stop_listen/<property>` with the same arguments stops it. The Live Object Model marks
`can_be_armed`, `fold_state`, `has_audio_input`, `has_audio_output`, `has_midi_input`,
`has_midi_output`, `is_foldable`, `is_grouped`, and `is_visible` as not observable, so listening
to them fails with `/live/error`.

A `track_index` of `"*"` applies a setter, a method, or a listener to every track. A getter given
`"*"` replies for the first track only.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/track/get/arm | track_index | track_index, arm | Query whether the track is armed |
| /live/track/get/available_input_routing_channels | track_index | track_index, channel, ... | Query the track's available input channels, such as "1", "2", and "1/2" |
| /live/track/get/available_input_routing_types | track_index | track_index, type, ... | Query the track's available input routes, such as "Ext. In" |
| /live/track/get/available_output_routing_channels | track_index | track_index, channel, ... | Query the track's available output channels, such as "1", "2", and "1/2" |
| /live/track/get/available_output_routing_types | track_index | track_index, type, ... | Query the track's available output routes, such as "Ext. Out" |
| /live/track/get/can_be_armed | track_index | track_index, can_be_armed | Query whether the track can be armed |
| /live/track/get/color | track_index | track_index, color | Query the track's color |
| /live/track/get/color_index | track_index | track_index, color_index | Query the track's color index |
| /live/track/get/current_monitoring_state | track_index | track_index, current_monitoring_state | Query the track's monitoring state (0=In, 1=Auto, 2=Off) |
| /live/track/get/fired_slot_index | track_index | track_index, fired_slot_index | Query the index of the track's fired slot |
| /live/track/get/fold_state | track_index | track_index, fold_state | Query whether the group track is folded |
| /live/track/get/has_audio_input | track_index | track_index, has_audio_input | Query whether the track has audio input |
| /live/track/get/has_audio_output | track_index | track_index, has_audio_output | Query whether the track has audio output |
| /live/track/get/has_midi_input | track_index | track_index, has_midi_input | Query whether the track has MIDI input |
| /live/track/get/has_midi_output | track_index | track_index, has_midi_output | Query whether the track has MIDI output |
| /live/track/get/input_routing_channel | track_index | track_index, channel | Query the track's input routing channel |
| /live/track/get/input_routing_type | track_index | track_index, type | Query the track's input routing type |
| /live/track/get/output_routing_channel | track_index | track_index, channel | Query the track's output routing channel |
| /live/track/get/output_meter_left | track_index | track_index, output_meter_left | Query the track's output level, left channel |
| /live/track/get/output_meter_level | track_index | track_index, output_meter_level | Query the track's output level, both channels |
| /live/track/get/output_meter_right | track_index | track_index, output_meter_right | Query the track's output level, right channel |
| /live/track/get/output_routing_type | track_index | track_index, type | Query the track's output routing type |
| /live/track/get/is_foldable | track_index | track_index, is_foldable | Query whether the track can fold, which a group track can |
| /live/track/get/is_grouped | track_index | track_index, is_grouped | Query whether the track is in a group |
| /live/track/get/is_visible | track_index | track_index, is_visible | Query whether the track is visible |
| /live/track/get/mute | track_index | track_index, mute | Query whether the track is muted |
| /live/track/get/name | track_index | track_index, name | Query the track's name |
| /live/track/get/panning | track_index | track_index, panning | Query the track's panning |
| /live/track/get/playing_slot_index | track_index | track_index, playing_slot_index | Query the index of the track's playing slot |
| /live/track/get/send | track_index, send_index | track_index, send_index, value | Query the value of the track's send `send_index` |
| /live/track/get/solo | track_index | track_index, solo | Query whether the track is soloed |
| /live/track/get/volume | track_index | track_index, volume | Query the track's volume |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/track/set/arm | track_index, arm | | Arm the track (1=on, 0=off) |
| /live/track/set/color | track_index, color | | Set the track's color |
| /live/track/set/color_index | track_index, color_index | | Set the track's color index |
| /live/track/set/current_monitoring_state | track_index, current_monitoring_state | | Set the track's monitoring state (0=In, 1=Auto, 2=Off) |
| /live/track/set/fold_state | track_index, fold_state | | Fold the group track (1=on, 0=off) |
| /live/track/set/input_routing_channel | track_index, channel | | Set the track's input routing channel |
| /live/track/set/input_routing_type | track_index, type | | Set the track's input routing type |
| /live/track/set/mute | track_index, mute | | Mute the track (1=on, 0=off) |
| /live/track/set/name | track_index, name | | Set the track's name |
| /live/track/set/output_routing_channel | track_index, channel | | Set the track's output routing channel |
| /live/track/set/output_routing_type | track_index, type | | Set the track's output routing type |
| /live/track/set/panning | track_index, panning | | Set the track's panning |
| /live/track/set/send | track_index, send_index, value | | Set the value of the track's send `send_index` |
| /live/track/set/solo | track_index, solo | | Solo the track (1=on, 0=off) |
| /live/track/set/volume | track_index, volume | | Set the track's volume |

### Clip properties on a track

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/track/get/clips/name | track_index | track_index, [name, ...] | Query the names of the clips on the track, nil for an empty slot |
| /live/track/get/clips/length | track_index | track_index, [length, ...] | Query the lengths of the clips on the track, nil for an empty slot |
| /live/track/get/clips/color | track_index | track_index, [color, ...] | Query the colors of the clips on the track, nil for an empty slot |
| /live/track/get/arrangement_clips/name | track_index | track_index, [name, ...] | Query the names of the track's Arrangement clips |
| /live/track/get/arrangement_clips/length | track_index | track_index, [length, ...] | Query the lengths of the track's Arrangement clips |
| /live/track/get/arrangement_clips/start_time | track_index | track_index, [start_time, ...] | Query the start times of the track's Arrangement clips |
| /live/track/get/arrangement_clips/properties | track_index, property, [property, ...] | track_index, [value, ...] | Query the named properties of every Arrangement clip on the track, one value per property per clip, clip by clip. A property that doesn't apply to a clip reads nil. Naming no property is an error. The reply is one message, so it fails above the UDP datagram size limit (about 340 clips with seven properties) |

### Device properties on a track

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/track/get/num_devices | track_index | track_index, num_devices | Query the number of devices on the track |
| /live/track/get/devices/name | track_index | track_index, [name, ...] | Query the names of the devices on the track |
| /live/track/get/devices/type | track_index | track_index, [type, ...] | Query the types of the devices on the track |
| /live/track/get/devices/class_name | track_index | track_index, [class_name, ...] | Query the class names of the devices on the track |
| /live/track/get/devices/can_have_chains | track_index | track_index, [can_have_chains, ...] | Query, for each device on the track, whether it is a Rack (1) or a single device (0) |

[Device API](#device-api) describes the device `type` and `class_name` values.

</details>

---

## Clip slot API

`/live/clip_slot` addresses a clip slot, the container for a clip. It creates and deletes clips,
and reports whether a slot has one.

<details>
<summary>Addresses</summary>

### Clip slot methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip_slot/fire | track_index, clip_index | | Launch the slot's clip, or trigger its stop button if it has no clip. An empty slot on an armed track starts recording |
| /live/clip_slot/stop | track_index, clip_index | | Stop the playing or recording clips on the slot's track, or in the tracks of its group |
| /live/clip_slot/create_clip | track_index, clip_index, length | | Create a MIDI clip `length` beats long in an empty slot of a MIDI track |
| /live/clip_slot/delete_clip | track_index, clip_index | | Delete the clip in the slot |
| /live/clip_slot/duplicate_clip_to | track_index, clip_index, target_track_index, target_clip_index | | Duplicate the clip to the target clip slot, replacing any clip there |

### Clip slot properties

`/live/clip_slot/start_listen/<property> <track_index> <clip_index>` listens to a property in the
Getters table below. AbletonOSC replies once with the current value, then sends
`/live/clip_slot/get/<property>` with `<track_index> <clip_index> <property_value>` on each change.
`/live/clip_slot/stop_listen/<property>` with the same arguments stops it. The Live Object Model
marks `is_group_slot`, `is_playing`, and `will_record_on_start` as not observable, so listening to
them fails with `/live/error`.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip_slot/get/has_clip | track_index, clip_index | track_index, clip_index, has_clip | Query whether the slot has a clip |
| /live/clip_slot/get/has_stop_button | track_index, clip_index | track_index, clip_index, has_stop_button | Query whether the slot has a stop button |
| /live/clip_slot/get/controls_other_clips | track_index, clip_index | track_index, clip_index, controls_other_clips | Query whether a group track's slot has active clips in its group's tracks |
| /live/clip_slot/get/is_group_slot | track_index, clip_index | track_index, clip_index, is_group_slot | Query whether the slot is a group track's slot |
| /live/clip_slot/get/is_playing | track_index, clip_index | track_index, clip_index, is_playing | Query whether `playing_status` is not 0 |
| /live/clip_slot/get/is_triggered | track_index, clip_index | track_index, clip_index, is_triggered | Query whether the slot's button, or its clip's, is blinking |
| /live/clip_slot/get/playing_status | track_index, clip_index | track_index, clip_index, playing_status | Query a group track's slot: 0=stopped, 1=a clip in its group is playing, 2=a clip in its group is playing or recording. Any other slot reads 0 |
| /live/clip_slot/get/will_record_on_start | track_index, clip_index | track_index, clip_index, will_record_on_start | Query whether the slot will record on start |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip_slot/set/has_stop_button | track_index, clip_index, has_stop_button | | Add or remove the slot's stop button (1=on, 0=off) |

</details>

---

## Clip API

`/live/clip` addresses an audio or MIDI clip in a clip slot, and `/live/arrangement_clip` a clip
in the Arrangement. They start and stop clips, and query and change their notes, name, gain,
pitch, color, playing state, and playing position.

<details>
<summary>Addresses</summary>

### Clip methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip/fire | track_index, clip_index | | Start the clip |
| /live/clip/stop | track_index, clip_index | | Stop the clip |
| /live/clip/duplicate_loop | track_index, clip_index | | Duplicate the clip's loop |
| /live/clip/remove_notes_by_id | track_index, clip_index, note_id, ... | | Pass the arguments after `clip_index` to Live's `Clip.remove_notes_by_id`. `/live/clip/get/notes` doesn't return note ids |
| /live/clips/filter | note_name, ... | | Unmute each Session clip whose name ends in note names (such as `_C-E-G`) that are all among the given ones. Mute each other clip whose name ends in note names. AbletonOSC reads the clip names once, at the first call after a load |
| /live/clips/unfilter | [track_index_min, track_index_max] | | Unmute every Session clip on the tracks in the range, or on every track |

### Clip notes

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip/get/notes | track_index, clip_index, [start_pitch, pitch_span, start_time, time_span] | track_index, clip_index, chunk_index, chunk_count, pitch, start_time, duration, velocity, mute, [pitch, start_time, ...] | Query the clip's notes, sorted by pitch, then time. With no range, the reply has every note in the clip, whatever its pitch or time. With a range, it has the notes in the range. `pitch_span` is a count of pitches from `start_pitch`: 0 and 128 cover all of them, and 0 and 127 miss pitch 127. `time_span` is a length in beats from `start_time`. The reply comes in chunks of up to 200 notes, one message per chunk, to stay under the UDP datagram size limit. An empty clip replies with one empty chunk |
| /live/clip/add/notes | track_index, clip_index, pitch, start_time, duration, velocity, mute, ... | | Add MIDI notes to the clip. `pitch` is the MIDI note number, `start_time` and `duration` are floats in beats, `velocity` is the MIDI velocity, and `mute` is true or false |
| /live/clip/remove/notes | track_index, clip_index, [start_pitch, pitch_span, start_time, time_span] | | Remove the clip's notes in a range of pitches and times, given as for `/live/clip/get/notes`. `pitch_span` is a count of pitches (0 and 128 cover all of them, and 0 and 127 miss pitch 127). With no range, AbletonOSC removes every note in the clip, whatever its pitch or time |

### Clip properties

`/live/clip/start_listen/<property> <track_index> <clip_index>` listens to a property in the
Getters table below. AbletonOSC replies once with the current value, then sends
`/live/clip/get/<property>` with `<track_index> <clip_index> <property_value>` on each change.
`/live/clip/stop_listen/<property>` with the same arguments stops it. The Live Object Model marks
`file_path`, `gain_display_string`, `has_groove`, `is_audio_clip`, `is_midi_clip`, `is_playing`,
`is_triggered`, `length`, `sample_length`, and `will_record_on_start` as not observable, so
listening to them fails with `/live/error`.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip/get/color | track_index, clip_index | track_index, clip_index, color | Query the clip's color |
| /live/clip/get/color_index | track_index, clip_index | track_index, clip_index, color_index | Query the clip's color index (0 to 69) |
| /live/clip/get/name | track_index, clip_index | track_index, clip_index, name | Query the clip's name |
| /live/clip/get/gain | track_index, clip_index | track_index, clip_index, gain | Query the clip's gain |
| /live/clip/get/gain_display_string | track_index, clip_index | track_index, clip_index, gain_display_string | Query an audio clip's gain as Live shows it, such as "1.3 dB" |
| /live/clip/get/length | track_index, clip_index | track_index, clip_index, length | Query the clip's length |
| /live/clip/get/sample_length | track_index, clip_index | track_index, clip_index, sample_length | Query the clip's sample length |
| /live/clip/get/start_time | track_index, clip_index | track_index, clip_index, start_time | Query the clip's start time |
| /live/clip/get/end_time | track_index, clip_index | track_index, clip_index, end_time | Query the clip's end time. For a Session clip, this is the loop end if Loop is on, otherwise the end marker. For an Arrangement clip, it is the clip's right edge in the Arrangement |
| /live/clip/get/pitch_coarse | track_index, clip_index | track_index, clip_index, pitch_coarse | Query the clip's coarse re-pitch, in semitones |
| /live/clip/get/pitch_fine | track_index, clip_index | track_index, clip_index, pitch_fine | Query the clip's fine re-pitch, in cents |
| /live/clip/get/file_path | track_index, clip_index | track_index, clip_index, file_path | Query the clip's file path |
| /live/clip/get/is_audio_clip | track_index, clip_index | track_index, clip_index, is_audio_clip | Query whether the clip is audio |
| /live/clip/get/is_midi_clip | track_index, clip_index | track_index, clip_index, is_midi_clip | Query whether the clip is MIDI |
| /live/clip/get/is_playing | track_index, clip_index | track_index, clip_index, is_playing | Query whether the clip is playing |
| /live/clip/get/is_triggered | track_index, clip_index | track_index, clip_index, is_triggered | Query whether the clip's launch button is blinking |
| /live/clip/get/is_overdubbing | track_index, clip_index | track_index, clip_index, is_overdubbing | Query whether the clip is overdubbing |
| /live/clip/get/is_recording | track_index, clip_index | track_index, clip_index, is_recording | Query whether the clip is recording |
| /live/clip/get/will_record_on_start | track_index, clip_index | track_index, clip_index, will_record_on_start | Query whether the clip will record on start |
| /live/clip/get/playing_position | track_index, clip_index | track_index, clip_index, playing_position | Query the clip's playing position |
| /live/clip/get/loop_start | track_index, clip_index | track_index, clip_index, loop_start | Query the clip's loop start |
| /live/clip/get/loop_end | track_index, clip_index | track_index, clip_index, loop_end | Query the clip's loop end |
| /live/clip/get/looping | track_index, clip_index | track_index, clip_index, looping | Query whether the clip's Loop switch is on |
| /live/clip/get/warping | track_index, clip_index | track_index, clip_index, warping | Query whether the clip's Warp switch is on |
| /live/clip/get/launch_mode | track_index, clip_index | track_index, clip_index, launch_mode | Query the clip's launch mode (0=Trigger, 1=Gate, 2=Toggle, 3=Repeat) |
| /live/clip/get/launch_quantization | track_index, clip_index | track_index, clip_index, launch_quantization | Query the clip's launch quantization (0=Global, 1=None, 2=8 Bars, 3=4 Bars, 4=2 Bars, 5=1 Bar, 6=1/2, 7=1/2T, 8=1/4, 9=1/4T, 10=1/8, 11=1/8T, 12=1/16, 13=1/16T, 14=1/32) |
| /live/clip/get/ram_mode | track_index, clip_index | track_index, clip_index, ram_mode | Query whether the clip's RAM switch is on |
| /live/clip/get/warp_mode | track_index, clip_index | track_index, clip_index, warp_mode | Query the clip's warp mode (0=Beats, 1=Tones, 2=Texture, 3=Re-Pitch, 4=Complex, 5=REX, 6=Complex Pro) |
| /live/clip/get/has_groove | track_index, clip_index | track_index, clip_index, has_groove | Query whether the clip has a groove |
| /live/clip/get/legato | track_index, clip_index | track_index, clip_index, legato | Query whether the clip's Legato switch is on |
| /live/clip/get/position | track_index, clip_index | track_index, clip_index, position | Query the clip's position, which equals `loop_start` |
| /live/clip/get/muted | track_index, clip_index | track_index, clip_index, muted | Query whether the clip is muted |
| /live/clip/get/velocity_amount | track_index, clip_index | track_index, clip_index, velocity_amount | Query the clip's velocity amount (0.0 to 1.0, which is 0% to 100%) |
| /live/clip/get/start_marker | track_index, clip_index | track_index, clip_index, start_marker | Query the clip's start marker |
| /live/clip/get/end_marker | track_index, clip_index | track_index, clip_index, end_marker | Query the clip's end marker |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/clip/set/color | track_index, clip_index, color | | Set the clip's color |
| /live/clip/set/color_index | track_index, clip_index, color_index | | Set the clip's color index (0 to 69) |
| /live/clip/set/name | track_index, clip_index, name | | Set the clip's name |
| /live/clip/set/gain | track_index, clip_index, gain | | Set the clip's gain |
| /live/clip/set/pitch_coarse | track_index, clip_index, pitch_coarse | | Set the clip's coarse re-pitch, in semitones |
| /live/clip/set/pitch_fine | track_index, clip_index, pitch_fine | | Set the clip's fine re-pitch, in cents |
| /live/clip/set/loop_start | track_index, clip_index, loop_start | | Set the clip's loop start |
| /live/clip/set/loop_end | track_index, clip_index, loop_end | | Set the clip's loop end |
| /live/clip/set/looping | track_index, clip_index, looping | | Set the clip's Loop switch (1=on, 0=off) |
| /live/clip/set/warping | track_index, clip_index, warping | | Set the clip's Warp switch (1=on, 0=off) |
| /live/clip/set/launch_mode | track_index, clip_index, launch_mode | | Set the clip's launch mode (0=Trigger, 1=Gate, 2=Toggle, 3=Repeat) |
| /live/clip/set/launch_quantization | track_index, clip_index, launch_quantization | | Set the clip's launch quantization (0=Global, 1=None, 2=8 Bars, 3=4 Bars, 4=2 Bars, 5=1 Bar, 6=1/2, 7=1/2T, 8=1/4, 9=1/4T, 10=1/8, 11=1/8T, 12=1/16, 13=1/16T, 14=1/32) |
| /live/clip/set/ram_mode | track_index, clip_index, ram_mode | | Set the clip's RAM switch (1=on, 0=off) |
| /live/clip/set/warp_mode | track_index, clip_index, warp_mode | | Set the clip's warp mode (0=Beats, 1=Tones, 2=Texture, 3=Re-Pitch, 4=Complex, 5=REX, 6=Complex Pro) |
| /live/clip/set/legato | track_index, clip_index, legato | | Set the clip's Legato switch (1=on, 0=off) |
| /live/clip/set/position | track_index, clip_index, position | | Set the clip's position, which moves the loop and keeps its length |
| /live/clip/set/muted | track_index, clip_index, muted | | Mute the clip (1=on, 0=off) |
| /live/clip/set/velocity_amount | track_index, clip_index, velocity_amount | | Set the clip's velocity amount (0.0 to 1.0, which is 0% to 100%) |
| /live/clip/set/start_marker | track_index, clip_index, start_marker | | Set the clip's start marker, in beats as a float |
| /live/clip/set/end_marker | track_index, clip_index, end_marker | | Set the clip's end marker, in beats as a float |

### Arrangement clips

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/arrangement_clip/get/notes | track_index, arrangement_clip_index, [start_pitch, pitch_span, start_time, time_span] | as `/live/clip/get/notes` | Query the notes in an Arrangement clip. `arrangement_clip_index` indexes the track's Arrangement clips in Live's order, which may not be by start time. Pick a clip by its `start_time` and `end_time`. Note times are in clip time: song beat = `start_time` + note `start_time` - `start_marker`. The range, and what no range returns, are as for `/live/clip/get/notes` |
| `/live/arrangement_clip/get/<property>` | track_index, arrangement_clip_index | track_index, arrangement_clip_index, value | Query, on an Arrangement clip, any property that `/live/clip/get/` reads, such as `start_time`, `start_marker`, or `is_midi_clip` |
| /live/arrangement_clip/delete | track_index, arrangement_clip_index | | Delete an Arrangement clip |

</details>

---

## Scene API

`/live/scene` addresses a scene, which launches a row of clips together. It fires scenes, and
queries and sets a scene's name, color, tempo, and time signature.

<details>
<summary>Addresses</summary>

### Scene methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/scene/fire | scene_index | | Trigger the scene and select it |
| /live/scene/fire_as_selected | scene_index | | Trigger the selected scene, whichever `scene_index` names, and select the next scene |
| /live/scene/fire_selected | | | Trigger the selected scene and select the next scene |

### Scene properties

`/live/scene/start_listen/<property> <scene_index>` listens to a property in the Getters table
below. AbletonOSC replies once with the current value, then sends `/live/scene/get/<property>`
with `<scene_index> <property_value>` on each change. `/live/scene/stop_listen/<property>` with the
same arguments stops it. The Live Object Model marks `is_empty` as not observable, so listening to
it fails with `/live/error`.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/scene/get/color | scene_index | scene_index, color | Query the scene's color |
| /live/scene/get/color_index | scene_index | scene_index, color_index | Query the scene's color index |
| /live/scene/get/is_empty | scene_index | scene_index, is_empty | Query whether the scene is empty |
| /live/scene/get/is_triggered | scene_index | scene_index, is_triggered | Query whether the scene is triggered |
| /live/scene/get/name | scene_index | scene_index, name | Query the scene's name |
| /live/scene/get/tempo | scene_index | scene_index, tempo | Query the scene's tempo |
| /live/scene/get/tempo_enabled | scene_index | scene_index, tempo_enabled | Query whether the scene's tempo is on |
| /live/scene/get/time_signature_numerator | scene_index | scene_index, time_signature_numerator | Query the scene's time signature numerator |
| /live/scene/get/time_signature_denominator | scene_index | scene_index, time_signature_denominator | Query the scene's time signature denominator |
| /live/scene/get/time_signature_enabled | scene_index | scene_index, time_signature_enabled | Query whether the scene's time signature is on |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/scene/set/name | scene_index, name | | Set the scene's name |
| /live/scene/set/color | scene_index, color | | Set the scene's color |
| /live/scene/set/color_index | scene_index, color_index | | Set the scene's color index |
| /live/scene/set/tempo | scene_index, tempo | | Set the scene's tempo |
| /live/scene/set/tempo_enabled | scene_index, tempo_enabled | | Turn the scene's tempo on or off (1=on, 0=off) |
| /live/scene/set/time_signature_numerator | scene_index, time_signature_numerator | | Set the scene's time signature numerator |
| /live/scene/set/time_signature_denominator | scene_index, time_signature_denominator | | Set the scene's time signature denominator |
| /live/scene/set/time_signature_enabled | scene_index, time_signature_enabled | | Turn the scene's time signature on or off (1=on, 0=off) |

</details>

---

## Device API

`/live/device` addresses an instrument or effect on a track.

<details>
<summary>Addresses</summary>

### Device properties

`/live/device/start_listen/<property> <track_index> <device_index>` listens to a device's `name`
or `is_active`. AbletonOSC replies once with the current value, then sends
`/live/device/get/<property>` with the value only, without the track or device index, on each
change. `/live/device/stop_listen/<property>` with the same arguments stops it. The Live Object
Model marks `class_name` and `type` as not observable, so listening to them fails with
`/live/error`.

`/live/device/start_listen/parameter/value <track_index> <device_index> <parameter_index>` listens
to a parameter's `value`. AbletonOSC replies once with the current value. On each change, it
sends both `/live/device/get/parameter/value` and `/live/device/get/parameter/value_string`, with
`<track_index> <device_index> <parameter_index> <value>`.

#### Getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/device/get/name | track_index, device_index | track_index, device_index, name | Query the device's name |
| /live/device/get/class_name | track_index, device_index | track_index, device_index, class_name | Query the device's class name |
| /live/device/get/is_active | track_index, device_index | track_index, device_index, is_active | Query whether the device is on. It reads 0 if the device or a Rack that contains it is off |
| /live/device/get/type | track_index, device_index | track_index, device_index, type | Query the device's type |
| /live/device/get/num_parameters | track_index, device_index | track_index, device_index, num_parameters | Query the number of the device's parameters |
| /live/device/get/parameters/name | track_index, device_index | track_index, device_index, [name, ...] | Query the names of the device's parameters |
| /live/device/get/parameters/value | track_index, device_index | track_index, device_index, [value, ...] | Query the values of the device's parameters |
| /live/device/get/parameters/min | track_index, device_index | track_index, device_index, [value, ...] | Query the minimum values of the device's parameters |
| /live/device/get/parameters/max | track_index, device_index | track_index, device_index, [value, ...] | Query the maximum values of the device's parameters |
| /live/device/get/parameters/is_quantized | track_index, device_index | track_index, device_index, [value, ...] | Query, for each of the device's parameters, whether it is quantized: 1 for a boolean or enum parameter, 0 for an int or float one |
| /live/device/get/parameter/value | track_index, device_index, parameter_index | track_index, device_index, parameter_index, value | Query a parameter's value |
| /live/device/get/parameter/name | track_index, device_index, parameter_index | track_index, device_index, parameter_index, name | Query a parameter's name |
| /live/device/get/parameter/value_string | track_index, device_index, parameter_index | track_index, device_index, parameter_index, value | Query a parameter's value as Live shows it, such as "2500 Hz" |
| /live/device/get/parameter/value_items | track_index, device_index, parameter_index | track_index, device_index, parameter_index, [item, ...] | Query a quantized parameter's item names, in value order. A continuous parameter has none |

#### Setters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/device/set/parameters/value | track_index, device_index, value, value, ... | | Set the values of the device's parameters, from the first parameter on |
| /live/device/set/parameter/value | track_index, device_index, parameter_index, value | | Set a parameter's value |

#### Listeners

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/device/start_listen/parameter/value | track_index, device_index, parameter_index | track_index, device_index, parameter_index, value | Start listening to a parameter's value, as [Device properties](#device-properties) describes |
| /live/device/stop_listen/parameter/value | track_index, device_index, parameter_index | | Stop listening to a parameter's value |

The device properties take these values:

- `name` is the human-readable name.
- `type` is 0 = undefined, 1 = instrument, 2 = audio_effect, or 4 = midi_effect.
- `class_name` is Live's name for the instrument or effect, such as Operator or Reverb. For a
  plug-in or a Rack, it can be AuPluginDevice, PluginDevice, or InstrumentGroupDevice, among
  others.

</details>


---

## Browser API

`/live/browser` loads devices and presets from Live's browser categories, the User Library, or a
Places folder.

`root` names where to look. It is one of these:

- One of Live's categories as its sidebar names them: "Sounds", "Drums", "Instruments",
  "Audio Effects", "MIDI Effects", "Max for Live", "Plug-Ins", "Clips", "Samples", or "Packs". A
  category wins over a Places folder of the same name.
- "User Library".
- A Places folder's name. When more than one Places folder has that name, AbletonOSC looks for the
  item in each, in order.
- `*`, for whichever Places folder has the item. Exactly one folder must have it.

`path` is item names below `root`, joined with `/`. The browser lists devices without their file
extension, and a path segment may carry it.

### Browser getters

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/browser/get/places_with | path | [name, ...] | Query the Places folders that have the item, by name. The reply is empty if none has it |
| /live/browser/get/children | root, [path] | root, path, chunk_index, chunk_count, [name, ...] | Query the names of the items under a browser item, in chunks of up to 100 |

### Browser methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/browser/load | track_index, root, path | track_index, device_index, device_name | Select the track and load the item onto it. `device_index` is the added device's index, or -1. AbletonOSC refuses the load while Hot-Swap is active, if the track can't be selected, or if the item can't be loaded. A Max for Live device's parameters arrive seconds later |


## MidiMap API

`/live/midimap` maps a MIDI control change to a Live parameter.

<details>
<summary>Addresses</summary>

### MidiMap methods

| Address | Query params | Response params | Description |
|:--------|:-------------|:----------------|:------------|
| /live/midimap/map_cc | track_index, device_index, parameter_index, channel, cc | | Map control change `cc` on MIDI channel `channel` to the parameter |

`channel` counts from 0, so MIDI channel 1 is `0`.

</details>

---

## Utilities

`harness/cli.js` sends OSC queries to AbletonOSC from the command line. For example:

```
$ node harness/cli.js send /live/song/set/tempo 123.0
"ok"
$ node harness/cli.js query /live/song/get/tempo
[123]
$ node harness/cli.js query /live/song/get/track_names
["1-MIDI","2-MIDI","3-Audio","4-Audio"]
```
