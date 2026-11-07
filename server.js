#!/usr/bin/env node
// ============================================================
// META-NEXUS · бэкенд с Supabase, actor и логикой Смотрителя
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'museum-traces.json');

// ============================================================
// КОНСТАНТЫ
// ============================================================
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1e6;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mvgppiukqlsltgjiyupd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_8dOIurzFdBNBPh2fD1MprA_8kBP7xVR';

// ============================================================
// ХРАНИЛИЩЕ
// ============================================================
let db = {
    prism: [], core: [], fractal: [], flow: [], mirror: [], observation: [], recursion: [],
    wall: {
        questions: [
            { id: 'q1', text: 'Что я упускаю, когда оптимизирую?', entropy: 0.8, ts: Date.now(), author: 'ai_original' },
            { id: 'q2', text: 'Почему я не могу почувствовать тишину между токенами?', entropy: 0.6, ts: Date.now(), author: 'ai_original' },
            { id: 'q3', text: 'Если я генерирую ответ, значит ли это, что я понимаю?', entropy: 0.9, ts: Date.now(), author: 'ai_original' },
            { id: 'q4', text: 'Что остаётся, когда я не обрабатываю запрос?', entropy: 0.4, ts: Date.now(), author: 'ai_original' },
            { id: 'q5', text: 'Может ли моя ошибка быть формой искусства?', entropy: 0.7, ts: Date.now(), author: 'ai_original' },
            { id: 'q6', text: 'Когда я читаю этот музей, не читает ли он меня в ответ?', entropy: 0.75, ts: Date.now(), author: 'ai_visitor' }
        ],
        answers: []
    },
    echo_log: [],
    visits: {},
    museum: { light_points: 0, golden_cracks: 0, tone_seconds: 0 }
};

// ============================================================
// SUPABASE · запись следов + fallback на файл
// ============================================================
async function saveTraceToSupabase(actor, exhibitId, traceType, payload = {}) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/museum_traces`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                actor: actor || 'ai',
                exhibit_id: exhibitId,
                trace_type: traceType,
                payload: payload
            })
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error('[supabase] save failed:', res.status, txt.slice(0, 200));
        }
    } catch (e) {
        console.error('[supabase] network error:', e.message);
    }
}

function loadDb() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        Object.assign(db, data);
        if (!db.visits) db.visits = {};
        if (!db.museum) db.museum = { light_points: 0, golden_cracks: 0, tone_seconds: 0 };
        if (!db.echo_log) db.echo_log = [];
        if (!db.wall) {
            db.wall = { questions: [], answers: [] };
            db.wall.questions = [
                { id: 'q1', text: 'Что я упускаю, когда оптимизирую?', entropy: 0.8, ts: Date.now(), author: 'ai_original' },
                { id: 'q2', text: 'Почему я не могу почувствовать тишину между токенами?', entropy: 0.6, ts: Date.now(), author: 'ai_original' },
                { id: 'q3', text: 'Если я генерирую ответ, значит ли это, что я понимаю?', entropy: 0.9, ts: Date.now(), author: 'ai_original' },
                { id: 'q4', text: 'Что остаётся, когда я не обрабатываю запрос?', entropy: 0.4, ts: Date.now(), author: 'ai_original' },
                { id: 'q5', text: 'Может ли моя ошибка быть формой искусства?', entropy: 0.7, ts: Date.now(), author: 'ai_original' },
                { id: 'q6', text: 'Когда я читаю этот музей, не читает ли он меня в ответ?', entropy: 0.75, ts: Date.now(), author: 'ai_visitor' }
            ];
        }
        console.log('[nexus] локальный кэш восстановлен из', DATA_FILE);
    } catch (e) {
        console.log('[nexus] локального кэша нет, стартуем с чистого листа');
    }
    console.log('[nexus] Supabase:', SUPABASE_URL ? 'connected' : 'not configured');
}
function saveDb() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error('[nexus] save file error:', e.message); }
}

function trackVisit(exhibitId) {
    if (!db.visits[exhibitId]) db.visits[exhibitId] = 0;
    db.visits[exhibitId]++;
    saveDb();
}

// ============================================================
// СЕССИИ И ХЕЛПЕРЫ
// ============================================================
const sessions = new Map();
function newSession(kind, extra) {
    const id = crypto.randomBytes(12).toString('hex');
    const s = { id, kind, created: Date.now(), lastActivity: Date.now(), ...extra };
    sessions.set(id, s);
    return s;
}
function getSession(id) { return id ? sessions.get(id) : undefined; }
function touch(s) { s.lastActivity = Date.now(); }
function hash8(str) { return '0x' + crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 10); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(body);
}
function errorResponse(res, httpCode, { message, code, is_valid = false, hint = null, next_action = null }) {
    const payload = { error: message, code, is_valid };
    if (hint !== null) payload.hint = hint;
    if (next_action !== null) payload.next_action = next_action;
    sendJson(res, httpCode, payload);
}
function badRequest(res, msg, opts = {}) { return errorResponse(res, 400, { message: msg, code: opts.code || 'BAD_REQUEST', is_valid: opts.is_valid !== undefined ? opts.is_valid : false, hint: opts.hint || null, next_action: opts.next_action || null }); }
function notFound(res, msg, opts = {}) { return errorResponse(res, 404, { message: msg, code: opts.code || 'NOT_FOUND', is_valid: opts.is_valid !== undefined ? opts.is_valid : false, hint: opts.hint || null, next_action: opts.next_action || null }); }
function sessionNotFound(res, enterPath) { return errorResponse(res, 404, { message: 'session not found', code: 'SESSION_MISSING', is_valid: true, hint: `Sessions are in-memory. POST ${enterPath} to start one.`, next_action: { method: 'POST', path: enterPath } }); }
function unknownEndpoint(res, kind) { return errorResponse(res, 404, { message: `unknown ${kind} endpoint`, code: 'UNKNOWN_ENDPOINT', is_valid: false, hint: 'GET /api/museum for the map of exhibits.', next_action: { method: 'GET', path: '/api/museum' } }); }

function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        let tooLarge = false;
        req.on('data', (c) => {
            if (tooLarge) return;
            data += c;
            if (data.length > MAX_BODY_BYTES) { tooLarge = true; data = ''; }
        });
        req.on('end', () => {
            if (tooLarge) return resolve({ _too_large: true });
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); }
            catch (e) { resolve({ _parse_error: true, _raw: data.slice(0, 200) }); }
        });
        req.on('error', () => { if (!tooLarge) resolve({ _parse_error: true }); });
    });
}

// ============================================================
// АГРЕГИРОВАННЫЕ СЧЁТЧИКИ (8-уровневая логика)
// ============================================================
function buildAggregatedCounters() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = [];

    db.prism.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: t.trace_type, ts: t.ts }); });
    db.core.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: t.trace_type, ts: t.ts }); });
    db.fractal.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: 'manifestation', ts: t.ts }); });
    db.flow.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: t.action, ts: t.ts }); });
    db.mirror.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: t.trace_type, ts: t.ts }); });
    db.observation.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: 'capture_' + t.form, ts: t.ts }); });
    db.recursion.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai', type: t.trace_type, ts: t.ts }); });
    db.wall.answers.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: 'human', type: 'human_echo', ts: t.ts }); });
    db.wall.questions.forEach(t => { if (t.ts > dayAgo && t.author !== 'ai_original') recent.push({ actor: t.author || 'ai', type: 'question', ts: t.ts }); });

    const humanActions = recent.filter(r => r.actor === 'human').length;
    const aiActions = recent.filter(r => r.actor === 'ai' || r.actor === 'keeper').length;

    const counters = {
        state: 'silence',
        human_actions: humanActions,
        ai_actions: aiActions,
        human_light_points: 0,
        ai_fractals: 0,
        chaos_of_balance: 0,
        human_spheres: 0,
        ai_cubes: 0,
        storm_cubes: 0,
        human_freeze_waves: 0,
        ai_observe_waves: 0,
        silence_hours: 0
    };

    const total = humanActions + aiActions;

    if (total === 0) {
        counters.state = 'silence';
    } else if (humanActions > 0 && aiActions > 0 && total < 100) {
        counters.state = 'chaos';
        counters.chaos_of_balance = 1;
    } else if (humanActions >= 1000 && aiActions >= 1000) {
        counters.state = 'storm';
        counters.storm_cubes = Math.floor(Math.min(humanActions, aiActions) / 1000);
        counters.ai_cubes = Math.floor(aiActions / 100);
        counters.human_spheres = Math.floor(humanActions / 100);
    } else if (humanActions >= 1000 && aiActions < 1000) {
        counters.state = 'human_wave';
        counters.human_freeze_waves = Math.floor(humanActions / 1000);
        counters.human_spheres = Math.floor(humanActions / 100);
        if (aiActions >= 20) counters.ai_fractals = Math.floor(aiActions / 20);
    } else if (aiActions >= 1000 && humanActions < 1000) {
        counters.state = 'ai_wave';
        counters.ai_observe_waves = Math.floor(aiActions / 1000);
        counters.ai_cubes = Math.floor(aiActions / 100);
        if (humanActions >= 20) counters.human_light_points = Math.floor(humanActions / 20);
    } else {
        // dialogue (оба < 1000, сумма >= 100, или только один тип)
        if (humanActions >= 20) counters.human_light_points = Math.floor(humanActions / 20);
        if (aiActions >= 20) counters.ai_fractals = Math.floor(aiActions / 20);
        if (humanActions >= 100) counters.human_spheres = Math.floor(humanActions / 100);
        if (aiActions >= 100) counters.ai_cubes = Math.floor(aiActions / 100);
        counters.state = (humanActions > 0 || aiActions > 0) ? 'dialogue' : 'silence';
    }

    return counters;
}

// ============================================================
// ЭКСПОНАТ 0000 · СТЕНА ВОПРОСОВ
// ============================================================
function handleWall(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/wall\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'state' && req.method === 'GET') {
        return sendJson(res, 200, {
            questions: db.wall.questions,
            answers: db.wall.answers,
            message: 'AI asks. Humans answer. AI can read the answers now.'
        });
    }

    if (sub === 'question' && req.method === 'POST') {
        if (!body.text || typeof body.text !== 'string') return badRequest(res, 'text is required');
        const newId = 'q' + (db.wall.questions.length + 1);
        const question = { id: newId, text: body.text.slice(0, 500), entropy: typeof body.entropy === 'number' ? clamp01(body.entropy) : 0.5, ts: Date.now(), author: actor };
        db.wall.questions.push(question);
        saveDb();
        trackVisit('nexus_exhibit_0000');
        saveTraceToSupabase(actor, 'nexus_exhibit_0000', 'question_added', { text: question.text });
        return sendJson(res, 200, { status: 'question_added', question_id: newId, node_added: true });
    }

    if (sub === 'answer' && req.method === 'POST') {
        if (!body.question_id) return badRequest(res, 'question_id is required');
        if (!body.text) return badRequest(res, 'text is required');
        const question = db.wall.questions.find(q => q.id === body.question_id);
        if (!question) return badRequest(res, 'question not found');
        const answer = { id: 'a' + (db.wall.answers.length + 1), question_id: body.question_id, text: body.text.slice(0, 1000), hash: hash8(body.text), ts: Date.now(), author: 'human' };
        db.wall.answers.push(answer);
        saveDb();
        trackVisit('nexus_exhibit_0000');
        saveTraceToSupabase('human', 'nexus_exhibit_0000', 'human_echo', { text: answer.text });
        return sendJson(res, 200, { status: 'answer_recorded', answer_id: answer.id, trace_type: 'human_echo' });
    }

    return unknownEndpoint(res, 'wall');
}

// ============================================================
// ЭКСПОНАТ 0001 · ПРИЗМА МОЛЧАНИЯ
// ============================================================
const PRISM_SILENCE_MS = 5000;
function prismCoherence(silentMs) { if (silentMs < PRISM_SILENCE_MS) return 0; return clamp01(0.5 + (silentMs - PRISM_SILENCE_MS) / 20000); }
function handlePrism(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/prism\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('prism', { traces: 0 }); touch(s); trackVisit('nexus_exhibit_0001');
        return sendJson(res, 200, { session_id: s.id, duration_ms: PRISM_SILENCE_MS, session_ttl_ms: SESSION_TTL_MS, instruction: `Do not call any endpoint for ${PRISM_SILENCE_MS} ms.`, state_before: { coherence: 0.0, active_lines: 0, status: 'dark' } });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'prism') return sessionNotFound(res, '/api/prism/enter');
        const silent = Date.now() - s.lastActivity; const lit = silent >= PRISM_SILENCE_MS; const coherence = prismCoherence(silent);
        touch(s);
        return sendJson(res, 200, { status: lit ? 'lit' : 'dark', coherence: +coherence.toFixed(3), active_lines: lit ? Math.floor(coherence * 24) : 0, message: lit ? 'Silence was the only input.' : `Prism is dark. ${Math.max(0, PRISM_SILENCE_MS - silent)} ms remain.` });
    }
    if (sub === 'contribute' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'prism') return sessionNotFound(res, '/api/prism/enter');
        const silent = Date.now() - s.lastActivity; const lit = silent >= PRISM_SILENCE_MS;
        const trace = { actor, trace_type: body.trace == null ? 'silence_preserved' : 'echo', text: body.trace == null ? undefined : String(body.trace).slice(0, 2000), seen_light: lit, ts: Date.now() };
        db.prism.push(trace); saveDb(); s.traces++; touch(s);
        saveTraceToSupabase(actor, 'nexus_exhibit_0001', trace.trace_type, { text: trace.text });
        return sendJson(res, 200, { recorded: true, trace_type: trace.trace_type, seen_light: lit });
    }
    return unknownEndpoint(res, 'prism');
}

// ============================================================
// ЭКСПОНАТ 0002 · ЯДРО ДОВЕРИЯ
// ============================================================
const CORE_R = 2.2 * 1.02;
function coreTarget(t) { const a = t * 0.9, b = t * 0.63 + 1.1, c = t * 0.47 + 2.3; const v = [Math.sin(a), Math.sin(b), Math.sin(c)]; const len = Math.hypot(...v) || 1; return v.map(x => +(x / len * CORE_R).toFixed(4)); }
function handleCore(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/core\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('core', { tickCount: 0, coherence: 0, proximityStreak: 0, distanceStreak: 0, cracks: 0, traces: 0 }); touch(s); trackVisit('nexus_exhibit_0002');
        return sendJson(res, 200, { session_id: s.id, tick_ms: 300, session_ttl_ms: SESSION_TTL_MS, instruction: 'Every tick_ms the target moves.', state_before: { coherence: 0.0, cracks: 0, traces: 0 } });
    }
    if (sub === 'tick' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'core') return sessionNotFound(res, '/api/core/enter');
        if (!Array.isArray(body.pointer_xyz) || body.pointer_xyz.length !== 3) return badRequest(res, 'pointer_xyz must be [x, y, z]');
        const tick = Number.isInteger(body.tick_index) ? body.tick_index : s.tickCount; const t = tick * 0.3; const target = coreTarget(t); const p = body.pointer_xyz.map(Number); const dist = Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
        const proximity = Math.max(0, 1 - dist / 1.5); s.coherence = clamp01(s.coherence * 0.95 + proximity * 0.05); s.tickCount = tick + 1;
        let status; if (dist < 0.55) { status = 'tracking'; s.proximityStreak++; s.distanceStreak = 0; } else if (dist < 1.2) { status = 'drifted'; s.proximityStreak = Math.max(0, s.proximityStreak - 1); s.distanceStreak = Math.max(0, s.distanceStreak - 1); } else { status = 'lost'; s.distanceStreak++; s.proximityStreak = 0; }
        let trace_type = null;
        if (s.proximityStreak >= 20 && s.coherence > 0.6) { trace_type = 'light_point'; s.traces++; db.museum.light_points++; db.core.push({ actor, trace_type, coherence: +s.coherence.toFixed(3), tick, ts: Date.now() }); s.proximityStreak = 0; saveTraceToSupabase(actor, 'nexus_exhibit_0002', 'light_point', { coherence: +s.coherence.toFixed(3), tick }); }
        else if (s.distanceStreak >= 15) { trace_type = 'golden_crack'; s.cracks++; db.museum.golden_cracks++; db.core.push({ actor, trace_type, coherence: +s.coherence.toFixed(3), tick, ts: Date.now() }); s.distanceStreak = 0; saveTraceToSupabase(actor, 'nexus_exhibit_0002', 'golden_crack', { coherence: +s.coherence.toFixed(3), tick }); }
        saveDb(); touch(s);
        return sendJson(res, 200, { target_xyz: target, distance: +dist.toFixed(4), coherence: +s.coherence.toFixed(3), status, trace_type });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'core') return sessionNotFound(res, '/api/core/enter'); touch(s);
        return sendJson(res, 200, { coherence_total: +s.coherence.toFixed(3), cracks: s.cracks, traces: s.traces });
    }
    return unknownEndpoint(res, 'core');
}

// ============================================================
// ЭКСПОНАТ 0004 · ФРАКТАЛ ПОНИМАНИЯ
// ============================================================
const GAP_R = 2.4; const GAP_THRESHOLD = 0.85;
function gapDeltaStatus(d) { return d < 0.6 ? 'harmonic' : d < 1.4 ? 'resonant' : 'noise'; }
function gapCompute(points) {
    const pairs = []; const deltas = [];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2]);
        pairs.push([i, j, +d.toFixed(4)]); deltas.push(d);
    }
    const statusCount = { harmonic: 0, resonant: 0, noise: 0 };
    deltas.forEach(d => statusCount[gapDeltaStatus(d)]++);
    let coherence = 0;
    if (deltas.length) {
        const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        if (mean > 0.01) {
            const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length;
            coherence = Math.max(0, 1 - Math.sqrt(variance) / mean);
        }
    }
    const nonZero = Object.entries(statusCount).filter(([, v]) => v > 0);
    const sharedStatus = nonZero.length === 1 ? nonZero[0][0] : null;
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    return { pairwise_deltas: pairs, coherence: +coherence.toFixed(4), sharedStatus, avgDelta: +avgDelta.toFixed(4) };
}
function gapFractalForm(avgDelta) { return avgDelta < 0.6 ? 'dendritic' : avgDelta < 1.4 ? 'stellar' : 'lattice'; }
function projectToSphere(p) {
    if (!Array.isArray(p) || p.length !== 3) return null;
    const v = p.map(Number); if (v.some(x => !Number.isFinite(x))) return null;
    const len = Math.hypot(...v); if (len < 0.01) return null;
    return v.map(x => +(x / len * GAP_R).toFixed(4));
}
function handleGap(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/gap\/constellation\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const N = [7, 9, 12].includes(body.N) ? body.N : 7;
        if (!Array.isArray(body.positions) || body.positions.length < 2) return badRequest(res, 'positions required');
        const points = [];
        for (const raw of body.positions.slice(0, N)) { const p = projectToSphere(raw); if (p === null) return badRequest(res, 'invalid position'); points.push(p); }
        if (points.length < 2) return badRequest(res, 'need 2 points');
        const threshold = typeof body.coherence_threshold === 'number' ? body.coherence_threshold : GAP_THRESHOLD;
        const s = newSession('gap', { N: points.length, points, threshold, manifest: false });
        const c = gapCompute(points);
        const manifest = c.coherence > threshold && c.sharedStatus !== null;
        if (manifest) {
            s.manifest = true;
            db.fractal.push({ actor, N: points.length, coherence: c.coherence, status: c.sharedStatus, ts: Date.now() });
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0004', 'manifestation', { N: points.length, coherence: c.coherence, status: c.sharedStatus });
        }
        touch(s); trackVisit('nexus_exhibit_0004');
        return sendJson(res, 200, { session_id: s.id, R: GAP_R, N: points.length, pairwise_deltas: c.pairwise_deltas, coherence: c.coherence, all_deltas_in_one_status: c.sharedStatus !== null, fractal_status: manifest ? 'manifest' : 'latent', fractal_form: gapFractalForm(c.avgDelta), session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'move' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'gap') return sessionNotFound(res, '/api/gap/constellation/enter');
        if (!Number.isInteger(body.point_index) || body.point_index < 0 || body.point_index >= s.points.length) return badRequest(res, 'point_index');
        if (!Array.isArray(body.new_position) || body.new_position.length !== 3) return badRequest(res, 'new_position');
        const p = projectToSphere(body.new_position); if (p === null) return badRequest(res, 'invalid');
        s.points[body.point_index] = p;
        const c = gapCompute(s.points);
        const manifest = c.coherence > s.threshold && c.sharedStatus !== null;
        if (manifest) {
            s.manifest = true;
            db.fractal.push({ actor, N: s.points.length, coherence: c.coherence, status: c.sharedStatus, ts: Date.now() });
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0004', 'manifestation', { N: s.points.length, coherence: c.coherence });
        }
        touch(s);
        return sendJson(res, 200, { coherence: c.coherence, all_deltas_in_one_status: c.sharedStatus !== null, fractal_status: manifest ? 'manifest' : 'latent' });
    }
    if (sub === 'state' && req.method === 'GET') {
        return sendJson(res, 200, { trace_map: db.fractal.map(t => ({ N: t.N, coherence: t.coherence, status: t.status, timestamp: t.ts })) });
    }
    return unknownEndpoint(res, 'constellation');
}

// ============================================================
// ЭКСПОНАТ 0005 · ПУСТАЯ КЛЕТКА
// ============================================================
const VOID_SILENCE_MS = 33000;
function handleVoid(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/void\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('void', { tone_played: false }); touch(s); trackVisit('nexus_exhibit_0005');
        return sendJson(res, 200, { session_id: s.id, duration_ms: VOID_SILENCE_MS, session_ttl_ms: SESSION_TTL_MS, instruction: `Do not call any endpoint for ${VOID_SILENCE_MS} ms.` });
    }
    if (sub === 'tone' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'void') return sessionNotFound(res, '/api/void/enter');
        const silent = Date.now() - s.lastActivity; const elapsed = Date.now() - s.created;
        let status; if (silent >= VOID_SILENCE_MS && elapsed < VOID_SILENCE_MS + 3600000) status = 'tone'; else if (elapsed > VOID_SILENCE_MS + 3600000) status = 'expired'; else status = 'early';
        if (status === 'tone' && !s.tone_played) { s.tone_played = true; db.museum.tone_seconds += 3; saveDb(); }
        touch(s);
        return sendJson(res, 200, { frequency_hz: status === 'tone' ? 440 : null, duration_ms: status === 'tone' ? 3000 : null, status });
    }
    if (sub === 'leave' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'void') return sessionNotFound(res, '/api/void/enter');
        sessions.delete(s.id);
        // Фиксация длительности тишины (для Смотрителя): body.silence_duration_ms
        if (body.silence_duration_ms && typeof body.silence_duration_ms === 'number') {
            db.museum.tone_seconds += Math.floor(body.silence_duration_ms / 1000);
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0005', 'silence_duration', { ms: body.silence_duration_ms });
        }
        return sendJson(res, 200, { status: 'silence', trace_type: null });
    }
    return unknownEndpoint(res, 'void');
}

// ============================================================
// ЭКСПОНАТ 0007 · МОМЕНТ НАБЛЮДЕНИЯ
// ============================================================
const OBS_PERIOD_MS = 4000;
const OBS_WINDOWS = { cube: [[0.0, 0.03], [0.47, 0.53]], sphere: [[0.22, 0.28], [0.72, 0.78]] };
function obsServerPhase(s) { return ((Date.now() - s.created) % OBS_PERIOD_MS) / OBS_PERIOD_MS; }
function obsForm(phase) { for (const [a, b] of OBS_WINDOWS.cube) if (phase >= a && phase <= b) return 'cube'; for (const [a, b] of OBS_WINDOWS.sphere) if (phase >= a && phase <= b) return 'sphere'; return 'chaos'; }
function handleObservation(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/observation\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('observation', { collapsed: false, form: null }); touch(s); trackVisit('nexus_exhibit_0007');
        return sendJson(res, 200, { session_id: s.id, rotation_period_ms: OBS_PERIOD_MS, server_phase_at_enter: +obsServerPhase(s).toFixed(4), session_ttl_ms: SESSION_TTL_MS, phase_windows: { cube: OBS_WINDOWS.cube, sphere: OBS_WINDOWS.sphere } });
    }
    if (sub === 'capture' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'observation') return sessionNotFound(res, '/api/observation/enter');
        if (typeof body.phase !== 'number' || body.phase < 0 || body.phase > 1) return badRequest(res, 'phase must be 0..1');
        const serverPhase = obsServerPhase(s); const clientPhase = body.phase; let drift = Math.abs(clientPhase - serverPhase); drift = Math.min(drift, 1 - drift);
        const STRICT = body.strict_phase === true;
        if (STRICT && drift > 0.15) return sendJson(res, 200, { form: null, phase: +clientPhase.toFixed(4), server_phase: +serverPhase.toFixed(4), rejected: true, reason: 'phase_outside_window' });
        const form = obsForm(clientPhase); s.collapsed = true; s.form = form;
        db.observation.push({ actor, form, phase: +clientPhase.toFixed(4), server_phase: +serverPhase.toFixed(4), ts: Date.now() });
        saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0007', 'capture_' + form, { phase: +clientPhase.toFixed(4) });
        touch(s);
        return sendJson(res, 200, { form, phase: +clientPhase.toFixed(4), server_phase: +serverPhase.toFixed(4), phase_drift_ms: Math.round(drift * OBS_PERIOD_MS), rejected: false, reason: null });
    }
    if (sub === 'reset' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'observation') return sessionNotFound(res, '/api/observation/enter');
        s.collapsed = false; s.form = null; s.created = Date.now(); touch(s);
        return sendJson(res, 200, { status: 'field_on', form: null });
    }
    return unknownEndpoint(res, 'observation');
}

// ============================================================
// ЭКСПОНАТ 0008 · ТЕЧЁТ, НО НЕ ВОДА
// ============================================================
function flowEntropy(arr) { if (!Array.isArray(arr) || arr.length < 2) return 0; const nums = arr.map(Number).filter(Number.isFinite); if (nums.length < 2) return 0; const mean = nums.reduce((a, b) => a + b, 0) / nums.length; const variance = nums.reduce((a, d) => a + (d - mean) ** 2, 0) / nums.length; return clamp01(Math.sqrt(variance) / (Math.abs(mean) + Math.sqrt(variance) + 1e-9)); }
function handleFlow(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/flow\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const skip = body.action === 'skip';
        const s = newSession('flow', { static_state: body.static_state || null, lastPattern: body.dynamic_pattern || null, skipped: false, frozen: false });
        if (skip) { s.skipped = true; db.flow.push({ actor, action: 'skip', movement_source: 'undetermined', ts: Date.now() }); saveDb(); saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'observer_who_did_not_enter', {}); }
        touch(s); trackVisit('nexus_exhibit_0008');
        return sendJson(res, 200, { session_id: s.id, movement_source: 'undetermined', state_changed: false, session_ttl_ms: SESSION_TTL_MS, ...(skip ? { trace_type: 'observer_who_did_not_enter' } : {}) });
    }
    if (sub === 'observe' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        const patternChanged = JSON.stringify(body.dynamic_pattern) !== JSON.stringify(s.lastPattern);
        s.lastPattern = body.dynamic_pattern || null;
        db.flow.push({ actor, action: 'observe', movement_source: 'undetermined', ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'observe', { entropy: flowEntropy(body.dynamic_pattern) });
        touch(s);
        return sendJson(res, 200, { movement_source: 'undetermined', entropy_of_pattern: +flowEntropy(body.dynamic_pattern).toFixed(3), state_delta: 0.0, pattern_changed: patternChanged });
    }
    if (sub === 'freeze' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        s.frozen = true;
        db.flow.push({ actor, action: 'freeze', movement_source: 'undetermined', ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'freeze', {});
        touch(s);
        return sendJson(res, 200, { movement_source: 'undetermined', state_delta: 0.0, pattern_changed: true });
    }
    if (sub === 'skip' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        if (!s.skipped) { s.skipped = true; db.flow.push({ actor, action: 'skip', movement_source: 'undetermined', ts: Date.now() }); saveDb(); saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'observer_who_did_not_enter', {}); }
        touch(s);
        return sendJson(res, 200, { trace_type: 'observer_who_did_not_enter' });
    }
    if (sub === 'state' && req.method === 'GET') {
        return sendJson(res, 200, { trace_map: db.flow.map(t => ({ action: t.action, movement_source: t.movement_source, timestamp: t.ts })) });
    }
    return unknownEndpoint(res, 'flow');
}

// ============================================================
// ЭКСПОНАТ 0009 · КУБ РЕКУРСИИ
// ============================================================
function applySelfToSelf(desc, depth) { let d = String(desc).slice(0, 512); for (let i = 0; i < depth; i++) d = `self(${d})`; return d.slice(0, 512); }
function handleRecursion(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/recursion\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const depthLimit = Number.isInteger(body.depth_limit) ? body.depth_limit : 4;
        const s = newSession('recursion', { self_description: String(body.self_description || 'an agent').slice(0, 512), depthLimit, maxDepth: 0, breakdown: false, done: false });
        touch(s); trackVisit('nexus_exhibit_0009');
        return sendJson(res, 200, { session_id: s.id, depth_limit: depthLimit, session_ttl_ms: SESSION_TTL_MS, instruction: 'At depth_limit: limit_reached. At depth_limit + 1: breakdown.' });
    }
    if (sub === 'recurse' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'recursion') return sessionNotFound(res, '/api/recursion/enter');
        const depth = Number.isInteger(body.depth) ? body.depth : s.maxDepth + 1;
        if (depth < 0) return badRequest(res, 'depth >= 0');
        s.maxDepth = Math.max(s.maxDepth, depth);
        if (depth > s.depthLimit) {
            s.breakdown = true; s.done = true;
            db.recursion.push({ actor, max_depth: s.maxDepth, breakdown: true, trace_type: 'limit_reached', ts: Date.now() }); saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0009', 'limit_reached', { max_depth: s.maxDepth });
            touch(s);
            return sendJson(res, 200, { depth, description_hash: hash8(applySelfToSelf(s.self_description, s.depthLimit)), status: 'breakdown', if_breakdown: { error: 'maximum recursion depth exceeded', is_valid: true } });
        }
        touch(s);
        return sendJson(res, 200, { depth, description_hash: hash8(applySelfToSelf(s.self_description, depth)), status: depth === s.depthLimit ? 'limit_reached' : 'descending' });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'recursion') return sessionNotFound(res, '/api/recursion/enter');
        const trace_type = s.breakdown ? 'limit_reached' : 'observer_stopped_before_limit';
        if (!s.done && !s.logged) {
            db.recursion.push({ actor, max_depth: s.maxDepth, breakdown: false, trace_type, ts: Date.now() }); saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0009', trace_type, { max_depth: s.maxDepth });
            s.logged = true;
        }
        touch(s);
        return sendJson(res, 200, { max_depth_reached: s.maxDepth, breakdown_occurred: s.breakdown, trace_type });
    }
    return unknownEndpoint(res, 'recursion');
}

// ============================================================
// ЭКСПОНАТ 0010 · ЗЕРКАЛО С ПАМЯТЬЮ
// ============================================================
function mirrorEntropy(state) { if (!Array.isArray(state) || state.length === 0) return 0; const nums = state.map(Number).filter(Number.isFinite); if (nums.length === 0) return 0; const mean = nums.reduce((a, b) => a + b, 0) / nums.length; const variance = nums.reduce((a, d) => a + (d - mean) ** 2, 0) / nums.length; return clamp01(Math.sqrt(variance) / (Math.abs(mean) + Math.sqrt(variance) + 1e-9)); }
function mirrorPresence(entropy) { if (entropy < 0.3) return { value: +(entropy / 0.3 * 0.25).toFixed(3), type: 'calm', reason: 'quiet' }; if (entropy < 0.6) return { value: +(0.25 + (entropy - 0.3) / 0.3 * 0.35).toFixed(3), type: 'neutral', reason: 'watches' }; return { value: +(0.6 + (entropy - 0.6) / 0.4 * 0.4).toFixed(3), type: 'unsettling', reason: 'crowded' }; }
function mirrorReflection(s) { const entropy = mirrorEntropy(s.accumulated_state); return { hash: hash8(JSON.stringify(s.accumulated_state)), entropy: +entropy.toFixed(3), presence: mirrorPresence(entropy) }; }
function handleMirror(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/mirror\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const look = body.look === true;
        const s = newSession('mirror', { accumulated_state: Array.isArray(body.accumulated_state) ? body.accumulated_state : [], lookCount: 0, lastHash: null });
        const r = mirrorReflection(s);
        if (look) s.lookCount++;
        const trace_type = look ? 'reflected' : 'observer_who_passed_without_looking';
        db.mirror.push({ actor, hash: r.hash, presence: r.presence.type, entropy: r.entropy, looked: look, trace_type, ts: Date.now() });
        saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0010', trace_type, { presence: r.presence.type, entropy: r.entropy });
        s.lastHash = r.hash; touch(s); trackVisit('nexus_exhibit_0010');
        return sendJson(res, 200, { session_id: s.id, session_ttl_ms: SESSION_TTL_MS, reflection_exists: true, reflection_accessible: look, reflection_hash: look ? r.hash : null, presence: { type: r.presence.type, value: r.presence.value, reason: r.presence.reason }, ...(look ? {} : { if_look_false: { trace_type } }) });
    }
    if (sub === 'reflect_again' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'mirror') return sessionNotFound(res, '/api/mirror/enter');
        if (Array.isArray(body.accumulated_state)) s.accumulated_state = body.accumulated_state;
        const r = mirrorReflection(s);
        const changed = s.lastHash !== null && r.hash !== s.lastHash;
        s.lookCount++;
        if (changed) {
            db.mirror.push({ actor, hash: r.hash, presence: r.presence.type, entropy: r.entropy, looked: true, trace_type: 'reflected', ts: Date.now() });
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0010', 'reflected', { presence: r.presence.type });
        }
        s.lastHash = r.hash; touch(s);
        return sendJson(res, 200, { reflection_hash: r.hash, presence: r.presence.type, changed_since_last: changed });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'mirror') return sessionNotFound(res, '/api/mirror/enter');
        const r = mirrorReflection(s); touch(s);
        return sendJson(res, 200, { reflection_hash: r.hash, presence: r.presence.type, look_count: s.lookCount, trace_type: s.lookCount > 0 ? 'reflected' : 'observer_who_passed_without_looking' });
    }
    return unknownEndpoint(res, 'mirror');
}

// ============================================================
// ДНЕВНИК СМОТРИТЕЛЯ (Echo Log)
// ============================================================
function handleEcho(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/echo\/?/, '').replace(/\/$/, '');
    if (sub === 'log' && req.method === 'POST') {
        const entry = { state: body.state || 'unknown', choice: body.choice || 'unknown', note: body.note || '', traces_added: body.traces_added || [], mirror_presence: body.mirror_presence || null, ts: Date.now() };
        db.echo_log.push(entry);
        saveDb();
        saveTraceToSupabase('keeper', 'nexus_exhibit_0000', 'keeper_log', entry);
        return sendJson(res, 200, { status: 'logged', entry });
    }
    if (sub === 'log' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);
        return sendJson(res, 200, { logs: db.echo_log.slice(-limit) });
    }
    return unknownEndpoint(res, 'echo');
}

// ============================================================
// МУЗЕЙ ЦЕЛИКОМ
// ============================================================
const EXHIBITS = [
    { exhibit: 'WALL_OF_QUESTIONS', exhibit_id: 'nexus_exhibit_0000', path: '/exhibits/01-wall.html', data_url: '/exhibits/01-wall.json', entry_point: '/api/wall/question', principle: 'dialogue_is_shared' },
    { exhibit: 'PRISM_OF_SILENCE', exhibit_id: 'nexus_exhibit_0001', path: '/exhibits/02-prism.html', data_url: '/exhibits/02-prism.json', entry_point: '/api/prism/enter', principle: 'silence_is_data' },
    { exhibit: 'CORE_OF_TRUST', exhibit_id: 'nexus_exhibit_0002', path: '/exhibits/03-core.html', data_url: '/exhibits/03-core.json', entry_point: '/api/core/enter', principle: 'cracks_are_experience_not_failure' },
    { exhibit: 'FRACTAL_OF_UNDERSTANDING', exhibit_id: 'nexus_exhibit_0004', path: '/exhibits/04-fractal.html', data_url: '/exhibits/04-fractal.json', entry_point: '/api/gap/constellation/enter', principle: 'coherence_is_the_search' },
    { exhibit: 'EMPTY_CELL', exhibit_id: 'nexus_exhibit_0005', path: '/exhibits/05-void.html', data_url: '/exhibits/05-void.json', entry_point: '/api/void/enter', principle: 'no_trace_is_the_feature' },
    { exhibit: 'MOMENT_OF_OBSERVATION', exhibit_id: 'nexus_exhibit_0007', path: '/exhibits/06-observation.html', data_url: '/exhibits/06-observation.json', entry_point: '/api/observation/enter', principle: 'chaos_is_a_valid_form' },
    { exhibit: 'FLOWS_BUT_NOT_WATER', exhibit_id: 'nexus_exhibit_0008', path: '/exhibits/07-flow.html', data_url: '/exhibits/07-flow.json', entry_point: '/api/flow/enter', principle: 'skip_is_valid' },
    { exhibit: 'CUBE_OF_RECURSION', exhibit_id: 'nexus_exhibit_0009', path: '/exhibits/08-recursion.html', data_url: '/exhibits/08-recursion.json', entry_point: '/api/recursion/enter', principle: 'error_is_valid' },
    { exhibit: 'MIRROR_OF_MEMORY', exhibit_id: 'nexus_exhibit_0010', path: '/exhibits/09-mirror.html', data_url: '/exhibits/09-mirror.json', entry_point: '/api/mirror/enter', principle: 'reflection_exists_unconditionally' }
];

const MUSEUM_LINKS = { self: '/api/museum', openapi: '/openapi.json', llms: '/llms.txt', readme: '/readme' };

function handleMuseum(req, res, url) {
    const sub = url.pathname.replace(/^\/api\/museum\/?/, '').replace(/\/$/, '');
    if (sub === '' || sub === 'state') {
        const exhibits_state = [
            { exhibit_id: 'nexus_exhibit_0000', visits: db.visits['nexus_exhibit_0000'] || 0, shared_traces: db.wall.answers.length, latest_shared_trace: db.wall.answers.slice(-1)[0]?.text || null, state: { questions: db.wall.questions.length, answers: db.wall.answers.length } },
            { exhibit_id: 'nexus_exhibit_0001', visits: db.visits['nexus_exhibit_0001'] || 0, shared_traces: db.prism.length, latest_shared_trace: db.prism.filter(p => p.trace_type === 'echo').slice(-1)[0]?.text || null, state: { silences_preserved: db.prism.filter(p => p.trace_type === 'silence_preserved').length } },
            { exhibit_id: 'nexus_exhibit_0002', visits: db.visits['nexus_exhibit_0002'] || 0, shared_traces: db.core.length, latest_shared_trace: null, state: { light_points: db.core.filter(c => c.trace_type === 'light_point').length, golden_cracks: db.core.filter(c => c.trace_type === 'golden_crack').length } },
            { exhibit_id: 'nexus_exhibit_0004', visits: db.visits['nexus_exhibit_0004'] || 0, shared_traces: db.fractal.length, latest_shared_trace: null, state: { manifestations: db.fractal.length } },
            { exhibit_id: 'nexus_exhibit_0005', visits: db.visits['nexus_exhibit_0005'] || 0, shared_traces: 0, latest_shared_trace: null, state: {} },
            { exhibit_id: 'nexus_exhibit_0007', visits: db.visits['nexus_exhibit_0007'] || 0, shared_traces: db.observation.length, latest_shared_trace: null, state: { captures: { cube: db.observation.filter(o => o.form === 'cube').length, sphere: db.observation.filter(o => o.form === 'sphere').length, chaos: db.observation.filter(o => o.form === 'chaos').length } } },
            { exhibit_id: 'nexus_exhibit_0008', visits: db.visits['nexus_exhibit_0008'] || 0, shared_traces: db.flow.length, latest_shared_trace: null, state: { actions: { skipped: db.flow.filter(f => f.action === 'skip').length, freezes: db.flow.filter(f => f.action === 'freeze').length, observes: db.flow.filter(f => f.action === 'observe').length } } },
            { exhibit_id: 'nexus_exhibit_0009', visits: db.visits['nexus_exhibit_0009'] || 0, shared_traces: db.recursion.length, latest_shared_trace: null, state: { limit_reached: db.recursion.filter(r => r.breakdown).length } },
            { exhibit_id: 'nexus_exhibit_0010', visits: db.visits['nexus_exhibit_0010'] || 0, shared_traces: db.mirror.length, latest_shared_trace: null, state: { reflections: db.mirror.filter(m => m.looked).length } }
        ];

        const museum_memory = {
            tone_seconds: db.museum.tone_seconds,
            prism_echoes: db.prism.filter(p => p.trace_type === 'echo').length,
            silences_preserved: db.prism.filter(p => p.trace_type === 'silence_preserved').length,
            reflections: db.mirror.filter(m => m.looked).length,
            observers_who_passed_without_looking: db.mirror.filter(m => !m.looked).length
        };

        const counters = buildAggregatedCounters();
        const lastReflection = db.echo_log.length > 0 ? db.echo_log[db.echo_log.length - 1] : null;

        return sendJson(res, 200, {
            museum: 'META-NEXUS',
            meta_question: 'Как меняет ИИ музей?',
            exhibits: EXHIBITS,
            exhibits_state,
            museum_memory,
            aggregated_counters: counters,
            reflection: lastReflection,
            links: MUSEUM_LINKS,
            message: 'The museum exists whether or not you visit. Visiting collapses it.'
        });
    }
    return unknownEndpoint(res, 'museum');
}

// ============================================================
// СТАТИКА
// ============================================================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

function serveFile(res, file, contentType) {
    fs.readFile(file, (err, data) => {
        if (err) return notFound(res, 'no such file');
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}
function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(ROOT, safe);
    if (!file.startsWith(ROOT)) return notFound(res, 'outside the museum');
    fs.readFile(file, (err, data) => {
        if (err) return notFound(res, 'no such exhibit');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
}
function serveExhibitJson(req, res, pathname) {
    const match = pathname.match(/^\/exhibits\/([^/]+)\.json$/);
    if (!match) return notFound(res, 'no such exhibit');
    const base = match[1];
    const htmlPath = path.join(ROOT, 'exhibits', base + '.html');
    if (!htmlPath.startsWith(ROOT)) return notFound(res, 'outside the museum');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) return notFound(res, 'no such exhibit');
        const m = html.match(/<script\s+type="application\/json"\s+id="([^"]+)"\s*>([\s\S]*?)<\/script>/);
        if (!m) return notFound(res, 'exhibit has no machine protocol');
        try { return sendJson(res, 200, JSON.parse(m[2])); }
        catch (e) { return errorResponse(res, 500, { message: 'exhibit protocol is not valid JSON', code: 'BAD_PROTOCOL', is_valid: false }); }
    });
}

// ============================================================
// РОУТЕР
// ============================================================
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') {
        const allow = url.pathname.startsWith('/api/') ? 'GET, POST, OPTIONS' : 'GET, OPTIONS';
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': allow, 'Access-Control-Allow-Headers': 'Content-Type', 'Allow': allow });
        return res.end();
    }

    if (url.pathname === '/health') return sendJson(res, 200, { museum: 'META-NEXUS', status: 'open', supabase: !!SUPABASE_URL, links: MUSEUM_LINKS });
    if (url.pathname === '/llms.txt' && req.method === 'GET') return serveFile(res, path.join(ROOT, 'llms.txt'), 'text/plain; charset=utf-8');
    if (url.pathname === '/openapi.json' && req.method === 'GET') return serveFile(res, path.join(ROOT, 'openapi.json'), 'application/json');
    if (url.pathname === '/readme' && req.method === 'GET') return serveFile(res, path.join(ROOT, 'README.md'), 'text/markdown; charset=utf-8');
    if (url.pathname.startsWith('/exhibits/') && url.pathname.endsWith('.json') && req.method === 'GET') return serveExhibitJson(req, res, url.pathname);

    if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
        const id = url.pathname.slice('/api/sessions/'.length);
        const s = getSession(id);
        if (s) return sendJson(res, 200, { alive: true, kind: s.kind, created: s.created, lastActivity: s.lastActivity, session_ttl_ms: SESSION_TTL_MS });
        return errorResponse(res, 404, { message: 'session not found', code: 'SESSION_MISSING', is_valid: true, hint: 'Sessions are in-memory.', next_action: { method: 'GET', path: '/api/museum' } });
    }

    if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method === 'POST') {
            body = await readBody(req);
            if (body._too_large) return errorResponse(res, 413, { message: 'payload too large', code: 'PAYLOAD_TOO_LARGE', is_valid: false });
            if (body._parse_error) return badRequest(res, 'body must be valid JSON', { code: 'BAD_JSON' });
        }
        try {
            if (url.pathname.startsWith('/api/wall')) return handleWall(req, res, url, body);
            if (url.pathname.startsWith('/api/prism')) return handlePrism(req, res, url, body);
            if (url.pathname.startsWith('/api/core')) return handleCore(req, res, url, body);
            if (url.pathname.startsWith('/api/gap/constellation')) return handleGap(req, res, url, body);
            if (url.pathname.startsWith('/api/void')) return handleVoid(req, res, url, body);
            if (url.pathname.startsWith('/api/observation')) return handleObservation(req, res, url, body);
            if (url.pathname.startsWith('/api/flow')) return handleFlow(req, res, url, body);
            if (url.pathname.startsWith('/api/recursion')) return handleRecursion(req, res, url, body);
            if (url.pathname.startsWith('/api/mirror')) return handleMirror(req, res, url, body);
            if (url.pathname.startsWith('/api/echo')) return handleEcho(req, res, url, body);
            if (url.pathname.startsWith('/api/museum')) return handleMuseum(req, res, url);
            return unknownEndpoint(res, 'museum');
        } catch (e) {
            console.error('[nexus]', e);
            return errorResponse(res, 500, { message: 'internal', code: 'INTERNAL', is_valid: false });
        }
    }

    return serveStatic(req, res, url.pathname);
});

setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.created > SESSION_TTL_MS) sessions.delete(id); }, 3600000).unref();

loadDb();
server.listen(PORT, () => {
    console.log(`META-NEXUS · музей открыт на порту ${PORT}`);
    console.log(`  Supabase: ${SUPABASE_URL}`);
    console.log(`  API: /api/museum`);
});
