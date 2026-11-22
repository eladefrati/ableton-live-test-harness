#!/bin/zsh
# Run a command against Live on another Mac: the host named as "remote" in
# harness/local.json, or LIVE_REMOTE for one run.
#
#   harness/remote.sh <repo> <command...>
#
# The repos are the folders beside this harness clone (~/dev for a clone at
# ~/dev/ableton-live-test-harness), and on the remote the folder at the same path under its
# user's home. <repo> is a git repo there or one level down: "project", or "product/repo" for
# a folder that holds a repo per format; or a git worktree of such a repo, at any depth there
# ("project/.worktrees/branch"), whose repo's .git is copied with it, so git works in the
# remote's copy of the worktree. Copies this Mac's working copies of the clone and of
# <repo> to the remote, then runs <command> there in <repo>, with LIVE_HARNESS set to the
# remote's copy of harness/, and exits with its status. The remote may not be able to fetch from this Mac, so code reaches
# it only by this push; working copies, not commits, because checks prove builds before they
# are committed. The remote's own build products (.venv,
# node_modules, __pycache__) and AbletonOSC's logs (/logs/, written by the remote's Live)
# are left alone. Excluded files are neither copied nor deleted, so a project that needs
# them installs them on the remote by hand. A check's logs (tests/live/logs/ at any depth, see
# run-log.js) are excluded too, and those of <repo> moved back to this Mac after the command,
# and so are the stills and
# videos taken there without a path (harness/captures.js), from the remote's captures folder
# to this Mac's. There is no lock. Two runs
# at once can replace files under a running check, so the slot rule in harness/README.md is
# the guard.
#
#   harness/remote.sh ableton-live-test-harness node harness/doctor.js
#   harness/remote.sh <repo> node tests/live/<check>.js --tempo 97
#
# Who holds the remote's Live: "Running on a second Mac" in harness/README.md.
set -euo pipefail

if (( $# < 2 )); then
  print -u2 "usage: harness/remote.sh <repo beside the harness clone, or product/repo> <command...>"
  exit 2
fi
repo=$1; shift

# The clone is the folder above harness/, whatever its name; the repos' folder is the one
# holding it. The remote's is the same path under its user's home, so the clone must be
# under this user's home.
clone=${0:A:h:h}
harness=${clone:t}
root=${clone:h}
if [[ $root != $HOME/* ]]; then
  print -u2 "remote.sh: the harness clone must be in a folder under your home folder, got: $clone"
  exit 2
fi
remote_root=${root#$HOME/}

# local.json is not in git (see local.example.json). It is read from the copy this script
# syncs, so the remote gets the file these values came from. plutil fails on a missing
# file, a missing key or bad JSON. All three read as not set.
host=${LIVE_REMOTE:-$(plutil -extract remote raw -o - "$clone/harness/local.json" 2>/dev/null || true)}
if [[ -z $host ]]; then
  print -u2 "remote.sh: no remote host: set \"remote\" in harness/local.json (see harness/local.example.json) or LIVE_REMOTE"
  exit 2
fi

# Folder names, and the folder a git repo or a worktree of one: ".", "..", an empty name, or a
# folder that holds repos would sync (and --delete) a parent of a repo on the remote, such as
# all of its repos, its home, or the other repos of a product. A repo is one or two names
# down; a worktree, whose .git is a file, may be deeper, as no repo is inside it.
parts=("${(@s:/:)repo}")
if (( ${parts[(I)]} || ${parts[(I).]} || ${parts[(I)..]} )); then
  print -u2 "remote.sh: <repo> must be a folder name in $root, one level down (product/repo), or a worktree's path there, got: $repo"
  exit 2
fi
if [[ ! -d $root/$repo ]]; then
  print -u2 "remote.sh: no such repo: $root/$repo"
  exit 2
fi
# For a worktree: the folder of its repo, under $root, and its own git folder in that repo's
# .git, as paths from $root.
main= gitdir=
if [[ -f $root/$repo/.git ]]; then
  local_common=$(git -C "$root/$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  local_gitdir=$(git -C "$root/$repo" rev-parse --absolute-git-dir 2>/dev/null || true)
  # :A of an empty name is the current folder, so an empty one stays empty.
  local_common=${local_common:+${local_common:A}} local_gitdir=${local_gitdir:+${local_gitdir:A}}
  if [[ -z $local_common || -z $local_gitdir || $local_common:t != .git || $local_common != $root/* \
        || $local_gitdir != $local_common/* || ! -d $local_common:h/.git ]]; then
    print -u2 "remote.sh: $root/$repo is a worktree whose repo isn't a git repo in $root, which the remote needs too"
    exit 2
  fi
  main=${${local_common:h}#$root/}
  gitdir=${local_gitdir#$root/}
elif (( $#parts > 2 )); then
  print -u2 "remote.sh: <repo> must be a folder name in $root, one level down (product/repo), or a worktree's path there, got: $repo"
  exit 2
elif [[ ! -e $root/$repo/.git ]]; then
  print -u2 "remote.sh: not a git repo: $root/$repo (give the repo, not a folder that holds repos)"
  exit 2
fi

# A check's logs at any depth, so that a sync of a repo leaves those of a worktree inside it.
sync() {
  rsync -a --delete \
    --exclude .venv --exclude node_modules --exclude __pycache__ --exclude /logs/ \
    --exclude tests/live/logs/ \
    "$root/$1/" "$host:$remote_root/$1/"
}

# rsync makes the repo's folder but not its parent.
ssh "$host" mkdir -p ${(q)remote_root} ${(q)${:-$remote_root/$repo:h}} ${main:+${(q)${:-$remote_root/$main}}}
sync $harness
[[ $repo == $harness ]] || sync $repo
if [[ -n $main ]]; then
  # The repo's .git, which holds the worktree's commits, index and HEAD. The worktree's .git
  # names its git folder by this Mac's path, which the remote doesn't have, so it is pointed at
  # the remote's copy, after every sync, as the sync puts this Mac's back.
  sync $main/.git
  ssh "$host" "printf 'gitdir: %s\\n' \"\$HOME\"/${(q)remote_root}/${(q)gitdir} > ${(q)remote_root}/${(q)repo}/.git"
fi

# Tools such as Node can be installed under ~/.local or Homebrew on the remote; a
# non-interactive ssh shell doesn't have them on PATH. Expanded by the remote's shell.
remote_path='export PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH'
# Checks find the harness through LIVE_HARNESS, falling back to a fixed path.
remote_env="$remote_path; export LIVE_HARNESS=\$HOME/${(q)remote_root}/${(q)harness}/harness"

# The command is passed as words; quote each so it reaches the remote shell intact.
run_status=0
ssh "$host" "$remote_env; cd ~/${(q)remote_root}/${(q)repo} && ${(j: :)${(q)@}}" || run_status=$?

# Move the run's logs here, after a failed run too, if the remote has any. Logs that can't be
# moved stay on the remote, where the sync leaves them alone, and come back after the next run.
bring_back_logs() {
  local folder=tests/live/logs
  ssh "$host" test -d "${(q)remote_root}/${(q)repo}/$folder" || return 0
  { mkdir -p "$root/$repo/$folder" && rsync -a --remove-source-files "$host:$remote_root/$repo/$folder/" "$root/$repo/$folder/" } \
    || print -u2 "remote.sh: could not bring the run's logs back from $host; the next run will retry"
}

# Move the remote's captures to this Mac's captures folder (harness/captures.js), naming each
# on stderr: only finished ones, not a video still being recorded, and none whose name is
# already here, so nothing here is overwritten. What stays comes back after a later run, or
# is deleted there once a capture is saved there more than 7 days after it.
bring_back_captures() {
  local listed
  listed=$(ssh "$host" "$remote_path; cd ~/${(q)remote_root}/${(q)harness} && node harness/captures.js finished") || {
    print -u2 "remote.sh: could not list the remote's captures; a later run will bring them back"
    return 0
  }
  local -a lines=("${(@f)listed}")
  local there=$lines[1]
  local -a names=("${(@)lines[2,-1]}")
  (( $#names )) || return 0
  # This Mac's captures folder, as captures.js finds it. os.tmpdir() is TMPDIR without its last
  # slash, or /tmp.
  local here=${${TMPDIR:-/tmp}%/}/ableton-harness-captures
  # A name already here is left on the remote and said so. openrsync deletes the source of a
  # file --ignore-existing skips, so such a name is never handed to rsync.
  local name
  local -a send
  for name in $names; do
    if [[ -e $here/$name ]]; then
      print -u2 "remote.sh: $there/$name on $host is also here; left there"
    else
      send+=($name)
    fi
  done
  (( $#send )) || return 0
  local list moved rsync_status=0
  list=$(mktemp -t remote-captures) || return 0
  print -rl -- $send > $list
  # Each file rsync names it has copied is named here, also when it then fails on another,
  # because a failed openrsync left what it had copied on the remote too, where a later run
  # finds the name already here.
  if mkdir -p "$here"; then
    moved=$(rsync -a --ignore-existing --remove-source-files --files-from="$list" --out-format="%n" \
      "$host:$there/" "$here/") || rsync_status=$?
  else
    rsync_status=1
  fi
  for name in ${(f)moved}; do
    (( ${send[(Ie)$name]} )) && print -u2 "remote.sh: brought back $here/$name"
  done
  (( rsync_status == 0 )) \
    || print -u2 "remote.sh: could not bring the remote's captures back from $host, or not all of them; the next run will retry those not here"
  rm -f $list
}

bring_back_logs
bring_back_captures
exit $run_status
