#!/bin/bash
# civitai-download.sh — resumable civitai model downloader
# Reads token from ~/.config/nixe/keys.json
#
# Usage:
#   civitai-download.sh <modelVersionId> [output_filename]
#   civitai-download.sh --list <modelId>       # list all versions + files
#
# Examples:
#   civitai-download.sh --list 2053259
#   civitai-download.sh 2367702
#   civitai-download.sh 2367702 wan22_cam_v2_LOW_fp8.safetensors

set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${GRIM_CIVITAI_DEST:-$PWD}"
KEYS_FILE="${HOME}/.config/nixe/keys.json"
API_BASE="https://civitai.com/api/v1"

_token() {
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${KEYS_FILE}','utf8')).civitai)"
}

_list() {
  local model_id="$1"
  echo "==> Model $model_id versions:"
  curl -sf "$API_BASE/models/$model_id" \
    -H "Authorization: Bearer $(_token)" | \
    node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Model:', d.name);
(d.modelVersions||[]).forEach(v => {
  console.log('\n  Version: ' + v.name + ' (id=' + v.id + ')');
  (v.files||[]).forEach(f => {
    const gb = (f.sizeKB/1024/1024).toFixed(2);
    console.log('    ' + f.name + ' — ' + gb + ' GB  [fileId=' + f.id + ']');
  });
});
"
}

_download() {
  local version_id="$1"
  local out_name="$2"

  echo "==> Fetching file info for version $version_id..."
  local meta
  meta=$(curl -sf "$API_BASE/model-versions/$version_id" \
    -H "Authorization: Bearer $(_token)")

  # Pick primary file if no name specified
  if [ -z "$out_name" ]; then
    out_name=$(node -e "
const d = JSON.parse(process.argv[1]);
const f = d.files.find(f=>f.primary) || d.files[0];
process.stdout.write(f.name);
" "$meta")
  fi

  local dest="$DEST_DIR/$out_name"
  echo "==> Destination: $dest"

  local download_url="https://civitai.com/api/download/models/$version_id"

  echo "==> Starting download (curl -C - for resume)..."
  curl -L -C - \
    -H "Authorization: Bearer $(_token)" \
    -o "$dest" \
    --progress-bar \
    "$download_url"

  echo ""
  echo "Done: $dest"
  ls -lh "$dest"
}

_main() {
  if [ "${1}" = "--list" ]; then
    _list "${2:?model_id required}"
  else
    _download "${1:?modelVersionId required}" "${2:-}"
  fi
}

_main "$@"
