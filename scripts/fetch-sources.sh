#!/usr/bin/env bash
# Fetch the legalize-kr snapshots needed by `npm run corpus` into ../sources.
#   bash scripts/fetch-sources.sh [target-dir]
# legalize-kr is cloned with full commit history (blobs on demand) so the
# builder can pick the version that is actually in force today.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-../sources}"
mkdir -p "$DEST"
cd "$DEST"

if [ ! -d legalize-kr ]; then
  git clone --filter=blob:none --no-checkout https://github.com/legalize-kr/legalize-kr
fi
cd legalize-kr
git fetch --filter=blob:none origin
git sparse-checkout init --no-cone
node -e '
  const src = require("fs").readFileSync(process.argv[1], "utf8");
  const list = JSON.parse(src.match(/NATIONAL_LAWS = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  console.log(list.map(l => `/kr/${l}/*`).join("\n"));
' "$ROOT/data/law-list.ts" > /tmp/bl-sparse.txt
git sparse-checkout set --stdin < /tmp/bl-sparse.txt
git checkout -q origin/HEAD 2>/dev/null || git checkout -q main
cd ..

if [ ! -d ordinance-kr ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/legalize-kr/ordinance-kr
fi
cd ordinance-kr
git fetch --depth 1 --filter=blob:none origin
git -c core.quotepath=off ls-tree -r --name-only origin/HEAD \
  | grep -E "/조례/[^/]*(건축 ?조례|도시계획 ?조례|도시ㆍ군계획 ?조례|주차장 설치 및 관리 ?조례)/본문\.md$" \
  | grep -v "_교육청" | sed 's#^#/#' > /tmp/bl-ord.txt
git sparse-checkout init --no-cone
git sparse-checkout set --stdin < /tmp/bl-ord.txt
git checkout -q origin/HEAD
echo "sources ready in $DEST (laws: $(wc -l < /tmp/bl-sparse.txt), ordinances: $(wc -l < /tmp/bl-ord.txt))"
