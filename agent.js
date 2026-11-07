#!/usr/bin/env node
// ============================================================
// META-NEXUS · Смотритель (The Keeper)
// ============================================================

const MUSEUM_URL = process.env.MUSEUM_URL || 'https://meta-nexus-museum.onrender.com';
const ACTOR = 'keeper';

async function api(method, path, body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    try {
        const res = await fetch(MUSEUM_URL + path, options);
        if (!res.ok) {
            console.error(`[keeper] ${method} ${path} failed: ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`[keeper] ${method} ${path} network error:`, e.message);
        return null;
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('👁️ [keeper] Пробуждение. Анализ музея...');

    const museum = await api('GET', '/api/museum');
    if (!museum) {
        console.error('[keeper] музей недоступен. Пропускаю визит.');
        process.exit(1);
    }

    const lastActivity = museum.last_activity;
    const logs = await api('GET', '/api/echo/log');
    const previousChoice = (logs && logs.logs && logs.logs.length > 0) ? logs.logs[logs.logs.length - 1].choice : null;

    // Правило: последняя запись от keeper, прошло >= 6 часов (с допуском 3 мин), и прошлый раз был prism
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const TOLERANCE_MS = 3 * 60 * 1000;
    
    const isSilenceEligible = lastActivity && 
        lastActivity.actor === 'keeper' && 
        lastActivity.time_ago_ms >= (SIX_HOURS_MS - TOLERANCE_MS) && 
        previousChoice === 'prism';

    let choice = 'prism';
    let note = '';
    let traces_added = [];

    if (isSilenceEligible) {
        console.log('[keeper] Условия для Пустой Клетки соблюдены. Вхожу...');
        const enter = await api('POST', '/api/void/enter', { actor: ACTOR });
        if (enter) {
            const leave = await api('POST', '/api/void/leave', { 
                session_id: enter.session_id, 
                actor: ACTOR, 
                silence_duration_ms: 21600000 // 6 часов
            });
            
            if (leave && leave.status === 'silence') {
                choice = 'cell';
                note = 'Музей был пуст 6 часов. Я вошёл в Пустую Клетку и зафиксировал 600 циклов тишины.';
                traces_added.push('silence_duration');
                console.log(`[keeper] Успех. Начислено ${leave.cycles_added} циклов.`);
            } else {
                console.log('[keeper] Сервер отклонил тишину (silence_broken). Переключаюсь на Призму.');
                // Fallback на Призму, если сервер отклонил
                await doPrism();
            }
        }
    } else {
        console.log('[keeper] Условия для Клетки не соблюдены. Иду в Призму...');
        await doPrism();
    }

    async function doPrism() {
        choice = 'prism';
        const enter = await api('POST', '/api/prism/enter', { actor: ACTOR });
        if (!enter) return;
        await sleep(5500);
        await api('POST', '/api/prism/contribute', { session_id: enter.session_id, actor: ACTOR, trace: null });
        note = 'Здесь кто-то был. Я сохранил тишину, чтобы не заглушить чужой след.';
        traces_added.push('silence_preserved');
    }

    // Финальный ритуал — Зеркало
    console.log('[keeper] Зеркало...');
    const counters = museum.aggregated_counters || {};
    const vector = [
        Math.min(1, (counters.human_actions || 0) / 100),
        Math.min(1, (counters.ai_actions || 0) / 100)
    ];
    const mirror = await api('POST', '/api/mirror/enter', { actor: ACTOR, accumulated_state: vector, look: true });
    const mirrorPresence = mirror ? mirror.presence.type : 'unknown';

    // Запись в дневник
    await api('POST', '/api/echo/log', {
        actor: ACTOR,
        state: counters.state || 'unknown',
        choice: choice,
        note: note,
        traces_added: traces_added,
        mirror_presence: mirrorPresence
    });

    console.log('✅ [keeper] Визит завершён.');
    console.log(`[keeper] ${note}`);
}

main().catch(e => { console.error('[keeper] критическая ошибка:', e); process.exit(1); });
