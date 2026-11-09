// Test hook for dev builds of Max for Live devices (ADR-0002). Include this file in the
// device's v8/js script, and wire one of the script's outlets to [udpsend 127.0.0.1 11002]
// in dev builds only. Then
//
//   const hook = makeHook((list) => outlet(N, list));   // N: the outlet wired to udpsend
//   hook.report("status", "ready");
//   hook.report("check", 1, "ok");
//
// sends OSC /hook/<topic> track_index device_index ...payload, which the harness's
// openHooks()/waitForHook() receive. [udpsend] turns a Max list whose first element starts
// with "/" into an OSC message. The indices come from the device's own Live path, read at
// each report, so they follow moves; a device inside a Rack reports its outermost Rack's,
// and one on a return or the main track reports -1, -1.

function makeHook(send, api) {
  const LiveAPIClass = api || LiveAPI;
  function where() {
    const path = String(new LiveAPIClass("this_device").unquotedpath || "");
    // "tracks", not "return_tracks"
    const m = /(?:^|\s)tracks (\d+) devices (\d+)/.exec(path);
    return m ? [Number(m[1]), Number(m[2])] : [-1, -1];
  }
  return {
    report: function (topic) {
      const payload = Array.prototype.slice.call(arguments, 1);
      send(["/hook/" + topic].concat(where(), payload));
    },
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { makeHook };
