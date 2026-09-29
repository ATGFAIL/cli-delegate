# cli-delegate

A Claude Code skill that lets Claude act as **lead** and hire other AI coding CLIs already installed on your machine (**Codex**, **Agy / Antigravity CLI**, or another **Claude Code** session) as sub-agents, picking the CLI, model and effort per task, then **verifying every result** before reporting.

Skill สำหรับ Claude Code ให้ Claude เป็นหัวหน้างาน จ้าง CLI อื่นในเครื่อง (Codex, Agy, หรือ Claude อีกเซสชัน) มาทำงานแทน เลือกโมเดลและ effort ตามงาน ประหยัดโควต้า ทำขนานได้ และหัวหน้าต้องตรวจงานทุกครั้งก่อนสรุป

## Install / ติดตั้ง

On every machine, once:

```bash
claude plugin marketplace add ATGFAIL/cli-delegate
claude plugin install cli-delegate@atgfail-tools
```

(or inside a session: `/plugin marketplace add ATGFAIL/cli-delegate`, then `/plugin install cli-delegate@atgfail-tools`).
Requires Node.js >= 18 and at least one worker CLI (`claude`, `codex`, `agy`) installed and logged in. Then just ask Claude, e.g. "use Codex at low effort to write tests for X, and have Agy review it".

Claude accounts do not sync local skills between machines; a plugin from a GitHub marketplace is how you get the same skill everywhere.

## What it does

- `detect` finds the CLIs (PATH, env override, known install locations incl. the Windows Store Codex app).
- `models <cli>` asks each CLI for its real model list; nothing is hard-coded.
- `run` executes one job with explicit model + effort, read-only by default, optional git worktree for write jobs, background mode, timeouts, resume.
- The skill's workflow makes the lead brief clearly, choose model/effort, and **verify diff/tests itself** before accepting.

## Verified facts and limits

Everything was checked against real `--help` output and real runs on **Windows 11** (claude 2.1.258, codex 0.158.0-alpha.2.1, agy 1.2.13) and **Ubuntu 22.04 x86_64** (claude 2.1.272, codex 0.157.1, agy 1.2.12, Node 24): detect, models, read-only run, background run, resume, timeout kill, and write jobs in a git worktree. Details in [`references/`](plugins/cli-delegate/skills/cli-delegate/references).

- **Agy does not enforce read-only** (`--mode plan` / `--sandbox` still allowed a file write). The runner adds an instruction and warns if `git status` changed. Use `--worktree` for jobs that matter.
- **macOS is not tested yet** (same POSIX code path as Linux, but unverified). Override with `CLI_DELEGATE_CODEX`, `CLI_DELEGATE_AGY`, `CLI_DELEGATE_CLAUDE` if detection misses. Reports and PRs welcome.
- Model strength guidance in `SKILL.md` is a starting heuristic, not a benchmark.

## License

MIT
