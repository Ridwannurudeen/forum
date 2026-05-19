#!/usr/bin/env bash
# poly-backup-keys.sh — encrypted off-VPS backup of /root/.poly-keys/.
#
# Pulls signer.key + api-key + api-secret + api-passphrase off the VPS,
# tars + encrypts with AES-256-CBC under a passphrase you type at the
# prompt, and writes a single .enc.tar file to C:\Users\gudma\Music\.
#
# Recovery (rebuild VPS / new machine):
#   openssl enc -aes-256-cbc -d -pbkdf2 -in poly-keys-backup-<date>.enc.tar | tar -xv
#
# Run:  bash keeper/scripts/poly-backup-keys.sh
# Optional: bash keeper/scripts/poly-backup-keys.sh --verify
#           (decrypts the latest backup in-memory to confirm passphrase + integrity)
#
# This script never writes the plaintext key bundle to disk locally
# (the tar pipes directly into openssl). The .enc.tar is safe to keep
# in Music/ alongside the existing plaintext file copies (those are the
# unencrypted backup; this is the encrypted one for archival / off-VPS
# recovery).

set -euo pipefail

REMOTE='root@gudman.xyz'
REMOTE_DIR='/root/.poly-keys'
LOCAL_OUT_DIR='C:/Users/gudma/Music'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${LOCAL_OUT_DIR}/poly-keys-backup-${STAMP}.enc.tar"

mode='backup'
if [[ "${1:-}" == '--verify' ]]; then
  mode='verify'
fi

if [[ "$mode" == 'verify' ]]; then
  latest=$(ls -1t "${LOCAL_OUT_DIR}"/poly-keys-backup-*.enc.tar 2>/dev/null | head -1 || true)
  if [[ -z "$latest" ]]; then
    echo "no poly-keys-backup-*.enc.tar in ${LOCAL_OUT_DIR}"
    exit 1
  fi
  echo "Verifying: $latest"
  echo -n "Decrypt passphrase: "
  read -rs pw; echo
  # Pipe decrypt → tar -tv to list contents without extracting to disk
  if ! openssl enc -aes-256-cbc -d -pbkdf2 -in "$latest" -pass "pass:$pw" 2>/dev/null | tar -tv; then
    echo
    echo "FAILED — passphrase wrong or backup corrupt."
    exit 1
  fi
  echo
  echo "Verified — passphrase correct, tar listing intact."
  exit 0
fi

echo "Backup target: $OUT"
echo "VPS:           $REMOTE:$REMOTE_DIR"
echo
echo -n "Encryption passphrase (memorize this): "
read -rs pw1; echo
echo -n "Confirm:                                "
read -rs pw2; echo
if [[ "$pw1" != "$pw2" ]]; then
  echo "passphrase mismatch"
  exit 2
fi
if [[ ${#pw1} -lt 12 ]]; then
  echo "passphrase too short (need >= 12 chars)"
  exit 2
fi

# tar over ssh → openssl enc; nothing plaintext touches local disk.
ssh "$REMOTE" "tar -C '$(dirname "$REMOTE_DIR")' -cf - $(basename "$REMOTE_DIR")" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:$pw1" -out "$OUT"
chmod 600 "$OUT" 2>/dev/null || true

bytes=$(wc -c < "$OUT")
echo
echo "Wrote $OUT ($bytes bytes)"
echo
echo "Verifying decryption + listing contents (passphrase auto-fed):"
openssl enc -aes-256-cbc -d -pbkdf2 -in "$OUT" -pass "pass:$pw1" | tar -tv
echo
echo "Done. Remember the passphrase — there is NO recovery if you lose it."
