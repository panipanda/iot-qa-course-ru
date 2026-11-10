'use strict';
/* Фабрики небольших тренажёров: сопоставление и разбор дефектов. Данные лежат в content/ru/trainers.js,
   большие тренажёры практикума находятся в js/labs.js, модели в js/sim.js. */

/* Сортировка: у каждого пункта выпадающий список категорий. items: [[текст (можно HTML), номер категории, пояснение]] */
function makeSorter(name, cfg) {
  WIDGETS[name] = {
    title: cfg.title, tag: cfg.tag || 'сопоставление',
    init(b) {
      const ids = cfg.items.map(() => uid('srt'));
      b.innerHTML = (cfg.intro ? `<p class="src" style="margin-top:0">${cfg.intro}</p>` : '') +
        cfg.items.map((it, i) => `<div class="field" style="margin-bottom:10px"><label for="${ids[i]}">${i + 1}. ${it[0]}</label><select id="${ids[i]}"><option value="">${cfg.prompt || 'Выберите вариант'}</option>${cfg.cats.map((r, j) => `<option value="${j}">${r}</option>`).join('')}</select><div id="${ids[i]}-fb"></div></div>`).join('') +
        '<div class="row"><button class="btn" type="button" data-chk="1">Проверить</button><span class="score" data-score="1"></span></div>';
      $('[data-chk]', b).onclick = () => {
        let ok = 0;
        cfg.items.forEach((it, i) => {
          const v = $('#' + ids[i], b).value, good = v !== '' && +v === it[1];
          if (good) ok++;
          $('#' + ids[i] + '-fb', b).innerHTML = v === '' ? '' : `<div class="fb ${good ? 'ok' : 'bad'}">${good ? 'Верно. ' : 'Правильный ответ: ' + cfg.cats[it[1]] + '. '}${it[2]}</div>`;
        });
        $('[data-score]', b).textContent = `${ok} из ${cfg.items.length} верно`;
      };
    }
  };
}

/* Разбор дефектов: к каждому тексту нужно отметить все проблемы. items: [{ text, bad: [номера дефектов], why, fix }] */
function makeClinic(name, cfg) {
  WIDGETS[name] = {
    title: cfg.title, tag: cfg.tag || 'разбор',
    init(b) {
      const ids = cfg.items.map(() => uid('cl'));
      b.innerHTML = (cfg.intro ? `<p class="src" style="margin-top:0">${cfg.intro}</p>` : '') +
        cfg.items.map((it, i) => `<div class="q" style="margin:0 0 12px"><p class="qt">${i + 1}. «${it.text}»</p>${cfg.defects.map((d, j) => `<label class="chk"><input type="checkbox" data-i="${i}" data-j="${j}"><span>${d}</span></label>`).join('')}<div id="${ids[i]}"></div></div>`).join('') +
        '<div class="row"><button class="btn" type="button" data-chk="1">Проверить</button><span class="score" data-score="1"></span></div>';
      $('[data-chk]', b).onclick = () => {
        let ok = 0;
        cfg.items.forEach((it, i) => {
          const picked = $$(`input[data-i="${i}"]`, b).filter(x => x.checked).map(x => +x.dataset.j);
          const good = sameSet(picked, it.bad);
          if (good) ok++;
          $('#' + ids[i], b).innerHTML = `<div class="fb ${good ? 'ok' : 'bad'}"><b>${good ? 'Верно.' : 'Не совпало.'}</b> Проблемы: ${it.bad.length ? it.bad.map(j => cfg.defects[j]).join('; ') : 'нет, формулировка хорошая'}. ${it.why}${it.fix ? `<br><b>Как лучше:</b> «${it.fix}»` : ''}</div>`;
        });
        $('[data-score]', b).textContent = `${ok} из ${cfg.items.length} разобрано верно`;
      };
    }
  };
}

/* Разбор захвата трафика: таблица пакетов и вопросы к ней. rows: [[№, время, источник, получатель, протокол, сведения]] */
function makeCapture(name, cfg) {
  WIDGETS[name] = {
    title: cfg.title, tag: cfg.tag || 'разбор захвата',
    init(b) {
      b.innerHTML = `<p class="src" style="margin-top:0">${cfg.intro}</p>
      <div class="tbl"><table class="pcap"><thead><tr><th>№</th><th>Время, с</th><th>Источник</th><th>Получатель</th><th>Протокол</th><th>Сведения</th></tr></thead><tbody>${cfg.rows.map(r => `<tr>${r.map(c => `<td class="mono">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div data-qs="1"></div>`;
      mountQuiz($('[data-qs]', b), cfg.questions, { id: name, persist: false });
    }
  };
}
