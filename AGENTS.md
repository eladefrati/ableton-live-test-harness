# Agents

A test harness that lets a coding agent run acceptance tests in a running Ableton Live, for
projects that run in Live. Built on AbletonOSC. macOS only.

## Layout

- `manager.py`, `abletonosc/`: the Remote Script. Python, runs inside Live and answers OSC.
- `harness/`: the Node client that drives Live, with its own checks and unit tests.
- `tests/`, `client/`, `run-console.py`: AbletonOSC's own Python tests, client and console.

## Where to go

- **Before any run in Live, or to write a check:** `skills/verify-ableton/SKILL.md`. Live is
  shared, and checks change the open set.
- **Before a commit, or after changing `abletonosc/`:** `CONTRIBUTING.md`, for what to reload
  and which checks to run.
- **Before changing how something works:** `docs/adr/`, for why it is built that way.
- **For the Node API:** `harness/README.md`.
- **When Live does something unexpected:** `harness/live-notes.md`.
