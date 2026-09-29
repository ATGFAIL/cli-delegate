#!/usr/bin/env node
// cli-delegate: run other AI coding CLIs (claude, codex, agy) as sub-agents.
// Zero dependencies, Node >= 18, works on Windows / Linux / macOS.
// Every flag used here was verified against each CLI's own `--help` (see references/*.md).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();
const STATE_DIR = process.env.CLI_DELEGATE_HOME || path.join(HOME, '.cli-delegate');
const RUNS_DIR = path.join(STATE_DIR, 'runs');
const INLINE_PROMPT_MAX = 6000; // agy only accepts the prompt as an argument; longer briefs go via a file

const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const fail = (msg, extra = {}) => { out({ ok: false, error: msg, ...extra }); process.exit(1); };

// ---------- argument parsing ----------
function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- process helpers ----------
function isWinShellScript(file) { return IS_WIN && /\.(cmd|bat)$/i.test(file); }
function quoteWin(a) { return /[\s&|<>^"()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a; }

function spawnCli(file, args, opts = {}) {
  if (isWinShellScript(file)) return spawn([quoteWin(file), ...args.map(quoteWin)].join(' '), { ...opts, shell: true });
  return spawn(file, args, opts);
}
function runSync(file, args, timeoutMs = 20000) {
  const useShell = isWinShellScript(file);
  const r = useShell
    ? spawnSync([quoteWin(file), ...args.map(quoteWin)].join(' '), { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: true })
    : spawnSync(file, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function killTree(pid) {
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
  } catch { /* already gone */ }
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function whichAll(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
  const hits = [];
  for (const d of dirs) for (const e of exts) {
    const f = path.join(d, name + e);
    try { if (fs.statSync(f).isFile()) hits.push(f); } catch { /* not here */ }
  }
  return hits;
}
function usable(f) { return !(IS_WIN && /\.ps1$/i.test(f)); } // .ps1 shims are skipped; npm ships a .cmd sibling

// ---------- CLI discovery ----------
function codexStoreCandidates() {
  if (!IS_WIN) return [];
  const found = [];
  const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps');
  try {
    for (const d of fs.readdirSync(root).filter((n) => /^OpenAI\.Codex_/i.test(n))) {
      found.push(path.join(root, d, 'app', 'resources', 'codex.exe'));
    }
  } catch { /* WindowsApps is often unreadable; fall back to the package query */ }
  if (!found.length) {
    const r = runSync('powershell.exe', ['-NoProfile', '-Command', '(Get-AppxPackage OpenAI.Codex | Select-Object -First 1).InstallLocation'], 30000);
    const loc = r.stdout.trim();
    if (loc) found.push(path.join(loc, 'app', 'resources', 'codex.exe'));
  }
  return found.sort().reverse(); // newest version folder first
}

const exe = (n) => (IS_WIN ? `${n}.exe` : n);
const CLIS = {
  claude: {
    env: 'CLI_DELEGATE_CLAUDE',
    candidates: () => [...whichAll('claude'), path.join(HOME, '.local', 'bin', exe('claude'))],
    probe: (f) => runSync(f, ['--version']),
    looksRight: (r) => /claude/i.test(r.stdout),
  },
  codex: {
    env: 'CLI_DELEGATE_CODEX',
    candidates: () => [...whichAll('codex'), ...codexStoreCandidates(), path.join(HOME, '.local', 'bin', exe('codex'))],
    probe: (f) => runSync(f, ['--version']),
    looksRight: (r) => /codex/i.test(r.stdout),
  },
  agy: {
    env: 'CLI_DELEGATE_AGY',
    // ~/.gemini/bin verified on Windows; ~/.local/bin is the documented location on macOS/Linux
    candidates: () => [...whichAll('agy'), path.join(HOME, '.gemini', 'bin', exe('agy')), path.join(HOME, '.local', 'bin', exe('agy'))],
    probe: (f) => runSync(f, ['--help']),
    // guards against the Linux desktop launcher `antigravity` being aliased as agy
    looksRight: (r) => /--print/.test(r.stdout + r.stderr),
  },
};

const _detected = {};
function detect(name) {
  if (_detected[name]) return _detected[name];
  const spec = CLIS[name];
  const list = [];
  if (process.env[spec.env]) list.push(process.env[spec.env]);
  list.push(...spec.candidates().filter(usable));
  const seen = new Set();
  for (const f of list) {
    if (seen.has(f)) continue; seen.add(f);
    if (!fs.existsSync(f)) continue;
    const r = spec.probe(f);
    if (r.error || !spec.looksRight(r)) continue;
    const ver = name === 'agy' ? runSync(f, ['--version']).stdout.trim() : r.stdout.trim().split('\n')[0];
    return (_detected[name] = { name, found: true, path: f, version: ver });
  }
  return (_detected[name] = { name, found: false, hint: `set ${spec.env} to the executable path` });
}

// ---------- model catalogs (never hard-coded) ----------
function listModels(name) {
  const d = detect(name);
  if (!d.found) return { cli: name, error: 'not installed' };
  if (name === 'agy') {
    const r = runSync(d.path, ['models'], 60000);
    const models = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [id, ...rest] = l.split('\t'); return { id, label: rest.join(' ') }; });
    return { cli: name, models };
  }
  if (name === 'codex') {
    const r = runSync(d.path, ['debug', 'models'], 60000);
    try {
      const j = JSON.parse(r.stdout); const arr = j.models || j;
      return { cli: name, models: arr.filter((m) => m.visibility === 'list').map((m) => ({
        id: m.slug, description: m.description, efforts: (m.supported_reasoning_levels || []).map((x) => x.effort || x), default_effort: m.default_reasoning_level })) };
    } catch { return { cli: name, error: 'could not parse `codex debug models`', raw: r.stdout.slice(0, 500) }; }
  }
  return { cli: name, note: 'claude has no model-list command; pass an alias (opus/sonnet/haiku/...) or a full model id, see `claude --help`' };
}
function codexEfforts(model) {
  const l = listModels('codex');
  return (l.models || []).find((m) => m.id === model)?.efforts;
}
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const AGY_EFFORTS = ['low', 'medium', 'high', 'max'];

// ---------- sourced model guide (bundled) + local refresh overlay ----------
const GUIDE_FILE = new URL('../references/model-guide.json', import.meta.url);
const LOCAL_GUIDE = path.join(STATE_DIR, 'model-guide.local.json');
const SCORE_FILE = path.join(STATE_DIR, 'scorecard.jsonl');

function loadGuide() {
  const g = JSON.parse(fs.readFileSync(GUIDE_FILE, 'utf8'));
  let local = null;
  try { local = JSON.parse(fs.readFileSync(LOCAL_GUIDE, 'utf8')); } catch { /* no local overlay */ }
  if (local) { // local entries override bundled ones with the same key; newest verified date wins for the file age
    const byKey = new Map(g.entries.map((e) => [e.key, e]));
    for (const e of local.entries || []) byKey.set(e.key, e);
    g.entries = [...byKey.values()];
    if (local.verified && local.verified > g.verified) g.verified = local.verified;
  }
  return g;
}
const entryFor = (g, cli, id) => g.entries.find((e) => e.cli === cli && new RegExp(e.match, 'i').test(id));
const ageDays = (d) => Math.floor((Date.now() - Date.parse(d)) / 86400000);

// Compare the guide with what each installed CLI reports right now.
function checkGuide() {
  const g = loadGuide(), report = { guideVerified: g.verified, guideAgeDays: ageDays(g.verified), clis: {}, actionRequired: [] };
  if (report.guideAgeDays > g.max_age_days) report.actionRequired.push(`guide is ${report.guideAgeDays} days old (limit ${g.max_age_days}): re-verify against the sources`);
  for (const cli of Object.keys(CLIS)) {
    const d = detect(cli);
    if (!d.found) { report.clis[cli] = { installed: false }; continue; }
    const live = listModels(cli);
    const ids = (live.models || []).map((m) => m.id);
    const info = { installed: true, version: d.version, liveModels: ids.length, undocumented: [], staleEntries: [], documented: [] };
    if (cli === 'claude') { // no list command: aliases cannot be diffed, so only check age and retirement-sensitive entries
      info.note = 'claude has no model-list command; entries cannot be diffed automatically';
    } else {
      for (const m of live.models || []) {
        const e = entryFor(g, cli, m.id);
        if (!e) info.undocumented.push(m.id); else if (!info.documented.includes(e.key)) info.documented.push(e.key);
      }
      for (const e of g.entries.filter((x) => x.cli === cli && x.status !== 'not-in-catalog')) {
        if (!ids.some((id) => new RegExp(e.match, 'i').test(id))) info.staleEntries.push(e.key);
      }
      if (info.undocumented.length) report.actionRequired.push(`${cli}: live models not in the guide (research before use): ${info.undocumented.join(', ')}`);
      if (info.staleEntries.length) report.actionRequired.push(`${cli}: guide entries no longer offered (likely retired/renamed): ${info.staleEntries.join(', ')}`);
    }
    for (const e of g.entries.filter((x) => x.cli === cli && ['preview', 'unknown'].includes(x.status))) {
      report.actionRequired.push(`${cli}: '${e.key}' is ${e.status} in the guide: treat as unreliable and re-check`);
    }
    report.clis[cli] = info;
  }
  report.ok = report.actionRequired.length === 0;
  if (!report.ok) report.howToRefresh = `Look up each item in the guide's official \`sources\`, then write ~/.cli-delegate/model-guide.local.json (same entry format, real source URL + today's date, confidence 'unknown' when nothing is found). Never fill facts from memory.`;
  return report;
}

// Live catalog joined with sourced guidance (+ vendor description when the CLI gives one).
function guideFor(cli) {
  const g = loadGuide(), live = listModels(cli);
  if (!live.models) return { cli, note: live.note || live.error, entries: g.entries.filter((e) => e.cli === cli) };
  return { cli, guideVerified: g.verified, models: live.models.map((m) => {
    const e = entryFor(g, cli, m.id);
    return { id: m.id, cliDescription: m.description, guide: e ? { status: e.status, tier: e.tier, best_for: e.best_for, notes: e.notes, confidence: e.confidence, source: e.source, verified: e.verified } : 'NOT IN GUIDE: research before use' };
  }) };
}

// ---------- scorecard: measured results from this user's own delegated jobs ----------
function appendScore(rec) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.appendFileSync(SCORE_FILE, JSON.stringify(rec) + '\n'); }
function readScores() {
  try { return fs.readFileSync(SCORE_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function scoreboard() {
  const runs = new Map(), verdicts = new Map();
  for (const r of readScores()) (r.type === 'verdict' ? verdicts : runs).set(r.id, { ...(runs.get(r.id) || {}), ...r });
  const groups = {};
  for (const r of runs.values()) {
    const key = `${r.cli}/${r.model || 'default'}/${r.effort} | ${r.taskType || 'untagged'}`;
    const v = verdicts.get(r.id)?.verdict;
    const gr = (groups[key] ||= { runs: 0, pass: 0, partial: 0, fail: 0, unverified: 0, secs: [] });
    gr.runs++; gr[v || 'unverified']++; if (r.durationSec != null) gr.secs.push(r.durationSec);
  }
  return Object.entries(groups).map(([k, v]) => { const s = v.secs.sort((a, b) => a - b);
    return { group: k, runs: v.runs, pass: v.pass, partial: v.partial, fail: v.fail, unverified: v.unverified, medianSec: s.length ? s[Math.floor(s.length / 2)] : null }; })
    .sort((a, b) => b.runs - a.runs);
}

// ---------- adapters: (opts) -> {args, stdin, outputFile?, parse} ----------
function isGitRepo(dir) { return spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], { windowsHide: true }).status === 0; }

const AGY_READONLY_GUARD = 'READ-ONLY TASK: never create, edit, move or delete any file, and never run commands that change state. Only read and report.\n\n';

const ADAPTERS = {
  claude(o) {
    const args = ['-p', '--output-format', 'json', '--permission-mode', o.mode === 'write' ? 'acceptEdits' : 'plan'];
    if (o.model) args.push('--model', o.model);
    if (o.effort) args.push('--effort', o.effort);
    if (o.resume) args.push('--resume', o.resume);
    return { args, stdin: o.prompt, parse: (stdout) => {
      try { const j = JSON.parse(stdout); return { text: j.result ?? stdout, sessionId: j.session_id, isError: !!j.is_error }; }
      catch { return { text: stdout }; } } };
  },
  codex(o) {
    const args = o.resume ? ['exec', 'resume', o.resume] : ['exec'];
    const sandbox = o.mode === 'write' ? 'workspace-write' : 'read-only';
    if (o.resume) args.push('-c', `sandbox_mode=${sandbox}`); // `exec resume` has no -s flag
    else args.push('-s', sandbox);
    if (o.model) args.push('-m', o.model);
    if (o.effort) args.push('-c', `model_reasoning_effort=${o.effort}`); // override config.toml default every time
    if (!isGitRepo(o.cwd)) args.push('--skip-git-repo-check');
    args.push('-o', o.outputFile, '-');
    return { args, stdin: o.prompt, outputFile: o.outputFile, parse: (stdout, stderr, file) => ({
      text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : stdout,
      sessionId: (/session id:\s*([0-9a-f-]{36})/i.exec(stdout + stderr) || [])[1] }) };
  },
  agy(o) {
    // `-p` only takes its prompt as an attached value (-p=<text>); long briefs are passed by file pointer
    // VERIFIED: agy's --mode plan and --sandbox do NOT stop file writes, so read-only is enforced by instruction + a git-status check
    let prompt = o.mode === 'write' ? o.prompt : AGY_READONLY_GUARD + o.prompt;
    const extra = [];
    if (prompt.length > INLINE_PROMPT_MAX) {
      prompt = `Read the full task from ${o.promptFile} and carry it out exactly as written.`;
      extra.push('--add-dir', path.dirname(o.promptFile));
    }
    const args = ['--mode', o.mode === 'write' ? 'accept-edits' : 'plan', '--output-format', 'json', ...extra];
    if (o.model) args.push('--model', o.model);
    if (o.effort) args.push('--effort', o.effort);
    if (o.resume) args.push('--conversation', o.resume);
    args.push(`-p=${prompt}`);
    return { args, stdin: null, parse: (stdout) => {
      try { const j = JSON.parse(stdout); return { text: j.response ?? stdout, sessionId: j.conversation_id, isError: j.status !== 'SUCCESS' }; }
      catch { return { text: stdout }; } } };
  },
};

// ---------- run lifecycle ----------
const runDir = (id) => path.join(RUNS_DIR, id);
const readMeta = (id) => { try { return JSON.parse(fs.readFileSync(path.join(runDir(id), 'meta.json'), 'utf8')); } catch { return null; } };
const writeMeta = (m) => fs.writeFileSync(path.join(runDir(m.id), 'meta.json'), JSON.stringify(m, null, 2));

function makeWorktree(cwd, id) {
  if (!isGitRepo(cwd)) fail('--worktree needs a git repository', { cwd });
  const wt = path.join(STATE_DIR, 'worktrees', id);
  const branch = `cli-delegate/${id}`;
  const r = spawnSync('git', ['-C', cwd, 'worktree', 'add', '-b', branch, wt, 'HEAD'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) fail('git worktree add failed', { stderr: r.stderr });
  return { path: wt, branch };
}

function prepareRun(flags) {
  const cli = flags.cli;
  if (!CLIS[cli]) fail(`--cli must be one of: ${Object.keys(CLIS).join(', ')}`);
  const d = detect(cli);
  if (!d.found) fail(`${cli} is not installed or not found`, { hint: d.hint });
  const mode = flags.mode === 'write' ? 'write' : 'read';
  if (flags.mode && !['read', 'write'].includes(flags.mode)) fail('--mode must be read or write');
  const effort = flags.effort && flags.effort !== true ? String(flags.effort) : null;
  if (!effort) fail('--effort is required (no silent defaults: a config file may hold a low default)');
  const supported = cli === 'claude' ? CLAUDE_EFFORTS : cli === 'agy' ? AGY_EFFORTS : (flags.model ? codexEfforts(flags.model) : null);
  if (supported && !supported.includes(effort)) fail(`effort '${effort}' not supported by ${cli}${flags.model ? '/' + flags.model : ''}`, { supported });
  let prompt;
  if (flags['prompt-file']) prompt = fs.readFileSync(flags['prompt-file'], 'utf8');
  else if (flags.prompt && flags.prompt !== true) prompt = String(flags.prompt);
  else fail('give --prompt-file <file> (preferred) or --prompt <text>');
  const id = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(runDir(id), { recursive: true });
  const promptFile = path.join(runDir(id), 'prompt.txt');
  fs.writeFileSync(promptFile, prompt);
  let cwd = path.resolve(flags.cwd && flags.cwd !== true ? flags.cwd : process.cwd());
  const wt = flags.worktree ? makeWorktree(cwd, id) : null;
  const meta = { id, cli, model: flags.model && flags.model !== true ? flags.model : null, effort, mode, cwd, workdir: wt ? wt.path : cwd,
    worktree: wt, resume: flags.resume && flags.resume !== true ? flags.resume : null,
    taskType: flags['task-type'] && flags['task-type'] !== true ? String(flags['task-type']) : null,
    timeoutSec: Number(flags.timeout) || 900, status: 'pending', startedAt: null, cliPath: d.path, promptFile };
  writeMeta(meta);
  return meta;
}

const gitState = (dir) => (isGitRepo(dir) ? spawnSync('git', ['-C', dir, 'status', '--porcelain', '-uall'], { encoding: 'utf8', windowsHide: true }).stdout : null);

function execute(meta) {
  return new Promise((resolve) => {
    const before = meta.mode === 'read' ? gitState(meta.workdir) : null;
    const outputFile = path.join(runDir(meta.id), 'codex-last-message.txt');
    const ad = ADAPTERS[meta.cli]({ ...meta, cwd: meta.workdir, prompt: fs.readFileSync(meta.promptFile, 'utf8'), outputFile });
    meta.status = 'running'; meta.startedAt = new Date().toISOString(); meta.args = ad.args.map((a) => (a.startsWith('-p=') ? '-p=<prompt>' : a));
    const stdoutStream = fs.createWriteStream(path.join(runDir(meta.id), 'stdout.txt'));
    const stderrStream = fs.createWriteStream(path.join(runDir(meta.id), 'stderr.txt'));
    const child = spawnCli(meta.cliPath, ad.args, { cwd: meta.workdir, windowsHide: true, detached: !IS_WIN,
      stdio: [ad.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' } });
    meta.pid = child.pid; writeMeta(meta);
    let so = '', se = '', timedOut = false;
    child.stdout.on('data', (b) => { so += b; stdoutStream.write(b); });
    child.stderr.on('data', (b) => { se += b; stderrStream.write(b); });
    if (ad.stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(ad.stdin); }
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, meta.timeoutSec * 1000);
    const finish = (code, err) => {
      clearTimeout(timer); stdoutStream.end(); stderrStream.end();
      const parsed = ad.parse(so, se, outputFile);
      Object.assign(meta, { endedAt: new Date().toISOString(), exitCode: code, sessionId: parsed.sessionId || null,
        status: timedOut ? 'timeout' : (code === 0 && !parsed.isError && !err ? 'done' : 'failed') });
      if (err) meta.error = String(err.message || err);
      if (before !== null && gitState(meta.workdir) !== before) meta.unexpectedChanges = true; // read-only run modified the tree
      fs.writeFileSync(path.join(runDir(meta.id), 'result.txt'), parsed.text || '');
      writeMeta(meta);
      appendScore({ type: 'run', id: meta.id, ts: meta.endedAt, cli: meta.cli, model: meta.model, effort: meta.effort, mode: meta.mode,
        taskType: meta.taskType, status: meta.status, durationSec: Math.round((Date.parse(meta.endedAt) - Date.parse(meta.startedAt)) / 1000) });
      resolve(meta);
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

const summary = (m, withText = true) => {
  let text = '';
  if (withText) { try { text = fs.readFileSync(path.join(runDir(m.id), 'result.txt'), 'utf8'); } catch { /* not ready */ } }
  const cap = 20000;
  return { ok: m.status === 'done', id: m.id, status: m.status, cli: m.cli, model: m.model, effort: m.effort, mode: m.mode,
    workdir: m.workdir, worktree: m.worktree, sessionId: m.sessionId, exitCode: m.exitCode, runDir: runDir(m.id),
    resultFile: path.join(runDir(m.id), 'result.txt'), error: m.error,
    ...(m.unexpectedChanges ? { WARNING: 'read-only run changed the git working tree; inspect `git status`/`git diff` before trusting it' } : {}),
    result: text.length > cap ? text.slice(0, cap) + `\n...[truncated, full text in resultFile]` : text || undefined,
    stderrTail: m.status === 'failed' || m.status === 'timeout' ? tail(path.join(runDir(m.id), 'stderr.txt')) : undefined };
};
function tail(f, n = 1500) { try { const s = fs.readFileSync(f, 'utf8'); return s.slice(-n); } catch { return ''; } }

// ---------- commands ----------
const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos[0];

async function main() {
  if (cmd === 'detect') return out({ platform: process.platform, node: process.version, clis: Object.keys(CLIS).map(detect) });
  if (cmd === 'models') { const n = pos[1]; if (!CLIS[n]) fail('usage: models <claude|codex|agy>'); return out(listModels(n)); }
  if (cmd === 'check') return out(checkGuide());
  if (cmd === 'guide') { const n = pos[1]; if (!CLIS[n]) fail('usage: guide <claude|codex|agy>'); return out(guideFor(n)); }
  if (cmd === 'scoreboard') return out({ file: SCORE_FILE, note: 'measured from your own delegated jobs; verdicts come from the lead via `score`', rows: scoreboard() });
  if (cmd === 'score') { // the lead records its verification verdict for a finished run
    const id = pos[1], verdict = flags.verdict;
    if (!readMeta(id)) fail(`no such run: ${id}`);
    if (!['pass', 'partial', 'fail'].includes(verdict)) fail('--verdict must be pass, partial or fail');
    appendScore({ type: 'verdict', id, ts: new Date().toISOString(), verdict, note: flags.note && flags.note !== true ? String(flags.note) : undefined });
    return out({ ok: true, id, verdict });
  }
  if (cmd === 'run') {
    const meta = prepareRun(flags);
    if (flags.bg) {
      const child = spawn(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '_worker', meta.id],
        { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return out({ ok: true, id: meta.id, status: 'started', runDir: runDir(meta.id), next: `status ${meta.id} | wait ${meta.id} | result ${meta.id}` });
    }
    return out(summary(await execute(meta)));
  }
  if (cmd === '_worker') { const m = readMeta(pos[1]); if (m) await execute(m); return; }
  if (['status', 'result', 'wait'].includes(cmd)) {
    const id = pos[1]; let m = readMeta(id);
    if (!m) fail(`no such run: ${id}`);
    if (cmd === 'wait') {
      const deadline = Date.now() + (Number(flags.timeout) || 600) * 1000;
      while (['pending', 'running'].includes(m.status) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 1000)); m = readMeta(id); }
    }
    if (m.status === 'running' && m.pid && !pidAlive(m.pid)) { m.status = 'failed'; m.error = 'worker died'; writeMeta(m); }
    return out(summary(m, cmd !== 'status'));
  }
  fail('usage: detect | models <cli> | check | guide <cli> | run --cli X --model M --effort E [--task-type T] [--mode read|write] [--cwd D] --prompt-file F [--timeout S] [--bg] [--worktree] [--resume ID] | status|result|wait <id> | score <id> --verdict pass|partial|fail | scoreboard');
}
main().catch((e) => fail(String(e && e.stack || e)));
