#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="troels-im/wonop-spotify-player"
commit_message="Prepare Spotify Wonop package for publication"

cd "$repo_dir"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is required. Install/login in your host terminal first." >&2
  exit 1
fi

echo "Checking GitHub authentication (no credentials are printed)..."
gh auth status >/dev/null

echo "Scanning working tree for credential-like material..."
if rg -n -i --hidden --glob '!*.png' --glob '!.git/**' \
  '(client_secret|access_token|refresh_token|authorization:[[:space:]]*bearer|BEGIN[[:space:]]+.*PRIVATE KEY|ghp_[A-Za-z0-9]|github_pat_[A-Za-z0-9])' .; then
  echo "Potential secret material found; refusing to continue." >&2
  exit 1
fi

echo "Scanning committed history for credential-like material..."
for rev in $(git rev-list --all); do
  if git grep -n -I -i -E \
    'client_secret|access_token|refresh_token|authorization:[[:space:]]*bearer|BEGIN[[:space:]].*PRIVATE KEY|ghp_[A-Za-z0-9]|github_pat_[A-Za-z0-9]' "$rev" -- .; then
    echo "Potential secret material found in history; refusing to continue." >&2
    exit 1
  fi
done

git diff --check
echo
git status --short
echo
read -r -p "Commit and push this package to PUBLIC https://github.com/$repo ? [y/N] " answer
case "$answer" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Cancelled; no commit, repository creation, or push performed."; exit 0 ;;
esac

git add -A
if ! git diff --cached --quiet; then
  git commit -m "$commit_message"
else
  echo "No new changes to commit."
fi

if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
else
  if gh repo view "$repo" >/dev/null 2>&1; then
    git remote add origin "https://github.com/$repo.git"
    git push -u origin main
  else
    gh repo create "$repo" --public --source=. --remote=origin --push
  fi
fi

echo "Published source repository: https://github.com/$repo"
echo "Wonop submission is separate and must be performed by the person with the scoped publication key."
