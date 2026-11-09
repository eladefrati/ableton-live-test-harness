---
title: "ADR-0005: Publish as one repo, with each machine's values in a local file"
status: Accepted
date: 2026-11-08
---

# ADR-0005: Publish as one repo, with each machine's values in a local file

**Status:** Accepted

## Context

The harness was local only (ADR-0001, decision 1) and written for one setup. The host that
`remote.sh` runs checks on was a default in the script, the one machine whose pointer may
be used was named in `device-ui.js` (ADR-0004, decision 2), and the docs and tests named
the projects that used it. A published repo can carry none of that.

## Decision

1. **One public repository.** Standalone, not a GitHub fork; AbletonOSC is credited as the
   base in `README.md`, and its copyright notice is kept in `LICENSE.md`. No private copy is kept in step with it.
2. **Values that differ per machine live in `harness/local.json`,** which git ignores.
   `harness/local.example.json` shows the keys: `remote`, the host `remote.sh` runs on
   (`LIVE_REMOTE` overrides it for one run), and `clickHost`, the one machine `device-ui.js`
   may click on.
3. **The click host comes from the file only,** never from the environment. With no file or
   no key, `device-ui.js` refuses on every machine. ADR-0004's reason stands: a click takes
   the pointer from whoever is using the Mac.
4. **The public history starts with one commit** on top of AbletonOSC's own history, which
   ends at the `upstream-base` tag and is left as it is. The work before publication is not
   part of the public history.

## Consequences

- A new clone needs a `harness/local.json` before `device-ui.js` will click, or before
  `remote.sh` will run without `LIVE_REMOTE`.
- `remote.sh` copies the working copy to the remote, `local.json` with it, so both machines
  read the same values.
- Only `remote.sh` assumes the clone is at `~/dev/ableton-live-test-harness`. Checks that
  load the harness by path can read `LIVE_HARNESS` instead.
- `git diff upstream-base` shows everything this repo changed and added; there is no
  commit-by-commit record of it before publication.

## Alternatives considered

- **A private repo and a scrubbed public copy:** every change is made twice or
  cherry-picked, and the copies drift. What differs between machines here is two host
  names, not code that must stay private.
- **Environment variables only:** ssh does not carry them to the remote, and a variable
  would lift the click guard for a single command.
