import time
import pytest
import threading

#--------------------------------------------------------------------------------
# Add . to the path so that pythonosc can be imported, enabling unit testing
# without any external dependencies
#--------------------------------------------------------------------------------
import sys
sys.path.append(".")

from ..client import AbletonOSCClient, TICK_DURATION

# Live tick is 100ms. Wait for this long plus a short additional buffer.
TICK_DURATION = 0.125

@pytest.fixture(scope="module")
def client() -> AbletonOSCClient:
    client = AbletonOSCClient()
    yield client
    client.stop()

def wait_one_tick():
    """
    Sleep for one Ableton Live tick (100ms).
    """
    time.sleep(TICK_DURATION)

def query_notes(client, params, address="/live/clip/get/notes"):
    """
    Query a clip's notes, which arrive as one or more chunks of
    (track_id, clip_id, chunk_index, chunk_count, *notes), and return them joined
    as (track_id, clip_id, *notes).
    """
    chunks = {}
    received_all = threading.Event()

    def received_chunk(_, chunk):
        chunks[chunk[2]] = tuple(chunk[4:])
        if len(chunks) == chunk[3]:
            received_all.set()

    client.set_handler(address, received_chunk)
    client.send_message(address, params)
    received_all.wait(TICK_DURATION * 4)
    client.remove_handler(address)
    assert received_all.is_set(), "Timed out waiting for %s" % address
    return tuple(params[:2]) + sum((chunks[i] for i in sorted(chunks)), ())

c = AbletonOSCClient()
c.send_message("/live/api/reload")
c.stop()
