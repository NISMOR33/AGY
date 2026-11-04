const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, execFile, spawn } = require('child_process');

let pty, QRCode;
for (const m of ['@lydell/node-pty', 'node-pty']) {
  try { pty = require(m); break; } catch {}
}
try { QRCode = require('qrcode'); } catch {}

if (!pty) {
  console.error('Lance d’abord : npm install');
  process.exit(1);
}

const WIN = process.platform === 'win32';
const HOME = os.homedir();
const CONF_DIR = path.join(HOME, '.agy-console');
const BIN_DIR = path.join(CONF_DIR, 'bin');
const CONV_DIR = path.join(CONF_DIR, 'conversations');
const CONF_FILE = path.join(CONF_DIR, 'config.json');
const TUNNEL_STATE_FILE = path.join(CONF_DIR, 'tunnel-state.json');
const TUNNEL_LOG_FILE = path.join(CONF_DIR, 'tunnel.log');
const VAPID_FILE = path.join(CONF_DIR, 'vapid-keys.json');
const SUBS_FILE = path.join(CONF_DIR, 'push-subscriptions.json');

let webpush;
try { webpush = require('web-push'); } catch {}

let vapidKeys = null;
if (webpush) {
  try {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  } catch {
    try {
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
    } catch {}
  }
  if (vapidKeys && vapidKeys.publicKey && vapidKeys.privateKey) {
    try {
      webpush.setVapidDetails('mailto:support@agy-console.local', vapidKeys.publicKey, vapidKeys.privateKey);
    } catch {}
  }
}

function loadPushSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}

function savePushSubs(subs) {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2)); } catch {}
}

function addPushSub(sub) {
  if (!sub || !sub.endpoint) return;
  const subs = loadPushSubs().filter(s => s.endpoint !== sub.endpoint);
  subs.push(sub);
  savePushSubs(subs);
}

function removePushSub(endpoint) {
  const subs = loadPushSubs().filter(s => s.endpoint !== endpoint);
  savePushSubs(subs);
}

async function broadcastPushNotification(payload) {
  if (!webpush || !vapidKeys) return;
  const subs = loadPushSubs();
  if (!subs.length) return;
  const bodyStr = JSON.stringify(payload);
  const tasks = subs.map(sub => {
    return webpush.sendNotification(sub, bodyStr).catch(err => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removePushSub(sub.endpoint);
      }
    });
  });
  await Promise.allSettled(tasks);
}

fs.mkdirSync(BIN_DIR, { recursive: true });
fs.mkdirSync(CONV_DIR, { recursive: true });

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONF_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    fs.writeFileSync(CONF_FILE, JSON.stringify(next, null, 2));
  } catch {}
  return next;
}

const savedConf = loadConfig();
const PORT = +process.env.PORT || savedConf.port || 3000;
const ROOT = path.resolve(process.env.AGY_ROOT || savedConf.root || path.join(HOME, 'agy-projects'));
const CMD = process.env.AGY_CMD || 'agy';
const XARGS = (process.env.AGY_ARGS || '').split(' ').filter(Boolean);
const FORCE_NEW_TOKEN = process.argv.includes('--new-token');
const TOKEN = process.env.AGY_TOKEN || (!FORCE_NEW_TOKEN && savedConf.token) || crypto.randomBytes(12).toString('hex');
const AUTO_TUNNEL = process.env.AGY_TUNNEL !== '0' && !process.argv.includes('--no-tunnel');

saveConfig({ token: TOKEN, root: ROOT });

const STARTERS = path.join(ROOT, '_modeles');
fs.mkdirSync(STARTERS, { recursive: true });

const DEFAULT_STARTERS = {
  'plan.md': '# Plan\n- liste de recettes\n- thème sombre\n- logo\n',
  'brief-api.md': '# Brief API\nUne API Node rapide avec :\n- `GET /health`\n- `GET /tasks` et `POST /tasks`\n- validation et tests unitaires\n',
  'cahier-des-charges.md': '# Cahier des charges\nSite moderne responsive :\n- accueil avec hero animé\n- grille de services\n- formulaire de contact\n- mode clair / sombre\n',
  'app-mobile-pwa.md': '# Application Web Mobile (PWA)\n- interface tactile fluide\n- fonctionnement hors-ligne (Service Worker)\n- stockage local + export JSON\n',
  'bot-automatisation.md': '# Script & Automatisation\n- CLI avec arguments clairs\n- journalisation propre\n- gestion des erreurs et relance automatique\n'
};

if (!fs.readdirSync(STARTERS).length) {
  for (const [k, v] of Object.entries(DEFAULT_STARTERS)) {
    fs.writeFileSync(path.join(STARTERS, k), v);
  }
}

// Registre des chemins de projets personnalisés (hors AGY_ROOT)
const customPaths = { ...(savedConf.customPaths || {}) };
function rememberCustomPath(name, fullPath) {
  customPaths[name] = fullPath;
  saveConfig({ customPaths });
}
function forgetCustomPath(name) {
  delete customPaths[name];
  saveConfig({ customPaths });
}

// Paramètres par défaut pour agy
let agySettings = {
  model: savedConf.model || '',
  mode: savedConf.mode || '',
  effort: savedConf.effort || '',
  skipPermissions: savedConf.skipPermissions !== undefined ? !!savedConf.skipPermissions : true,
  continueSession: savedConf.continueSession !== false
};

// Modèles disponibles dans agy
let availableModels = [
  { id: '', label: 'Modèle par défaut (Auto)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
];

function refreshModelsAsync() {
  execFile(WIN ? 'cmd.exe' : CMD, WIN ? ['/d', '/s', '/c', CMD, 'models'] : ['models'], { timeout: 8000 }, (err, stdout) => {
    if (err || !stdout) return;
    const parsed = [{ id: '', label: 'Modèle par défaut (Auto)' }];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^([a-z0-9._-]+)\s+(.+)$/i);
      if (m && !m[1].toLowerCase().includes('fetching')) {
        parsed.push({ id: m[1].trim(), label: m[2].trim() });
      }
    }
    if (parsed.length > 1) availableModels = parsed;
  });
}
refreshModelsAsync();

// Résolution sécurisée du dossier d'un projet
function dirOf(n) {
  const name = String(n || '').trim();
  if (!name || /^[_.]/.test(name)) throw Error('Nom de projet invalide');
  if (customPaths[name] && fs.existsSync(customPaths[name])) {
    return path.resolve(customPaths[name]);
  }
  const d = path.resolve(ROOT, name);
  if (path.dirname(d) !== ROOT) throw Error('Nom de projet invalide');
  return d;
}

// Exécution Git rapide
function git(d, ...a) {
  try {
    return execFileSync('git', a, {
      cwd: d,
      encoding: 'utf8',
      maxBuffer: 5e7,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    return null;
  }
}

function gitWithErr(d, ...a) {
  try {
    const out = execFileSync('git', a, {
      cwd: d,
      encoding: 'utf8',
      maxBuffer: 5e7,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, out: out || '' };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.stdout || e.message || 'Erreur git').toString().trim() };
  }
}

function ensureGitBase(d) {
  if (!fs.existsSync(path.join(d, '.git'))) {
    git(d, 'init', '-q');
    git(d, 'add', '-A');
    git(d, '-c', 'user.name=agy', '-c', 'user.email=agy@local', 'commit', '-qm', 'base', '--allow-empty');
  }
}

// Crée un projet par défaut si aucun projet n'existe encore
function ensureAtLeastOneProject() {
  try {
    const existing = fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() && !/^[_.]/.test(e.name));
    if (existing.length === 0 && Object.keys(customPaths).length === 0) {
      const defDir = path.join(ROOT, 'mon-projet');
      fs.mkdirSync(defDir, { recursive: true });
      fs.writeFileSync(path.join(defDir, 'README.md'), '# Mon Projet\n\nDécris ici ce que tu souhaites construire avec agy.\n');
      ensureGitBase(defDir);
    }
  } catch {}
}
ensureAtLeastOneProject();

// ============================================================================
// MOTEUR DE CHAT IA TEMPS RÉEL (stream-json) + MULTI-TERMINAUX PTY
// ============================================================================
const S = {};

function getChatStoreFile(d) {
  return path.join(d, '.git', 'agy-chat-history.json');
}

function getCentralConvFile(n) {
  const safe = String(n || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CONV_DIR, `${safe}.json`);
}

function deriveThreadTitle(messages, fallback = 'Nouvelle discussion') {
  const firstUser = (messages || []).find(m => m && m.role === 'user' && String(m.text || '').trim());
  if (!firstUser) return fallback;
  const clean = String(firstUser.text).trim().replace(/\s+/g, ' ');
  return clean.length > 48 ? clean.slice(0, 48) + '…' : clean;
}

function sanitizeMessages(msgs) {
  if (!Array.isArray(msgs)) return [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.role !== 'assistant') continue;
    if (m.duration && m.duration > 3600) {
      m.duration = 2.8;
    }
    const prev = i > 0 ? msgs[i - 1] : null;
    if (!m.text && prev && prev.role === 'user' && String(prev.text || '').trim() === '/compact') {
      m.text = '✅ Contexte de la conversation compacté et sauvegardé.';
      m.status = 'done';
      delete m.error;
    }
    if (m.text && m.error && /plan model not specified|must specify a valid model/i.test(m.error)) {
      delete m.error;
      m.status = 'done';
    }
  }
  return msgs;
}

function normalizeThreadsData(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  let threads = Array.isArray(data.threads) ? data.threads : [];

  // Migration automatique si l'ancien format plat { conversationId, messages } existait
  if (!threads.length && Array.isArray(data.messages) && data.messages.length > 0) {
    const cleanMsgs = sanitizeMessages(data.messages);
    const firstTs = cleanMsgs[0].ts || Date.now();
    const lastTs = cleanMsgs[cleanMsgs.length - 1].ts || Date.now();
    threads.push({
      id: 'th-' + crypto.randomBytes(5).toString('hex'),
      title: deriveThreadTitle(cleanMsgs, 'Discussion sauvegardée'),
      conversationId: data.conversationId || null,
      createdAt: firstTs,
      updatedAt: lastTs,
      messages: cleanMsgs
    });
  }

  for (const t of threads) {
    t.messages = sanitizeMessages(t.messages);
  }

  if (!threads.length) {
    const initId = 'th-' + crypto.randomBytes(5).toString('hex');
    threads.push({
      id: initId,
      title: 'Nouvelle discussion',
      conversationId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    });
  }

  let activeId = data.activeThreadId;
  let activeThread = threads.find(t => t.id === activeId);
  if (!activeThread) {
    activeThread = threads[0];
    activeId = activeThread.id;
  }

  return {
    activeThreadId: activeId,
    conversationId: activeThread.conversationId || null,
    messages: sanitizeMessages(activeThread.messages),
    threads
  };
}

function loadChatState(n, d) {
  let centralData = null;
  let localData = null;
  try {
    const cf = getCentralConvFile(n);
    if (fs.existsSync(cf)) centralData = JSON.parse(fs.readFileSync(cf, 'utf8'));
  } catch {}
  try {
    const lf = getChatStoreFile(d);
    if (fs.existsSync(lf)) localData = JSON.parse(fs.readFileSync(lf, 'utf8'));
  } catch {}

  const chosen = (centralData && Array.isArray(centralData.threads) && centralData.threads.length)
    ? centralData
    : (localData || centralData || {});

  const state = normalizeThreadsData(chosen);
  saveChatState(n, d, state);
  return state;
}

function syncActiveThreadInMemory(chat) {
  if (!chat.threads) chat.threads = [];
  let th = chat.threads.find(t => t.id === chat.activeThreadId);
  if (!th) {
    th = {
      id: chat.activeThreadId || ('th-' + crypto.randomBytes(5).toString('hex')),
      title: deriveThreadTitle(chat.messages, 'Nouvelle discussion'),
      conversationId: chat.conversationId || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    chat.activeThreadId = th.id;
    chat.threads.unshift(th);
  }
  th.conversationId = chat.conversationId || null;
  th.messages = (chat.messages || []).slice(-150);
  if (th.messages.length > 0) {
    th.title = deriveThreadTitle(th.messages, th.title);
    th.updatedAt = Date.now();
  }
}

function getThreadsSummary(chat) {
  syncActiveThreadInMemory(chat);
  return (chat.threads || []).map(t => ({
    id: t.id,
    title: t.title || deriveThreadTitle(t.messages, 'Nouvelle discussion'),
    conversationId: t.conversationId || null,
    createdAt: t.createdAt || Date.now(),
    updatedAt: t.updatedAt || Date.now(),
    msgCount: Array.isArray(t.messages) ? t.messages.length : 0,
    active: t.id === chat.activeThreadId
  }));
}

function saveChatState(n, d, chat) {
  try {
    syncActiveThreadInMemory(chat);
    const payload = JSON.stringify({
      activeThreadId: chat.activeThreadId || null,
      conversationId: chat.conversationId || null,
      messages: (chat.messages || []).slice(-150),
      threads: (chat.threads || []).slice(0, 80)
    }, null, 2);

    // 1. Sauvegarde centralisée sur le PC (~/.agy-console/conversations/<projet>.json)
    fs.writeFileSync(getCentralConvFile(n), payload);

    // 2. Sauvegarde locale dans le dossier du projet (<projet>/.git/agy-chat-history.json)
    ensureGitBase(d);
    fs.writeFileSync(getChatStoreFile(d), payload);
  } catch {}
}

function getProjectState(n) {
  if (!S[n]) {
    const d = dirOf(n);
    ensureGitBase(d);
    const savedChat = loadChatState(n, d);
    const st = {
      tabs: {},
      watcher: null,
      watchTimer: null,
      fileSubs: new Set(),
      chatSubs: new Set(),
      chat: {
        activeThreadId: savedChat.activeThreadId,
        conversationId: savedChat.conversationId || null,
        messages: savedChat.messages || [],
        threads: savedChat.threads || [],
        busy: false,
        proc: null,
        currentTurn: null
      }
    };
    try {
      st.watcher = fs.watch(d, { recursive: true }, (evt, filename) => {
        if (filename && (filename.startsWith('.git' + path.sep) || filename === '.git' || filename.includes('node_modules'))) return;
        clearTimeout(st.watchTimer);
        st.watchTimer = setTimeout(() => {
          for (const res of st.fileSubs) {
            try { res.write('event: files\ndata: 1\n\n'); } catch {}
          }
          for (const res of st.chatSubs) {
            try { res.write('event: files\ndata: 1\n\n'); } catch {}
          }
        }, 300);
      });
      st.watcher.on('error', () => {});
    } catch {}
    S[n] = st;
  }
  return S[n];
}

function normalizeModelKey(rawModel) {
  const s = String(rawModel || '').trim();
  if (!s) return { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' };
  const found = availableModels.find(m => m.id && (m.id.toLowerCase() === s.toLowerCase() || m.label.toLowerCase() === s.toLowerCase()));
  if (found) return { id: found.id, label: found.label };
  const sl = s.toLowerCase();
  if (sl.includes('3.8') && sl.includes('high')) return { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' };
  if (sl.includes('3.8') && sl.includes('low')) return { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' };
  if (sl.includes('3.8') || sl.includes('flash')) return { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' };
  if (sl.includes('argon') && sl.includes('high')) return { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' };
  if (sl.includes('argon') && sl.includes('low')) return { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' };
  if (sl.includes('argon') || sl.includes('gemini-4')) return { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' };
  if (sl.includes('opus')) return { id: 'claude-opus-5-5-medium', label: s };
  if (sl.includes('sonnet')) return { id: 'claude-sonnet-5-5-medium', label: s };
  if (sl.includes('gpt-oss')) return { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' };
  return { id: sl.replace(/\s+/g, '-'), label: s };
}

let cachedBrainStats = { ts: 0, events: [] };
function readBrainTokenEvents() {
  const now = Date.now();
  if (now - cachedBrainStats.ts < 8000 && cachedBrainStats.events.length) {
    return cachedBrainStats.events;
  }
  const events = [];
  for (const rel of ['.gemini/antigravity-cli/brain', '.gemini/antigravity/brain']) {
    const root = path.join(HOME, rel);
    if (!fs.existsSync(root)) continue;
    let cids = [];
    try { cids = fs.readdirSync(root); } catch { continue; }
    for (const cid of cids) {
      const tf = path.join(root, cid, '.system_generated', 'logs', 'transcript.jsonl');
      if (!fs.existsSync(tf)) continue;
      let curModel = 'gemini-3.8-flash-medium';
      let content = '';
      try { content = fs.readFileSync(tf, 'utf8'); } catch { continue; }
      for (const line of content.split(/\r?\n/)) {
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.content && j.content.includes('Model Selection')) {
            const m = j.content.match(/Model Selection` from [^\n]+? to ([^\r\n]+?)\./);
            if (m) curModel = m[1].trim();
          }
          if (j.type === 'PLANNER_RESPONSE' && (j.input_tokens || j.output_tokens)) {
            const ts = j.created_at ? new Date(j.created_at).getTime() : now;
            const inp = j.input_tokens || 0;
            const out = j.output_tokens || 0;
            const cache = j.cache_read_tokens || 0;
            events.push({
              model: curModel,
              ts: isNaN(ts) ? now : ts,
              input: inp,
              output: out,
              cacheRead: cache,
              total: inp + out + cache
            });
          }
        } catch {}
      }
    }
  }
  cachedBrainStats = { ts: now, events };
  return events;
}

function getProjectTokenStats(proj) {
  let totalTokens = 0, inputTokens = 0, outputTokens = 0, thinkingTokens = 0, cacheReadTokens = 0;
  for (const m of (proj && proj.chat && proj.chat.messages) || []) {
    if (m.usage) {
      totalTokens += (m.usage.total || 0);
      inputTokens += (m.usage.input || 0);
      outputTokens += (m.usage.output || 0);
      thinkingTokens += (m.usage.thinking || 0);
      cacheReadTokens += (m.usage.cacheRead || 0);
    } else if (m.tokens) {
      totalTokens += m.tokens;
    }
  }

  const now = Date.now();
  const resetFloor = savedConf.tokenResetAt || 0;
  const win5hStart = Math.max(resetFloor, now - 5 * 3600 * 1000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayStart = Math.max(resetFloor, startOfDay.getTime());
  const nextMidnight = new Date(startOfDay.getTime() + 24 * 3600 * 1000).getTime();

  const modelMap = new Map();
  // Pré-remplir avec tous les modèles disponibles pour qu'on voie chaque modèle même à 0
  for (const m of availableModels) {
    if (!m.id) continue;
    modelMap.set(m.id, {
      id: m.id,
      label: m.label,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      window5hTokens: 0,
      window5hTurns: 0,
      oldestIn5hTs: null,
      reset5hAt: null,
      todayTokens: 0,
      todayTurns: 0,
      lastUsedAt: null
    });
  }

  const allEvents = readBrainTokenEvents();
  for (const ev of allEvents) {
    if (resetFloor && ev.ts < resetFloor) continue;
    const mk = normalizeModelKey(ev.model);
    if (!modelMap.has(mk.id)) {
      modelMap.set(mk.id, {
        id: mk.id,
        label: mk.label,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        window5hTokens: 0,
        window5hTurns: 0,
        oldestIn5hTs: null,
        reset5hAt: null,
        todayTokens: 0,
        todayTurns: 0,
        lastUsedAt: null
      });
    }
    const st = modelMap.get(mk.id);
    st.turns += 1;
    st.inputTokens += ev.input;
    st.outputTokens += ev.output;
    st.cacheReadTokens += ev.cacheRead;
    st.totalTokens += ev.total;
    if (!st.lastUsedAt || ev.ts > st.lastUsedAt) st.lastUsedAt = ev.ts;
    if (ev.ts >= win5hStart) {
      st.window5hTokens += ev.total;
      st.window5hTurns += 1;
      if (!st.oldestIn5hTs || ev.ts < st.oldestIn5hTs) st.oldestIn5hTs = ev.ts;
    }
    if (ev.ts >= todayStart) {
      st.todayTokens += ev.total;
      st.todayTurns += 1;
    }
  }

  let earliestReset5hAt = null;
  const byModel = [];
  for (const st of modelMap.values()) {
    if (st.oldestIn5hTs) {
      st.reset5hAt = st.oldestIn5hTs + 5 * 3600 * 1000;
      if (!earliestReset5hAt || st.reset5hAt < earliestReset5hAt) {
        earliestReset5hAt = st.reset5hAt;
      }
    }
    byModel.push(st);
  }
  byModel.sort((a, b) => (b.window5hTokens - a.window5hTokens) || (b.totalTokens - a.totalTokens));

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    byModel,
    resetInfo: {
      window5hResetAt: earliestReset5hAt,
      dailyResetAt: nextMidnight,
      manualResetAt: savedConf.tokenResetAt || null,
      serverNow: now
    }
  };
}

function broadcastChat(proj, eventObj) {
  const payload = 'data: ' + JSON.stringify(eventObj) + '\n\n';
  for (const r of proj.chatSubs) {
    try { r.write(payload); } catch {}
  }
}

function runChatPrompt(n, promptText, opts = {}) {
  const proj = getProjectState(n);
  const d = dirOf(n);
  const chat = proj.chat;

  if (chat.busy && chat.proc) {
    try { chat.proc.kill(); } catch {}
  }

  if (opts.fresh) {
    chat.conversationId = null;
  } else if (opts.conversationId) {
    chat.conversationId = opts.conversationId;
  }

  const userMsg = {
    id: crypto.randomBytes(6).toString('hex'),
    role: 'user',
    text: promptText,
    ts: Date.now()
  };
  chat.messages.push(userMsg);

  const assistantMsg = {
    id: crypto.randomBytes(6).toString('hex'),
    role: 'assistant',
    text: '',
    tools: [],
    status: 'streaming',
    ts: Date.now(),
    duration: null,
    tokens: null,
    usage: null
  };
  chat.messages.push(assistantMsg);
  chat.busy = true;
  chat.currentTurn = assistantMsg;
  saveChatState(n, d, chat);

  broadcastChat(proj, {
    type: 'turn_start',
    userMsg,
    assistantMsg,
    activeThreadId: chat.activeThreadId,
    threads: getThreadsSummary(chat),
    tokenStats: getProjectTokenStats(proj)
  });

  const args = [...XARGS, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
  let activeModel = opts.model !== undefined ? opts.model : agySettings.model;
  if (!activeModel || /\s/.test(activeModel)) {
    activeModel = 'gemini-3.8-flash-medium';
  }
  const activeMode = opts.mode !== undefined ? opts.mode : agySettings.mode;
  const activeEffort = opts.effort !== undefined ? opts.effort : agySettings.effort;

  if (activeModel) args.push('--model', activeModel);
  if (activeMode) args.push('--mode', activeMode);
  if (activeEffort) args.push('--effort', activeEffort);
  if (chat.conversationId && !opts.fresh) {
    args.push('--conversation', chat.conversationId);
  }
  args.push('-p', promptText);

  const turnStartMs = Date.now();
  let stepDuration = 0;
  let gotCheckpoint = false;

  const proc = spawn(WIN ? 'cmd.exe' : CMD, WIN ? ['/d', '/s', '/c', CMD, ...args] : args, {
    cwd: d,
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true
  });
  chat.proc = proc;

  let lineBuf = '';
  const handleJsonLine = line => {
    line = line.trim();
    if (!line || !line.startsWith('{')) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }

    if (ev.event === 'init' && ev.conversation_id) {
      chat.conversationId = ev.conversation_id;
    } else if (ev.event === 'step_update' && ev.step_update) {
      const su = ev.step_update;
      if (su.conversation_id) chat.conversationId = su.conversation_id;
      if (su.duration_seconds && su.duration_seconds < 3600) {
        stepDuration += su.duration_seconds;
      }
      if (su.step_type === 'checkpoint') {
        gotCheckpoint = true;
      }

      if (su.usage) {
        assistantMsg.usage = {
          input: su.usage.input_tokens || 0,
          output: su.usage.output_tokens || 0,
          thinking: su.usage.thinking_tokens || 0,
          cacheRead: su.usage.cache_read_tokens || 0,
          total: su.usage.total_tokens || 0
        };
        assistantMsg.tokens = assistantMsg.usage.total;
      }

      if (su.step_type === 'agent_response' && su.text_delta) {
        assistantMsg.text += su.text_delta;
        broadcastChat(proj, {
          type: 'delta',
          msgId: assistantMsg.id,
          delta: su.text_delta,
          fullText: assistantMsg.text,
          usage: assistantMsg.usage
        });
      } else if (su.step_type === 'tool') {
        const ti = su.tool_info || {};
        const params = ti.parameters || {};
        const rawPath = params.Path || params.TargetFile || params.DirectoryPath || params.SearchPath || '';
        let relPath = '';
        if (rawPath) {
          const resP = path.resolve(d, rawPath);
          relPath = resP.startsWith(d + path.sep) ? resP.slice(d.length + 1).replace(/\\/g, '/') : rawPath.replace(/\\/g, '/');
        }
        const toolEntry = {
          stepIndex: su.step_index,
          name: su.tool_name || ti.name || 'tool',
          state: su.state || 'ACTIVE',
          path: relPath,
          cmd: params.CommandLine || params.Query || params.Pattern || '',
          output: ti.output ? String(ti.output).slice(0, 1200) : '',
          error: ti.error ? (ti.error.message || JSON.stringify(ti.error)) : null,
          duration: su.duration_seconds || null
        };
        const existingIdx = assistantMsg.tools.findIndex(t => t.stepIndex === su.step_index);
        if (existingIdx >= 0) assistantMsg.tools[existingIdx] = toolEntry;
        else assistantMsg.tools.push(toolEntry);

        broadcastChat(proj, {
          type: 'tool',
          msgId: assistantMsg.id,
          tool: toolEntry
        });
      }
    } else if (ev.event === 'result' && ev.result) {
      const res = ev.result;
      if (res.conversation_id) chat.conversationId = res.conversation_id;
      if (!assistantMsg.text && res.response) {
        assistantMsg.text = res.response;
      }
      if (!assistantMsg.text && (gotCheckpoint || String(promptText || '').trim() === '/compact')) {
        assistantMsg.text = '✅ Contexte de la conversation compacté et sauvegardé.';
      }
      const elapsedSec = Math.max(0.2, (Date.now() - turnStartMs) / 1000);
      assistantMsg.duration = (stepDuration > 0 && stepDuration < 3600)
        ? stepDuration
        : ((res.duration_seconds && res.duration_seconds < 600) ? res.duration_seconds : elapsedSec);
      if (res.usage && !assistantMsg.usage) {
        assistantMsg.usage = {
          input: res.usage.input_tokens || 0,
          output: res.usage.output_tokens || 0,
          thinking: res.usage.thinking_tokens || 0,
          cacheRead: res.usage.cache_read_tokens || 0,
          total: res.usage.total_tokens || 0
        };
        assistantMsg.tokens = assistantMsg.usage.total;
      }
      // Ne reporter res.error que si aucune réponse valide n'a été générée dans ce tour
      // (agy conserve parfois une ancienne erreur de tour précédent dans le résumé de conversation)
      if (res.status === 'ERROR' && res.error && !assistantMsg.text && !gotCheckpoint) {
        assistantMsg.error = res.error;
      } else {
        delete assistantMsg.error;
      }
    }
  };

  proc.stdout.on('data', chunk => {
    lineBuf += chunk.toString('utf8');
    const lines = lineBuf.split(/\r?\n/);
    lineBuf = lines.pop() || '';
    for (const l of lines) handleJsonLine(l);
  });

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString('utf8');
  });

  proc.on('close', code => {
    if (lineBuf.trim()) handleJsonLine(lineBuf);
    if (chat.proc === proc) {
      chat.proc = null;
      chat.busy = false;
      chat.currentTurn = null;
    }
    if (assistantMsg.status === 'streaming') {
      const errText = (assistantMsg.error || stderrBuf || '').trim();
      // Si agy réclame explicitement un modèle (ex: cache de modèles temporairement vide), relancer avec un modèle explicite sans perdre la conversation
      if (!opts.retriedModel && /plan model not specified|must specify a valid model/i.test(errText)) {
        chat.messages.pop();
        chat.messages.pop();
        return runChatPrompt(n, promptText, {
          ...opts,
          model: activeModel || 'gemini-3.8-flash-medium',
          retriedModel: true
        });
      }
      assistantMsg.status = (code === 0 && !assistantMsg.error) ? 'done' : 'error';
      if (!assistantMsg.text && errText) {
        // Si --conversation a échoué (conversation introuvable/expirée), relancer automatiquement sans --conversation
        if (!opts.retriedFresh && chat.conversationId && !/model not specified|no such host/i.test(errText)) {
          chat.messages.pop();
          chat.messages.pop();
          chat.conversationId = null;
          return runChatPrompt(n, promptText, { ...opts, fresh: true, retriedFresh: true });
        }
        assistantMsg.error = errText.slice(0, 500);
      }
      if (!assistantMsg.text) {
        if (assistantMsg.tools && assistantMsg.tools.length) {
          assistantMsg.text = "Modifications et actions terminées sur le projet.";
        } else if (!assistantMsg.error) {
          assistantMsg.text = (code === 0) ? "Tâche terminée avec succès." : "L'exécution s'est terminée sans réponse textuelle.";
        }
      }
    }
    saveChatState(n, d, chat);
    broadcastChat(proj, {
      type: 'turn_end',
      msgId: assistantMsg.id,
      assistantMsg,
      activeThreadId: chat.activeThreadId,
      threads: getThreadsSummary(chat),
      tokenStats: getProjectTokenStats(proj)
    });

    const durStr = assistantMsg.duration ? `${assistantMsg.duration.toFixed(1)}s` : '';
    const hasErr = !!assistantMsg.error;
    broadcastPushNotification({
      title: (hasErr ? 'Erreur agy · ' : 'agy · ') + n,
      body: hasErr ? assistantMsg.error : (durStr ? `Tâche terminée en ${durStr}` : 'Tâche terminée avec succès !'),
      url: `/?p=${encodeURIComponent(n)}`
    }).catch(() => {});
  });

  return assistantMsg;
}

function buildAgyArgs(opts = {}) {
  const args = [...XARGS];
  const model = opts.model !== undefined ? opts.model : agySettings.model;
  const mode = opts.mode !== undefined ? opts.mode : agySettings.mode;
  const effort = opts.effort !== undefined ? opts.effort : agySettings.effort;
  const skip = opts.skipPermissions !== undefined ? opts.skipPermissions : agySettings.skipPermissions;
  const cont = opts.continueSession !== undefined ? opts.continueSession : agySettings.continueSession;

  if (model) args.push('--model', model);
  if (mode) args.push('--mode', mode);
  if (effort) args.push('--effort', effort);
  if (skip) args.push('--dangerously-skip-permissions');
  if (opts.firstPrompt) {
    args.push('-i', opts.firstPrompt);
  } else if (cont && !opts.fresh) {
    args.push('-c');
  }
  return args;
}

function startSession(n, tabId = 'shell', opts = {}) {
  const proj = getProjectState(n);
  const existing = proj.tabs[tabId];
  if (existing && !existing.dead && !opts.restart) return existing;
  if (existing && !existing.dead && opts.restart) {
    try { existing.p.kill(); } catch {}
  }

  const d = dirOf(n);
  ensureGitBase(d);

  const kind = opts.kind || (tabId === 'agy' ? 'agy' : 'shell');
  let file, args, label;

  if (kind === 'shell') {
    label = opts.label || (tabId === 'shell' ? 'PowerShell' : tabId);
    if (WIN) {
      file = 'powershell.exe';
      args = ['-NoLogo'];
    } else {
      file = process.env.SHELL || '/bin/bash';
      args = [];
    }
  } else {
    label = opts.label || 'agy CLI';
    const agyArgs = buildAgyArgs(opts);
    if (WIN) {
      file = 'cmd.exe';
      args = ['/d', '/s', '/c', CMD, ...agyArgs];
    } else {
      file = CMD;
      args = agyArgs;
    }
  }

  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: opts.cols || 100,
    rows: opts.rows || 30,
    cwd: d,
    env: { ...process.env, FORCE_COLOR: '1', TERM: 'xterm-256color' }
  });

  const session = {
    id: tabId,
    kind,
    label,
    p,
    buf: '',
    subs: new Set(),
    dead: false,
    startedAt: Date.now(),
    lastActivity: Date.now()
  };

  proj.tabs[tabId] = session;

  p.onData(c => {
    session.lastActivity = Date.now();
    session.buf = (session.buf + c).slice(-200000);
    const payload = 'data: ' + JSON.stringify(c) + '\n\n';
    session.subs.forEach(r => {
      try { r.write(payload); } catch {}
    });
  });

  p.onExit(({ exitCode } = {}) => {
    if (kind === 'agy' && !opts.retriedWithoutContinue && Date.now() - session.startedAt < 2500 && !opts.firstPrompt && !opts.fresh && agySettings.continueSession) {
      const cleanBuf = session.buf.toLowerCase();
      if (exitCode !== 0 || cleanBuf.includes('no conversation') || cleanBuf.includes('error') || cleanBuf.includes('not found')) {
        session.buf = '';
        return startSession(n, tabId, { ...opts, fresh: true, restart: true, retriedWithoutContinue: true });
      }
    }
    session.dead = true;
    session.subs.forEach(r => {
      try {
        r.write('event: end\ndata: ' + JSON.stringify({ code: exitCode ?? 0 }) + '\n\n');
        r.end();
      } catch {}
    });
    session.subs.clear();
  });

  return session;
}

// Écriture PTY intelligente : sépare le texte et la touche Entrée (\r) pour éviter que le mode "paste" des TUI n'avale Entrée
function writePtyInput(session, rawStr) {
  if (!session || session.dead) return;
  const s = String(rawStr || '');
  if (s.length > 1 && (s.endsWith('\r') || s.endsWith('\n'))) {
    const bodyText = s.replace(/[\r\n]+$/, '');
    session.p.write(bodyText);
    setTimeout(() => {
      if (!session.dead) session.p.write('\r');
    }, 65);
  } else {
    session.p.write(s);
  }
}

// ============================================================================
// TUNNEL INTERNET AUTOMATIQUE (HORS MÊME WI-FI : 4G / 5G / PARTOUT)
// ============================================================================
const tunnel = {
  status: 'stopped',
  provider: savedConf.tunnelProvider || 'cloudflared',
  url: null,
  error: null,
  proc: null,
  startedAt: null,
  qrSvg: null,
  qrTerm: null
};

function getCloudflaredPath() {
  try {
    const cmd = WIN ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['cloudflared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {}
  const localBin = path.join(BIN_DIR, WIN ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(localBin) && fs.statSync(localBin).size > 5_000_000) return localBin;
  return null;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'agy-console' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Téléchargement HTTP ' + res.statusCode));
      }
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmp, dest);
            if (!WIN) fs.chmodSync(dest, 0o755);
            resolve(dest);
          } catch (e) {
            reject(e);
          }
        });
      });
      file.on('error', err => {
        try { fs.unlinkSync(tmp); } catch {}
        reject(err);
      });
    });
    req.on('error', reject);
  });
}

async function ensureCloudflaredBinary() {
  const existing = getCloudflaredPath();
  if (existing) return existing;
  let asset = null;
  const arch = os.arch();
  if (WIN) asset = 'cloudflared-windows-amd64.exe';
  else if (process.platform === 'linux') asset = arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
  else throw new Error('Utilise le mode SSH ou installe cloudflared');

  const dest = path.join(BIN_DIR, WIN ? 'cloudflared.exe' : 'cloudflared');
  const dlUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  tunnel.status = 'downloading';
  await downloadFile(dlUrl, dest);
  return dest;
}

async function updateTunnelQr() {
  if (!tunnel.url || !QRCode) {
    tunnel.qrSvg = null;
    tunnel.qrTerm = null;
    return;
  }
  const fullLink = tunnel.url;
  try {
    tunnel.qrSvg = await QRCode.toString(fullLink, { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    tunnel.qrTerm = await QRCode.toString(fullLink, { type: 'terminal', small: true });
  } catch {}
}

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadTunnelState() {
  try {
    if (fs.existsSync(TUNNEL_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(TUNNEL_STATE_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveTunnelState(state) {
  try {
    if (!state) {
      if (fs.existsSync(TUNNEL_STATE_FILE)) fs.unlinkSync(TUNNEL_STATE_FILE);
    } else {
      fs.writeFileSync(TUNNEL_STATE_FILE, JSON.stringify(state, null, 2));
    }
  } catch {}
}

function stopTunnel(forceKillDaemon = false) {
  if (tunnel.logPoll) {
    clearInterval(tunnel.logPoll);
    tunnel.logPoll = null;
  }
  if (forceKillDaemon) {
    const st = loadTunnelState();
    if (st && st.pid && isPidAlive(st.pid)) {
      try { process.kill(st.pid); } catch {}
    }
    if (tunnel.proc) {
      try { tunnel.proc.kill(); } catch {}
      tunnel.proc = null;
    }
    saveTunnelState(null);
    tunnel.status = 'stopped';
    tunnel.url = null;
    tunnel.error = null;
    tunnel.qrSvg = null;
    tunnel.qrTerm = null;
  }
}

process.on('uncaughtException', err => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return;
  console.error('⚠️  Erreur non interceptée (ignorée pour préserver le serveur) :', err ? (err.stack || err.message) : err);
});
process.on('unhandledRejection', reason => {
  console.error('⚠️  Promesse rejetée non gérée :', reason ? (reason.stack || reason.message || reason) : reason);
});

function cleanupAll() {
  // On NE tue PAS le processus tunnel lors d'un redémarrage du serveur pour conserver exactement la même URL !
  stopTunnel(false);
  for (const proj of Object.values(S)) {
    if (proj.watcher) try { proj.watcher.close(); } catch {}
    if (proj.chat && proj.chat.proc) try { proj.chat.proc.kill(); } catch {}
    for (const tab of Object.values(proj.tabs || {})) {
      if (tab && !tab.dead) try { tab.p.kill(); } catch {}
    }
  }
}
process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });

async function startTunnel(preferredProvider, forceRestart = false) {
  // 1. Vérifier si un tunnel persistant tourne déjà sur ce PC (garde toujours la même URL !)
  if (!forceRestart) {
    const existing = loadTunnelState();
    if (existing && existing.pid && existing.url && existing.port === PORT && isPidAlive(existing.pid)) {
      tunnel.provider = existing.provider || 'cloudflared';
      tunnel.url = existing.url;
      tunnel.status = 'running';
      tunnel.error = null;
      tunnel.startedAt = existing.startedAt || Date.now();
      await updateTunnelQr();
      printTunnelBanner();
      return;
    }
  }

  stopTunnel(true);
  const provider = preferredProvider || tunnel.provider || 'cloudflared';
  tunnel.provider = provider;
  tunnel.status = 'starting';
  tunnel.error = null;
  saveConfig({ tunnelProvider: provider });

  if (provider === 'cloudflared') {
    try {
      const bin = await ensureCloudflaredBinary();
      tunnel.status = 'starting';
      try { fs.writeFileSync(TUNNEL_LOG_FILE, ''); } catch {}
      const outFd = fs.openSync(TUNNEL_LOG_FILE, 'a');
      const errFd = fs.openSync(TUNNEL_LOG_FILE, 'a');

      const customToken = process.env.AGY_TUNNEL_TOKEN || savedConf.tunnelToken || '';
      const cfArgs = customToken
        ? ['tunnel', '--no-autoupdate', '--logfile', TUNNEL_LOG_FILE, 'run', '--token', customToken]
        : ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate', '--logfile', TUNNEL_LOG_FILE];

      let spawnedPid = null;
      if (WIN) {
        try {
          const cmdStr = `"${bin}" ${cfArgs.map(a => `"${a}"`).join(' ')}`;
          const psCmd = `($r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${cmdStr.replace(/'/g, "''")}'}).ProcessId`;
          const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (/^\d+$/.test(out)) spawnedPid = Number(out);
        } catch {}
      }
      if (!spawnedPid) {
        const proc = spawn(bin, cfArgs, {
          detached: true,
          stdio: ['ignore', outFd, errFd],
          windowsHide: true
        });
        proc.unref();
        tunnel.proc = proc;
        spawnedPid = proc.pid;
      }

      tunnel.logPoll = setInterval(async () => {
        if (!isPidAlive(spawnedPid)) {
          clearInterval(tunnel.logPoll);
          tunnel.logPoll = null;
          if (tunnel.status !== 'stopped') {
            tunnel.status = 'error';
            tunnel.error = 'Tunnel arrêté';
          }
          return;
        }
        try {
          const text = fs.readFileSync(TUNNEL_LOG_FILE, 'utf8');
          const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (m && tunnel.url !== m[0]) {
            tunnel.url = m[0];
            tunnel.status = 'running';
            tunnel.startedAt = Date.now();
            saveTunnelState({
              pid: spawnedPid,
              url: tunnel.url,
              provider: 'cloudflared',
              port: PORT,
              startedAt: tunnel.startedAt
            });
            await updateTunnelQr();
            printTunnelBanner();
          }
        } catch {}
      }, 400);
      return;
    } catch (e) {
      tunnel.error = e.message;
      return startSshTunnel();
    }
  } else {
    return startSshTunnel();
  }
}

function startSshTunnel() {
  tunnel.provider = 'ssh';
  tunnel.status = 'starting';
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', WIN ? 'UserKnownHostsFile=NUL' : 'UserKnownHostsFile=/dev/null',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ConnectTimeout=10',
    '-R', `80:127.0.0.1:${PORT}`,
    'nokey@localhost.run'
  ];

  let proc;
  try {
    proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    tunnel.status = 'error';
    tunnel.error = 'SSH introuvable : ' + e.message;
    return;
  }

  tunnel.proc = proc;
  const onChunk = async data => {
    const text = data.toString('utf8');
    const m = text.match(/https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)/i);
    if (m && tunnel.url !== m[0]) {
      tunnel.url = m[0];
      tunnel.status = 'running';
      tunnel.startedAt = Date.now();
      await updateTunnelQr();
      printTunnelBanner();
    }
  };
  proc.stdout.on('data', onChunk);
  proc.stderr.on('data', onChunk);
  proc.on('exit', code => {
    if (tunnel.proc === proc) {
      tunnel.proc = null;
      if (tunnel.status !== 'stopped') {
        tunnel.status = 'error';
        tunnel.error = `Tunnel SSH fermé (code ${code ?? 0})`;
      }
    }
  });
}

function getNetworkLinks() {
  const links = [];
  links.push({
    type: 'local',
    label: 'Ce PC (Local)',
    url: `http://localhost:${PORT}`,
    baseUrl: `http://localhost:${PORT}`
  });

  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const i of addrs || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const isTailscale = i.address.startsWith('100.') || /tailscale/i.test(name);
      links.push({
        type: isTailscale ? 'tailscale' : 'lan',
        label: isTailscale ? `Tailscale (${name})` : `Même Wi-Fi / LAN (${name})`,
        url: `http://${i.address}:${PORT}`,
        baseUrl: `http://${i.address}:${PORT}`
      });
    }
  }

  if (tunnel.status === 'running' && tunnel.url) {
    links.unshift({
      type: 'internet',
      label: `Partout / 4G / 5G (${tunnel.provider === 'cloudflared' ? 'Cloudflare HTTPS' : 'SSH HTTPS'})`,
      url: tunnel.url,
      baseUrl: tunnel.url
    });
  }
  return links;
}

function printTunnelBanner() {
  if (!tunnel.url) return;
  const full = tunnel.url;
  console.log('\n┌──────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 🌐 ACCÈS HORS WI-FI (4G / 5G / PARTOUT) ACTIF                            │');
  console.log('└──────────────────────────────────────────────────────────────────────────┘');
  console.log('  Lien direct : ' + full + '\n');
  if (tunnel.qrTerm) {
    console.log('  Scanne ce QR code avec ton téléphone (même en 4G/5G) :\n');
    console.log(tunnel.qrTerm.split('\n').map(l => '    ' + l).join('\n'));
  }
}

// ============================================================================
// UTILITAIRES FICHIERS, DIFF & RECHERCHE
// ============================================================================
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', 'coverage']);

function walk(d, b = '', out = []) {
  if (out.length >= 4000) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= 4000) break;
    if (IGNORE_DIRS.has(e.name)) continue;
    const rel = b + e.name;
    if (e.isDirectory()) {
      walk(path.join(d, e.name), rel + '/', out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

function getGitStatusMap(d) {
  const st = {};
  const raw = git(d, 'status', '--porcelain', '-uall', '-z') || '';
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i];
    if (!l || l.length < 4) continue;
    const xy = l.slice(0, 2);
    const file = l.slice(3).replace(/\\/g, '/');
    if (xy.includes('R') || xy.includes('C')) i++;
    if (xy.includes('D')) st[file] = 'D';
    else if (xy === '??' || xy.includes('A')) st[file] = 'A';
    else st[file] = 'M';
  }
  return st;
}

function listAllProjects() {
  ensureAtLeastOneProject();
  const list = [];
  const seenPaths = new Set();

  if (fs.existsSync(ROOT)) {
    for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!e.isDirectory() || /^[_.]/.test(e.name)) continue;
      const full = path.join(ROOT, e.name);
      seenPaths.add(path.resolve(full));
      list.push(inspectProject(e.name, full, false));
    }
  }

  for (const [name, fullPath] of Object.entries(customPaths)) {
    const resolved = path.resolve(fullPath);
    if (!seenPaths.has(resolved) && fs.existsSync(resolved)) {
      seenPaths.add(resolved);
      list.push(inspectProject(name, resolved, true));
    }
  }

  return list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

function inspectProject(name, fullPath, isCustom) {
  let mtime = 0;
  try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}
  const st = S[name];
  const activeTabs = st ? Object.values(st.tabs).filter(t => !t.dead).length : 0;
  let branch = '';
  try {
    const headFile = path.join(fullPath, '.git', 'HEAD');
    if (fs.existsSync(headFile)) {
      const h = fs.readFileSync(headFile, 'utf8').trim();
      branch = h.startsWith('ref: refs/heads/') ? h.slice(16) : h.slice(0, 7);
    }
  } catch {}
  return { n: name, d: fullPath, custom: !!isCustom, mtime, activeTabs, branch };
}

// ============================================================================
// AUTHENTIFICATION & SERVEUR HTTP
// ============================================================================
const authFailures = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = authFailures.get(ip);
  if (!rec || now > rec.resetAt) return true;
  return rec.count < 15;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const rec = authFailures.get(ip);
  if (!rec || now > rec.resetAt) {
    authFailures.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    rec.count++;
  }
}

function parseCookies(req) {
  const out = {};
  const rc = req.headers.cookie || '';
  rc.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

function isAuthorized(req, urlObj) {
  const requiredPin = process.env.AGY_PIN || savedConf.pin || '';
  if (!requiredPin) return true;
  const qk = urlObj.searchParams.get('k');
  const hk = req.headers['x-agy-token'];
  const ck = parseCookies(req).agy_k;
  const candidate = qk || hk || ck || '';
  if (!candidate || candidate.length !== requiredPin.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(requiredPin));
  } catch {
    return false;
  }
}

const json = (r, o, c = 200, extraHeaders = {}) => {
  r.writeHead(c, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  r.end(JSON.stringify(o));
};

const body = q => new Promise((resolve, reject) => {
  let b = '';
  q.on('data', c => {
    b += c;
    if (b.length > 15e6) {
      q.destroy();
      reject(new Error('Payload trop volumineux'));
    }
  });
  q.on('end', () => {
    try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
  });
});

// Battement de coeur SSE global toutes les 15s
setInterval(() => {
  for (const proj of Object.values(S)) {
    for (const tab of Object.values(proj.tabs)) {
      for (const r of tab.subs) {
        try { r.write(': ping\n\n'); } catch {}
      }
    }
    for (const r of proj.fileSubs) {
      try { r.write(': ping\n\n'); } catch {}
    }
    for (const r of proj.chatSubs) {
      try { r.write(': ping\n\n'); } catch {}
    }
  }
}, 15000);

const IMAGE_EXTS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const MIME_EXTS = {
  ...IMAGE_EXTS,
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

http.createServer(async (q, r) => {
  try {
    const u = new URL(q.url, 'http://localhost');
    const a = u.pathname;
    const clientIp = q.headers['cf-connecting-ip'] || q.headers['x-forwarded-for'] || q.socket.remoteAddress || 'unknown';

    // Aperçu Live Mobile / Web des fichiers d'un projet (/preview/<projet>/<fichier>)
    if (a.startsWith('/preview/')) {
      if (!isAuthorized(q, u)) return json(r, { error: 'Non autorisé' }, 401);
      const parts = a.slice('/preview/'.length).split('/');
      const projName = decodeURIComponent(parts.shift() || '');
      const relFile = decodeURIComponent(parts.join('/') || 'index.html');
      const projDir = dirOf(projName);
      let filePath = path.resolve(projDir, relFile);
      if (!filePath.startsWith(projDir)) return json(r, { error: 'Accès interdit' }, 403);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        r.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return r.end('<body style="font-family:sans-serif;padding:24px;background:#111;color:#eee"><h3>Aucun fichier index.html trouvé</h3><p>Demande à agy : <i>"Crée une page index.html moderne"</i> pour voir l’aperçu en direct ici.</p></body>');
      }
      const ext = path.extname(filePath).toLowerCase();
      r.writeHead(200, {
        'content-type': MIME_EXTS[ext] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      return r.end(fs.readFileSync(filePath));
    }

    if (a === '/' || a === '/index.html') {
      const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate' };
      if (isAuthorized(q, u)) {
        headers['set-cookie'] = `agy_k=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
      }
      r.writeHead(200, headers);
      return r.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }

    if (a === '/manifest.json') {
      return json(r, {
        name: 'agy console',
        short_name: 'agy',
        description: 'Studio mobile & desktop pour agy',
        start_url: '/?k=' + TOKEN,
        display: 'standalone',
        background_color: '#0b0c0e',
        theme_color: '#ff7a2f',
        icons: [
          {
            src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b0c0e"/><rect x="14" y="10" width="8" height="8" rx="2" fill="#ff7a2f"/><rect x="42" y="10" width="8" height="8" rx="2" fill="#ff7a2f"/><rect x="10" y="18" width="44" height="28" rx="6" fill="#ff7a2f"/><rect x="20" y="26" width="7" height="11" rx="2" fill="#0b0c0e"/><rect x="37" y="26" width="7" height="11" rx="2" fill="#0b0c0e"/><rect x="18" y="46" width="8" height="10" rx="2" fill="#ff7a2f"/><rect x="38" y="46" width="8" height="10" rx="2" fill="#ff7a2f"/></svg>'),
            sizes: '192x192',
            type: 'image/svg+xml'
          }
        ]
      });
    }

    if (a === '/sw.js') {
      const swPath = path.join(__dirname, 'public', 'sw.js');
      if (fs.existsSync(swPath)) {
        r.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'service-worker-allowed': '/',
          'cache-control': 'no-cache, no-store, must-revalidate'
        });
        return r.end(fs.readFileSync(swPath));
      }
      return json(r, { error: 'Service worker non trouvé' }, 404);
    }

    if (a === '/api/ping') {
      return json(r, {
        ok: 1,
        auth: isAuthorized(q, u),
        host: os.hostname(),
        platform: process.platform
      });
    }

    if (a === '/api/auth' && q.method === 'POST') {
      if (!checkRateLimit(clientIp)) {
        return json(r, { error: 'Trop de tentatives. Réessaie dans 1 minute.' }, 429);
      }
      const B = await body(q);
      const candidate = String(B.token || '').trim();
      const fakeUrl = new URL('http://localhost/?k=' + encodeURIComponent(candidate));
      if (!isAuthorized({ headers: {} }, fakeUrl)) {
        recordAuthFailure(clientIp);
        return json(r, { error: 'Code d’accès invalide.' }, 401);
      }
      return json(
        r,
        { ok: 1, token: TOKEN },
        200,
        { 'set-cookie': `agy_k=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` }
      );
    }

    if (!isAuthorized(q, u)) {
      return json(r, { error: 'Jeton invalide ou session expirée' }, 401);
    }

    const B = q.method === 'POST' ? await body(q) : {};
    const projs = listAllProjects();
    const defaultProjName = projs[0] ? projs[0].n : 'mon-projet';
    const n = u.searchParams.get('p') || B.p || defaultProjName;

    // 1. Infos générales
    if (a === '/api/info') {
      const starters = fs.readdirSync(STARTERS)
        .filter(f => /\.md$/i.test(f))
        .map(f => {
          const c = fs.readFileSync(path.join(STARTERS, f), 'utf8');
          const firstLine = (c.split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '');
          return { n: f, c, s: firstLine };
        });

      return json(r, {
        host: os.hostname(),
        platform: process.platform,
        root: ROOT,
        token: TOKEN,
        settings: agySettings,
        models: availableModels,
        starters,
        projects: projs,
        links: getNetworkLinks(),
        tunnel: {
          status: tunnel.status,
          provider: tunnel.provider,
          url: tunnel.url,
          baseUrl: tunnel.url,
          error: tunnel.error,
          qrSvg: tunnel.qrSvg
        }
      });
    }

    // Routes Web Push Notifications (Écran de veille / APNs Apple)
    if (a === '/api/push/vapid-public-key') {
      return json(r, { publicKey: vapidKeys ? vapidKeys.publicKey : null });
    }

    if (a === '/api/push/subscribe' && q.method === 'POST') {
      if (B.subscription) {
        addPushSub(B.subscription);
      }
      return json(r, { ok: 1 });
    }

    if (a === '/api/push/test' && q.method === 'POST') {
      await broadcastPushNotification({
        title: 'agy console · Test Push',
        body: 'Notification push reçue avec succès sur ton écran de veille !',
        url: '/'
      });
      return json(r, { ok: 1 });
    }

    // 2. Chat IA Temps Réel (Histoire, Discussions multiples sauvegardées, Envoi de message, Stop, Flux SSE)
    if (a === '/api/tokens/reset' && q.method === 'POST') {
      savedConf.tokenResetAt = B.restore ? 0 : Date.now();
      saveConfig({ tokenResetAt: savedConf.tokenResetAt });
      cachedBrainStats.ts = 0;
      const proj = getProjectState(n);
      return json(r, { ok: 1, tokenStats: getProjectTokenStats(proj) });
    }

    if (a === '/api/chat/history') {
      const proj = getProjectState(n);
      return json(r, {
        activeThreadId: proj.chat.activeThreadId,
        conversationId: proj.chat.conversationId,
        busy: proj.chat.busy,
        messages: proj.chat.messages,
        threads: getThreadsSummary(proj.chat),
        tokenStats: getProjectTokenStats(proj)
      });
    }

    if (a === '/api/chat/stream') {
      const proj = getProjectState(n);
      r.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });
      r.write('data: ' + JSON.stringify({
        type: 'init',
        busy: proj.chat.busy,
        activeThreadId: proj.chat.activeThreadId,
        conversationId: proj.chat.conversationId,
        messages: proj.chat.messages,
        threads: getThreadsSummary(proj.chat),
        tokenStats: getProjectTokenStats(proj)
      }) + '\n\n');
      proj.chatSubs.add(r);
      q.on('close', () => proj.chatSubs.delete(r));
      return;
    }

    if (a === '/api/chat/select' && q.method === 'POST') {
      const proj = getProjectState(n);
      const d = dirOf(n);
      const tid = String(B.threadId || '').trim();
      syncActiveThreadInMemory(proj.chat);
      const target = (proj.chat.threads || []).find(t => t.id === tid);
      if (!target) return json(r, { error: 'Discussion introuvable' }, 404);
      if (proj.chat.proc) {
        try { proj.chat.proc.kill(); } catch {}
        proj.chat.proc = null;
      }
      proj.chat.busy = false;
      proj.chat.activeThreadId = target.id;
      proj.chat.conversationId = target.conversationId || null;
      proj.chat.messages = Array.isArray(target.messages) ? target.messages : [];
      saveChatState(n, d, proj.chat);
      const payload = {
        type: 'thread_changed',
        activeThreadId: proj.chat.activeThreadId,
        conversationId: proj.chat.conversationId,
        messages: proj.chat.messages,
        threads: getThreadsSummary(proj.chat),
        tokenStats: getProjectTokenStats(proj)
      };
      broadcastChat(proj, payload);
      return json(r, { ok: 1, ...payload });
    }

    if (a === '/api/chat/delete' && q.method === 'POST') {
      const proj = getProjectState(n);
      const d = dirOf(n);
      const tid = String(B.threadId || '').trim();
      syncActiveThreadInMemory(proj.chat);
      proj.chat.threads = (proj.chat.threads || []).filter(t => t.id !== tid);
      if (!proj.chat.threads.length) {
        const newId = 'th-' + crypto.randomBytes(5).toString('hex');
        proj.chat.threads.push({
          id: newId,
          title: 'Nouvelle discussion',
          conversationId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: []
        });
      }
      if (proj.chat.activeThreadId === tid) {
        const first = proj.chat.threads[0];
        proj.chat.activeThreadId = first.id;
        proj.chat.conversationId = first.conversationId || null;
        proj.chat.messages = Array.isArray(first.messages) ? first.messages : [];
      }
      saveChatState(n, d, proj.chat);
      const payload = {
        type: 'thread_changed',
        activeThreadId: proj.chat.activeThreadId,
        conversationId: proj.chat.conversationId,
        messages: proj.chat.messages,
        threads: getThreadsSummary(proj.chat),
        tokenStats: getProjectTokenStats(proj)
      };
      broadcastChat(proj, payload);
      return json(r, { ok: 1, ...payload });
    }

    if (a === '/api/chat/send' && q.method === 'POST') {
      const text = String(B.text || '').trim();
      if (!text) return json(r, { error: 'Message vide' }, 400);
      const msg = runChatPrompt(n, text, {
        fresh: !!B.fresh,
        mode: B.mode,
        effort: B.effort,
        model: B.model,
        conversationId: B.conversationId
      });
      return json(r, { ok: 1, msg });
    }

    if (a === '/api/agy/cmd') {
      const cmd = String(u.searchParams.get('c') || B.c || '').trim();
      const d = dirOf(n);

      if (cmd === 'models') {
        refreshModelsAsync();
        return json(r, { ok: 1, models: availableModels });
      }

      if (cmd === 'conversations') {
        const convList = [];
        const histFile = path.join(HOME, '.gemini', 'antigravity-cli', 'history.jsonl');
        if (fs.existsSync(histFile)) {
          try {
            const lines = fs.readFileSync(histFile, 'utf8').split(/\r?\n/).filter(Boolean);
            for (let i = lines.length - 1; i >= 0 && convList.length < 30; i--) {
              try {
                const item = JSON.parse(lines[i]);
                if (item.conversationId) {
                  const isCurrent = (item.workspace && path.resolve(item.workspace) === path.resolve(d));
                  convList.push({
                    conversationId: item.conversationId,
                    display: item.display || 'Conversation',
                    timestamp: item.timestamp,
                    workspace: item.workspace || '',
                    isCurrent
                  });
                }
              } catch {}
            }
          } catch {}
        }
        return json(r, { ok: 1, conversations: convList });
      }

      const runAgySubcommand = (subArgs) => {
        return new Promise((resolve, reject) => {
          execFile(WIN ? 'cmd.exe' : CMD, WIN ? ['/d', '/s', '/c', CMD, ...subArgs] : subArgs, {
            cwd: d,
            timeout: 15000,
            encoding: 'utf8'
          }, (err, stdout, stderr) => {
            if (err && !stdout) return reject(new Error(stderr || err.message));
            resolve((stdout || stderr || '').trim());
          });
        });
      };

      try {
        let out = '';
        if (cmd === 'mcp') {
          out = await runAgySubcommand(['mcp', 'list']);
        } else if (cmd === 'plugins') {
          out = await runAgySubcommand(['plugin', 'list']);
        } else if (cmd === 'changelog') {
          out = await runAgySubcommand(['changelog']);
        } else if (cmd === 'update') {
          out = await runAgySubcommand(['update']);
        } else if (cmd === 'help') {
          out = await runAgySubcommand(['--help']);
        } else {
          return json(r, { error: 'Sous-commande inconnue : ' + cmd }, 400);
        }
        return json(r, { ok: 1, output: out });
      } catch (err) {
        return json(r, { ok: 0, error: err.message }, 500);
      }
    }

    if (a === '/api/chat/stop' && q.method === 'POST') {
      const proj = getProjectState(n);
      if (proj.chat.proc) {
        try { proj.chat.proc.kill(); } catch {}
        proj.chat.proc = null;
      }
      proj.chat.busy = false;
      return json(r, { ok: 1 });
    }

    if ((a === '/api/chat/clear' || a === '/api/chat/new') && q.method === 'POST') {
      const proj = getProjectState(n);
      const d = dirOf(n);
      if (proj.chat.proc) {
        try { proj.chat.proc.kill(); } catch {}
        proj.chat.proc = null;
      }
      proj.chat.busy = false;
      syncActiveThreadInMemory(proj.chat);

      // Si la discussion actuelle contient des messages, on la garde précieusement dans threads et on en crée une nouvelle !
      const curTh = (proj.chat.threads || []).find(t => t.id === proj.chat.activeThreadId);
      if (!curTh || (curTh.messages && curTh.messages.length > 0)) {
        const newThread = {
          id: 'th-' + crypto.randomBytes(5).toString('hex'),
          title: 'Nouvelle discussion',
          conversationId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: []
        };
        proj.chat.threads.unshift(newThread);
        proj.chat.activeThreadId = newThread.id;
      }
      proj.chat.conversationId = null;
      proj.chat.messages = [];
      saveChatState(n, d, proj.chat);
      const payload = {
        type: 'thread_changed',
        activeThreadId: proj.chat.activeThreadId,
        conversationId: null,
        messages: [],
        threads: getThreadsSummary(proj.chat),
        tokenStats: getProjectTokenStats(proj)
      };
      broadcastChat(proj, payload);
      return json(r, { ok: 1, ...payload });
    }

    // 3. Tunnel Internet
    if (a === '/api/tunnel') {
      if (q.method === 'POST') {
        if (B.action === 'stop') {
          stopTunnel(true);
        } else if (B.action === 'start' || B.action === 'restart') {
          startTunnel(B.provider || tunnel.provider, B.action === 'restart');
          const t0 = Date.now();
          while (tunnel.status === 'starting' || tunnel.status === 'downloading') {
            if (Date.now() - t0 > 4500) break;
            await new Promise(res => setTimeout(res, 250));
          }
        }
      }
      let customQr = null;
      const targetUrl = u.searchParams.get('url') || B.url;
      if (targetUrl && QRCode) {
        try {
          customQr = await QRCode.toString(targetUrl, { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
        } catch {}
      }
      return json(r, {
        status: tunnel.status,
        provider: tunnel.provider,
        url: tunnel.url,
        baseUrl: tunnel.url,
        error: tunnel.error,
        qrSvg: customQr || tunnel.qrSvg,
        links: getNetworkLinks()
      });
    }

    // 4. Réglages agy
    if (a === '/api/settings' && q.method === 'POST') {
      agySettings = {
        model: B.model !== undefined ? String(B.model) : agySettings.model,
        mode: B.mode !== undefined ? String(B.mode) : agySettings.mode,
        effort: B.effort !== undefined ? String(B.effort) : agySettings.effort,
        skipPermissions: B.skipPermissions !== undefined ? !!B.skipPermissions : agySettings.skipPermissions,
        continueSession: B.continueSession !== undefined ? !!B.continueSession : agySettings.continueSession
      };
      saveConfig(agySettings);
      return json(r, { ok: 1, settings: agySettings });
    }

    // 5. Gestion des projets
    if (a === '/api/projects' && q.method === 'POST') {
      if (B.action === 'delete') {
        const projName = String(B.name || '');
        if (S[projName]) {
          for (const t of Object.values(S[projName].tabs)) {
            try { t.p.kill(); } catch {}
          }
          if (S[projName].watcher) try { S[projName].watcher.close(); } catch {}
          delete S[projName];
        }
        if (customPaths[projName]) {
          forgetCustomPath(projName);
          return json(r, { ok: 1 });
        }
        if (B.deleteFiles) {
          const d = dirOf(projName);
          fs.rmSync(d, { recursive: true, force: true });
        }
        return json(r, { ok: 1 });
      }

      if (B.action === 'openPath') {
        const target = path.resolve(String(B.path || '').trim());
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
          throw new Error('Ce dossier n’existe pas sur le PC : ' + target);
        }
        let baseName = path.basename(target).replace(/[^\w-]/g, '-') || 'projet';
        if (/^[_.]/.test(baseName)) baseName = 'p-' + baseName;
        rememberCustomPath(baseName, target);
        getProjectState(baseName);
        return json(r, { n: baseName, d: target });
      }

      if (B.action === 'clone') {
        const repoUrl = String(B.repoUrl || '').trim();
        if (!repoUrl) throw new Error('URL du dépôt Git manquante');
        const guessed = path.basename(repoUrl.replace(/\.git$/i, '')).replace(/[^\w-]/g, '-') || 'repo';
        let k = String(B.name || guessed).replace(/[^\w-]/g, '-') || 'repo';
        if (/^[_.]/.test(k)) k = 'p-' + k;
        let m = k, i = 2;
        while (fs.existsSync(path.join(ROOT, m))) m = k + '-' + i++;
        const d = dirOf(m);
        const res = gitWithErr(ROOT, 'clone', repoUrl, d);
        if (!res.ok) throw new Error('Échec du git clone : ' + res.error);
        runChatPrompt(m, 'Explore ce dépôt nouvellement cloné, résume son architecture et indique comment le lancer.', { fresh: true });
        return json(r, { n: m, d });
      }

      let k = String(B.name || 'projet').replace(/[^\w-]/g, '-') || 'projet';
      if (/^[_.]/.test(k)) k = 'p-' + k;
      let m = k, i = 2;
      const customBase = B.baseDir && path.resolve(B.baseDir) !== ROOT ? path.resolve(B.baseDir) : null;
      let d;
      if (customBase) {
        fs.mkdirSync(customBase, { recursive: true });
        while (fs.existsSync(path.join(customBase, m)) || customPaths[m]) m = k + '-' + i++;
        d = path.join(customBase, m);
        fs.mkdirSync(d, { recursive: true });
        rememberCustomPath(m, d);
      } else {
        while (fs.existsSync(path.join(ROOT, m))) m = k + '-' + i++;
        d = dirOf(m);
        fs.mkdirSync(d, { recursive: true });
      }

      const md = B.md || {};
      if (md.n && md.c !== undefined) {
        fs.writeFileSync(path.join(d, path.basename(md.n)), md.c || '');
      }
      ensureGitBase(d);
      const prompt = B.firstPrompt || (md.n ? `Lis le fichier ${path.basename(md.n)} : c’est la base du projet. Résume-le brièvement puis propose un plan d'action.` : null);
      if (prompt) {
        runChatPrompt(m, prompt, { fresh: true });
      }
      return json(r, { n: m, d });
    }

    // 6. Onglets de terminal PTY (PowerShell / agy TUI)
    if (a === '/api/tabs') {
      const proj = getProjectState(n);
      if (q.method === 'POST') {
        const tabId = String(B.tab || 'shell');
        if (B.action === 'kill') {
          const s = proj.tabs[tabId];
          if (s && !s.dead) try { s.p.kill(); } catch {}
        } else if (B.action === 'close') {
          const s = proj.tabs[tabId];
          if (s && !s.dead) try { s.p.kill(); } catch {}
          delete proj.tabs[tabId];
        } else {
          startSession(n, tabId, {
            kind: B.kind,
            label: B.label,
            restart: !!B.restart,
            fresh: !!B.fresh
          });
        }
      }
      const tabs = Object.values(proj.tabs).map(t => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        dead: t.dead,
        startedAt: t.startedAt
      }));
      return json(r, { tabs });
    }

    if (a === '/api/open') {
      const tabId = String(u.searchParams.get('tab') || B.tab || 'shell');
      const s = startSession(n, tabId, {
        kind: B.kind || (tabId === 'agy' ? 'agy' : 'shell'),
        restart: !!B.restart,
        fresh: !!B.fresh
      });
      const proj = getProjectState(n);
      return json(r, {
        ok: 1,
        tab: s.id,
        tabs: Object.values(proj.tabs).map(t => ({ id: t.id, kind: t.kind, label: t.label, dead: t.dead }))
      });
    }

    if (a === '/api/stream') {
      const tabId = String(u.searchParams.get('tab') || 'shell');
      const proj = getProjectState(n);
      const x = proj.tabs[tabId];
      if (!x) return json(r, { error: 'Session inconnue' }, 404);

      r.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });

      if (x.buf) r.write('data: ' + JSON.stringify(x.buf) + '\n\n');
      if (x.dead) {
        r.write('event: end\ndata: 0\n\n');
        return r.end();
      }
      x.subs.add(r);
      proj.fileSubs.add(r);
      q.on('close', () => {
        x.subs.delete(r);
        proj.fileSubs.delete(r);
      });
      return;
    }

    if (a === '/api/input') {
      const tabId = String(B.tab || 'shell');
      const proj = getProjectState(n);
      const x = proj.tabs[tabId];
      if (x && !x.dead) writePtyInput(x, B.d);
      return json(r, { ok: 1 });
    }

    if (a === '/api/resize') {
      const tabId = String(B.tab || 'shell');
      const proj = S[n];
      const x = proj && proj.tabs[tabId];
      try {
        if (x && !x.dead) x.p.resize(Math.max(20, B.cols | 0), Math.max(5, B.rows | 0));
      } catch {}
      return json(r, { ok: 1 });
    }

    // 7. Fichiers & Éditeur
    if (a === '/api/files') {
      const d = dirOf(n);
      const st = getGitStatusMap(d);
      const walked = walk(d);
      const allSet = new Set(walked);
      for (const k of Object.keys(st)) {
        if (!allSet.has(k)) walked.push(k);
      }
      return json(r, walked.slice(0, 4000).map(f => ({ f, s: st[f] || '' })));
    }

    if (a === '/api/file' && q.method === 'GET') {
      const d = dirOf(n);
      const f = String(u.searchParams.get('f') || '').replace(/\\/g, '/');
      const fp = path.resolve(d, f);
      if (!fp.startsWith(d + path.sep) && fp !== d) throw Error('Chemin invalide');

      const o = git(d, 'show', 'HEAD:' + f);
      if (!fs.existsSync(fp)) {
        return json(r, { c: '', o, deleted: true });
      }

      const stat = fs.statSync(fp);
      const ext = path.extname(fp).toLowerCase();
      if (IMAGE_EXTS[ext] && stat.size < 4e6) {
        const b64 = fs.readFileSync(fp).toString('base64');
        return json(r, { c: '[image]', o: null, image: `data:${IMAGE_EXTS[ext]};base64,${b64}`, size: stat.size });
      }

      let c = '';
      let binary = false;
      if (stat.size > 1e6) {
        c = `[Fichier volumineux : ${(stat.size / 1024).toFixed(1)} Ko]`;
        binary = true;
      } else {
        const b = fs.readFileSync(fp);
        if (b.includes(0)) {
          c = '[Fichier binaire]';
          binary = true;
        } else {
          c = b.toString('utf8');
        }
      }
      return json(r, { c, o, binary, size: stat.size });
    }

    if (a === '/api/file/save' && q.method === 'POST') {
      const d = dirOf(n);
      const f = String(B.f || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!f) throw new Error('Nom de fichier manquant');
      const fp = path.resolve(d, f);
      if (!fp.startsWith(d + path.sep)) throw new Error('Chemin invalide');
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      if (B.base64) {
        fs.writeFileSync(fp, Buffer.from(String(B.base64), 'base64'));
      } else {
        fs.writeFileSync(fp, String(B.c ?? ''), 'utf8');
      }
      return json(r, { ok: 1, f });
    }

    if (a === '/api/file/revert' && q.method === 'POST') {
      const d = dirOf(n);
      const f = String(B.f || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const fp = path.resolve(d, f);
      if (!fp.startsWith(d + path.sep)) throw new Error('Chemin invalide');

      if (B.deleteFile) {
        if (fs.existsSync(fp)) fs.rmSync(fp, { force: true });
        return json(r, { ok: 1 });
      }

      const inHead = git(d, 'cat-file', '-e', 'HEAD:' + f);
      if (inHead !== null) {
        git(d, 'checkout', 'HEAD', '--', f);
      } else if (fs.existsSync(fp)) {
        fs.rmSync(fp, { force: true });
      }
      return json(r, { ok: 1 });
    }

    // 8. Opérations Git
    if (a === '/api/git') {
      const d = dirOf(n);
      ensureGitBase(d);

      if (q.method === 'POST') {
        const act = B.action;
        if (act === 'commit') {
          const msg = String(B.message || 'Mise à jour via agy console').trim();
          gitWithErr(d, 'add', '-A');
          const res = gitWithErr(d, '-c', 'user.name=agy', '-c', 'user.email=agy@local', 'commit', '-m', msg);
          if (!res.ok) throw new Error(res.error);
        } else if (act === 'push') {
          const res = gitWithErr(d, 'push');
          if (!res.ok) throw new Error(res.error);
        } else if (act === 'pull') {
          const res = gitWithErr(d, 'pull', '--rebase');
          if (!res.ok) throw new Error(res.error);
        } else if (act === 'revertAll') {
          gitWithErr(d, 'reset', '--hard', 'HEAD');
          gitWithErr(d, 'clean', '-fd');
        } else if (act === 'branch') {
          const br = String(B.branch || '').trim();
          if (!br) throw new Error('Nom de branche requis');
          const res = B.create ? gitWithErr(d, 'checkout', '-b', br) : gitWithErr(d, 'checkout', br);
          if (!res.ok) throw new Error(res.error);
        }
      }

      const branch = (git(d, 'rev-parse', '--abbrev-ref', 'HEAD') || 'main').trim();
      const branches = (git(d, 'branch', '--format=%(refname:short)') || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      const remote = (git(d, 'remote', 'get-url', 'origin') || '').trim();
      const rawLog = git(d, 'log', '-n', '25', '--pretty=format:%h\t%s\t%cr\t%an') || '';
      const commits = rawLog
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          const [hash, subject, date, author] = line.split('\t');
          return { hash, subject, date, author };
        });

      return json(r, { branch, branches, remote, commits });
    }

    if (a === '/api/download') {
      const d = dirOf(n);
      const f = String(u.searchParams.get('f') || '').replace(/\\/g, '/');
      const fp = path.resolve(d, f);
      if (!fp.startsWith(d + path.sep) || !fs.existsSync(fp)) throw new Error('Fichier introuvable');
      r.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(fp))}"`
      });
      return fs.createReadStream(fp).pipe(r);
    }

    json(r, { error: 'Route introuvable (404)' }, 404);
  } catch (e) {
    json(r, { error: e.message || 'Erreur interne' }, 500);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  agy console v3.0 · Studio Mobile & Desktop (Local, Wi-Fi & 4G/5G)       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('  Dossier projets : ' + ROOT);
  console.log('  Code d’accès    : ' + TOKEN + '\n');

  const links = getNetworkLinks();
  for (const l of links) {
    console.log(`  • ${l.label.padEnd(28)} : ${l.url}`);
  }

  if (AUTO_TUNNEL) {
    console.log('\n  ⏳ Ouverture du tunnel HTTPS pour accès hors Wi-Fi (4G/5G)...');
    startTunnel().catch(err => {
      console.error('  ⚠️  Tunnel automatique indisponible :', err.message);
    });
  }
});
