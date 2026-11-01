#!/bin/sh
# macOS: double-click in Finder. Linux: run ./dev.command in a terminal.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 이상이 필요합니다: https://nodejs.org/ko/download"
  echo "설치한 뒤 다시 실행하세요. (Enter를 누르면 닫습니다)"
  read -r _
  exit 1
fi
node scripts/launch.mjs dev "$@"
status=$?
if [ $status -ne 0 ]; then
  echo "실행하지 못했습니다. 위의 메시지를 확인하세요. (Enter를 누르면 닫습니다)"
  read -r _
fi
exit $status
