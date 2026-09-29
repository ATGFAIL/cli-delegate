# Claude Code CLI (as a worker)

Verified 2026-09-29 on Windows 11, `claude` 2.1.258 (`claude --help`, real runs).

| Need | Flag |
|---|---|
| Non-interactive | `-p` / `--print` (prompt on stdin works) |
| Model | `--model <alias or id>` (aliases such as `opus`, `sonnet`, `haiku`; there is no model-list command) |
| Effort | `--effort low\|medium\|high\|xhigh\|max` |
| Output | `--output-format json` gives `result`, `session_id`, `is_error` |
| Read-only | `--permission-mode plan` (verified: a write request was refused) |
| Write | `--permission-mode acceptEdits` |
| Resume | `--resume <session-id>` (verified: remembered earlier turn) |

Other options seen in `--help`, not used by the runner: `--max-budget-usd`, `--no-session-persistence`, `--bg`, `--add-dir`, `--tools`, `--allowedTools`, `--bare` (needs API key auth).

Windows: npm installs `claude.cmd` (and a `.ps1` shim). The runner uses the `.cmd`.
