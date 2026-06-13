#!/usr/bin/env bash
# Cron wrapper for grim-ritual — sources nvm so node resolves correctly.

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

GRIMOIRE_DIR="/mnt/eighty/userspace/vgvm/src/me/grimoire"
cd "$GRIMOIRE_DIR" || exit 1

exec node bin/grim-ritual.js "$@"
