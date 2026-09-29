# Codex CLI (as a worker)

Verified 2026-09-29 on Windows 11, `codex-cli 0.158.0-alpha.2.1` (`--help`, `debug models`, real runs).

| Need | Flag |
|---|---|
| Non-interactive | `codex exec [PROMPT]`; `-` reads the prompt from stdin |
| Model | `-m <slug>`; list with `codex debug models` (JSON catalog, use entries with `visibility: list`) |
| Effort | `-c model_reasoning_effort=<level>`; allowed levels depend on the model (`supported_reasoning_levels` in the catalog; official docs: low, medium, high, xhigh, max, ultra "depending on model") |
| Read-only / write | `-s read-only` / `-s workspace-write` (third value `danger-full-access` is never used). Verified: read-only refused a file write |
| Last answer | `-o <file>` writes the final message; the runner reads it |
| Not a git repo | `--skip-git-repo-check` (added automatically) |
| Resume | `codex exec resume <session-id> -` . **`resume` has no `-s`**, use `-c sandbox_mode=read-only\|workspace-write` (config key from official config reference). Verified: remembered earlier turn |
| Session id | printed as `session id: <uuid>` in the run header; the runner parses it |
| Config default | a user's `~/.codex/config.toml` may set `model_reasoning_effort` (here it was `low`); always override |

Install: macOS/Linux `curl -fsSL https://chatgpt.com/codex/install.sh | sh` or `npm install -g @openai/codex` (official docs). On Windows the desktop Store app bundles `codex.exe` at `%ProgramFiles%\WindowsApps\OpenAI.Codex_<version>\app\resources\codex.exe`; that path changes with each update, so the runner discovers it (PATH, then WindowsApps, then `Get-AppxPackage`). Override with `CLI_DELEGATE_CODEX`.

Verified on Ubuntu 22.04: `codex` and `claude` live in `~/.local/bin` (not on a non-login SSH PATH); the runner probes that directory. Auth: `codex login status`.
