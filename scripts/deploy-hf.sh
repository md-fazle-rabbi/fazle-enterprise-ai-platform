#!/usr/bin/env bash
set -euo pipefail

# Syncs packages/, pyproject.toml, uv.lock from main into hf-space,
# regenerates the rag-engine dependency list, and pushes to Hugging
# Face. hf-space-only files (app.py, requirements.txt, packages.txt,
# the HF README.md) are never touched by this script.
# Run from repo root, on a clean working tree, from main.

CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Run this from main. Currently on: $CURRENT_BRANCH"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean. Commit or stash changes on main first."
  exit 1
fi

uv export --no-dev --package rag-engine --format requirements-txt \
  > requirements-generated.txt

MAIN_COMMIT=$(git rev-parse --short main)

git checkout hf-space
git checkout main -- packages/ pyproject.toml uv.lock
git checkout main -- requirements-generated.txt
git add packages/ pyproject.toml uv.lock requirements-generated.txt

if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git commit -m "hf-space: sync with main ($MAIN_COMMIT)"
fi

git push space hf-space:main --force -4

git checkout main
git checkout -- requirements-generated.txt 2>/dev/null || rm -f requirements-generated.txt
echo "Done. Back on main."
