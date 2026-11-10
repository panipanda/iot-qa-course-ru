'use strict';
/* Большие тренажёры практикума: MQTT, повторные подключения, OTA, парные комбинации, облачное API, разбор логов.
   Модели находятся в js/sim.js, тексты заданий в content/ru/labs.js. Результаты заданий хранятся в state.lab. */

function labSave(id, d, ok) {
  const o = state.lab[id] || {};
  const e = { ok: (ok || o.ok) ? 1 : 0, ts: Date.now() };
  const dd = d != null ? String(d).slice(0, LIMITS.lab) : o.d;
  if (dd != null) e.d = dd;
  state.lab[id] = e;
  touch();
  if (ok) renderChrome();
}
const labState = id => state.lab[id] || {};
const labStatus = id => labState(id).ok ? '<span class="pill ok">задание выполнено</span>' : '<span class="pill hold">цель не достигнута</span>';

/* ===== MQTT: потеря пакета при разных QoS ===== */
WIDGETS['mqtt-qos'] = {
  title: 'Потеря пакета при разных QoS', tag: 'тренажёр',
  init(b) {
    const a = uid('mq'), c = uid('mq');
    b.innerHTML = `<p class="src" style="margin-top:0">Выберите уровень доставки и то, что теряется в сети, и посмотрите, сколько раз сообщение дойдёт до приложения получателя.</p>
    <div class="row"><div class="field"><label for="${a}">Уровень QoS</label><select id="${a}"><option value="0">0: не более одного раза</option><option value="1" selected>1: хотя бы один раз</option><option value="2">2: ровно один раз</option></select></div>
    <div class="field"><label for="${c}">Что потерялось в сети</label><select id="${c}"><option value="none">Ничего</option><option value="publish">Само сообщение (первый PUBLISH)</option><option value="ack">Подтверждение получателя</option></select></div></div><div data-out="1"></div>`;
    const draw = () => {
      const r = SIM.mqttFlow(+$('#' + a, b).value, $('#' + c, b).value);
      $('[data-out]', b).innerHTML = `<ol class="seq">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol><div class="fb ${r.deliveries === 1 ? 'ok' : 'bad'}"><b>Приложению получателя доставлено раз: ${r.deliveries}.</b> ${esc(r.note)}</div>`;
    };
    b.addEventListener('change', draw);
    draw();
  }
};

/* ===== повторные подключения: подбор параметров ===== */
function backoffChart(r) {
  const g = SIM.BACKOFF_GOAL;
  const W = r.recovery !== null ? Math.min(240, Math.max(40, r.recovery + 10)) : 240;
  const yMax = Math.max(r.peak, g.peak * 1.3, r.capacity * 1.3);
  const w = 640, h = 200, pl = 46, pr = 8, pt = 10, pb = 26, bw = (w - pl - pr) / W;
  const X = t => pl + (t - 1) * bw, Y = v => pt + (h - pt - pb) * (1 - Math.min(v, yMax) / yMax);
  let bars = '';
  for (let t = 1; t <= W; t++) { const v = r.arrivals[t]; if (v > 0) bars += `<rect x="${X(t).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${Math.max(1, bw - 0.6).toFixed(1)}" height="${(h - pb - Y(v)).toFixed(1)}" fill="var(--accent)"/>`; }
  const hline = (v, color, label) => `<line x1="${pl}" x2="${w - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${w - pr - 2}" y="${(Y(v) - 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${color}">${label}</text>`;
  let ticks = '';
  for (let i = 0; i <= 4; i++) { const t = Math.round(1 + (W - 1) * i / 4); ticks += `<text x="${X(t).toFixed(1)}" y="${h - 8}" font-size="11" text-anchor="middle" fill="var(--muted)">${t} с</text>`; }
  const yl = [0, Math.round(yMax / 2), Math.round(yMax)].map(v => `<text x="${pl - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="var(--muted)">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Число попыток подключения в секунду" style="width:100%;height:auto;max-width:640px;display:block"><line x1="${pl}" x2="${w - pr}" y1="${h - pb}" y2="${h - pb}" stroke="var(--rule)"/>${bars}${hline(r.capacity, 'var(--good)', 'сервер принимает ' + r.capacity + ' в с')}${hline(g.peak, 'var(--bad)', 'допустимый пик ' + g.peak + ' в с')}${yl}${ticks}</svg>`;
}
WIDGETS['lab-backoff'] = {
  title: 'Повторные подключения после сбоя облака', tag: 'задание',
  init(b) {
    const g = SIM.BACKOFF_GOAL, I = { base: uid('bo'), cap: uid('bo'), f: uid('bo'), j: uid('bo') };
    const saved = (labState('backoff').d || '').split('/');
    const val = (i, def) => { const n = parseFloat(saved[i]); return isFinite(n) ? n : def; };
    const sj = ['none', 'equal', 'full'].includes(saved[3]) ? saved[3] : 'none';
    b.innerHTML = `<p class="src" style="margin-top:0">Облако было недоступно, и 5000 устройств одновременно пробуют подключиться в нулевую секунду. Сервер принимает не больше 500 подключений в секунду, остальные получают отказ и повторяют попытку. Задержка перед следующей попыткой равна min(предел, базовая × множитель в степени номера попытки), затем применяется джиттер: «половинный» даёт половину расчётной задержки плюс случайную часть, «полный» случайное значение от нуля до расчётной задержки. Модель упрощена: отказ мгновенный, сервер под нагрузкой не деградирует. <b>Цель:</b> все устройства подключены не позже чем через ${g.recovery} с, и в любую секунду после первой на сервер приходит не больше ${g.peak} попыток.</p>
    <div class="row">
      <div class="field"><label for="${I.base}">Базовая задержка: <output data-o="base"></output></label><input type="range" id="${I.base}" min="1" max="30" step="1" value="${val(0, 1)}"></div>
      <div class="field"><label for="${I.cap}">Предел: <output data-o="cap"></output></label><input type="range" id="${I.cap}" min="10" max="600" step="10" value="${val(1, 60)}"></div>
      <div class="field"><label for="${I.f}">Множитель: <output data-o="f"></output></label><input type="range" id="${I.f}" min="1.5" max="3" step="0.5" value="${val(2, 2)}"></div>
      <div class="field"><label for="${I.j}">Джиттер</label><select id="${I.j}"><option value="none">Нет</option><option value="equal">Половинный</option><option value="full">Полный</option></select></div>
    </div><div data-out="1"></div>`;
    $('#' + I.j, b).value = sj;
    const run = save => {
      const p = { base: +$('#' + I.base, b).value, cap: +$('#' + I.cap, b).value, factor: +$('#' + I.f, b).value, jitter: $('#' + I.j, b).value };
      $('[data-o="base"]', b).textContent = p.base + ' с'; $('[data-o="cap"]', b).textContent = p.cap + ' с'; $('[data-o="f"]', b).textContent = p.factor;
      const r = SIM.backoff(p);
      const recTxt = r.recovery === null ? 'не за ' + r.horizon + ' с' : r.recovery + ' с';
      $('[data-out]', b).innerHTML = backoffChart(r) + `<p class="src">Нулевая секунда (все ${r.n} устройств сразу) на графике не показана.</p>
      <div class="row"><span class="score">Все подключены: ${recTxt}</span><span class="score">Пик попыток: ${r.peak} в с</span><span class="score">Всего попыток: ${r.requests}</span></div>
      <div class="fb ${r.pass ? 'ok' : 'bad'}"><b>${r.pass ? 'Цель достигнута.' : 'Цель не достигнута.'}</b> ${r.pass ? 'Нагрузка размазана по времени, сервер успевает принимать подключения.' : (r.peak > g.peak ? 'Попытки устройств слипаются в пики: первая же повторная попытка приходит почти одновременно от всех отказанных.' : 'Устройства подключаются слишком медленно.')}</div>`;
      if (save === true) labSave('backoff', [p.base, p.cap, p.factor, p.jitter].join('/'), r.pass);
    };
    b.addEventListener('input', () => run(true)); b.addEventListener('change', () => run(true));
    run(false);
  }
};

/* ===== OTA: набор механизмов против набора аварий ===== */
WIDGETS['lab-ota'] = {
  title: 'Проектирование OTA: переживите девять аварий', tag: 'задание',
  init(b) {
    const chosen = new Set((labState('ota').d || '').split(',').filter(x => SIM.OTA_FEATURES.some(f => f.id === x)));
    b.innerHTML = `<p class="src" style="margin-top:0">Включайте механизмы защиты и смотрите, какие аварии устройство переживёт. <b>Цель:</b> ни одна авария не должна заканчиваться «кирпичом», чужой прошивкой, недоступным устройством или массовым сбоем. Подтверждение версии требует двух слотов, подтверждение через облако требует подтверждения версии.</p>
    <div data-feat="1"></div><div data-out="1"></div>`;
    const feat = $('[data-feat]', b);
    feat.innerHTML = SIM.OTA_FEATURES.map(f => `<label class="chk"><input type="checkbox" data-f="${f.id}"><span><b>${f.t}.</b> ${f.d}</span></label>`).join('');
    const draw = save => {
      const f = {}; $$('[data-f]', b).forEach(x => { f[x.dataset.f] = x.checked; });
      const n = SIM.otaNorm(f);
      $$('[data-f]', b).forEach(x => { x.checked = !!n[x.dataset.f]; });
      const ab = $('[data-f="ab"]', b).checked, cf = $('[data-f="confirm"]', b).checked;
      $('[data-f="confirm"]', b).disabled = !ab; $('[data-f="health"]', b).disabled = !cf;
      const r = SIM.otaRun(n);
      const pill = l => `<span class="pill ${l === 'ok' ? 'ok' : l === 'warn' ? 'hold' : 'bad'}">${l === 'ok' ? 'переживёт' : l === 'warn' ? 'с оговоркой' : 'авария'}</span>`;
      $('[data-out]', b).innerHTML = `<div class="tbl"><table><thead><tr><th>Авария</th><th>Итог</th><th>Что происходит</th></tr></thead><tbody>${r.results.map(x => `<tr><td>${x.t}</td><td>${pill(x.level)}</td><td>${x.text}</td></tr>`).join('')}</tbody></table></div>
      <div class="fb ${r.pass ? 'ok' : 'bad'}"><b>${r.pass ? 'Цель достигнута.' : 'Не пережито аварий: ' + r.fails + '.'}</b> ${r.pass ? (r.warns ? 'Оговорки остаются: их можно убрать дополнительными механизмами.' : 'Все аварии пережиты без оговорок.') : 'Включите механизмы, которые закрывают красные строки.'}</div>`;
      if (save === true) labSave('ota', SIM.OTA_FEATURES.filter(x => n[x.id]).map(x => x.id).join(',') || '-', r.pass);
    };
    chosen.forEach(id => { const el = $('[data-f="' + id + '"]', b); if (el) el.checked = true; });
    feat.addEventListener('change', () => draw(true));
    draw(false);
  }
};

/* ===== парные комбинации ===== */
WIDGETS.pairwise = {
  title: 'Парные комбинации: сколько тестов на самом деле нужно', tag: 'расчёт',
  init(b) {
    const id = uid('pw');
    b.innerHTML = `<p class="src" style="margin-top:0">По одному фактору на строке: «Название: значение, значение». Калькулятор покажет размер полного перебора и набор, в котором каждая пара значений любых двух факторов встречается хотя бы раз.</p>
    <div class="field"><label for="${id}">Факторы</label><textarea id="${id}" spellcheck="false" style="min-height:130px">Прошивка: 2.3.0, 2.4.0, 2.5.0
Приложение: iOS, Android
Связь: BLE, Wi-Fi, Ethernet
Сеть: хорошая, слабая
Состояние устройства: новое, после сброса, после обновления</textarea></div>
    <div class="row"><button class="btn" type="button" data-go="1">Построить набор</button></div><div data-out="1"></div>`;
    const go = () => {
      const lines = $('#' + id, b).value.split('\n').map(x => x.trim()).filter(Boolean);
      const names = [], vals = [];
      for (const l of lines) {
        const i = l.indexOf(':'); if (i < 1) continue;
        const v = l.slice(i + 1).split(',').map(x => x.trim()).filter(Boolean);
        if (v.length) { names.push(l.slice(0, i).trim()); vals.push(Array.from(new Set(v))); }
      }
      const out = $('[data-out]', b);
      if (names.length < 2) { out.innerHTML = '<div class="fb info">Нужно минимум два фактора, каждый хотя бы с одним значением.</div>'; return; }
      if (names.length > 8 || vals.some(v => v.length > 8)) { out.innerHTML = '<div class="fb info">Не больше 8 факторов и 8 значений в каждом.</div>'; return; }
      const rows = SIM.pairwise(vals), full = SIM.fullCount(vals);
      out.innerHTML = `<div class="row"><span class="score">Полный перебор: ${full}</span><span class="score">Парный набор: ${rows.length}</span><span class="score">Экономия: ${Math.round((1 - rows.length / full) * 100)}%</span></div>
      <div class="tbl"><table><thead><tr><th>№</th>${names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="src">Покрытие пар проверено: непокрытых пар ${SIM.pairsMissing(rows, vals)}. Набор построен жадным алгоритмом, он близок к минимальному, но не обязательно минимален.</p>`;
    };
    $('[data-go]', b).onclick = go;
    go();
  }
};

/* ===== облачное API: поиск ошибок ===== */
WIDGETS['lab-api'] = {
  title: 'Облачное API умных ламп: найдите ошибки', tag: 'задание',
  init(b) {
    const I = { tok: uid('ap'), m: uid('ap'), p: uid('ap'), h: uid('ap'), body: uid('ap'), pre: uid('ap'), claim: uid('ap') };
    let st = SIM.api.fresh();
    const reproduced = new Set(), hist = [];
    const found = new Set((labState('api').d || '').split(',').filter(x => SIM.API_BUGS.some(bg => bg.id === x)));
    const all = SIM.API_BUGS.concat(SIM.API_DECOYS);
    const order = ['b3', 'x2', 'b7', 'b1', 'x4', 'b5', 'b8', 'x1', 'b2', 'b6', 'x3', 'b4'].map(k => all.find(x => x.id === k));
    const presets = [
      ['Список устройств Alice', 'tok_alice', 'GET', '/api/v1/devices', '', ''],
      ['Устройство d1 (Alice)', 'tok_alice', 'GET', '/api/v1/devices/d1', '', ''],
      ['Изменить яркость d1', 'tok_alice', 'PATCH', '/api/v1/devices/d1/settings', '', '{"brightness": 60}'],
      ['Команда reboot для d1', 'tok_alice', 'POST', '/api/v1/devices/d1/commands', 'Idempotency-Key: k-001', '{"type": "reboot"}'],
      ['Команда reboot для d3', 'tok_alice', 'POST', '/api/v1/devices/d3/commands', '', '{"type": "reboot"}'],
      ['Удалить устройство d2 (Bob)', 'tok_bob', 'DELETE', '/api/v1/devices/d2', '', '']
    ];
    const status = { 200: 'OK', 202: 'Accepted', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 500: 'Internal Server Error' };
    b.innerHTML = `<div class="prose"><p style="margin-top:0">Перед вами работающая учебная копия облачного API умных ламп. В ней заложено <b>8 ошибок</b>, ещё несколько мест работают правильно. Отправляйте запросы, сравнивайте ответы со спецификацией и заявляйте найденные ошибки: засчитывается только то, что вы воспроизвели запросом в этой сессии. Области для проверки: права доступа, границы и типы значений, повторная отправка, состояние устройства, удаление, некорректный ввод, срок жизни токена, содержимое ответов.</p></div>
    <details><summary>Спецификация API</summary><div class="prose">
    <p>Все запросы с заголовком <code>Authorization: Bearer &lt;токен&gt;</code>. Токены: <code>tok_alice</code>, <code>tok_bob</code> и <code>tok_expired</code> (токен Alice, срок которого истёк). Устройства: d1 (Alice, онлайн), d3 (Alice, офлайн), d2 (Bob, онлайн). Ошибки возвращаются в виде <code>{"error": "код", "field": "...", "message": "..."}</code>.</p>
    ${tbl(['Запрос', 'Правила', 'Ответы'], [
      ['GET /api/v1/devices?limit=&amp;offset=', 'Только свои устройства. limit от 1 до 100 (по умолчанию 20), offset от 0.', '200 <code>{items, total}</code>; 400 validation_failed'],
      ['GET /api/v1/devices/{id}', 'Поля: id, name, fw, online, brightness. Чужое или несуществующее устройство недоступно.', '200; 404 not_found'],
      ['PATCH /api/v1/devices/{id}/settings', 'Тело: name (строка 1 до 40) и/или brightness (целое от 0 до 100). Только своё устройство.', '200 с устройством; 400; 404'],
      ['POST /api/v1/devices/{id}/commands', 'Тело: type (reboot или set_brightness), для set_brightness ещё value 0 до 100. Заголовок Idempotency-Key: повтор с тем же ключом не создаёт новую команду и возвращает прежнюю. Офлайн-устройству команда не отправляется.', '202 <code>{id, status}</code>; 400; 404; 409 device_offline'],
      ['GET /api/v1/devices/{id}/commands', 'Список команд устройства.', '200; 404'],
      ['DELETE /api/v1/devices/{id}', 'Удаляет своё устройство.', '204; 404'],
      ['Любой запрос', 'Без токена, с неизвестным токеном: 401. Просроченный токен: 401 token_expired. Тело не JSON: 400 invalid_json.', '']
    ])}</div></details>
    <div class="row" style="margin-top:8px"><div class="field"><label for="${I.pre}">Готовый запрос</label><select id="${I.pre}"><option value="">Выберите пример</option>${presets.map((p, i) => `<option value="${i}">${esc(p[0])}</option>`).join('')}</select></div></div>
    <div class="row">
      <div class="field" style="flex:2 1 200px"><label for="${I.tok}">Токен</label><input type="text" id="${I.tok}" value="tok_alice" list="${I.tok}-l" autocomplete="off" spellcheck="false"><datalist id="${I.tok}-l"><option value="tok_alice"><option value="tok_bob"><option value="tok_expired"></datalist></div>
      <div class="field" style="flex:0 0 120px;min-width:100px"><label for="${I.m}">Метод</label><select id="${I.m}"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option><option>DELETE</option></select></div>
      <div class="field" style="flex:4 1 260px"><label for="${I.p}">Путь</label><input type="text" id="${I.p}" value="/api/v1/devices" autocomplete="off" spellcheck="false"></div>
    </div>
    <div class="row">
      <div class="field"><label for="${I.h}">Дополнительные заголовки (по одному на строке)</label><textarea id="${I.h}" spellcheck="false" style="min-height:64px" placeholder="Idempotency-Key: k-001"></textarea></div>
      <div class="field"><label for="${I.body}">Тело запроса (JSON)</label><textarea id="${I.body}" spellcheck="false" style="min-height:64px" placeholder='{"brightness": 60}'></textarea></div>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn" type="button" data-a="send">Отправить</button><button class="btn ghost" type="button" data-a="reset">Сбросить данные API</button></div>
    <div data-resp="1"></div>
    <h3 style="font-size:.95rem">Заявить ошибку</h3>
    <div class="row"><div class="field" style="flex:3 1 300px"><label for="${I.claim}">Что вы нашли</label><select id="${I.claim}">${order.map(x => `<option value="${x.id}">${esc(x.t)}</option>`).join('')}</select></div><button class="btn" type="button" data-a="claim">Заявить</button></div>
    <div data-claim="1"></div><div data-found="1"></div>`;
    const resp = $('[data-resp]', b), claimOut = $('[data-claim]', b), foundOut = $('[data-found]', b);
    const drawFound = () => {
      foundOut.innerHTML = `<p class="score">Найдено ${found.size} из ${SIM.API_BUGS.length} ${labStatus('api')}</p>` + (found.size ? '<ul>' + SIM.API_BUGS.filter(x => found.has(x.id)).map(x => `<li><b>${esc(x.t)}.</b> ${esc(x.why)}</li>`).join('') + '</ul>' : '');
    };
    drawFound();
    const send = () => {
      const headers = {}, tok = $('#' + I.tok, b).value.trim();
      if (tok) headers.Authorization = 'Bearer ' + tok;
      $('#' + I.h, b).value.split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      const req = { method: $('#' + I.m, b).value, path: $('#' + I.p, b).value.trim(), headers, body: $('#' + I.body, b).value };
      let res;
      try { res = SIM.api.handle(st, req); } catch (e) { res = { status: 400, body: { error: 'bad_request' }, triggered: [] }; }
      res.triggered.forEach(x => reproduced.add(x));
      hist.unshift(req.method + ' ' + req.path + ' → ' + res.status);
      if (hist.length > 8) hist.pop();
      resp.innerHTML = `<div class="mono-box">HTTP ${res.status} ${status[res.status] || ''}\n${res.body === null ? '(пустое тело)' : esc(JSON.stringify(res.body, null, 2))}</div><details><summary>История запросов</summary><ul>${hist.map(h => `<li class="mono">${esc(h)}</li>`).join('')}</ul></details>`;
    };
    b.addEventListener('change', e => {
      if (e.target.id !== I.pre || e.target.value === '') return;
      const p = presets[+e.target.value];
      $('#' + I.tok, b).value = p[1]; $('#' + I.m, b).value = p[2]; $('#' + I.p, b).value = p[3]; $('#' + I.h, b).value = p[4]; $('#' + I.body, b).value = p[5];
      e.target.value = '';
    });
    b.addEventListener('click', e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'send') send();
      else if (a.dataset.a === 'reset') { st = SIM.api.fresh(); resp.innerHTML = '<div class="fb info">Данные API возвращены к исходным: устройства d1, d2, d3, команд нет.</div>'; }
      else if (a.dataset.a === 'claim') {
        const id = $('#' + I.claim, b).value, bug = SIM.API_BUGS.find(x => x.id === id), decoy = SIM.API_DECOYS.find(x => x.id === id);
        if (decoy) { claimOut.innerHTML = `<div class="fb info"><b>Это не ошибка.</b> ${esc(decoy.why)}</div>`; return; }
        if (found.has(id)) { claimOut.innerHTML = '<div class="fb info">Эта ошибка уже засчитана.</div>'; return; }
        if (!reproduced.has(id)) { claimOut.innerHTML = '<div class="fb bad"><b>Не подтверждено.</b> Ваши запросы в этой сессии не воспроизвели такое поведение. Либо этого дефекта нет, либо его нужно показать запросом: проверьте ещё раз и сравните ответ со спецификацией.</div>'; return; }
        found.add(id);
        labSave('api', Array.from(found).join(','), found.size === SIM.API_BUGS.length);
        claimOut.innerHTML = `<div class="fb ok"><b>Подтверждено.</b> ${esc(bug.t)}. ${esc(bug.why)}</div>`;
        drawFound();
      }
    });
    send();
  }
};

/* ===== разбор логов ===== */
function logHighlight(text, re) {
  if (!re) return esc(text);
  let out = '', last = 0, m; re.lastIndex = 0;
  while ((m = re.exec(text)) && m[0] !== '') { out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
  return out + esc(text.slice(last));
}
function mountLogLab(b, cfg) {
  const I = { q: uid('lg'), s: uid('lg') };
  b.innerHTML = `<div class="prose"><p style="margin-top:0">${cfg.intro}</p></div>
  <div class="row"><div class="field" style="flex:2 1 220px"><label for="${I.q}">Фильтр: текст или /регулярное выражение/</label><input type="text" id="${I.q}" placeholder="например: CONNACK или /panic|reboot/" autocomplete="off" spellcheck="false"></div>
  <div class="field"><label for="${I.s}">Источник</label><select id="${I.s}"><option value="all">Устройство и облако</option><option value="dev">Только устройство</option><option value="cloud">Только облако</option></select></div></div>
  <div class="row">${[['D', 'debug'], ['I', 'info'], ['W', 'warning'], ['E', 'error']].map(l => `<label class="chk"><input type="checkbox" data-lv="${l[0]}" checked><span>${l[1]}</span></label>`).join('')}<span class="score" data-count="1"></span></div>
  <div class="logbox" tabindex="0" role="region" aria-label="Журнал" data-log="1"></div>
  <h3 style="font-size:.95rem">Вопросы по журналу</h3><div data-qs="1"></div><div data-res="1"></div>`;
  const draw = () => {
    const q = $('#' + I.q, b).value, src = $('#' + I.s, b).value, levels = $$('[data-lv]', b).filter(x => x.checked).map(x => x.dataset.lv);
    const r = SIM.logFilter(cfg.lines, q, src, levels), s = q.trim();
    $('[data-count]', b).textContent = r.error ? r.error : `Строк: ${r.lines.length} из ${cfg.lines.length}`;
    let re = null;
    if (!r.error && s) { try { re = (s.length > 2 && s[0] === '/' && s[s.length - 1] === '/') ? new RegExp(s.slice(1, -1), 'gi') : new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); } catch (e) { re = null; } }
    $('[data-log]', b).innerHTML = r.lines.map(l => `<div class="ll l${l.lvl}">${logHighlight(SIM.logLine(l), re)}</div>`).join('') || '<div class="ll">Ничего не найдено</div>';
  };
  b.addEventListener('input', e => { if (e.target.id === I.q) draw(); });
  b.addEventListener('change', e => { if (e.target.id === I.s || e.target.dataset.lv) draw(); });
  draw();
  mountQuiz($('[data-qs]', b), cfg.questions, { id: cfg.id, persist: false, onFinish: (c, t) => {
    const ok = c / t >= 0.8;
    labSave(cfg.id, c + '/' + t, ok);
    $('[data-res]', b).innerHTML = `<div class="fb ${ok ? 'ok' : 'bad'}"><b>Результат: ${c} из ${t}.</b> ${ok ? 'Задание выполнено.' : 'Для зачёта нужно не меньше 80%. Вернитесь к журналу, найдите нужные строки фильтром и пройдите вопросы ещё раз.'}</div>`;
  } });
  if (labState(cfg.id).ok) $('[data-res]', b).innerHTML = '<div class="fb ok">Задание уже выполнено. Можно пройти ещё раз для повторения.</div>';
}
