from typing import Tuple, Any
from .handler import AbletonOSCHandler
from ableton.v2.base import liveobj_valid
import Live

# Names per reply message for /live/browser/get/children, to stay under the UDP
# datagram size limit.
NAMES_PER_CHUNK = 100

# The root name that addresses the User Library rather than a Places folder.
USER_LIBRARY = "User Library"

# The root name that looks for the item in every Places folder, whatever the folders are
# called: it must be in exactly one of them.
ANY_PLACE = "*"

# Root names for Live's own browser categories, as its sidebar labels them, and the Browser
# property behind each. They are checked before Places folders, so a Places folder with one
# of these names can only be reached through "*".
CATEGORIES = {
    "Sounds": "sounds",
    "Drums": "drums",
    "Instruments": "instruments",
    "Audio Effects": "audio_effects",
    "MIDI Effects": "midi_effects",
    "Max for Live": "max_for_live",
    "Plug-Ins": "plugins",
    "Clips": "clips",
    "Samples": "samples",
    "Packs": "packs",
}

class BrowserHandler(AbletonOSCHandler):
    """
    Loads items from Live's browser categories (CATEGORIES), the User Library and the
    user's Places folders, addressed by a root name and a path of item names below it, e.g.
    ("Instruments", "Drift") or ("builds", "Device 2030.1.18.1.amxd").
    The LOM's BrowserItem has no filesystem path, so items are found by name, one path
    segment at a time.
    """
    def __init__(self, manager):
        super().__init__(manager)
        self.class_identifier = "browser"

    def _find_item(self, root: str, path: str):
        browser = Live.Application.get_application().browser
        if root == USER_LIBRARY:
            return self._find_in(browser.user_library, path)
        if root in CATEGORIES:
            return self._find_in(getattr(browser, CATEGORIES[root]), path)
        if root == ANY_PLACE:
            found = self._find_in_places(path)
            if not found:
                raise ValueError("No Places folder has %s" % path)
            if len(found) > 1:
                raise ValueError("%s is in %d Places folders (%s); remove all but one from Places"
                                 % (path, len(found), ", ".join(name for name, _ in found)))
            return found[0][1]
        # Live names a Places folder after its directory, so two projects' builds/ folders
        # are both "builds": the item is looked for in each folder of that name, in order.
        folders = [folder for folder in browser.user_folders if folder.name == root]
        if not folders:
            raise ValueError("No Places folder named %s" % root)
        for folder in folders[:-1]:
            try:
                return self._find_in(folder, path)
            except ValueError:
                pass
        return self._find_in(folders[-1], path)

    def _find_in_places(self, path: str):
        """(folder name, item) for each Places folder that has the item."""
        found = []
        for folder in Live.Application.get_application().browser.user_folders:
            try:
                found.append((folder.name, self._find_in(folder, path)))
            except ValueError:
                pass
            except Exception as error:
                # A folder Live can't list (e.g. on an unmounted disk) must not block a
                # lookup that other folders can answer.
                self.logger.warning("Skipping Places folder %s: %s" % (folder.name, error))
        return found

    def _find_in(self, item, path: str):
        for name in [segment for segment in path.split("/") if segment]:
            # The browser lists devices without their file extension; an exact name wins
            # over a name that only matches without it.
            stem = name.rsplit(".", 1)[0]
            children = list(item.children)
            matches = [child for child in children if child.name == name] or \
                      [child for child in children if child.name == stem]
            if not matches:
                raise ValueError("No browser item named %s in %s" % (name, item.name))
            item = matches[0]
        return item

    def init_api(self):
        def browser_get_user_folders(params: Tuple[Any] = ()):
            browser = Live.Application.get_application().browser
            return tuple(folder.name for folder in browser.user_folders)

        def browser_get_places_with(params: Tuple[Any]):
            return tuple(name for name, _ in self._find_in_places(params[0]))

        def browser_get_children(params: Tuple[Any]):
            root, path = params[0], params[1] if len(params) > 1 else ""
            names = [child.name for child in self._find_item(root, path).children]
            chunk_count = max(1, -(-len(names) // NAMES_PER_CHUNK))
            return [(root, path, chunk_index, chunk_count,
                     *names[chunk_index * NAMES_PER_CHUNK:(chunk_index + 1) * NAMES_PER_CHUNK])
                    for chunk_index in range(chunk_count)]

        def browser_load(params: Tuple[Any]):
            #--------------------------------------------------------------------------------
            # Browser.load_item loads onto the selected track, so select the target first.
            # A device is inserted after the selected device on that track, or appended.
            # Replies with the index and name of the device the load added, found by
            # comparing the track's devices before and after, or -1 if none was added.
            # A Max for Live device's parameters appear only once Max has loaded the
            # patch, seconds later; poll num_parameters until it settles.
            #--------------------------------------------------------------------------------
            track_index, root, path = int(params[0]), params[1], params[2]
            item = self._find_item(root, path)
            if not item.is_loadable:
                raise ValueError("Browser item %s is not loadable" % item.name)
            browser = Live.Application.get_application().browser
            #--------------------------------------------------------------------------------
            # With Hot-Swap active, load_item replaces the hot-swap target instead of
            # adding a device.
            #--------------------------------------------------------------------------------
            if liveobj_valid(browser.hotswap_target):
                raise ValueError("Hot-Swap is active; turn it off before loading")
            track = self.song.tracks[track_index]
            self.song.view.selected_track = track
            #--------------------------------------------------------------------------------
            # The selection has been seen to stay where it was with no error; loading then
            # would put the device on another track.
            #--------------------------------------------------------------------------------
            if self.song.view.selected_track != track:
                raise ValueError("Track %d could not be selected; nothing loaded" % track_index)
            devices_before = [device._live_ptr for device in track.devices]
            browser.load_item(item)
            for device_index, device in enumerate(track.devices):
                if device._live_ptr not in devices_before:
                    return track_index, device_index, device.name
            return track_index, -1, ""

        self.osc_server.add_handler("/live/browser/get/user_folders", browser_get_user_folders)
        self.osc_server.add_handler("/live/browser/get/places_with", browser_get_places_with)
        self.osc_server.add_handler("/live/browser/get/children", browser_get_children)
        self.osc_server.add_handler("/live/browser/load", browser_load)
