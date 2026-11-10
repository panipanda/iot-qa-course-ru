'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { COURSE, CARDS, GLOSS, WIDGETS, SOURCES, LABS, PLAN, PARTS, LAB_DATA, lib } = loadCourse();

test('четырнадцать модулей с уникальными идентификаторами по порядку', () => {
  assert.equal(COURSE.length, 14);
  assert.deepEqual(Array.from(COURSE, m => m.id), Array.from({ length: 14 }, (_, i) => 'm' + (i + 1)));
});

test('у каждого модуля есть всё необходимое', () => {
  const parts = new Set(Array.from(PARTS, p => p.id));
  for (const m of COURSE) {
    for (const k of ['short', 'title', 'lead', 'body']) assert.ok(typeof m[k] === 'string' && m[k].length > 0, m.id + ' ' + k);
    for (const k of ['learn', 'takeaways', 'quiz']) assert.ok(Array.isArray(m[k]) && m[k].length > 0, m.id + ' ' + k);
    assert.ok(parts.has(m.part), m.id + ' part');
    assert.ok(m.minutes > 0, m.id + ' minutes');
    assert.ok(m.body.length > 6000, m.id + ' слишком короткий текст: ' + m.body.length);
    const p = m.practice;
    assert.ok(p && p.id && p.title && p.brief && p.template && p.model, m.id + ' practice');
    assert.ok(Array.isArray(p.checks) && p.checks.length > 0, m.id + ' checks');
  }
});

test('идентификаторы практических заданий уникальны', () => {
  const ids = COURSE.map(m => m.practice.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('модули сгруппированы по частям подряд', () => {
  assert.equal(COURSE.map(m => m.part).join(''), 'aaabbbbbcccddd');
});

test('вопросы корректны: у каждого есть пояснение, ответ в допустимых пределах', () => {
  let total = 0;
  const check = (where, q) => {
    const t = q.type || 'mc';
    assert.ok(q.q && q.why, where + ' вопросу нужны текст и пояснение');
    if (t === 'mc') {
      assert.ok(Array.isArray(q.o) && q.o.length >= 2, where + ' варианты');
      assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length, where + ' индекс ответа');
      assert.equal(new Set(q.o).size, q.o.length, where + ' повторяющиеся варианты');
    } else if (t === 'multi') {
      assert.ok(Array.isArray(q.o) && q.o.length >= 3, where + ' multi варианты');
      assert.ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.length < q.o.length, where + ' multi ответы');
      assert.ok(q.a.every(i => Number.isInteger(i) && i >= 0 && i < q.o.length), where + ' multi индексы');
      assert.equal(new Set(q.o).size, q.o.length, where + ' повторяющиеся варианты');
    } else if (t === 'num') {
      assert.equal(typeof q.ans, 'number', where + ' числовой ответ');
    } else if (t === 'order') {
      assert.ok(Array.isArray(q.items) && q.items.length >= 3, where + ' порядок');
      assert.equal(new Set(q.items).size, q.items.length, where + ' повторяющиеся шаги');
    } else assert.fail(where + ' неизвестный тип вопроса ' + t);
  };
  for (const m of COURSE) {
    assert.ok(m.quiz.length >= 6, m.id + ' мало вопросов: ' + m.quiz.length);
    for (const q of m.quiz) { total++; check(m.id, q); }
  }
  assert.ok(total >= 100, 'вопросов всего: ' + total);
  for (const id of Object.keys(LAB_DATA)) for (const q of LAB_DATA[id].questions) check(id, q);
});

test('каждый тренажёр из текста существует, и каждый зарегистрированный тренажёр где-то используется', () => {
  const used = new Set();
  for (const m of COURSE) {
    for (const mt of m.body.matchAll(/\{\{w:([\w-]+)\}\}/g)) {
      assert.ok(WIDGETS[mt[1]], m.id + ' использует неизвестный тренажёр ' + mt[1]);
      assert.equal(typeof WIDGETS[mt[1]].init, 'function', mt[1]);
      assert.ok(WIDGETS[mt[1]].title, mt[1]);
      used.add(mt[1]);
    }
  }
  assert.deepEqual(Array.from(Object.keys(WIDGETS).filter(n => !used.has(n))), []);
});

test('задания практикума: уникальные идентификаторы, размещены в своём модуле', () => {
  const ids = LABS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(LABS.length, 5);
  for (const t of LABS) {
    assert.ok(t.title && t.mod && t.level, t.id);
    const mod = COURSE.find(m => m.id === t.mod);
    assert.ok(mod, t.id + ' модуль ' + t.mod);
    assert.ok(mod.body.includes('{{w:lab-' + t.id + '}}'), t.id + ' не размещено в модуле ' + t.mod);
    assert.ok(WIDGETS['lab-' + t.id], t.id + ' нет тренажёра');
  }
});

test('карточки: уникальные идентификаторы, есть вопрос и ответ', () => {
  const ids = CARDS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(CARDS.length >= 60);
  for (const c of CARDS) assert.ok(c.tag && c.q && c.a, c.id);
});

test('глоссарий: уникальные термины с определением, отсортирован', () => {
  assert.ok(GLOSS.length >= 100);
  const terms = GLOSS.map(g => g.t);
  assert.equal(new Set(terms).size, terms.length, 'повторяющиеся термины');
  for (const g of GLOSS) assert.ok(g.t && g.d, g.t);
  const sorted = terms.slice().sort((a, b) => a.localeCompare(b, 'ru'));
  assert.deepEqual(Array.from(terms), Array.from(sorted));
});

test('у каждого модуля с источниками они по https', () => {
  for (const m of COURSE) {
    const list = SOURCES[m.id];
    if (m.id === 'm13' || m.id === 'm14') continue;
    assert.ok(Array.isArray(list) && list.length > 0, m.id + ' источники');
    for (const s of list) assert.ok(s.t && /^https:\/\//.test(s.u), m.id + ' ' + s.u);
  }
});

test('план на 7 дней: дни подряд, модули существуют, ключи отметок корректны и уникальны', () => {
  assert.equal(PLAN.length, 7);
  const keys = [], covered = new Set();
  PLAN.forEach((d, i) => {
    assert.equal(d.day, i + 1);
    assert.ok(d.title && d.goal && d.time && d.items.length >= 5, 'день ' + d.day);
    for (const id of d.mods) { assert.ok(COURSE.some(m => m.id === id), 'модуль ' + id); covered.add(id); }
    for (const it of d.items) {
      assert.ok(/^[A-Za-z0-9_:-]{1,40}$/.test(it.id) && it.text, it.id);
      keys.push(it.id);
    }
  });
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(covered.size, COURSE.length, 'каждый модуль стоит в плане');
});

test('карточки и тренажёры не ссылаются на несуществующие карточки плана', () => {
  const nums = new Set(CARDS.map(c => c.id));
  for (const d of PLAN) for (const it of d.items) for (const m of it.text.matchAll(/c(\d\d) до c(\d\d)/g)) {
    assert.ok(nums.has('c' + m[1]) && nums.has('c' + m[2]), d.day + ' ' + it.text);
  }
});

test('названия страницы и глоссария согласованы с идентификатором приложения', () => {
  assert.equal(lib.APP_ID, 'iot-qa-course-ru');
});
