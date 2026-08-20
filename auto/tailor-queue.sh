#!/usr/bin/env bash
# Tails Gighunter's drafted-but-untailored applications through a headless Claude Code session.
#
# Why this exists: Gighunter's server-side tailoring (server/llm/tailor.ts) bills Anthropic API
# credits. A Claude Code session bills the Pro subscription instead. So the reasoning moves out
# of the server and into an agent that drives Gighunter over MCP — same prompt, same schema, same
# validation, different wallet.
#
# Usage:
#   ./tailor-queue.sh          # work the whole backlog
#   ./tailor-queue.sh 5        # stop after 5
#
# Requires: the autogighunter MCP server registered with Claude Code, and Gighunter reachable.
set -uo pipefail

ORBIT="${ORBIT_BASE_URL:-http://127.0.0.1:3000}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMIT="${1:-0}"
# Pro plan usage is windowed; pacing keeps a long backlog from burning the window in one burst.
GAP_SECONDS="${TAILOR_GAP_SECONDS:-20}"

command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
curl -sf -m 5 "$ORBIT/api/overview" >/dev/null || { echo "Gighunter not reachable at $ORBIT"; exit 1; }

# Drafted applications with no tailoring yet, highest score first.
# Gighunter has no "untailored" endpoint, so this reads each drafted application and filters here.
export ORBIT
QUEUE_RAW="$(
  curl -s "$ORBIT/api/matches" | python3 -c '
import json, os, sys, urllib.request
base = os.environ["ORBIT"]
rows = []
for m in json.load(sys.stdin)["matches"]:
    aid = m.get("applicationId")
    if not aid:
        continue
    with urllib.request.urlopen(base + "/api/applications/" + aid) as r:
        if json.load(r).get("tailoring") is None:
            rows.append((m["score"], m["jobId"], m["title"], m["company"]))
for score, job, title, company in sorted(rows, reverse=True):
    print("%s\t%s\t%s @ %s" % (job, score, title, company))
'
)" || { echo "Could not build the queue from $ORBIT"; exit 1; }

mapfile -t QUEUE <<<"$QUEUE_RAW"
# mapfile turns empty input into one empty element; drop it so the count is honest.
[ "${#QUEUE[@]}" -eq 1 ] && [ -z "${QUEUE[0]}" ] && QUEUE=()

total=${#QUEUE[@]}
[ "$total" -eq 0 ] && { echo "Nothing to tailor — every drafted application already has a tailoring."; exit 0; }
[ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$total" ] && total="$LIMIT"

echo "Tailoring $total application(s) via headless Claude Code (Pro subscription, no API credits)."
echo

done_n=0; failed=0
for row in "${QUEUE[@]}"; do
  [ "$done_n" -ge "$total" ] && break
  IFS=$'\t' read -r job score label <<<"$row"
  printf '[%d/%d] %s%% %s ... ' "$((done_n + 1))" "$total" "$score" "${label:0:60}"

  if (cd "$PROJECT_DIR" && claude -p "Tailor the resume for Gighunter job $job.

1. Call orbit_tailoring_context with that jobId. It returns the posting, the candidate's full
   accomplishment library, and Gighunter's honesty rules.
2. Follow those rules exactly. Never invent experience. Preserve every number, percentage, date,
   and proper noun verbatim. Only rephrase material the candidate actually wrote.
3. Call orbit_save_tailoring with the jobId and your tailoring. Each bullet's sourceText must be
   copied verbatim from the library so the rewrite can be diffed against it.
4. Be rigorous about coveredButUnstated — terms the posting wants that the candidate demonstrably
   has but never names literally. Be honest in fitAssessment, including reasons not to apply.

Reply with one short line confirming what you saved." \
      --allowedTools "mcp__autogighunter__orbit_tailoring_context,mcp__autogighunter__orbit_save_tailoring" \
      >/dev/null 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    failed=$((failed + 1))
  fi

  done_n=$((done_n + 1))
  [ "$done_n" -lt "$total" ] && sleep "$GAP_SECONDS"
done

echo
echo "Done: $((done_n - failed)) tailored, $failed failed."
echo "Resumes regenerate from the stored tailoring on next download — no need to re-draft."
