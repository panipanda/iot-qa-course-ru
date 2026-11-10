'use strict';
/* Чистые учебные модели для тренажёров: повторные подключения после сбоя, потоки MQTT, OTA-обновление,
   парные комбинации, учебное облачное API с заложенными ошибками и генераторы логов.
   Без обращения к DOM: в браузере подключается обычным скриптом, в тестах Node через vm. */

const SIM = {};

/* Детерминированный генератор случайных чисел (mulberry32): одинаковые логи и графики при каждом открытии. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
SIM.rng = rng;

/* ===== повторные подключения после сбоя облака ===== */
/* Все устройства теряют связь одновременно и пробуют подключиться в нулевую секунду. Сервер принимает не больше
   capacity подключений в секунду, остальные получают отказ и повторяют попытку с задержкой. */
SIM.BACKOFF_GOAL = { recovery: 120, peak: 1000 };
SIM.backoff = function (p) {
  const o = Object.assign({ n: 5000, capacity: 500, base: 1, cap: 60, factor: 2, jitter: 'none', horizon: 600, seed: 7 }, p);
  const rand = rng(o.seed);
  const buckets = Array.from({ length: o.horizon + 1 }, () => []);
  buckets[0] = new Array(o.n).fill(0);
  const arrivals = new Array(o.horizon + 1).fill(0);
  let connected = 0, recovery = null;
  for (let t = 0; t <= o.horizon; t++) {
    const arr = buckets[t];
    arrivals[t] = arr.length;
    const ok = Math.min(arr.length, o.capacity);
    connected += ok;
    if (ok > 0 && connected >= o.n && recovery === null) recovery = t;
    for (let i = ok; i < arr.length; i++) {
      const k = arr[i];
      const d = Math.min(o.cap, o.base * Math.pow(o.factor, k));
      let w = d;
      if (o.jitter === 'full') w = rand() * d;
      else if (o.jitter === 'equal') w = d / 2 + rand() * d / 2;
      const t2 = t + Math.max(1, Math.round(w));
      if (t2 <= o.horizon) buckets[t2].push(k + 1);
    }
  }
  let peak = 0, requests = 0;
  for (let t = 0; t <= o.horizon; t++) { requests += arrivals[t]; if (t > 0 && arrivals[t] > peak) peak = arrivals[t]; }
  const g = SIM.BACKOFF_GOAL;
  return { arrivals, recovery, peak, requests, connected, n: o.n, capacity: o.capacity, horizon: o.horizon,
    pass: recovery !== null && recovery <= g.recovery && peak <= g.peak };
};

/* ===== потоки MQTT при потере пакета ===== */
/* loss: none, publish (потерян первый PUBLISH), ack (потерян первый ответ получателя). */
SIM.mqttFlow = function (qos, loss) {
  const s = [];
  let deliveries = 0, note = '';
  if (qos === 0) {
    if (loss === 'publish') { s.push('Отправитель: PUBLISH (QoS 0)', 'Сеть: пакет потерян', 'Отправитель не знает о потере и ничего не повторяет'); note = 'Сообщение потеряно без следа: так работает QoS 0 («не более одного раза»).'; }
    else { s.push('Отправитель: PUBLISH (QoS 0)', 'Получатель: сообщение доставлено приложению'); deliveries = 1; note = 'Подтверждений нет, поэтому потерю нельзя заметить.'; }
  } else if (qos === 1) {
    if (loss === 'publish') {
      s.push('Отправитель: PUBLISH (QoS 1, id=7)', 'Сеть: пакет потерян', 'Отправитель: нет PUBACK, повторяет PUBLISH с флагом DUP', 'Получатель: сообщение доставлено приложению', 'Получатель: PUBACK (id=7)');
      deliveries = 1; note = 'Потеря исправлена повтором. Доставлено один раз.';
    } else if (loss === 'ack') {
      s.push('Отправитель: PUBLISH (QoS 1, id=7)', 'Получатель: сообщение доставлено приложению', 'Получатель: PUBACK (id=7)', 'Сеть: PUBACK потерян', 'Отправитель: нет PUBACK, повторяет PUBLISH с флагом DUP', 'Получатель: сообщение доставлено приложению ещё раз', 'Получатель: PUBACK (id=7)');
      deliveries = 2; note = 'Дубликат: QoS 1 гарантирует «хотя бы один раз». Обработчик команд должен быть идемпотентным.';
    } else {
      s.push('Отправитель: PUBLISH (QoS 1, id=7)', 'Получатель: сообщение доставлено приложению', 'Получатель: PUBACK (id=7)');
      deliveries = 1; note = 'Без потерь доставлено один раз, но гарантии «ровно один раз» нет.';
    }
  } else {
    if (loss === 'publish') {
      s.push('Отправитель: PUBLISH (QoS 2, id=7)', 'Сеть: пакет потерян', 'Отправитель: нет PUBREC, повторяет PUBLISH с флагом DUP', 'Получатель: сохраняет сообщение, PUBREC (id=7)', 'Отправитель: PUBREL (id=7)', 'Получатель: сообщение доставлено приложению, PUBCOMP (id=7)');
      deliveries = 1;
    } else if (loss === 'ack') {
      s.push('Отправитель: PUBLISH (QoS 2, id=7)', 'Получатель: сохраняет сообщение, PUBREC (id=7)', 'Сеть: PUBREC потерян', 'Отправитель: нет PUBREC, повторяет PUBLISH с флагом DUP', 'Получатель: id=7 уже известен, второй копии не создаёт, снова отвечает PUBREC', 'Отправитель: PUBREL (id=7)', 'Получатель: сообщение доставлено приложению, PUBCOMP (id=7)');
      deliveries = 1;
    } else {
      s.push('Отправитель: PUBLISH (QoS 2, id=7)', 'Получатель: сохраняет сообщение, PUBREC (id=7)', 'Отправитель: PUBREL (id=7)', 'Получатель: сообщение доставлено приложению, PUBCOMP (id=7)');
      deliveries = 1;
    }
    note = 'Ровно один раз, но ценой четырёх сообщений вместо двух и большей задержки.';
  }
  return { steps: s, deliveries, note };
};

/* ===== OTA-обновление: набор механизмов против набора аварий ===== */
SIM.OTA_FEATURES = [
  { id: 'ab', t: 'Две копии прошивки (слоты A и B)', d: 'Новая версия пишется в неактивный слот, рабочая остаётся нетронутой.' },
  { id: 'sig', t: 'Проверка цифровой подписи образа', d: 'Загрузчик принимает только образы, подписанные ключом производителя. Подпись заодно защищает целостность.' },
  { id: 'hash', t: 'Проверка контрольной суммы образа', d: 'Сравнение хэша скачанного файла с указанным в манифесте.' },
  { id: 'confirm', t: 'Подтверждение новой версии и автооткат', d: 'Новая прошивка должна сама подтвердить, что работает. Иначе после нескольких неудачных запусков загрузчик возвращает старый слот. Требует двух слотов.' },
  { id: 'health', t: 'Подтверждение только после выхода на связь с облаком', d: 'Прошивка считается рабочей, когда подключилась к облаку, а не просто загрузилась. Требует подтверждения версии.' },
  { id: 'resume', t: 'Докачка образа с места обрыва', d: 'Загрузка продолжается после обрыва, а не начинается заново.' },
  { id: 'battery', t: 'Проверка заряда перед стартом', d: 'Обновление не начинается при низком заряде батареи.' },
  { id: 'antirb', t: 'Защита от отката на старую версию', d: 'Загрузчик не принимает образ с версией ниже допустимой (счётчик безопасности).' },
  { id: 'staged', t: 'Постепенная раздача по группам', d: 'Сначала 1% парка, потом больше, с возможностью остановить раздачу.' }
];
SIM.otaNorm = function (f) {
  const o = Object.assign({}, f);
  if (!o.ab) o.confirm = false;
  if (!o.confirm) o.health = false;
  return o;
};
SIM.OTA_SCENARIOS = [
  { id: 'o1', t: 'Питание пропало во время записи образа',
    run: f => f.ab ? ['ok', 'Рабочий слот не тронут, устройство загрузится со старой версией.'] : ['fail', 'Единственная копия прошивки повреждена, устройство не загрузится («кирпич»).'] },
  { id: 'o2', t: 'Обновление стартовало при заряде 8%',
    run: f => f.battery ? ['ok', 'Обновление не началось, пока заряд ниже порога.'] : f.ab ? ['ok', 'Питание могло пропасть, но рабочий слот цел: обновление просто повторится.'] : ['fail', 'Питание пропало во время записи, одной копии прошивки больше нет.'] },
  { id: 'o3', t: 'Образ повреждён при передаче (изменился один бит)',
    run: f => (f.sig || f.hash) ? ['ok', 'Проверка целостности отклонила образ до установки.'] : f.confirm ? ['warn', 'Образ установился, не запустился, и автооткат вернул старую версию. Сработало, но лучше отсечь заранее.'] : ['fail', 'Повреждённый образ установлен и не запускается, возврата нет.'] },
  { id: 'o4', t: 'Образ от постороннего источника (подмена сервера или файла)',
    run: f => f.sig ? ['ok', 'Подпись не совпала, образ отклонён.'] : ['fail', 'Контрольная сумма из того же манифеста ничего не доказывает: злоумышленник подменит оба. Устройство примет чужую прошивку.'] },
  { id: 'o5', t: 'В новой версии ошибка: устройство падает сразу после запуска',
    run: f => f.confirm ? ['ok', 'Версия не подтвердилась за заданное число запусков, загрузчик вернул старый слот.'] : ['fail', 'Устройство бесконечно перезагружается на сломанной версии.'] },
  { id: 'o6', t: 'Новая версия запускается, но не может подключиться к облаку (неверный адрес или сертификат)',
    run: f => f.health ? ['ok', 'Версия не вышла на связь, не подтвердилась и откатилась.'] : ['fail', 'Прошивка подтвердила себя фактом запуска. Устройство работает, но недоступно из облака и вернуть его можно только вручную.'] },
  { id: 'o7', t: 'Сервер предлагает старую версию с известной уязвимостью',
    run: f => f.antirb ? ['ok', 'Счётчик безопасности не позволил установить версию ниже допустимой.'] : ['fail', 'Устройство спокойно «обновилось» назад на уязвимую версию.'] },
  { id: 'o8', t: 'Слабая сотовая связь: загрузка 8 МБ обрывается каждые 2 МБ',
    run: f => f.resume ? ['ok', 'Загрузка продолжается с места обрыва и завершается.'] : ['fail', 'Каждая попытка начинается заново, образ не скачивается никогда.'] },
  { id: 'o9', t: 'Ошибка проявляется только на одной аппаратной ревизии (7% парка), раздача идёт на весь парк сразу',
    run: f => f.staged ? ['ok', 'Проблема нашлась на 1% парка, раздачу остановили.'] : (f.confirm && f.health) ? ['warn', 'Затронутые устройства откатятся сами, но раздача уже ушла всем: нагрузка и обращения в поддержку придут одновременно.'] : ['fail', 'Ошибка попала на все устройства ревизии и остановить раздачу нечем.'] }
];
SIM.otaRun = function (features) {
  const f = SIM.otaNorm(features);
  const res = SIM.OTA_SCENARIOS.map(s => { const r = s.run(f); return { id: s.id, t: s.t, level: r[0], text: r[1] }; });
  return { results: res, fails: res.filter(r => r.level === 'fail').length, warns: res.filter(r => r.level === 'warn').length, pass: res.every(r => r.level !== 'fail') };
};

/* ===== парные комбинации (all-pairs) ===== */
/* Жадный алгоритм: берёт ещё не покрытую пару значений как основу строки и добирает остальные факторы так,
   чтобы каждая строка покрывала как можно больше новых пар. */
SIM.pairwise = function (factors) {
  const n = factors.length;
  if (!n || factors.some(f => !f.length)) return [];
  if (n === 1) return factors[0].map(v => [v]);
  const key = (i, a, j, b) => i + ':' + a + '|' + j + ':' + b;
  const uncovered = new Set();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let a = 0; a < factors[i].length; a++) for (let b = 0; b < factors[j].length; b++) uncovered.add(key(i, a, j, b));
  const rows = [];
  while (uncovered.size) {
    const m = /^(\d+):(\d+)\|(\d+):(\d+)$/.exec(uncovered.values().next().value);
    const i = +m[1], a = +m[2], j = +m[3], b = +m[4];
    const row = new Array(n).fill(-1); row[i] = a; row[j] = b;
    for (let f = 0; f < n; f++) {
      if (row[f] !== -1) continue;
      let best = 0, bestScore = -1;
      for (let v = 0; v < factors[f].length; v++) {
        let sc = 0;
        for (let g = 0; g < n; g++) {
          if (row[g] === -1 || g === f) continue;
          if (g < f ? uncovered.has(key(g, row[g], f, v)) : uncovered.has(key(f, v, g, row[g]))) sc++;
        }
        if (sc > bestScore) { bestScore = sc; best = v; }
      }
      row[f] = best;
    }
    for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) uncovered.delete(key(x, row[x], y, row[y]));
    rows.push(row);
  }
  return rows.map(r => r.map((v, k) => factors[k][v]));
};
SIM.fullCount = factors => factors.reduce((a, f) => a * f.length, 1);
/* Сколько пар значений осталось непокрытыми (для проверки). */
SIM.pairsMissing = function (rows, factors) {
  let missing = 0;
  for (let i = 0; i < factors.length; i++) for (let j = i + 1; j < factors.length; j++) {
    for (const a of factors[i]) for (const b of factors[j]) if (!rows.some(r => r[i] === a && r[j] === b)) missing++;
  }
  return missing;
};

/* ===== учебное облачное API с заложенными ошибками ===== */
SIM.API_BUGS = [
  { id: 'b1', t: 'Пользователь может прочитать чужое устройство', why: 'Нет проверки владельца при чтении устройства. Должно быть 404 (или 403). Это одна из самых частых уязвимостей API: доступ к объекту по идентификатору без проверки прав.' },
  { id: 'b2', t: 'Яркость вне диапазона 0 до 100 принимается', why: 'Настройки не проверяются, хотя команда с той же яркостью проверяется. В прошивку уйдёт значение, которого она не ждёт. Должно быть 400 с указанием поля.' },
  { id: 'b3', t: 'Повтор команды с тем же Idempotency-Key выполняется дважды', why: 'Ключ идемпотентности игнорируется. При повторной отправке после обрыва связи команда создаётся заново. Должен вернуться тот же идентификатор команды.' },
  { id: 'b4', t: 'Команда офлайн-устройству получает успешный ответ', why: 'Ответ «доставлена» для устройства, которое недоступно, обманывает пользователя. Должно быть 409 device_offline либо честный статус queued.' },
  { id: 'b5', t: 'Удаление несуществующего устройства возвращает успех', why: 'Должно быть 404 not_found. Успешный ответ скрывает опечатки в идентификаторе и ошибки клиента.' },
  { id: 'b6', t: 'Некорректный JSON даёт 500 и раскрывает внутренние детали', why: 'Ошибка клиента должна быть 400 invalid_json. Трассировка стека в ответе раскрывает устройство сервера и пути к файлам.' },
  { id: 'b7', t: 'Просроченный токен принимается', why: 'Просроченный токен должен давать 401 token_expired. Иначе срок жизни токена ничего не защищает.' },
  { id: 'b8', t: 'В ответе есть поле, которого нет в спецификации (пароль Wi-Fi)', why: 'Ответ отдаёт лишние данные, включая секрет. В ответе должны быть только поля из спецификации. Проверять нужно не только статусы, но и тело ответа.' }
];
SIM.API_DECOYS = [
  { id: 'x1', t: 'Запрос без токена возвращает 401', why: 'Так и должно быть. Это правильное поведение.' },
  { id: 'x2', t: 'Запрос несуществующего устройства возвращает 404', why: 'Так и должно быть. Это правильное поведение.' },
  { id: 'x3', t: 'Изменение настроек чужого устройства запрещено', why: 'Так и должно быть: возвращается 404. Проверки владельца на изменение работают, в отличие от чтения.' },
  { id: 'x4', t: 'Список устройств показывает только свои устройства', why: 'Так и должно быть. Это правильное поведение.' }
];
SIM.api = {
  tokens: { tok_alice: { user: 'alice' }, tok_bob: { user: 'bob' }, tok_expired: { user: 'alice', expired: true } },
  fresh() {
    return {
      devices: {
        d1: { id: 'd1', owner: 'alice', name: 'Лампа в спальне', fw: '1.4.2', online: true, brightness: 40, wifi_password: 'hunter2' },
        d2: { id: 'd2', owner: 'bob', name: 'Лампа в кабинете', fw: '1.4.0', online: true, brightness: 70, wifi_password: 'qwerty99' },
        d3: { id: 'd3', owner: 'alice', name: 'Лампа на кухне', fw: '1.3.9', online: false, brightness: 10, wifi_password: 'hunter2' }
      },
      commands: [], keys: {}, seq: 100
    };
  },
  /* req: { method, path (с query), headers (объект), body (строка) }. Возвращает { status, body, triggered }. */
  handle(st, req) {
    const trig = [];
    const out = (status, body) => ({ status, body: body === undefined ? null : body, triggered: trig });
    const h = {}; Object.keys(req.headers || {}).forEach(k => { h[k.toLowerCase()] = String(req.headers[k]); });
    const method = String(req.method || 'GET').toUpperCase();
    const full = String(req.path || '');
    const qi = full.indexOf('?');
    const path = (qi >= 0 ? full.slice(0, qi) : full).replace(/\/+$/, '') || '/';
    const query = {};
    if (qi >= 0) full.slice(qi + 1).split('&').forEach(kv => { if (!kv) return; const e = kv.indexOf('='); const k = e >= 0 ? kv.slice(0, e) : kv; query[k] = e >= 0 ? decodeURIComponent(kv.slice(e + 1)) : ''; });

    const am = /^Bearer\s+(\S+)$/i.exec(h.authorization || '');
    if (!am) return out(401, { error: 'unauthorized' });
    const tok = SIM.api.tokens[am[1]];
    if (!tok) return out(401, { error: 'unauthorized' });
    if (tok.expired) trig.push('b7');
    const user = tok.user;

    const pub = d => ({ id: d.id, name: d.name, fw: d.fw, online: d.online, brightness: d.brightness });
    const readBody = () => {
      const raw = String(req.body || '').trim();
      if (!raw) return { ok: true, v: {} };
      try { const v = JSON.parse(raw); return { ok: true, v: (v && typeof v === 'object' && !Array.isArray(v)) ? v : null }; } catch (e) { return { ok: false }; }
    };
    const badJson = () => { trig.push('b6'); return out(500, { error: 'internal_error', trace: 'SyntaxError: Unexpected token in JSON at position 1\n    at JSON.parse (<anonymous>)\n    at parseBody (/srv/cloud-api/lib/http.js:42:19)\n    at handle (/srv/cloud-api/routes/devices.js:17:5)' }); };
    const isInt = v => typeof v === 'number' && Number.isInteger(v);

    if (path === '/api/v1/devices') {
      if (method !== 'GET') return out(405, { error: 'method_not_allowed' });
      let limit = 20, offset = 0;
      if ('limit' in query) { if (!/^\d+$/.test(query.limit) || +query.limit < 1 || +query.limit > 100) return out(400, { error: 'validation_failed', field: 'limit', message: 'limit: целое от 1 до 100' }); limit = +query.limit; }
      if ('offset' in query) { if (!/^\d+$/.test(query.offset)) return out(400, { error: 'validation_failed', field: 'offset', message: 'offset: целое от 0' }); offset = +query.offset; }
      const mine = Object.values(st.devices).filter(d => d.owner === user);
      return out(200, { items: mine.slice(offset, offset + limit).map(pub), total: mine.length });
    }
    let m = /^\/api\/v1\/devices\/([\w-]+)$/.exec(path);
    if (m) {
      const d = st.devices[m[1]];
      if (method === 'GET') {
        if (!d) return out(404, { error: 'not_found' });
        if (d.owner !== user) trig.push('b1');
        trig.push('b8');
        return out(200, Object.assign(pub(d), { wifi_password: d.wifi_password }));
      }
      if (method === 'DELETE') {
        if (!d) { trig.push('b5'); return out(200, { deleted: true }); }
        if (d.owner !== user) return out(404, { error: 'not_found' });
        delete st.devices[d.id];
        return out(204, null);
      }
      return out(405, { error: 'method_not_allowed' });
    }
    m = /^\/api\/v1\/devices\/([\w-]+)\/settings$/.exec(path);
    if (m) {
      if (method !== 'PATCH') return out(405, { error: 'method_not_allowed' });
      const d = st.devices[m[1]];
      if (!d || d.owner !== user) return out(404, { error: 'not_found' });
      const b = readBody();
      if (!b.ok) return badJson();
      if (!b.v || !('brightness' in b.v || 'name' in b.v)) return out(400, { error: 'validation_failed', message: 'нужно поле brightness или name' });
      if ('name' in b.v) {
        if (typeof b.v.name !== 'string' || b.v.name.length < 1 || b.v.name.length > 40) return out(400, { error: 'validation_failed', field: 'name', message: 'name: строка от 1 до 40 символов' });
        d.name = b.v.name;
      }
      if ('brightness' in b.v) {
        if (!isInt(b.v.brightness) || b.v.brightness < 0 || b.v.brightness > 100) trig.push('b2');
        d.brightness = b.v.brightness;
      }
      return out(200, pub(d));
    }
    m = /^\/api\/v1\/devices\/([\w-]+)\/commands$/.exec(path);
    if (m) {
      const d = st.devices[m[1]];
      if (!d || d.owner !== user) return out(404, { error: 'not_found' });
      if (method === 'GET') return out(200, { items: st.commands.filter(c => c.device === d.id).map(c => ({ id: c.id, type: c.type, value: c.value, status: c.status })) });
      if (method !== 'POST') return out(405, { error: 'method_not_allowed' });
      const b = readBody();
      if (!b.ok) return badJson();
      if (!b.v || !['reboot', 'set_brightness'].includes(b.v.type)) return out(400, { error: 'validation_failed', field: 'type', message: 'type: reboot или set_brightness' });
      if (b.v.type === 'set_brightness' && (!isInt(b.v.value) || b.v.value < 0 || b.v.value > 100)) return out(400, { error: 'validation_failed', field: 'value', message: 'value: целое от 0 до 100' });
      const idem = h['idempotency-key'];
      const kk = idem ? d.id + '|' + idem : '';
      if (kk && st.keys[kk]) trig.push('b3');
      if (!d.online) { trig.push('b4'); }
      const c = { id: 'c' + (++st.seq), device: d.id, type: b.v.type, value: b.v.value, status: d.online ? 'queued' : 'delivered' };
      st.commands.push(c);
      if (kk) st.keys[kk] = c.id;
      return out(202, { id: c.id, status: c.status });
    }
    return out(404, { error: 'not_found' });
  }
};

/* ===== генераторы логов для учебных разборов ===== */
const pad = (n, w) => String(n).padStart(w || 2, '0');
SIM.fmtTime = function (sec) {
  const ms = Math.round((sec % 1) * 1000), s = Math.floor(sec);
  return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + '.' + pad(ms, 3);
};
/* Журнал А: устройство периодически теряет связь с брокером MQTT. Причина в том, что промежуточное оборудование
   закрывает неактивное соединение быстрее, чем устройство отправляет пинг. */
SIM.logA = function () {
  const r = rng(11), L = [];
  const add = (t, src, lvl, msg) => L.push({ t, src, lvl, msg });
  const t = 12 * 3600;
  add(t, 'dev', 'I', 'boot: fw=2.3.1 reset_reason=POWERON');
  add(t + 2.1, 'dev', 'I', 'wifi: connected ssid=home-2g rssi=-58');
  add(t + 2.6, 'dev', 'I', 'dhcp: got ip 192.168.1.44 lease=86400s');
  let nextSensor = t + 15, cycle = 0, prevAt = null, cmdSentAt = 0;
  const connect = at => {
    add(at, 'dev', 'I', 'mqtt: CONNECT client=dev-ab12 clean_session=1 keepalive=60');
    if (prevAt !== null) add(at + 0.3, 'cloud', 'W', 'broker: client dev-ab12 already connected, closing stale connection (last packet ' + Math.round(at + 0.3 - (prevAt + 0.5)) + ' s ago)');
    if (cycle === 4) add(at + 0.35, 'cloud', 'W', 'broker: dropped 1 unacknowledged qos1 message for dev-ab12 (clean_session=1)');
    add(at + 0.4, 'cloud', 'I', 'broker: client dev-ab12 connected from 84.17.x.x keepalive=60');
    add(at + 0.4, 'dev', 'I', 'mqtt: CONNACK rc=0 session_present=0');
    add(at + 0.5, 'dev', 'I', 'mqtt: SUBSCRIBE dev/ab12/cmd qos=1');
    add(at + 0.6, 'dev', 'I', 'mqtt: SUBACK ok');
    prevAt = at;
  };
  let at = t + 3;
  connect(at);
  while (cycle < 13) {
    const ping = at + 0.6 + 60;
    for (; nextSensor < ping + 10; nextSensor += 30) add(nextSensor, 'dev', 'D', 'sensor: temp=' + (22 + r() * 1.2).toFixed(1) + ' hum=' + Math.round(40 + r() * 4));
    if (cycle === 3) { cmdSentAt = at + 50; add(cmdSentAt, 'cloud', 'I', 'cmd: publish dev/ab12/cmd id=7731 qos=1 sent to dev-ab12, waiting for PUBACK'); }
    add(ping, 'dev', 'D', 'mqtt: PINGREQ');
    add(ping + 10, 'dev', 'W', 'mqtt: PINGRESP timeout, closing socket');
    add(ping + 10.1, 'dev', 'E', 'mqtt: connection lost, reconnect in 2000 ms');
    add(ping + 11, 'dev', 'D', 'heap: free=' + Math.round(118 + r() * 2) + 'k');
    at = ping + 12.5;
    cycle++;
    connect(at);
    if (cycle === 4) add(cmdSentAt + 120, 'cloud', 'E', 'cmd: id=7731 status=TIMEOUT no PUBACK within 120 s');
  }
  L.sort((x, y) => x.t - y.t);
  return L;
};
/* Журнал Б: обновление прошивки установилось, но новая версия падает, и загрузчик возвращает старый слот. */
SIM.logB = function () {
  const r = rng(23), L = [];
  const add = (t, src, lvl, msg) => L.push({ t, src, lvl, msg });
  let t = 9 * 3600 + 30 * 60;
  add(t, 'cloud', 'I', 'ota: job 77 created target=2.5.0 rollout=25% devices=1200');
  add(t + 4, 'cloud', 'I', 'ota: job 77 device dev-ab12 selected, manifest sent');
  add(t + 4.5, 'dev', 'I', 'ota: manifest received version=2.5.0 size=1048576 sha256=9f2c41');
  add(t + 5, 'dev', 'D', 'heap: free=118k');
  add(t + 5.2, 'dev', 'I', 'ota: download started');
  [25, 50, 75, 100].forEach((p, i) => add(t + 8 + i * 6 + r(), 'dev', 'D', 'ota: download progress ' + p + '%'));
  add(t + 33, 'dev', 'I', 'ota: sha256 verify OK');
  add(t + 33.4, 'dev', 'I', 'ota: signature verify OK');
  add(t + 33.5, 'dev', 'I', 'ota: writing slot B');
  add(t + 41, 'dev', 'I', 'ota: slot B written, set boot slot=B (test)');
  add(t + 41.2, 'dev', 'I', 'reboot: reason=SW_RESET');
  let at = t + 44;
  for (let i = 1; i <= 3; i++) {
    add(at, 'dev', 'I', 'boot: slot=B fw=2.5.0 boot_count=' + i + ' reset_reason=' + (i === 1 ? 'SW_RESET' : 'PANIC'));
    add(at + 1.4, 'dev', 'I', 'wifi: connected ssid=home-2g rssi=-57');
    add(at + 1.6, 'dev', 'D', 'heap: free=' + Math.round(41 + r() * 2) + 'k');
    add(at + 2.2, 'dev', 'I', 'mqtt: CONNECT client=dev-ab12 clean_session=1 keepalive=60');
    add(at + 2.8, 'dev', 'I', 'ui: gallery task started, loading assets');
    add(at + 3.9, 'dev', 'E', 'panic: heap alloc failed size=8192 task=wifi_task free=3k');
    add(at + 4, 'dev', 'E', 'backtrace: 0x4008a1c2 0x4008b3f0 0x400d12aa');
    at += 8;
  }
  add(at, 'dev', 'W', 'boot: boot_count=3 exceeds limit 3 without confirmation, reverting to slot A');
  add(at + 1.1, 'dev', 'I', 'boot: slot=A fw=2.4.0 boot_count=1 reset_reason=SW_RESET');
  add(at + 2.5, 'dev', 'D', 'heap: free=118k');
  add(at + 3.1, 'dev', 'I', 'mqtt: CONNACK rc=0 session_present=0');
  add(at + 4, 'dev', 'W', 'ota: update to 2.5.0 failed, running 2.4.0');
  add(at + 4.6, 'cloud', 'E', 'ota: job 77 device dev-ab12 status=FAILED reason=ROLLBACK_AFTER_BOOT_FAILURE running=2.4.0');
  add(at + 30, 'cloud', 'W', 'ota: job 77 progress: 168 updated, 41 failed (ROLLBACK_AFTER_BOOT_FAILURE: 41), failure rate 19.6%');
  add(at + 30.5, 'cloud', 'I', 'ota: job 77 paused automatically: failure rate above 5% threshold');
  L.sort((x, y) => x.t - y.t);
  return L;
};
SIM.logLine = l => SIM.fmtTime(l.t) + ' [' + l.src + '] ' + l.lvl + ' ' + l.msg;
/* Фильтр как в строке поиска: обычный текст без учёта регистра, либо регулярное выражение в косых чертах /как это/. */
SIM.logFilter = function (lines, q, src, levels) {
  const s = String(q || '').trim();
  let test = () => true;
  if (s.length > 2 && s[0] === '/' && s[s.length - 1] === '/') {
    try { const re = new RegExp(s.slice(1, -1), 'i'); test = x => re.test(x); } catch (e) { return { lines: [], error: 'Некорректное регулярное выражение' }; }
  } else if (s) { const low = s.toLowerCase(); test = x => x.toLowerCase().includes(low); }
  return { lines: lines.filter(l => (src === 'all' || l.src === src) && levels.includes(l.lvl) && test(SIM.logLine(l))), error: '' };
};

if (typeof module !== 'undefined' && module.exports) module.exports = { SIM };
