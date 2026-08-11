#!/usr/bin/env bash
set -euo pipefail

npm ci --build-from-source
npm install --global skills@1.5.22 @openai/codex@latest

node --version
git --version
gh --version
skills --version
codex --version

npm run verify:linux
npm test
