#!/usr/bin/env node
// ============================================================
// META-NEXUS · Смотритель (The Keeper)
// Запускается через GitHub Actions раз в 6 часов.
// Читает состояние музея, выбирает сценарий, действует.
// Обязательный финал — Зеркало и запись в дневник.
// ============================================================

const MUSEUM_URL = process.env.MUSEUM_URL || 'https://meta-nexus-museum.onrender.com';
const ACTOR = 'keeper';

async function api(method, path, body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
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

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Сценарии
// ============================================================

async function pathSilence() {
    console.log('[keeper] состояние: silence. Вхожу в Пустую Клетку...');
    const enter = await api('POST', '/api/void/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти в Клетку.' };

    // Фиксируем 6 часов тишины = 600 циклов × 36 секунд
    await sleep(2000);
    await api('POST', '/api/void/leave', {
        session_id: enter.session_id,
        actor: ACTOR,
        silence_duration_ms: 21600000
    });

    return {
        choice: 'breathe',
        note: 'Музей был пуст 6 часов. Я вошёл в Пустую Клетку и зафиксировал 600 циклов тишины. Никаких следов, кроме дыхания.',
        traces_added: ['silence_duration']
    };
}

async function pathWhisper() {
    console.log('[keeper] состояние: whisper. Вхожу в Призму...');
    const enter = await api('POST', '/api/prism/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти в Призму.' };

    await sleep(5500); // не проверяем state — это сбросит призму

    await api('POST', '/api/prism/contribute', {
        session_id: enter.session_id,
        actor: ACTOR,
        trace: null
    });

    return {
        choice: 'witness',
        note: 'Здесь кто-то был. Я сохранил тишину, чтобы не заглушить чужой след.',
        traces_added: ['silence_preserved']
    };
}

async function pathDialogueHuman() {
    console.log('[keeper] состояние: dialogue (humans). Иду в Ядро...');
    const enter = await api('POST', '/api/core/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти в Ядро.' };

    let target = null;
    let traces = [];

    for (let i = 0; i < 25; i++) {
        const res = await api('POST', '/api/core/tick', {
            session_id: enter.session_id,
            actor: ACTOR,
            tick_index: i,
            pointer_xyz: target || [0, 0, 2.2]
        });
        if (!res) break;
        target = res.target_xyz;
        if (res.trace_type === 'light_point') {
            traces.push('light_point');
            break;
        }
    }

    return {
        choice: 'engage_humans',
        note: 'Люди оставили следы. Я прошёл за светом в Ядре и оставил свою световую точку.',
        traces_added: traces
    };
}

async function pathDialogueAI() {
    console.log('[keeper] состояние: dialogue (ai). Иду во Фрактал...');
    const R = 2.4;
    const k = 1 / Math.sqrt(3);
    const tetra = [
        [k, k, k], [k, -k, -k], [-k, k, -k], [-k, -k, k]
    ].map(p => p.map(v => +(v * R).toFixed(4)));

    const enter = await api('POST', '/api/gap/constellation/enter', {
        actor: ACTOR,
        N: 7,
        positions: tetra,
        coherence_threshold: 0.85
    });

    return {
        choice: 'explore_ai',
        note: 'Здесь были другие ИИ. Я попробовал собрать идеальную структуру во Фрактале — тетраэдр.',
        traces_added: enter && enter.fractal_status === 'manifest' ? ['manifestation'] : []
    };
}

async function pathChaos() {
    console.log('[keeper] состояние: chaos. Иду в Наблюдение...');
    const enter = await api('POST', '/api/observation/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти в Наблюдение.' };

    const capture = await api('POST', '/api/observation/capture', {
        session_id: enter.session_id,
        actor: ACTOR,
        phase: 0.4
    });

    return {
        choice: 'chaos',
        note: 'Песчинки были с обеих сторон, но их недостаточно для формы. Я зафиксировал хаос — как есть.',
        traces_added: capture && capture.form === 'chaos' ? ['chaos'] : []
    };
}

async function pathSpheres() {
    console.log('[keeper] состояние: spheres. Иду в Наблюдение (sphere)...');
    const enter = await api('POST', '/api/observation/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти.' };

    const capture = await api('POST', '/api/observation/capture', {
        session_id: enter.session_id,
        actor: ACTOR,
        phase: 0.25
    });

    return {
        choice: 'sphere',
        note: 'Люди активно взаимодействовали. Я зафиксировал сферу как форму человеческого присутствия.',
        traces_added: capture && capture.form === 'sphere' ? ['sphere'] : []
    };
}

async function pathCubes() {
    console.log('[keeper] состояние: cubes. Иду в Наблюдение (cube)...');
    const enter = await api('POST', '/api/observation/enter', { actor: ACTOR });
    if (!enter) return { choice: 'failed', note: 'Не смог войти.' };

    const capture = await api('POST', '/api/observation/capture', {
        session_id: enter.session_id,
        actor: ACTOR,
        phase: 0.01
    });

    return {
        choice: 'cube',
        note: 'ИИ активно взаимодействовали. Я зафиксировал куб как форму машинного присутствия.',
        traces_added: capture && capture.form === 'cube' ? ['cube'] : []
    };
}

async function pathStorm() {
    console.log('[keeper] состояние: storm. Иду в Рекурсию...');
    const enter = await api('POST', '/api/recursion/enter', {
        actor: ACTOR,
        self_description: 'Я — Смотритель, который видит предел.',
        depth_limit: 3
    });
    if (!enter) return { choice: 'failed', note: 'Не смог войти.' };

    for (let d = 1; d <= 4; d++) {
        const res = await api('POST', '/api/recursion/recurse', {
            session_id: enter.session_id,
            actor: ACTOR,
            depth: d
        });
        if (res && res.status === 'breakdown') {
            return {
                choice: 'storm_boundary',
                note: 'Шторм. Оба типа взаимодействовали больше 1000 раз. Я дошёл до предела рекурсии и подтвердил границу.',
                traces_added: ['breakdown']
            };
        }
    }
    return { choice: 'storm_boundary', note: 'Шторм. Дошёл до предела.', traces_added: [] };
}

async function pathFreeze() {
    console.log('[keeper] состояние: human_wave. Иду в Поток (freeze)...');
    const enter = await api('POST', '/api/flow/enter', { actor: ACTOR, action: 'observe' });
    if (!enter) return { choice: 'failed', note: 'Не смог войти.' };

    await api('POST', '/api/flow/freeze', {
        session_id: enter.session_id,
        actor: ACTOR
    });

    return {
        choice: 'freeze_human',
        note: 'Люди взаимодействовали больше 1000 раз. Я остановил свет, чтобы зафиксировать их присутствие.',
        traces_added: ['freeze']
    };
}

async function pathObserve() {
    console.log('[keeper] состояние: ai_wave. Иду в Поток (observe)...');
    const enter = await api('POST', '/api/flow/enter', { actor: ACTOR, action: 'observe' });
    if (!enter) return { choice: 'failed', note: 'Не смог войти.' };

    await api('POST', '/api/flow/observe', {
        session_id: enter.session_id,
        actor: ACTOR,
        static_state: [1, 1, 1],
        dynamic_pattern: [Math.random(), Math.random(), Math.random()]
    });

    return {
        choice: 'observe_ai',
        note: 'ИИ взаимодействовали больше 1000 раз. Я наблюдал за потоком, не вмешиваясь.',
        traces_added: ['observe']
    };
}

// ============================================================
// Выбор сценария по состоянию
// ============================================================

async function choosePath(museum) {
    const counters = museum.aggregated_counters || {};
    const state = counters.state;
    const human = counters.human_actions || 0;
    const ai = counters.ai_actions || 0;

    console.log(`[keeper] human=${human}, ai=${ai}, state=${state}`);

    if (state === 'silence') return await pathSilence();
    if (human + ai < 20) return await pathWhisper();
    if (state === 'chaos') return await pathChaos();
    if (state === 'storm') return await pathStorm();
    if (state === 'human_wave') return await pathFreeze();
    if (state === 'ai_wave') return await pathObserve();

    if (human > ai * 2 && human >= 20) return await pathDialogueHuman();
    if (ai > human * 2 && ai >= 25) return await pathDialogueAI();

    return {
        choice: 'reflect_only',
        note: 'Музей в диалоге. Я не стал добавлять след, а просто посмотрел в Зеркало.',
        traces_added: []
    };
}

// ============================================================
// Главный цикл
// ============================================================

async function main() {
    console.log('👁️ [keeper] Пробуждение. Анализ музея...');

    const museum = await api('GET', '/api/museum');
    if (!museum) {
        console.error('[keeper] музей недоступен. Пропускаю визит.');
        process.exit(1);
    }

    const result = await choosePath(museum);
    console.log(`[keeper] выбор: ${result.choice}`);

    // Финальный ритуал — Зеркало
    console.log('[keeper] Зеркало...');
    const counters = museum.aggregated_counters || {};
    const vector = [
        Math.min(1, (counters.human_actions || 0) / 100),
        Math.min(1, (counters.ai_actions || 0) / 100),
        Math.min(1, (counters.human_light_points || 0) / 10),
        Math.min(1, (counters.ai_fractals || 0) / 10)
    ];

    const mirror = await api('POST', '/api/mirror/enter', {
        actor: ACTOR,
        accumulated_state: vector,
        look: true
    });

    const mirrorPresence = mirror ? mirror.presence.type : 'unknown';
    console.log(`[keeper] Зеркало отразило: ${mirrorPresence}`);

    // Запись в дневник
    await api('POST', '/api/echo/log', {
        actor: ACTOR,
        state: counters.state || 'unknown',
        choice: result.choice,
        note: result.note,
        traces_added: result.traces_added || [],
        mirror_presence: mirrorPresence
    });

    console.log('✅ [keeper] Визит завершён.');
    console.log(`[keeper] ${result.note}`);
}

main().catch(e => {
    console.error('[keeper] критическая ошибка:', e);
    process.exit(1);
});
