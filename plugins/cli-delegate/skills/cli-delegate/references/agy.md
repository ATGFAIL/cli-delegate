# Agy: Google Antigravity CLI (as a worker)

Verified 2026-09-29 on Windows 11, `agy` 1.2.12 / 1.2.13 (`--help`, `agy models`, real runs).

| Need | Flag |
|---|---|
| Non-interactive | `-p=<prompt>`. **The prompt must be attached with `=`**; `-p` followed by another flag swallows that flag, and stdin is not accepted. Long briefs: pass "read the task from <file>" plus `--add-dir <dir>` (runner does this above 6000 chars) |
| Model | `--model <id>`; list with `agy models` (ids like `gemini-3.8-flash-low`, `gemini-3.1-pro-high`, `claude-sonnet-4-6`, `gpt-oss-120b-medium`; the list is account-dependent, never hard-code it) |
| Effort | `--effort low\|medium\|high\|max` (many model ids also carry a `-low/-medium/-high` suffix) |
| Output | `--output-format json` gives `response`, `conversation_id`, `status` (`SUCCESS`) |
| Resume | `--conversation <id>`; `-c` continues the latest. Verified: remembered earlier turn |
| Timeout | `--print-timeout` exists; the runner uses its own kill-tree timeout |

## Read-only is NOT enforced (verified)

`--mode plan` and `--sandbox` did **not** stop agy from creating a file when asked. `--mode plan` only makes it draft plan artifacts (written under `~/.gemini/antigravity-cli/brain/`) and it still wrote the file afterwards. A prompt that says "read-only, never modify files" was obeyed. So the runner prefixes that instruction for read runs and diffs `git status` before/after; use `--worktree` for anything important.

Write mode: `--mode accept-edits`.

## Install / location

- Windows: `irm https://antigravity.google/cli/install.ps1 | iex`. Verified location on this machine: `%USERPROFILE%\.gemini\bin\agy.exe` (not on PATH).
- macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash` (official install command per third-party guides). **Verified on Ubuntu 22.04:** the binary is `~/.gemini/bin/agy` (here symlinked from `/usr/local/bin/agy`), same as Windows. macOS not verified. The runner checks `--help` output contains `--print`.
- On Linux the desktop app's `/usr/bin/antigravity` can collide with the name `agy` (third-party report); the runner rejects executables that do not look like agy.
- Override with `CLI_DELEGATE_AGY`.
