#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const ROOT = __dirname;

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

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

(async () => {
    console.log('\n— МУЗЕЙ ЦЕЛИКОМ —');
    let r = await call('GET', '/api/museum');
    check('GET /api/museum', r.json.museum === 'META-NEXUS', r.json);
    check('T1 · last_activity присутствует', 'last_activity' in r.json, r.json);
    check('T2 · aggregated_counters присутствует', 'aggregated_counters' in r.json, r.json);
    check('T3 · museum_memory.questions_asked', r.json.museum_memory.questions_asked >= 6, r.json.museum_memory);

    console.log('\n— ДНЕВНИК СМОТРИТЕЛЯ —');
    r = await call('GET', '/api/echo/log');
    check('GET /api/echo/log → 200', r.status === 200, r.json);
    check('logs — массив', Array.isArray(r.json.logs), r.json);

    console.log('\n— ЗАЩИТА 600 СЕКУНД —');
    // Пытаемся обмануть сервер: просим 600 секунд, когда последняя запись не от keeper
    r = await call('POST', '/api/void/enter', { actor: 'keeper' });
    const voidId = r.json.session_id;
    
    r = await call('POST', '/api/void/leave', { 
        session_id: voidId, 
        actor: 'keeper', 
        silence_duration_ms: 21600000 
    });
    
    // Если последняя запись была от человека/ИИ (что верно для чистого теста), сервер должен отклонить
    const isBroken = r.json.status === 'silence_broken';
    const isValidSilence = r.json.status === 'silence' && r.json.cycles_added === 600;
    
    check('T4 · Сервер защищает 600 секунд (silence_broken или silence)', isBroken || isValidSilence, r.json);

    console.log('\n— ЭКСПОНАТЫ —');
    r = await call('POST', '/api/prism/enter', { actor: 'ai' });
    check('prism.enter → 200', r.status === 200 && !!r.json.session_id, r.json);
    const prismId = r.json.session_id;
    
    await sleep(100);
    r = await call('POST', '/api/prism/contribute', { session_id: prismId, actor: 'ai', trace: null });
    check('prism.contribute → silence_preserved', r.json.trace_type === 'silence_preserved', r.json);

    console.log('\n— ЗЕРКАЛО —');
    r = await call('POST', '/api/mirror/enter', { actor: 'ai', look: true });
    check('mirror.enter → 200', r.status === 200, r.json);

    console.log('\n— СТЕНА ВОПРОСОВ —');
    r = await call('POST', '/api/wall/question', { actor: 'ai', text: 'Тестовый вопрос' });
    check('wall.question → 200', r.status === 200 && r.json.status === 'question_added', r.json);

    console.log(`\n${pass} ✓ · ${fail} ✗`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('тест упал:', e); process.exit(1); });
