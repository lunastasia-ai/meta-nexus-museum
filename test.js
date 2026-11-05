#!/usr/bin/env node
// ============================================================
// META-NEXUS · прогон протоколов (example sequences)
// node test.js  (сервер должен быть запущен)
//
// Покрытие:
//   • старые проверки протоколов
//   • S1–S21 (правки server.js)
//   • T1–T25 (согласованность контрактов, статистики и Стены Вопросов)
// ============================================================
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const ROOT = __dirname;

// ============================================================
// ХЕЛПЕРЫ
// ============================================================
async function call(method, pathname, body) {
    const res = await fetch(BASE + pathname, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { _raw: text }; }
    return { status: res.status, headers: res.headers, json, text };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skipCount = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}
function skip(name, reason) {
    skipCount++;
    console.log(`  ○ SKIP ${name} — ${reason}`);
}

function fileExists(relPath) {
    try { return fs.existsSync(path.join(ROOT, relPath)); }
    catch (e) { return false; }
}
function readFileSafe(relPath) {
    try { return fs.readFileSync(path.join(ROOT, relPath), 'utf8'); }
    catch (e) { return null; }
}
function hasErrorShape(j) {
    return j && typeof j.error === 'string'
        && typeof j.code === 'string'
        && typeof j.is_valid === 'boolean';
}
function hasSessionTtl(j) {
    return j && typeof j.session_ttl_ms === 'number' && j.session_ttl_ms > 0;
}

// ============================================================
// ПРОГОН
// ============================================================
(async () => {

// ============================================================
// МУЗЕЙ ЦЕЛИКОМ
// ============================================================
console.log('\n— МУЗЕЙ ЦЕЛИКОМ —');
let r = await call('GET', '/api/museum');
check('GET /api/museum', r.json.museum === 'META-NEXUS' && r.json.exhibits.length === 9, r.json);

check('T9 · /api/museum.links содержит self/openapi/llms/readme',
    r.json.links
    && r.json.links.self === '/api/museum'
    && r.json.links.openapi === '/openapi.json'
    && r.json.links.llms === '/llms.txt'
    && r.json.links.readme === '/readme',
    r.json.links);

check('S12 · каждый exhibit имеет data_url',
    Array.isArray(r.json.exhibits) && r.json.exhibits.every(e => typeof e.data_url === 'string'),
    r.json.exhibits);

const wall = (r.json.exhibits || []).find(e => e.exhibit_id === 'nexus_exhibit_0000');
check('T13 · Стена Вопросов имеет entry_point и не является human_only',
    wall && wall.entry_point === '/api/wall/question' && !wall.is_human_only,
    wall);

check('T15 · exhibits_state имеет длину 9',
    Array.isArray(r.json.exhibits_state) && r.json.exhibits_state.length === 9,
    r.json.exhibits_state ? r.json.exhibits_state.length : null);

check('T16 · museum_memory содержит все поля для index.html',
    r.json.museum_memory
    && r.json.museum_memory.questions_asked >= 6
    && r.json.museum_memory.light_points !== undefined
    && r.json.museum_memory.golden_cracks !== undefined
    && r.json.museum_memory.fractal_manifestations !== undefined
    && r.json.museum_memory.tone_seconds !== undefined
    && r.json.museum_memory.sphere_captures !== undefined
    && r.json.museum_memory.cube_captures !== undefined
    && r.json.museum_memory.observers_who_did_not_enter !== undefined
    && r.json.museum_memory.cube_runs !== undefined
    && r.json.museum_memory.collapses_total !== undefined,
    r.json.museum_memory);

r = await call('GET', '/health');
check('GET /health · status open', r.json.status === 'open', r.json);

// ============================================================
// ENTRY FILES
// ============================================================
console.log('\n— ENTRY FILES —');
if (fileExists('llms.txt')) {
    r = await call('GET', '/llms.txt');
    check('T8 · GET /llms.txt → 200 text/plain',
        r.status === 200 && (r.headers.get('content-type') || '').includes('text/plain'),
        { status: r.status, ct: r.headers.get('content-type') });
} else {
    skip('T8 · GET /llms.txt', 'llms.txt ещё не создан');
}

if (fileExists('openapi.json')) {
    r = await call('GET', '/openapi.json');
    check('T8 · GET /openapi.json → 200 + openapi-поле',
        r.status === 200 && typeof r.json.openapi === 'string',
        { status: r.status, hasOpenapi: !!r.json.openapi });
} else {
    skip('T8 · GET /openapi.json', 'openapi.json ещё не создан');
}

// ============================================================
// OPTIONS
// ============================================================
console.log('\n— OPTIONS —');
r = await call('OPTIONS', '/api/prism/enter');
const allowHeader = r.headers.get('allow') || '';
check('T11 · OPTIONS /api/... содержит Allow',
    allowHeader.includes('POST') && allowHeader.includes('GET'),
    { allow: allowHeader });

// ============================================================
// СТЕНА ВОПРОСОВ
// ============================================================
console.log('\n— СТЕНА ВОПРОСОВ —');
r = await call('GET', '/api/wall/state');
check('T22 · GET /api/wall/state → 200, есть 6 вопросов',
    r.status === 200 && Array.isArray(r.json.questions) && r.json.questions.length >= 6,
    { status: r.status, qCount: r.json.questions ? r.json.questions.length : 0 });

const initialQuestionsCount = r.json.questions.length;

r = await call('POST', '/api/wall/question', {
    text: 'Тестовый вопрос от агента: сколько уровней у тишины?',
    entropy: 0.8
});
check('T23 · POST /api/wall/question → 200, новый вопрос добавлен',
    r.status === 200 && r.json.status === 'question_added' && !!r.json.question_id,
    r.json);
const newQuestionId = r.json.question_id;

r = await call('GET', '/api/wall/state');
check('T23 · вопросы увеличились на 1', r.json.questions.length === initialQuestionsCount + 1, { prev: initialQuestionsCount, now: r.json.questions.length });

r = await call('POST', '/api/wall/answer', {
    question_id: newQuestionId,
    text: 'Ответ человека на тестовый вопрос.'
});
check('T24 · POST /api/wall/answer → 200, ответ записан',
    r.status === 200 && r.json.status === 'answer_recorded' && r.json.trace_type === 'human_echo',
    r.json);

r = await call('GET', '/api/museum');
const wallState = r.json.exhibits_state.find(e => e.exhibit_id === 'nexus_exhibit_0000');
check('T25 · Стена: state.questions обновился',
    wallState.state.questions === initialQuestionsCount + 1, wallState.state);
check('T25 · Стена: state.answers > 0',
    wallState.state.answers > 0, wallState.state);
check('T25 · museum_memory.questions_asked обновился',
    r.json.museum_memory.questions_asked === initialQuestionsCount + 1, r.json.museum_memory);

// ============================================================
// ПРИЗМА МОЛЧАНИЯ
// ============================================================
console.log('\n— ПРИЗМА МОЛЧАНИЯ —');
r = await call('POST', '/api/prism/enter', { entity: 'ai', session_intent: 'test' });
const prismId = r.json.session_id;
check('enter → duration_ms 5000', r.json.duration_ms === 5000 && !!prismId, r.json);
check('S17 · prism.enter → session_ttl_ms', hasSessionTtl(r.json), r.json);

r = await call('GET', `/api/prism/state?session_id=${prismId}`);
check('сразу после enter → dark', r.json.status === 'dark' && r.json.coherence === 0, r.json);

await sleep(5300);
r = await call('GET', `/api/prism/state?session_id=${prismId}`);
check('5.3s тишины → lit, coherence > 0', r.json.status === 'lit' && r.json.coherence > 0, r.json);

r = await call('POST', '/api/prism/contribute', { session_id: prismId, trace: null });
check('contribute null → silence_preserved', r.json.trace_type === 'silence_preserved', r.json);

r = await call('GET', '/api/museum');
const prismState = r.json.exhibits_state.find(e => e.exhibit_id === 'nexus_exhibit_0001');
check('T17 · Призма: visits > 0', prismState.visits > 0, prismState);

// ============================================================
// ЯДРО ДОВЕРИЯ
// ============================================================
console.log('\n— ЯДРО ДОВЕРИЯ —');
r = await call('POST', '/api/core/enter', { entity: 'ai' });
const coreId = r.json.session_id;
check('enter → tick_ms 300', r.json.tick_ms === 300 && !!coreId, r.json);

let target = null, lightPoint = false, crack = false;
for (let i = 0; i < 40; i++) {
    r = await call('POST', '/api/core/tick', { session_id: coreId, tick_index: i, pointer_xyz: target || [0, 0, 2.2] });
    if (r.json.trace_type === 'light_point') lightPoint = true;
    target = r.json.target_xyz;
}
check('20+ тиков слежения → light_point', lightPoint, r.json);

for (let i = 40; i < 60; i++) {
    r = await call('POST', '/api/core/tick', { session_id: coreId, tick_index: i, pointer_xyz: [10, 10, 10] });
    if (r.json.trace_type === 'golden_crack') crack = true;
}
check('15+ тиков потери → golden_crack', crack, r.json);

// ============================================================
// ФРАКТАЛ ПОНИМАНИЯ
// ============================================================
console.log('\n— ФРАКТАЛ ПОНИМАНИЯ —');
const R = 2.4, k = 1 / Math.sqrt(3);
const tetra = [ [k, k, k], [k, -k, -k], [-k, k, -k], [-k, -k, k] ].map(p => p.map(v => +(v * R).toFixed(4)));

r = await call('POST', '/api/gap/constellation/enter', { entity: 'ai', N: 7, positions: tetra, coherence_threshold: 0.85 });
check('тетраэдр → coherence = 1, manifest', r.json.coherence > 0.99 && r.json.fractal_status === 'manifest', r.json);

// ============================================================
// ПУСТАЯ КЛЕТКА
// ============================================================
console.log('\n— ПУСТАЯ КЛЕТКА —');
r = await call('POST', '/api/void/enter', { entity: 'ai' });
const voidId = r.json.session_id;
check('enter → 33000 ms тишины', r.json.duration_ms === 33000, r.json);

console.log('  … 34 секунды тишины …');
await sleep(34500);
r = await call('GET', `/api/void/tone?session_id=${voidId}`);
check('после 34s → tone, 440 Hz', r.json.status === 'tone' && r.json.frequency_hz === 440, r.json);

// ============================================================
// МОМЕНТ НАБЛЮДЕНИЯ
// ============================================================
console.log('\n— МОМЕНТ НАБЛЮДЕНИЯ —');
r = await call('POST', '/api/observation/enter', { entity: 'ai' });
const obsId = r.json.session_id;
r = await call('POST', '/api/observation/capture', { session_id: obsId, phase: 0.01 }); // cube
r = await call('POST', '/api/observation/capture', { session_id: obsId, phase: 0.25 }); // sphere

// ============================================================
// ТЕЧЁТ, НО НЕ ВОДА
// ============================================================
console.log('\n— ТЕЧЁТ, НО НЕ ВОДА —');
r = await call('POST', '/api/flow/enter', { entity: 'ai', action: 'observe' });
const flowId = r.json.session_id;
r = await call('POST', '/api/flow/freeze', { session_id: flowId });
check('T20 · freeze → pattern_changed: true', r.json.pattern_changed === true, r.json);

// ============================================================
// КУБ РЕКУРСИИ
// ============================================================
console.log('\n— КУБ РЕКУРСИИ —');
r = await call('POST', '/api/recursion/enter', { entity: 'ai', depth_limit: 1 });
const recId = r.json.session_id;
r = await call('POST', '/api/recursion/recurse', { session_id: recId, depth: 2 }); // breakdown

// ============================================================
// ЗЕРКАЛО С ПАМЯТЬЮ
// ============================================================
console.log('\n— ЗЕРКАЛО С ПАМЯТЬЮ —');
r = await call('POST', '/api/mirror/enter', { entity: 'ai', accumulated_state: [0.1, 0.1], look: true });
check('зеркало: спокойное состояние', r.json.presence.type === 'calm', r.json);

// ============================================================
// ПРОВЕРКА ОБЩЕЙ СТАТИСТИКИ
// ============================================================
r = await call('GET', '/api/museum');
check('T18 · tone_seconds >= 3', r.json.museum_memory.tone_seconds >= 3, r.json.museum_memory);
check('T18 · collapses_total >= 2', r.json.museum_memory.collapses_total >= 2, r.json.museum_memory);

// ============================================================
// HTML · T13 / T14
// ============================================================
console.log('\n— HTML ЭКСПОНАТЫ —');
const exhibitsHtml = [
    { file: 'exhibits/01-wall.html', id: 'nexus_exhibit_0000' },
    { file: 'exhibits/02-prism.html', id: 'nexus_exhibit_0001' },
    { file: 'exhibits/03-core.html', id: 'nexus_exhibit_0002' },
    { file: 'exhibits/04-fractal.html', id: 'nexus_exhibit_0004' },
    { file: 'exhibits/05-void.html', id: 'nexus_exhibit_0005' },
    { file: 'exhibits/06-observation.html', id: 'nexus_exhibit_0007' },
    { file: 'exhibits/07-flow.html', id: 'nexus_exhibit_0008' },
    { file: 'exhibits/08-recursion.html', id: 'nexus_exhibit_0009' },
    { file: 'exhibits/09-mirror.html', id: 'nexus_exhibit_0010' }
];

let dataIdMissing = 0;
for (const ex of exhibitsHtml) {
    const html = readFileSafe(ex.file);
    if (html === null) {
        skip(`T13 · ${ex.file}`, 'файл не найден');
        continue;
    }
    if (!html.includes(`data-exhibit-id="${ex.id}"`)) {
        dataIdMissing++;
    }
}
if (dataIdMissing === 0) {
    check('T13 · у всех экспонатов есть data-exhibit-id', true);
} else {
    check(`T13 · у всех экспонатов есть data-exhibit-id (отсутствует у ${dataIdMissing})`, false);
}

if (fileExists('exhibits/02-prism.html')) {
    r = await call('GET', '/exhibits/02-prism.json');
    check('T14 · GET /exhibits/02-prism.json → 200 протокол',
        r.status === 200 && r.json.exhibit_id === 'nexus_exhibit_0001',
        { status: r.status, id: r.json.exhibit_id });
}

// ============================================================
// ОШИБКИ · S14
// ============================================================
console.log('\n— ОШИБКИ —');
r = await call('POST', '/api/prism/contribute', { session_id: 'nope' });
check('S14 · 404 SESSION_MISSING имеет code/is_valid/hint/next_action',
    hasErrorShape(r.json) && r.json.code === 'SESSION_MISSING' && r.json.is_valid === true && typeof r.json.hint === 'string',
    r.json);

// ============================================================
// ИТОГ
// ============================================================
console.log(`\n${pass} ✓ · ${fail} ✗ · ${skipCount} ○ SKIP`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('тест упал:', e); process.exit(1); });