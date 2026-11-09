#!/bin/zsh
# Run a command against Live on another Mac: the host named as "remote" in
# harness/local.json, or LIVE_REMOTE for one run.
#
#   harness/remote.sh <repo> <command...>
#
# Copies this Mac's working copies of ~/dev/ableton-live-test-harness and ~/dev/<repo> to
# the same paths under the remote user's home, then runs <command> there in ~/dev/<repo> and
# exits with its status. The remote may not be able to fetch from this Mac, so code reaches
# it only by this push; working copies, not commits, because checks prove builds before they
# are committed. The remote's own build products (.venv,
# node_modules, __pycache__) and AbletonOSC's logs (/logs/, written by the remote's Live)
# are left alone: excluded files are neither copied nor deleted, so a project that needs
# them installs them on the remote by hand. A check's logs (tests/live/logs/, see run-log.js)
# are excluded too, and moved back to this Mac after the command. There is no lock: two runs
# at once can replace files under a running check, so the slot rule in harness/README.md is
# the guard.
#
#   harness/remote.sh ableton-live-test-harness node harness/doctor.js
#   harness/remote.sh <repo> node tests/live/<check>.js --tempo 97
#
# Who holds the remote's Live: "Running on a second Mac" in harness/README.md.
set -euo pipefail

if (( $# < 2 )); then
  print -u2 "usage: harness/remote.sh <repo in ~/dev> <command...>"
  exit 2
fi
repo=$1; shift
harness=ableton-live-test-harness

# local.json is not in git (see local.example.json). It is read from the copy this script
# syncs, so the remote gets the file these values came from. plutil fails on a missing
# file, a missing key or bad JSON: all three read as not set.
host=${LIVE_REMOTE:-$(plutil -extract remote raw -o - "$HOME/dev/$harness/harness/local.json" 2>/dev/null || true)}
if [[ -z $host ]]; then
  print -u2 "remote.sh: no remote host: set \"remote\" in harness/local.json (see harness/local.example.json) or LIVE_REMOTE"
  exit 2
fi

# One folder name only: ".", ".." or a path would sync (and --delete) a parent of the repo
# on the remote, such as all of ~/dev or the remote's home.
if [[ $repo == */* || $repo == . || $repo == .. || -z $repo ]]; then
  print -u2 "remote.sh: <repo> must be a folder name in ~/dev, got: $repo"
  exit 2
fi
if [[ ! -d $HOME/dev/$repo ]]; then
  print -u2 "remote.sh: no such repo: $HOME/dev/$repo"
  exit 2
fi

sync() {
  rsync -a --delete \
    --exclude .venv --exclude node_modules --exclude __pycache__ --exclude /logs/ \
    --exclude /tests/live/logs/ \
    "$HOME/dev/$1/" "$host:dev/$1/"
}

ssh "$host" mkdir -p dev
sync $harness
[[ $repo == $harness ]] || sync $repo

# Tools such as Node can be installed under ~/.local or Homebrew on the remote; a
# non-interactive ssh shell doesn't have them on PATH. The command is passed as words; quote each so it reaches the remote
# shell intact.
run_status=0
ssh "$host" "export PATH=\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH; cd ~/dev/${(q)repo} && ${(j: :)${(q)@}}" || run_status=$?

# Move the run's logs here, after a failed run too. Logs that can't be moved stay on the
# remote, where the sync leaves them alone, and come back after the next run.
if ssh "$host" test -d "dev/${(q)repo}/tests/live/logs"; then
  rsync -a --remove-source-files "$host:dev/$repo/tests/live/logs/" "$HOME/dev/$repo/tests/live/logs/" \
    || print -u2 "remote.sh: could not bring the run's logs back from $host; the next run will retry"
fi
exit $run_status
