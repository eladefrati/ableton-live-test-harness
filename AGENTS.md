# Agents

This repo is a test harness that lets a coding agent run acceptance tests in a running Ableton
Live, for projects that run in Live. It is built on AbletonOSC and runs on macOS only.

## Layout

- `manager.py`, `abletonosc/`: the Remote Script. It is written in Python, runs inside Live
  and answers OSC.
- `__init__.py`: Live's entry point to the Remote Script (`create_instance`).
- `pythonosc/`: the copy of python-osc that the Remote Script imports.
- `harness/`: the Node client that drives Live, with its own checks and unit tests.
- `tests/`, `client/`: AbletonOSC's own Python tests and their client.
- `docs/`: the ADRs, the OSC address reference, and the backlog.
- `skills/verify-ableton/`: the agent skill, and `writing-checks.md` for writing a check.

## Where to go

- **On a new clone:** "Installation" in `README.md` (the Remote Script link, Live's settings,
  permissions, `harness/local.json`), then `node harness/doctor.js`, which names what is
  still missing.
- **Before any run in Live, or to write a check:** `skills/verify-ableton/SKILL.md`. Live is
  shared, and checks change the open set.
- **Before a commit, or after changing `abletonosc/`:** `CONTRIBUTING.md`, for what to reload
  and which checks to run.
- **Before changing how something works:** `docs/adr/`, for why it is built that way.
- **For the Node API:** `harness/README.md`.
- **For an OSC address:** `docs/osc-api.md`.
- **For open work:** `docs/backlog.md`.
- **When Live does something unexpected:** `harness/live-notes.md`.
