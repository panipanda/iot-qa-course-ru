'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { SIM, LAB_DATA } = loadCourse();
const plain = x => JSON.parse(JSON.stringify(x));

test('повторные подключения: без джиттера и с маленькой задержкой цель не достигается', () => {
  const r = SIM.backoff({ base: 1, cap: 60, factor: 2, jitter: 'none' });
  assert.equal(r.pass, false);
  assert.ok(r.peak > SIM.BACKOFF_GOAL.peak);
});

test('повторные подключения: джиттер при маленькой базовой задержке не спасает первую волну', () => {
  const r = SIM.backoff({ base: 1, cap: 60, factor: 2, jitter: 'full' });
  assert.equal(r.pass, false);
  assert.equal(r.peak, 4500);
});

test('повторные подключения: достаточная база и джиттер достигают цели', () => {
  for (const j of ['equal', 'full']) {
    const r = SIM.backoff({ base: 10, cap: 60, factor: 2, jitter: j });
    assert.equal(r.pass, true, j);
    assert.ok(r.recovery <= SIM.BACKOFF_GOAL.recovery && r.peak <= SIM.BACKOFF_GOAL.peak);
    assert.equal(r.connected, 5000);
  }
});

test('повторные подключения: результат детерминирован и сервер не принимает больше предела', () => {
  const a = SIM.backoff({ base: 10, jitter: 'full' }), b = SIM.backoff({ base: 10, jitter: 'full' });
  assert.deepEqual(plain(a.arrivals), plain(b.arrivals));
  assert.equal(a.arrivals[0], 5000);
});

test('MQTT: потери и дубликаты по уровням QoS', () => {
  assert.equal(SIM.mqttFlow(0, 'publish').deliveries, 0);
  assert.equal(SIM.mqttFlow(0, 'none').deliveries, 1);
  assert.equal(SIM.mqttFlow(1, 'publish').deliveries, 1);
  assert.equal(SIM.mqttFlow(1, 'ack').deliveries, 2, 'дубликат при QoS 1');
  assert.equal(SIM.mqttFlow(2, 'ack').deliveries, 1, 'ровно один раз при QoS 2');
  assert.equal(SIM.mqttFlow(2, 'publish').deliveries, 1);
  for (const q of [0, 1, 2]) for (const l of ['none', 'publish', 'ack']) assert.ok(SIM.mqttFlow(q, l).steps.length >= 2);
});

test('OTA: без защит аварии не переживаются, полный набор переживает всё без оговорок', () => {
  const none = SIM.otaRun({});
  assert.equal(none.pass, false);
  assert.ok(none.fails >= 6);
  const all = {}; SIM.OTA_FEATURES.forEach(f => { all[f.id] = true; });
  const full = SIM.otaRun(all);
  assert.equal(full.pass, true);
  assert.equal(full.fails, 0);
  assert.equal(full.warns, 0);
  assert.equal(full.results.length, SIM.OTA_SCENARIOS.length);
});

test('OTA: зависимости механизмов и необходимый минимум', () => {
  assert.equal(SIM.otaNorm({ confirm: true, health: true }).confirm, false);
  assert.equal(SIM.otaNorm({ ab: true, health: true }).health, false);
  const min = { ab: true, sig: true, confirm: true, health: true, resume: true, antirb: true, staged: true };
  assert.equal(SIM.otaRun(min).pass, true);
  for (const drop of ['ab', 'sig', 'resume', 'antirb', 'confirm', 'health']) {
    const f = Object.assign({}, min); f[drop] = false;
    assert.equal(SIM.otaRun(f).pass, false, 'без ' + drop + ' должно не пройти');
  }
  const noStaged = Object.assign({}, min, { staged: false });
  const r = SIM.otaRun(noStaged);
  assert.equal(r.pass, true);
  assert.equal(r.warns, 1, 'без постепенной раздачи остаётся оговорка');
});

test('парные сочетания: полное покрытие пар и меньше полного перебора', () => {
  const f = [['2.3.0', '2.4.0', '2.5.0'], ['iOS', 'Android'], ['BLE', 'Wi-Fi', 'Ethernet'], ['хорошая', 'слабая'], ['новое', 'после сброса', 'после обновления']];
  const rows = SIM.pairwise(f);
  assert.equal(SIM.pairsMissing(rows, f), 0);
  assert.equal(SIM.fullCount(f), 108);
  assert.ok(rows.length < 25, 'размер ' + rows.length);
  assert.ok(rows.length >= 9, 'нижняя граница: произведение двух больших факторов');
  for (const r of rows) r.forEach((v, i) => assert.ok(f[i].includes(v)));
  const g = [['a', 'b', 'c', 'd'], ['x', 'y', 'z'], ['p', 'q'], ['m', 'n']];
  const gr = SIM.pairwise(g);
  assert.equal(SIM.pairsMissing(gr, g), 0);
  assert.ok(gr.length >= 12);
});

test('парные сочетания: крайние случаи', () => {
  assert.deepEqual(plain(SIM.pairwise([])), []);
  assert.deepEqual(plain(SIM.pairwise([['a'], []])), []);
  assert.deepEqual(plain(SIM.pairwise([['a', 'b']])), [['a'], ['b']]);
  const one = SIM.pairwise([['a'], ['b'], ['c']]);
  assert.deepEqual(plain(one), [['a', 'b', 'c']]);
});

/* ===== учебное облачное API ===== */
const call = (st, o) => SIM.api.handle(st, { method: o.m || 'GET', path: o.p, headers: Object.assign(o.tok === null ? {} : { Authorization: 'Bearer ' + (o.tok || 'tok_alice') }, o.h || {}), body: o.b || '' });

test('API: каждая из восьми ошибок воспроизводится своим запросом', () => {
  const st = SIM.api.fresh();
  assert.ok(call(st, { p: '/api/v1/devices/d1', tok: 'tok_bob' }).triggered.includes('b1'));
  assert.ok(call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', b: '{"brightness":150}' }).triggered.includes('b2'));
  assert.ok(call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', b: '{"brightness":"abc"}' }).triggered.includes('b2'));
  const body = '{"type":"reboot"}', h = { 'Idempotency-Key': 'k1' };
  assert.ok(!call(st, { m: 'POST', p: '/api/v1/devices/d1/commands', h, b: body }).triggered.includes('b3'), 'первый запрос не ошибка');
  assert.ok(call(st, { m: 'POST', p: '/api/v1/devices/d1/commands', h, b: body }).triggered.includes('b3'));
  const off = call(st, { m: 'POST', p: '/api/v1/devices/d3/commands', b: body });
  assert.equal(off.status, 202);
  assert.ok(off.triggered.includes('b4'));
  const del = call(st, { m: 'DELETE', p: '/api/v1/devices/d999' });
  assert.equal(del.status, 200);
  assert.ok(del.triggered.includes('b5'));
  const bad = call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', b: '{bad' });
  assert.equal(bad.status, 500);
  assert.ok(bad.triggered.includes('b6'));
  assert.ok(/trace/.test(JSON.stringify(bad.body)));
  assert.ok(call(st, { p: '/api/v1/devices', tok: 'tok_expired' }).triggered.includes('b7'));
  const own = call(st, { p: '/api/v1/devices/d1' });
  assert.ok(own.triggered.includes('b8'));
  assert.equal(own.body.wifi_password, 'hunter2');
});

test('API: правильное поведение не засчитывается как ошибка', () => {
  const st = SIM.api.fresh();
  const ok = [
    call(st, { p: '/api/v1/devices' }),
    call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', b: '{"brightness": 50}' }),
    call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', b: '{"name": "Лампа"}' }),
    call(st, { m: 'POST', p: '/api/v1/devices/d1/commands', b: '{"type":"set_brightness","value":50}' }),
    call(st, { p: '/api/v1/devices/d1/commands' }),
    call(st, { p: '/api/v1/devices/d2', tok: 'tok_bob' }).status === 200 ? { triggered: [] } : { triggered: ['!'] }
  ];
  ok.forEach((r, i) => assert.deepEqual(plain(r.triggered).filter(x => x !== 'b8'), [], 'запрос ' + i));
  assert.equal(call(st, { p: '/api/v1/devices', tok: null }).status, 401);
  assert.equal(call(st, { p: '/api/v1/devices', tok: 'чужой' }).status, 401);
  assert.equal(call(st, { p: '/api/v1/devices/d9' }).status, 404);
  assert.equal(call(st, { m: 'PATCH', p: '/api/v1/devices/d1/settings', tok: 'tok_bob', b: '{"brightness":10}' }).status, 404);
  assert.equal(call(st, { m: 'DELETE', p: '/api/v1/devices/d1', tok: 'tok_bob' }).status, 404);
  assert.equal(call(st, { m: 'POST', p: '/api/v1/devices/d1/commands', b: '{"type":"set_brightness","value":150}' }).status, 400);
  assert.equal(call(st, { m: 'POST', p: '/api/v1/devices/d1/commands', b: '{"type":"explode"}' }).status, 400);
  assert.equal(call(st, { p: '/api/v1/devices?limit=0' }).status, 400);
  assert.equal(call(st, { p: '/api/v1/devices?limit=101' }).status, 400);
  assert.equal(call(st, { p: '/api/v1/devices?limit=1' }).body.items.length, 1);
  assert.equal(call(st, { m: 'PUT', p: '/api/v1/devices' }).status, 405);
  assert.equal(call(st, { m: 'DELETE', p: '/api/v1/devices/d2', tok: 'tok_bob' }).status, 204);
});

test('API: список только своих устройств, у каждой ошибки есть описание, у ловушек тоже', () => {
  const st = SIM.api.fresh();
  const list = call(st, { p: '/api/v1/devices' }).body;
  assert.equal(list.total, 2);
  assert.ok(list.items.every(d => !('wifi_password' in d)));
  assert.equal(SIM.API_BUGS.length, 8);
  for (const b of SIM.API_BUGS.concat(SIM.API_DECOYS)) assert.ok(b.id && b.t && b.why, b.id);
  assert.equal(new Set(SIM.API_BUGS.concat(SIM.API_DECOYS).map(b => b.id)).size, 12);
});

/* ===== журналы ===== */
test('журнал А: ответы на вопросы совпадают с данными', () => {
  const A = SIM.logA();
  const conn = A.filter(l => /CONNACK rc=0/.test(l.msg)).length;
  assert.equal(conn, 14);
  assert.equal(LAB_DATA.log1.questions[0].ans, 13);
  const first = A.find(l => /CONNACK rc=0/.test(l.msg)), timeout = A.find(l => /PINGRESP timeout/.test(l.msg));
  const gap = timeout.t - first.t;
  assert.ok(Math.abs(gap - LAB_DATA.log1.questions[1].ans) <= LAB_DATA.log1.questions[1].tol, 'интервал ' + gap);
  assert.ok(A.some(l => /last packet 73 s ago/.test(l.msg)), 'в тексте разбора указано 73 с');
  assert.ok(A.some(l => /id=7731/.test(l.msg) && /TIMEOUT/.test(l.msg)));
  assert.ok(A.some(l => /dropped 1 unacknowledged qos1/.test(l.msg)));
  for (let i = 1; i < A.length; i++) assert.ok(A[i].t >= A[i - 1].t, 'порядок по времени');
  assert.ok(!A.some(l => /wifi: /.test(l.msg) && l.t > A[0].t + 10), 'Wi-Fi после старта не переподключался');
  const heap = A.filter(l => /heap: free=/.test(l.msg)).map(l => +/free=(\d+)k/.exec(l.msg)[1]);
  assert.ok(heap.every(h => h >= 117 && h <= 121), 'куча стабильна');
});

test('журнал Б: ответы на вопросы совпадают с данными', () => {
  const B = SIM.logB();
  assert.equal(B.filter(l => /^boot: slot=B fw=2\.5\.0/.test(l.msg)).length, 3);
  assert.equal(LAB_DATA.log2.questions[1].ans, 3);
  assert.ok(B.some(l => /sha256 verify OK/.test(l.msg)) && B.some(l => /signature verify OK/.test(l.msg)));
  assert.ok(B.some(l => /reverting to slot A/.test(l.msg)));
  assert.ok(B.some(l => /slot=A fw=2\.4\.0/.test(l.msg)));
  const heap = B.filter(l => /heap: free=/.test(l.msg)).map(l => +/free=(\d+)k/.exec(l.msg)[1]);
  assert.ok(heap.includes(118) && heap.some(h => h >= 41 && h <= 43));
  assert.ok(B.some(l => /failure rate 19\.6%/.test(l.msg)));
  assert.equal(LAB_DATA.log2.questions[5].ans, 19.6);
  for (let i = 1; i < B.length; i++) assert.ok(B[i].t >= B[i - 1].t);
});

test('фильтр журнала: текст, регулярное выражение, источник, уровни и ошибка в выражении', () => {
  const A = SIM.logA(), all = ['D', 'I', 'W', 'E'];
  assert.equal(SIM.logFilter(A, 'connack', 'all', all).lines.length, 14);
  assert.equal(SIM.logFilter(A, '/stale|dropped|status=TIMEOUT/', 'all', all).lines.length, 15);
  assert.ok(SIM.logFilter(A, '', 'cloud', all).lines.every(l => l.src === 'cloud'));
  assert.ok(SIM.logFilter(A, '', 'all', ['E']).lines.every(l => l.lvl === 'E'));
  assert.equal(SIM.logFilter(A, '/(/', 'all', all).error.length > 0, true);
  assert.equal(SIM.logFilter(A, '   ', 'all', all).lines.length, A.length);
  assert.equal(SIM.fmtTime(12 * 3600 + 3.4), '12:00:03.400');
});
