#!/usr/bin/env bash
# Works Gighunter's drafted-but-untailored applications through headless Claude Code sessions,
# in parallel.
#
# Why this exists: Gighunter's server-side tailoring (server/llm/tailor.ts) bills Anthropic API
# credits. A Claude Code session bills the Pro subscription instead. So the reasoning moves out
# of the server and into an agent that drives Gighunter over MCP — same prompt, same schema, same
# validation, different wallet.
#
# Usage:
#   ./tailor-queue.sh              # work the whole backlog
#   ./tailor-queue.sh 5            # stop after 5
#   TAILOR_JOBS=8 ./tailor-queue.sh    # 8 concurrent sessions instead of the default 4
#
# Requires: the autogighunter MCP server registered with Claude Code, and Gighunter reachable.
set -uo pipefail

ORBIT="${ORBIT_BASE_URL:-http://127.0.0.1:3000}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMIT="${1:-0}"

# Each job is independent — a tailoring reads one posting and writes one row — so the only reason
# to serialise was simplicity. Concurrency is what turns a 40-job backlog from forty sequential
# Claude sessions into ten rounds of four.
CONCURRENCY="${TAILOR_JOBS:-4}"

# Pro plan usage is windowed. With workers running in parallel the gap is per-worker, so the
# aggregate rate is roughly CONCURRENCY/GAP — keep that in mind before raising both at once.
GAP_SECONDS="${TAILOR_GAP_SECONDS:-5}"

LOG_DIR="${TAILOR_LOG_DIR:-$PROJECT_DIR/auto/logs/tailoring}"

command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
curl -sf -m 5 "$ORBIT/api/overview" >/dev/null || { echo "Gighunter not reachable at $ORBIT"; exit 1; }
mkdir -p "$LOG_DIR"

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

read -r -d '' PROMPT_TEMPLATE <<'PROMPT'
Tailor the resume and cover letter for Gighunter job __JOB__.

1. Call orbit_tailoring_context with that jobId. It returns the posting, the candidate's full
   accomplishment library, and Gighunter's honesty rules.
2. Follow those rules exactly. Never invent experience. Preserve every number, percentage, date,
   and proper noun verbatim. Only rephrase material the candidate actually wrote.
3. Call orbit_save_tailoring with the jobId and your tailoring. Each bullet's sourceText must be
   copied verbatim from the library so the rewrite can be diffed against it.
4. Be rigorous about coveredButUnstated — terms the posting wants that the candidate demonstrably
   has but never names literally. Be honest in fitAssessment, including reasons not to apply.
5. The coverLetter field is required and is graded on being specific to THIS posting:
   - recipient: only a name the posting itself gives. null otherwise — never guess one.
   - Write four paragraphs totalling 250-400 words. Gighunter rejects the save outside 120-500,
     so count before you send.
   - Do NOT write a greeting, sign-off, or letterhead. Gighunter renders those.
   - Do not restate the resume in prose. The bullets say what the candidate did; the letter says
     what that means for this employer.
   - interestParagraph must point at something the posting actually says. If it offers nothing
     concrete, write about the substance of the work rather than inventing praise for the company.

If orbit_save_tailoring returns a 400, read the issues, fix exactly what it names, and retry once.
Reply with one short line confirming what you saved.
PROMPT

TOOLS="mcp__autogighunter__orbit_tailoring_context,mcp__autogighunter__orbit_save_tailoring"

# One unit of work. Runs in a subshell so several can be in flight at once; its exit status is
# what the wait loop below counts, and its output is kept for diagnosis rather than discarded.
tailor_one() {
  local job="$1" score="$2" label="$3" log="$LOG_DIR/$job.log"
  local prompt="${PROMPT_TEMPLATE//__JOB__/$job}"

  if (cd "$PROJECT_DIR" && claude -p "$prompt" --allowedTools "$TOOLS") >"$log" 2>&1; then
    printf '  ok      %3s%%  %s\n' "$score" "${label:0:58}"
    return 0
  fi
  # The failure reason is the useful part at scale — "12 failed" is not actionable, "12 failed on
  # cover letter length" is. Surface the last line and keep the whole transcript.
  printf '  FAILED  %3s%%  %s\n            └ %s\n' \
    "$score" "${label:0:58}" "$(tail -n 2 "$log" | tr '\n' ' ' | cut -c1-100)"
  return 1
}

echo "Tailoring $total application(s) via headless Claude Code (Pro subscription, no API credits)."
echo "Concurrency: $CONCURRENCY   Logs: $LOG_DIR"
echo

started=0; failed=0
declare -a PIDS=()

for row in "${QUEUE[@]}"; do
  [ "$started" -ge "$total" ] && break
  IFS=$'\t' read -r job score label <<<"$row"

  tailor_one "$job" "$score" "$label" &
  PIDS+=("$!")
  started=$((started + 1))

  # Block once the pool is full: wait for the oldest worker, then let the next one start. Keeps
  # exactly CONCURRENCY sessions in flight without needing GNU parallel or `wait -n`.
  if [ "${#PIDS[@]}" -ge "$CONCURRENCY" ]; then
    wait "${PIDS[0]}" || failed=$((failed + 1))
    PIDS=("${PIDS[@]:1}")
    sleep "$GAP_SECONDS"
  fi
done

# Drain whatever is still running.
for pid in "${PIDS[@]}"; do
  wait "$pid" || failed=$((failed + 1))
done

echo
echo "Done: $((started - failed)) tailored, $failed failed."
[ "$failed" -gt 0 ] && echo "Failure transcripts: $LOG_DIR"
echo "Resumes and cover letters regenerate from the stored tailoring on next download."
