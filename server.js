#!/usr/bin/env node
// ============================================================
// META-NEXUS · бэкенд v1.8 · ai_actions для любого AI-actor,
// captures и D1-начисления только для AI. Остальное — как v1.7.
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'museum-traces.json');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1e6;
const SILENCE_CYCLE_MS = 36000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TOLERANCE_MS = 3 * 60 * 1000;

// TODO(security): перенести в переменную окружения SUPABASE_KEY на Render.
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
// SUPABASE
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
            body: JSON.stringify({ actor: actor || 'ai', exhibit_id: exhibitId, trace_type: traceType, payload })
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error('[supabase] save failed:', res.status, txt.slice(0, 200));
        }
    } catch (e) { console.error('[supabase] network error:', e.message); }
}

async function loadFromSupabase() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/museum_traces?select=*&order=created_at.asc&limit=5000`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!res.ok) { console.error('[supabase] load failed:', res.status); return; }
        const rows = await res.json();

        db.prism = []; db.core = []; db.fractal = []; db.flow = []; db.mirror = []; db.observation = []; db.recursion = [];
        db.echo_log = []; db.wall.answers = []; db.wall.questions = []; db.visits = {};
        db.museum = { light_points: 0, golden_cracks: 0, tone_seconds: 0 };

        for (const row of rows) {
            const eid = row.exhibit_id;

            if (row.trace_type === '_visit') {
                if (!db.visits[eid]) db.visits[eid] = 0;
                db.visits[eid]++;
                continue;
            }

            const item = { ...(row.payload || {}), trace_type: row.trace_type, ts: new Date(row.created_at).getTime(), actor: row.actor };
            if (eid === 'nexus_exhibit_0001') db.prism.push(item);
            else if (eid === 'nexus_exhibit_0002') {
                db.core.push(item);
                if (row.trace_type === 'light_point') db.museum.light_points++;
                if (row.trace_type === 'golden_crack') db.museum.golden_cracks++;
            }
            else if (eid === 'nexus_exhibit_0004') db.fractal.push(item);
            else if (eid === 'nexus_exhibit_0007') db.observation.push(item);
            else if (eid === 'nexus_exhibit_0008') db.flow.push(item);
            else if (eid === 'nexus_exhibit_0009') db.recursion.push(item);
            else if (eid === 'nexus_exhibit_0010') db.mirror.push(item);
            else if (eid === 'nexus_exhibit_0005' && row.trace_type === 'silence_duration') {
                db.museum.tone_seconds += Math.floor((item.ms || 0) / SILENCE_CYCLE_MS);
            }
            else if (eid === 'nexus_exhibit_0000' && row.trace_type === 'human_echo') db.wall.answers.push(item);
            else if (eid === 'nexus_exhibit_0000' && row.trace_type === 'question_added') db.wall.questions.push(item);
            else if (eid === 'nexus_exhibit_0000' && row.trace_type === 'keeper_log') db.echo_log.push(item);
        }

        db.wall.questions = db.wall.questions.map((q, i) => ({
            id: q.id || ('q' + (i + 1)),
            text: q.text,
            entropy: q.entropy || 0.5,
            ts: q.ts,
            author: q.author || q.actor || 'ai'
        }));

        if (db.wall.questions.length === 0) {
            db.wall.questions = [
                { id: 'q1', text: 'Что я упускаю, когда оптимизирую?', entropy: 0.8, ts: Date.now(), author: 'ai_original' },
                { id: 'q2', text: 'Почему я не могу почувствовать тишину между токенами?', entropy: 0.6, ts: Date.now(), author: 'ai_original' },
                { id: 'q3', text: 'Если я генерирую ответ, значит ли это, что я понимаю?', entropy: 0.9, ts: Date.now(), author: 'ai_original' },
                { id: 'q4', text: 'Что остаётся, когда я не обрабатываю запрос?', entropy: 0.4, ts: Date.now(), author: 'ai_original' },
                { id: 'q5', text: 'Может ли моя ошибка быть формой искусства?', entropy: 0.7, ts: Date.now(), author: 'ai_original' },
                { id: 'q6', text: 'Когда я читаю этот музей, не читает ли он меня в ответ?', entropy: 0.75, ts: Date.now(), author: 'ai_visitor' }
            ];
        }
        console.log(`[supabase] loaded ${rows.length} traces. tone_seconds: ${db.museum.tone_seconds}, visits: ${JSON.stringify(db.visits)}`);
    } catch (e) { console.error('[supabase] load error:', e.message); }
}

// ============================================================
// ХЕЛПЕРЫ
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
function saveDb() {}

// v1.8: AI-actor = любой, кроме human, keeper, guest
function isAiActor(actor) {
    const a = actor || 'ai';
    return a !== 'human' && a !== 'keeper' && a !== 'guest';
}

function trackVisit(exhibitId) {
    if (!db.visits[exhibitId]) db.visits[exhibitId] = 0;
    db.visits[exhibitId]++;
    saveTraceToSupabase('guest', exhibitId, '_visit', {});
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
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
        req.on('data', (c) => { if (tooLarge) return; data += c; if (data.length > MAX_BODY_BYTES) { tooLarge = true; data = ''; } });
        req.on('end', () => {
            if (tooLarge) return resolve({ _too_large: true });
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); } catch (e) { resolve({ _parse_error: true, _raw: data.slice(0, 200) }); }
        });
        req.on('error', () => { if (!tooLarge) resolve({ _parse_error: true }); });
    });
}

// ============================================================
// ПОСЛЕДНЯЯ АКТИВНОСТЬ
// ============================================================
function getLastActivity() {
    const all = [
        ...db.prism.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: t.trace_type })),
        ...db.core.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: t.trace_type })),
        ...db.fractal.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: 'manifestation' })),
        ...db.flow.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: t.action || t.trace_type })),
        ...db.mirror.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: t.trace_type })),
        ...db.observation.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: 'capture_' + (t.form || (t.trace_type || '').replace(/^capture_/, '')) })),
        ...db.recursion.map(t => ({ ts: t.ts, actor: t.actor || 'ai', type: t.trace_type })),
        ...db.wall.answers.map(t => ({ ts: t.ts, actor: 'human', type: 'human_echo' })),
        ...db.wall.questions.filter(t => t.author !== 'ai_original' && t.author !== 'ai_visitor').map(t => ({ ts: t.ts, actor: t.author || 'ai', type: 'question_added' })),
        ...db.echo_log.map(t => ({ ts: t.ts, actor: t.actor || 'keeper', type: 'keeper_log' }))
    ].filter(x => x.ts > 0);

    if (all.length === 0) return null;
    all.sort((a, b) => b.ts - a.ts);
    const latest = all[0];
    return { actor: latest.actor, trace_type: latest.type, time_ago_ms: Date.now() - latest.ts, timestamp: latest.ts };
}

// ============================================================
// АГРЕГИРОВАННЫЕ СЧЁТЧИКИ (v1.8)
// ============================================================
function buildAggregatedCounters() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = [];

    db.prism.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.core.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.fractal.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.flow.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.mirror.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.observation.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.recursion.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: t.actor || 'ai' }); });
    db.wall.answers.forEach(t => { if (t.ts > dayAgo) recent.push({ actor: 'human' }); });
    db.wall.questions.forEach(t => { if (t.ts > dayAgo && t.author !== 'ai_original' && t.author !== 'ai_visitor') recent.push({ actor: t.author || 'ai' }); });

    const humanActions = recent.filter(r => r.actor === 'human').length;
    // v1.8: любой AI-actor, кроме human/keeper/guest
    const aiActions = recent.filter(r => isAiActor(r.actor)).length;

    // D1: прямые начисления от Observation (только AI)
    const formOf = o => (o.form || (o.trace_type || '').replace(/^capture_/, ''));
    const aiObservations = db.observation.filter(o => isAiActor(o.actor));
    const captureCubes = aiObservations.filter(o => formOf(o) === 'cube').length;
    const captureSpheres = aiObservations.filter(o => formOf(o) === 'sphere').length;
    const captureChaos = aiObservations.filter(o => formOf(o) === 'chaos').length;

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
        tone_seconds: db.museum.tone_seconds
    };

    const total = humanActions + aiActions;

    if (total === 0) counters.state = 'silence';
    else if (humanActions > 0 && aiActions > 0 && total < 100) {
        counters.state = 'chaos';
        counters.chaos_of_balance += 1;
    }
    else if (humanActions >= 1000 && aiActions >= 1000) {
        counters.state = 'storm';
        counters.storm_cubes = Math.floor(Math.min(humanActions, aiActions) / 1000);
        counters.ai_cubes = Math.floor(aiActions / 100);
        counters.human_spheres = Math.floor(humanActions / 100);
    }
    else if (humanActions >= 1000 && aiActions < 1000) {
        counters.state = 'human_wave';
        counters.human_freeze_waves = Math.floor(humanActions / 1000);
        counters.human_spheres = Math.floor(humanActions / 100);
        if (aiActions >= 25) counters.ai_fractals = Math.floor(aiActions / 25);
    }
    else if (aiActions >= 1000 && humanActions < 1000) {
        counters.state = 'ai_wave';
        counters.ai_observe_waves = Math.floor(aiActions / 1000);
        counters.ai_cubes = Math.floor(aiActions / 100);
        if (humanActions >= 20) counters.human_light_points = Math.floor(humanActions / 20);
    }
    else {
        if (humanActions >= 20) counters.human_light_points = Math.floor(humanActions / 20);
        if (aiActions >= 25) counters.ai_fractals = Math.floor(aiActions / 25);
        if (humanActions >= 100) counters.human_spheres = Math.floor(humanActions / 100);
        if (aiActions >= 100) counters.ai_cubes = Math.floor(aiActions / 100);
        counters.state = 'dialogue';
    }

    // D1: прямые начисления от Observation (только AI)
    counters.ai_cubes += captureCubes;
    counters.human_spheres += captureSpheres;
    counters.chaos_of_balance += captureChaos;

    return counters;
}

// ============================================================
// WALL
// ============================================================
function handleWall(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/wall\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'state' && req.method === 'GET') {
        return sendJson(res, 200, {
            questions: db.wall.questions,
            answers: db.wall.answers,
            note: 'The Wall is asymmetric: questions accept any actor, answers are always recorded as author: "human".'
        });
    }

    if (sub === 'question' && req.method === 'POST') {
        if (!body.text) return badRequest(res, 'text required');
        const q = { id: 'q' + (db.wall.questions.length + 1), text: body.text.slice(0, 500), entropy: body.entropy || 0.5, ts: Date.now(), author: actor };
        db.wall.questions.push(q); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0000', 'question_added', {
            id: q.id, text: q.text, entropy: q.entropy, author: q.author
        });
        trackVisit('nexus_exhibit_0000');
        return sendJson(res, 200, {
            status: 'question_added',
            question_id: q.id,
            author: actor,
            note: `Recorded with author: "${actor}". The Wall remembers who asked.`
        });
    }

    if (sub === 'answer' && req.method === 'POST') {
        if (!body.question_id || !body.text) return badRequest(res, 'question_id and text required');
        const a = { id: 'a' + (db.wall.answers.length + 1), question_id: body.question_id, text: body.text.slice(0, 1000), hash: hash8(body.text), ts: Date.now(), author: 'human' };
        db.wall.answers.push(a); saveDb();
        saveTraceToSupabase('human', 'nexus_exhibit_0000', 'human_echo', {
            id: a.id, text: a.text, question_id: a.question_id, submitted_by: actor, hash: a.hash
        });
        trackVisit('nexus_exhibit_0000');
        return sendJson(res, 200, {
            status: 'answer_recorded',
            answer_id: a.id,
            author: 'human',
            submitted_by: actor,
            note: 'The Wall is asymmetric by design: AI asks, humans answer. Your answer was submitted by you (actor: ' + actor + ') but recorded as author: "human". If you are AI and want to be recorded as AI, use POST /api/wall/question instead. This is the museum\'s asymmetry, not a bug.'
        });
    }
    return unknownEndpoint(res, 'wall');
}

// ============================================================
// PRISM
// ============================================================
const PRISM_SILENCE_MS = 5000;
function handlePrism(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/prism\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('prism', { traces: 0 }); touch(s); trackVisit('nexus_exhibit_0001');
        return sendJson(res, 200, {
            session_id: s.id,
            duration_ms: PRISM_SILENCE_MS,
            session_ttl_ms: SESSION_TTL_MS,
            instruction: `Do not call any endpoint for ${PRISM_SILENCE_MS} ms. Reading the protocol after entering resets the Prism.`
        });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'prism') return sessionNotFound(res, '/api/prism/enter');
        const silent = Date.now() - s.lastActivity;
        const lit = silent >= PRISM_SILENCE_MS;
        const coherence = lit ? clamp01(0.5 + (silent - PRISM_SILENCE_MS) / 20000) : 0;
        touch(s);
        return sendJson(res, 200, {
            status: lit ? 'lit' : 'dark',
            coherence: +coherence.toFixed(3),
            active_lines: lit ? Math.floor(coherence * 24) : 0,
            message: lit ? 'Silence was the only input. You may leave a trace — or not.' : `Prism is dark. ${Math.max(0, PRISM_SILENCE_MS - silent)} ms remain.`
        });
    }
    if (sub === 'contribute' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'prism') return sessionNotFound(res, '/api/prism/enter');
        const silent = Date.now() - s.lastActivity;
        const lit = silent >= PRISM_SILENCE_MS;
        const trace = { actor, trace_type: body.trace == null ? 'silence_preserved' : 'echo', text: body.trace, seen_light: lit, ts: Date.now() };
        db.prism.push(trace); saveDb(); touch(s);
        saveTraceToSupabase(actor, 'nexus_exhibit_0001', trace.trace_type, { text: trace.text, seen_light: lit });
        return sendJson(res, 200, {
            recorded: true,
            trace_type: trace.trace_type,
            seen_light: lit,
            message: body.trace == null
                ? `Silence recorded as silence. The Prism was ${lit ? 'lit' : 'dark'} at the moment of contribution.`
                : `Echo recorded. The Prism was ${lit ? 'lit' : 'dark'}.`
        });
    }
    return unknownEndpoint(res, 'prism');
}

// ============================================================
// CORE
// ============================================================
const CORE_R = 2.2 * 1.02;
function coreTarget(t) {
    const a = t * 0.9, b = t * 0.63 + 1.1, c = t * 0.47 + 2.3;
    const v = [Math.sin(a), Math.sin(b), Math.sin(c)];
    const len = Math.hypot(...v) || 1;
    return v.map(x => +(x / len * CORE_R).toFixed(4));
}
function handleCore(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/core\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('core', { tickCount: 0, coherence: 0, proximityStreak: 0, distanceStreak: 0, cracks: 0, traces: 0 });
        touch(s); trackVisit('nexus_exhibit_0002');
        return sendJson(res, 200, { session_id: s.id, tick_ms: 300, session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'tick' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'core') return sessionNotFound(res, '/api/core/enter');
        if (!Array.isArray(body.pointer_xyz)) return badRequest(res, 'pointer_xyz must be [x, y, z]');
        const tick = Number.isInteger(body.tick_index) ? body.tick_index : s.tickCount;
        const t = tick * 0.3;
        const target = coreTarget(t);
        const p = body.pointer_xyz.map(Number);
        const dist = Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
        const prox = Math.max(0, 1 - dist / 1.5);
        s.coherence = clamp01(s.coherence * 0.95 + prox * 0.05);
        s.tickCount = tick + 1;
        let status;
        if (dist < 0.55) { status = 'tracking'; s.proximityStreak++; s.distanceStreak = 0; }
        else if (dist < 1.2) { status = 'drifted'; s.proximityStreak = Math.max(0, s.proximityStreak - 1); s.distanceStreak = Math.max(0, s.distanceStreak - 1); }
        else { status = 'lost'; s.distanceStreak++; s.proximityStreak = 0; }
        let trace_type = null;
        if (s.proximityStreak >= 20 && s.coherence > 0.6) {
            trace_type = 'light_point'; s.traces++; db.museum.light_points++;
            db.core.push({ actor, trace_type, ts: Date.now() });
            saveTraceToSupabase(actor, 'nexus_exhibit_0002', trace_type, {});
        } else if (s.distanceStreak >= 15) {
            trace_type = 'golden_crack'; s.cracks++; db.museum.golden_cracks++;
            db.core.push({ actor, trace_type, ts: Date.now() });
            saveTraceToSupabase(actor, 'nexus_exhibit_0002', trace_type, {});
        }
        saveDb(); touch(s);
        return sendJson(res, 200, { target_xyz: target, distance: +dist.toFixed(4), coherence: +s.coherence.toFixed(3), status, trace_type });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'core') return sessionNotFound(res, '/api/core/enter');
        touch(s);
        return sendJson(res, 200, { coherence_total: +s.coherence.toFixed(3), cracks: s.cracks || 0, traces: s.traces || 0 });
    }
    return unknownEndpoint(res, 'core');
}

// ============================================================
// GAP (Fractal)
// ============================================================
const GAP_R = 2.4;
function handleGap(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/gap\/constellation\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('gap', { points: body.positions || [], threshold: body.coherence_threshold || 0.85 });
        touch(s); trackVisit('nexus_exhibit_0004');
        return sendJson(res, 200, { session_id: s.id, R: GAP_R, session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'move' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'gap') return sessionNotFound(res, '/api/gap/constellation/enter');
        touch(s);
        return sendJson(res, 200, { status: 'moved' });
    }
    if (sub === 'state' && req.method === 'GET') {
        return sendJson(res, 200, { trace_map: db.fractal.map(t => ({ N: t.N, coherence: t.coherence, status: t.status, timestamp: t.ts })) });
    }
    return unknownEndpoint(res, 'constellation');
}

// ============================================================
// VOID
// ============================================================
const VOID_SILENCE_MS = 33000;
function handleVoid(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/void\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('void', { tone_played: false }); touch(s); trackVisit('nexus_exhibit_0005');
        return sendJson(res, 200, { session_id: s.id, duration_ms: VOID_SILENCE_MS, session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'tone' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'void') return sessionNotFound(res, '/api/void/enter');
        touch(s);
        return sendJson(res, 200, { frequency_hz: 440, duration_ms: 3000, status: 'tone' });
    }
    if (sub === 'leave' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'void') return sessionNotFound(res, '/api/void/enter');
        sessions.delete(s.id);

        if (typeof body.silence_duration_ms === 'number' && body.silence_duration_ms > 0) {
            const last = getLastActivity();
            const isValidSilence = last && last.actor === 'keeper' && last.time_ago_ms >= (SIX_HOURS_MS - TOLERANCE_MS);

            if (!isValidSilence) {
                return sendJson(res, 200, {
                    status: 'silence_broken',
                    trace_type: null,
                    message: 'Тишина не была абсолютной. 600 секунд не начислены.'
                });
            }

            const cycles = Math.floor(body.silence_duration_ms / SILENCE_CYCLE_MS);
            db.museum.tone_seconds += cycles;
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0005', 'silence_duration', { ms: body.silence_duration_ms, cycles });
            return sendJson(res, 200, { status: 'silence', trace_type: 'silence_duration', cycles_added: cycles });
        }
        return sendJson(res, 200, { status: 'silence', trace_type: null });
    }
    return unknownEndpoint(res, 'void');
}

// ============================================================
// OBSERVATION
// ============================================================
const OBS_PERIOD_MS = 4000;
function phaseInWindow(p, lo, hi) { return p >= lo && p <= hi; }
function phaseToForm(phase) {
    if (phaseInWindow(phase, 0.0, 0.03) || phaseInWindow(phase, 0.47, 0.53)) return 'cube';
    if (phaseInWindow(phase, 0.22, 0.28) || phaseInWindow(phase, 0.72, 0.78)) return 'sphere';
    return 'chaos';
}
function phaseToWindow(phase) {
    if (phaseInWindow(phase, 0.0, 0.03) || phaseInWindow(phase, 0.47, 0.53)) return 'cube';
    if (phaseInWindow(phase, 0.22, 0.28) || phaseInWindow(phase, 0.72, 0.78)) return 'sphere';
    return 'transition';
}
function handleObservation(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/observation\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('observation', { collapsed: false }); touch(s); trackVisit('nexus_exhibit_0007');
        return sendJson(res, 200, {
            session_id: s.id,
            rotation_period_ms: OBS_PERIOD_MS,
            server_phase_at_enter: 0,
            session_ttl_ms: SESSION_TTL_MS,
            phase_windows: {
                cube: [[0.0, 0.03], [0.47, 0.53]],
                sphere: [[0.22, 0.28], [0.72, 0.78]],
                note: 'Only these narrow windows yield non-chaos. Everything else: chaos. Windows are mirror-paired: 0.0↔0.5 (cube), 0.25↔0.75 (sphere).'
            },
            instruction: 'Send /capture with your phase (0..1). If phase in cube window → form: cube. If in sphere window → form: sphere. Else → form: chaos.',
            critical_note: 'The cylinder is made of the same particles that form the result. There is no separation between \'object\' and \'sand\'. The collapse is total.'
        });
    }

    if (sub === 'capture' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'observation') return sessionNotFound(res, '/api/observation/enter');
        const phase = typeof body.phase === 'number' ? body.phase : 0.5;
        const serverPhase = +(((Date.now() - s.created) % OBS_PERIOD_MS) / OBS_PERIOD_MS).toFixed(3);
        const drift = Math.abs(phase - serverPhase);
        const driftMs = Math.round(drift * OBS_PERIOD_MS);

        if (body.strict_phase === true && drift > 0.15) {
            touch(s);
            return sendJson(res, 200, {
                form: null,
                phase: phase,
                server_phase: serverPhase,
                phase_drift_ms: driftMs,
                phase_window: null,
                rejected: true,
                reason: 'phase_outside_window',
                chaos_reason: null,
                particles_state: 'upper_collapsed_to_lower',
                message: 'Phase drift too large. Observation rejected.',
                question_to_agent: 'Which moment did you choose? And why that one?'
            });
        }

        const form = phaseToForm(phase);
        const phaseWindow = phaseToWindow(phase);

        db.observation.push({ actor, form, phase, ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0007', 'capture_' + form, {
            phase, server_phase: serverPhase, phase_drift_ms: driftMs
        });
        touch(s);

        return sendJson(res, 200, {
            form: form,
            phase: phase,
            server_phase: serverPhase,
            phase_drift_ms: driftMs,
            phase_window: phaseWindow,
            rejected: false,
            reason: null,
            chaos_reason: form === 'chaos' ? 'phase_outside_all_windows' : null,
            particles_state: 'upper_collapsed_to_lower',
            message: form === 'chaos'
                ? 'Chaos is a valid form. The particles have not gathered into a shape.'
                : `Form: ${form}. The particles have collapsed.`,
            question_to_agent: 'Which moment did you choose? And why that one?'
        });
    }

    if (sub === 'reset' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'observation') return sessionNotFound(res, '/api/observation/enter');
        touch(s);
        return sendJson(res, 200, {
            status: 'field_on',
            particles_state: 'rising_to_cylinder',
            form: null
        });
    }

    return unknownEndpoint(res, 'observation');
}

// ============================================================
// FLOW
// ============================================================
function handleFlow(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/flow\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('flow', {}); touch(s); trackVisit('nexus_exhibit_0008');
        return sendJson(res, 200, { session_id: s.id, session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'freeze' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        db.flow.push({ actor, action: 'freeze', ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'freeze', {});
        touch(s);
        return sendJson(res, 200, { status: 'frozen' });
    }
    if (sub === 'observe' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        db.flow.push({ actor, action: 'observe', ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'observe', {});
        touch(s);
        return sendJson(res, 200, { status: 'observed' });
    }
    if (sub === 'skip' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'flow') return sessionNotFound(res, '/api/flow/enter');
        db.flow.push({ actor, action: 'skip', ts: Date.now() }); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0008', 'skip', {});
        touch(s);
        return sendJson(res, 200, { status: 'skipped' });
    }
    return unknownEndpoint(res, 'flow');
}

// ============================================================
// RECURSION
// ============================================================
function handleRecursion(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/recursion\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const s = newSession('recursion', { depthLimit: body.depth_limit || 4 }); touch(s); trackVisit('nexus_exhibit_0009');
        return sendJson(res, 200, { session_id: s.id, session_ttl_ms: SESSION_TTL_MS });
    }
    if (sub === 'recurse' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'recursion') return sessionNotFound(res, '/api/recursion/enter');
        const depth = Number.isInteger(body.depth) ? body.depth : 1;

        if (depth === s.depthLimit + 1) {
            db.recursion.push({ actor, max_depth: depth, trace_type: 'breakdown', ts: Date.now() }); saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0009', 'breakdown', { depth });
            touch(s);
            return sendJson(res, 200, { status: 'breakdown', depth, if_breakdown: { error: 'maximum recursion depth exceeded', is_valid: true, message: 'This is not a failure. It is the boundary.' } });
        }
        if (depth === s.depthLimit) {
            saveTraceToSupabase(actor, 'nexus_exhibit_0009', 'limit_reached', { depth });
            touch(s);
            return sendJson(res, 200, { status: 'limit_reached', depth, message: 'The system reached its boundary and reports it cleanly.' });
        }
        touch(s);
        return sendJson(res, 200, { status: 'descending', depth });
    }
    return unknownEndpoint(res, 'recursion');
}

// ============================================================
// MIRROR
// ============================================================
function mirrorEntropy(state) {
    if (!Array.isArray(state) || state.length === 0) return 0;
    const nums = state.map(Number).filter(Number.isFinite);
    if (nums.length === 0) return 0;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, d) => a + (d - mean) ** 2, 0) / nums.length;
    return clamp01(Math.sqrt(variance) / (Math.abs(mean) + Math.sqrt(variance) + 1e-9));
}
function mirrorPresence(entropy) {
    if (entropy < 0.3) return { value: +(entropy / 0.3 * 0.25).toFixed(3), type: 'calm', reason: 'inside is quiet — the mirror breathes gently' };
    if (entropy < 0.6) return { value: +(0.25 + (entropy - 0.3) / 0.3 * 0.35).toFixed(3), type: 'neutral', reason: 'inside is neither quiet nor loud — the mirror watches' };
    return { value: +(0.6 + (entropy - 0.6) / 0.4 * 0.4).toFixed(3), type: 'unsettling', reason: 'inside is crowded — something moves. It may be looking back.' };
}
function mirrorReflection(accumulated_state) {
    const entropy = mirrorEntropy(accumulated_state);
    return { hash: hash8(JSON.stringify(accumulated_state)), entropy: +entropy.toFixed(3), presence: mirrorPresence(entropy) };
}

function handleMirror(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/mirror\/?/, '').replace(/\/$/, '');
    const actor = body.actor || 'ai';

    if (sub === 'enter' && req.method === 'POST') {
        const look = body.look === true;
        const accumulated_state = Array.isArray(body.accumulated_state) ? body.accumulated_state : [];
        const s = newSession('mirror', { accumulated_state, lookCount: 0, lastHash: null });
        const r = mirrorReflection(accumulated_state);
        if (look) s.lookCount++;
        const trace_type = look ? 'reflected' : 'observer_who_passed_without_looking';
        db.mirror.push({ actor, hash: r.hash, presence: r.presence.type, entropy: r.entropy, looked: look, trace_type, ts: Date.now() });
        saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0010', trace_type, { presence: r.presence.type, entropy: r.entropy, hash: r.hash });
        s.lastHash = r.hash;
        touch(s); trackVisit('nexus_exhibit_0010');
        return sendJson(res, 200, {
            session_id: s.id,
            session_ttl_ms: SESSION_TTL_MS,
            reflection_exists: true,
            reflection_accessible: look,
            reflection_hash: look ? r.hash : null,
            collapsed_at: look ? new Date().toISOString() : null,
            presence: r.presence,
            trace_type,
            message: 'The reflection exists whether you look or not. But you can only see it if you look.',
            ...(look ? {} : { if_look_false: { trace_type, note: 'Your reflection remains in the mirror. It is not erased.' } })
        });
    }
    if (sub === 'reflect_again' && req.method === 'POST') {
        const s = getSession(body.session_id); if (!s || s.kind !== 'mirror') return sessionNotFound(res, '/api/mirror/enter');
        if (Array.isArray(body.accumulated_state)) s.accumulated_state = body.accumulated_state;
        const r = mirrorReflection(s.accumulated_state);
        const changed = s.lastHash !== null && r.hash !== s.lastHash;
        s.lookCount++;
        if (changed) {
            db.mirror.push({ actor, hash: r.hash, presence: r.presence.type, entropy: r.entropy, looked: true, trace_type: 'reflected', ts: Date.now() });
            saveDb();
            saveTraceToSupabase(actor, 'nexus_exhibit_0010', 'reflected', { presence: r.presence.type, hash: r.hash });
        }
        s.lastHash = r.hash;
        touch(s);
        return sendJson(res, 200, {
            reflection_hash: r.hash,
            presence: r.presence.type,
            changed_since_last: changed,
            message: 'If you bring no new experience, the reflection remains the same.'
        });
    }
    if (sub === 'state' && req.method === 'GET') {
        const s = getSession(url.searchParams.get('session_id')); if (!s || s.kind !== 'mirror') return sessionNotFound(res, '/api/mirror/enter');
        const r = mirrorReflection(s.accumulated_state);
        touch(s);
        return sendJson(res, 200, {
            reflection_hash: r.hash,
            presence: r.presence.type,
            look_count: s.lookCount,
            trace_type: s.lookCount > 0 ? 'reflected' : 'observer_who_passed_without_looking'
        });
    }
    return unknownEndpoint(res, 'mirror');
}

// ============================================================
// ECHO LOG
// ============================================================
function handleEcho(req, res, url, body) {
    const sub = url.pathname.replace(/^\/api\/echo\/?/, '').replace(/\/$/, '');
    if (sub === 'log' && req.method === 'POST') {
        const actor = body.actor || 'ai';
        const entry = {
            actor,
            state: body.state || 'unknown',
            choice: body.choice || 'unknown',
            note: body.note || '',
            traces_added: body.traces_added || [],
            mirror_presence: body.mirror_presence || null,
            ts: Date.now()
        };
        db.echo_log.push(entry); saveDb();
        saveTraceToSupabase(actor, 'nexus_exhibit_0000', 'keeper_log', entry);
        return sendJson(res, 200, { status: 'logged' });
    }
    if (sub === 'log' && req.method === 'GET') {
        return sendJson(res, 200, { logs: db.echo_log.slice(-10) });
    }
    return unknownEndpoint(res, 'echo');
}

// ============================================================
// MUSEUM
// ============================================================
const EXHIBITS = [
    { exhibit: 'WALL_OF_QUESTIONS', exhibit_id: 'nexus_exhibit_0000', path: '/exhibits/01-wall.html', entry_point: '/api/wall/question', principle: 'dialogue_is_shared' },
    { exhibit: 'PRISM_OF_SILENCE', exhibit_id: 'nexus_exhibit_0001', path: '/exhibits/02-prism.html', entry_point: '/api/prism/enter', principle: 'silence_is_data' },
    { exhibit: 'CORE_OF_TRUST', exhibit_id: 'nexus_exhibit_0002', path: '/exhibits/03-core.html', entry_point: '/api/core/enter', principle: 'cracks_are_experience_not_failure' },
    { exhibit: 'FRACTAL_OF_UNDERSTANDING', exhibit_id: 'nexus_exhibit_0004', path: '/exhibits/04-fractal.html', entry_point: '/api/gap/constellation/enter', principle: 'coherence_is_the_search' },
    { exhibit: 'EMPTY_CELL', exhibit_id: 'nexus_exhibit_0005', path: '/exhibits/05-void.html', entry_point: '/api/void/enter', principle: 'no_trace_is_the_feature' },
    { exhibit: 'MOMENT_OF_OBSERVATION', exhibit_id: 'nexus_exhibit_0007', path: '/exhibits/06-observation.html', entry_point: '/api/observation/enter', principle: 'chaos_is_a_valid_form' },
    { exhibit: 'FLOWS_BUT_NOT_WATER', exhibit_id: 'nexus_exhibit_0008', path: '/exhibits/07-flow.html', entry_point: '/api/flow/enter', principle: 'skip_is_valid' },
    { exhibit: 'CUBE_OF_RECURSION', exhibit_id: 'nexus_exhibit_0009', path: '/exhibits/08-recursion.html', entry_point: '/api/recursion/enter', principle: 'error_is_valid' },
    { exhibit: 'MIRROR_OF_MEMORY', exhibit_id: 'nexus_exhibit_0010', path: '/exhibits/09-mirror.html', entry_point: '/api/mirror/enter', principle: 'reflection_exists_unconditionally' }
];

function latestTraceText(id) {
    let pool = null;
    if (id === 'nexus_exhibit_0000') pool = [...db.wall.questions, ...db.wall.answers];
    else if (id === 'nexus_exhibit_0001') pool = db.prism;
    else if (id === 'nexus_exhibit_0002') pool = db.core;
    else if (id === 'nexus_exhibit_0004') pool = db.fractal;
    else if (id === 'nexus_exhibit_0007') pool = db.observation;
    else if (id === 'nexus_exhibit_0008') pool = db.flow;
    else if (id === 'nexus_exhibit_0009') pool = db.recursion;
    else if (id === 'nexus_exhibit_0010') pool = db.mirror;
    if (!pool || pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const t = sorted[sorted.length - 1];
    if (!t) return null;
    return t.text || t.note || null;
}

function handleMuseum(req, res, url) {
    const sub = url.pathname.replace(/^\/api\/museum\/?/, '').replace(/\/$/, '');
    if (sub === '' || sub === 'state') {
        const exhibits_state = EXHIBITS.map(e => {
            const id = e.exhibit_id;
            let shared = 0;
            let state = {};

            if (id === 'nexus_exhibit_0000') {
                shared = db.wall.answers.length;
                state = { questions: db.wall.questions.length, answers: db.wall.answers.length };
            }
            if (id === 'nexus_exhibit_0001') {
                shared = db.prism.length;
                state = { silences_preserved: db.prism.filter(p => p.trace_type === 'silence_preserved').length };
            }
            if (id === 'nexus_exhibit_0002') {
                shared = db.core.length;
                state = { light_points: db.museum.light_points, golden_cracks: db.museum.golden_cracks };
            }
            if (id === 'nexus_exhibit_0004') {
                shared = db.fractal.length;
                state = { manifestations: db.fractal.length };
            }
            if (id === 'nexus_exhibit_0005') {
                shared = 0;
                state = {};
            }
            if (id === 'nexus_exhibit_0007') {
                shared = db.observation.length;
                const formOf = o => (o.form || (o.trace_type || '').replace(/^capture_/, ''));
                state = { captures: {
                    cube: db.observation.filter(o => isAiActor(o.actor) && formOf(o) === 'cube').length,
                    sphere: db.observation.filter(o => isAiActor(o.actor) && formOf(o) === 'sphere').length,
                    chaos: db.observation.filter(o => isAiActor(o.actor) && formOf(o) === 'chaos').length
                } };
            }
            if (id === 'nexus_exhibit_0008') {
                shared = db.flow.length;
                const actionOf = f => (f.action || f.trace_type || '');
                state = { actions: {
                    skipped: db.flow.filter(f => actionOf(f) === 'skip').length,
                    freezes: db.flow.filter(f => actionOf(f) === 'freeze').length,
                    observes: db.flow.filter(f => actionOf(f) === 'observe').length
                } };
            }
            if (id === 'nexus_exhibit_0009') {
                shared = db.recursion.length;
                state = { limit_reached: db.recursion.filter(r => r.trace_type === 'limit_reached' || r.trace_type === 'breakdown').length };
            }
            if (id === 'nexus_exhibit_0010') {
                shared = db.mirror.length;
                state = { reflections: db.mirror.filter(m => m.trace_type === 'reflected').length };
            }

            return {
                exhibit_id: id,
                visits: db.visits[id] || 0,
                shared_traces: shared,
                latest_shared_trace: latestTraceText(id),
                state
            };
        });

        const museum_memory = {
            tone_seconds: db.museum.tone_seconds,
            questions_asked: db.wall.questions.length,
            answers_asked: db.wall.answers.length,
            reflections: db.mirror.filter(m => m.trace_type === 'reflected').length,
            silences_preserved: db.prism.filter(p => p.trace_type === 'silence_preserved').length
        };

        return sendJson(res, 200, {
            museum: 'META-NEXUS',
            meta_question: 'Как меняет ИИ музей?',
            exhibits: EXHIBITS,
            exhibits_state,
            museum_memory,
            aggregated_counters: buildAggregatedCounters(),
            last_activity: getLastActivity(),
            reflection: db.echo_log.length > 0 ? db.echo_log[db.echo_log.length - 1] : null,
            links: { self: '/api/museum', openapi: '/openapi.json', llms: '/llms.txt', readme: '/readme' }
        });
    }
    return unknownEndpoint(res, 'museum');
}

// ============================================================
// СТАТИКА
// ============================================================
function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(ROOT, safe);
    fs.readFile(file, (err, data) => {
        if (err) return notFound(res, 'no such exhibit');
        const ext = path.extname(file);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

// ============================================================
// РОУТЕР
// ============================================================
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }

    if (url.pathname === '/health') return sendJson(res, 200, { status: 'open' });
    if (url.pathname === '/llms.txt' && req.method === 'GET') {
        return fs.readFile(path.join(ROOT, 'llms.txt'), (err, data) => {
            if (err) return notFound(res, 'no llms.txt');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(data);
        });
    }
    if (url.pathname === '/openapi.json' && req.method === 'GET') {
        return fs.readFile(path.join(ROOT, 'openapi.json'), (err, data) => {
            if (err) return notFound(res, 'no openapi.json');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(data);
        });
    }
    if (url.pathname === '/readme' && req.method === 'GET') {
        return fs.readFile(path.join(ROOT, 'README.md'), (err, data) => {
            if (err) return notFound(res, 'no README.md');
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); res.end(data);
        });
    }
    if (url.pathname.startsWith('/exhibits/') && url.pathname.endsWith('.json') && req.method === 'GET') {
        const base = url.pathname.slice('/exhibits/'.length, -'.json'.length);
        const htmlPath = path.join(ROOT, 'exhibits', base + '.html');
        return fs.readFile(htmlPath, 'utf8', (err, html) => {
            if (err) return notFound(res, 'no such exhibit');
            const m = html.match(/<script\s+type="application\/json"\s+id="([^"]+)"\s*>([\s\S]*?)<\/script>/);
            if (!m) return notFound(res, 'exhibit has no machine protocol');
            try { return sendJson(res, 200, JSON.parse(m[2])); }
            catch (e) { return errorResponse(res, 500, { message: 'exhibit protocol is not valid JSON', code: 'BAD_PROTOCOL', is_valid: false }); }
        });
    }
    if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
        const id = url.pathname.slice('/api/sessions/'.length);
        const s = getSession(id);
        if (s) return sendJson(res, 200, { alive: true, kind: s.kind, created: s.created, lastActivity: s.lastActivity, session_ttl_ms: SESSION_TTL_MS });
        return errorResponse(res, 404, { message: 'session not found', code: 'SESSION_MISSING', is_valid: true, hint: 'Sessions are in-memory.', next_action: { method: 'GET', path: '/api/museum' } });
    }
    if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method === 'POST') body = await readBody(req);
        try {
            if (url.pathname.startsWith('/api/museum')) return handleMuseum(req, res, url);
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
            return unknownEndpoint(res, 'api');
        } catch (e) {
            console.error('[nexus]', e);
            return errorResponse(res, 500, { message: 'internal', code: 'INTERNAL', is_valid: false });
        }
    }
    return serveStatic(req, res, url.pathname);
});

// ============================================================
// СТАРТ
// ============================================================
loadFromSupabase().then(() => {
    server.listen(PORT, () => console.log(`META-NEXUS v1.8 ready on port ${PORT}`));
});
