/* 2026年 年収の壁チェッカー — 画面の処理（計算は rules.js） */
(function () {
  'use strict';
  var R = window.NenshuRules;
  var $ = function (id) { return document.getElementById(id); };

  var BADGE = {
    incomeTax: { under: ['かからない目安', 'ok'], over: ['かかる目安', 'warn'] },
    residentTax: { under: ['所得割はかからない目安', 'ok'], over: ['所得割がかかる目安', 'warn'] },
    supporterDeduction: {
      under: ['控除の対象（満額）の目安', 'ok'],
      partial: ['控除の対象（金額が変わる）の目安', 'mid'],
      over: ['控除の対象外の目安', 'warn'],
      na: ['対象外', 'neutral'],
      unknown: ['要確認', 'neutral']
    },
    socialInsurance: {
      under: ['扶養の範囲内の目安', 'ok'],
      over: ['扶養から外れる・勤務先で加入の目安', 'warn'],
      na: ['加入条件に当たらない目安', 'neutral'],
      unknown: ['要確認', 'neutral']
    }
  };
  var SI_OTHER_BADGE = { over: ['勤務先で加入する目安', 'warn'], na: ['加入条件に当たらない目安', 'ok'], unknown: ['要確認', 'neutral'] };

  function yen(n) { return n.toLocaleString('ja-JP') + '円'; }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  function radio(name) {
    var c = document.querySelector('input[name="' + name + '"]:checked');
    return c ? c.value : null;
  }

  function syncFields() {
    var pos = radio('position');
    $('supporter-field').hidden = pos !== 'spouse';
  }

  function sourceLabel(url) {
    if (url.indexOf('nta.go.jp') >= 0) return '国税庁';
    if (url.indexOf('soumu.go.jp') >= 0) return '総務省';
    if (url.indexOf('nenkin.go.jp') >= 0) return '日本年金機構';
    if (url.indexOf('mhlw.go.jp') >= 0) return '厚生労働省';
    if (url.indexOf('laws.e-gov.go.jp') >= 0) return 'e-Gov法令検索';
    return '出典';
  }

  function renderSection(s, position) {
    var map = (s.key === 'socialInsurance' && position === 'other') ? SI_OTHER_BADGE : BADGE[s.key];
    var b = s.badge || (map && map[s.status]) || ['要確認', 'neutral'];
    if (s.key === 'residentTax' && s.minorExempt) b = ['住民税はかからない目安（未成年者）', 'ok'];
    var card = el('article', { class: 'rcard ' + b[1] });
    card.appendChild(el('div', { class: 'rhead' }, [
      el('h3', { text: s.title }),
      el('span', { class: 'badge ' + b[1], text: b[0] })
    ]));
    card.appendChild(el('p', { text: s.summary }));

    if (s.key === 'supporterDeduction' && typeof s.amount === 'number' && s.amount > 0) {
      card.appendChild(el('p', { class: 'amount' }, [s.deductionName + ': ', el('strong', { text: R.formatMan(s.amount) }), '（扶養する人の所得から差し引かれる額）']));
    }
    if (typeof s.remaining === 'number' && s.remaining > 0 && typeof s.wall === 'number') {
      var label = s.nextLabel || (R.formatMan(s.wall) + (s.key === 'socialInsurance' ? '（' + s.dependent.limitLabel + '）' : '') + 'の壁');
      card.appendChild(el('p', { class: 'remain' }, ['次の壁: ' + label + ' — ', el('strong', { text: 'あと ' + yen(s.remaining) })]));
    } else if (s.remaining === 0 && (s.status === 'under' || s.status === 'partial')) {
      card.appendChild(el('p', { class: 'remain' }, [el('strong', { text: 'ちょうど上限です。' }), ' 1円でも増えると次の区分になります。']));
    }
    if (s.key === 'socialInsurance' && s.own && position !== 'other') {
      card.appendChild(el('p', { class: 'sub' }, ['勤務先での加入: ' + s.own.text]));
    }

    var det = el('details');
    det.appendChild(el('summary', { text: 'くわしい条件と出典' }));
    var ul = el('ul');
    (s.notes || []).forEach(function (n) { ul.appendChild(el('li', { text: n })); });
    det.appendChild(ul);
    if (s.sources && s.sources.length) {
      var src = el('p', { class: 'sources' }, ['出典: ']);
      s.sources.forEach(function (u, i) {
        if (i) src.appendChild(document.createTextNode('、'));
        src.appendChild(el('a', { href: u, rel: 'noopener noreferrer', target: '_blank', text: sourceLabel(u) + '（' + (i + 1) + '）' }));
      });
      det.appendChild(src);
    }
    card.appendChild(det);
    return card;
  }

  function run() {
    var err = $('revenue-err');
    var input = $('revenue');
    var revenue = R.parseYen(input.value);
    if (revenue === null) {
      err.textContent = '給与収入の見込みを、0円以上の数字で入力してください（例: 1500000 または 150万）。';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    err.hidden = true;
    input.removeAttribute('aria-invalid');

    var position = radio('position');
    var res = R.evaluate({
      revenue: revenue,
      position: position,
      ageGroup: $('age').value,
      supporterBracket: $('supporter').value,
      companySize: radio('size'),
      weeklyHours: radio('hours')
    });
    var body = $('result-body');
    body.textContent = '';
    if (!res.ok) {
      body.appendChild(el('p', { class: 'error', text: '入力を確認してください。' }));
    } else {
      var head = el('div', { class: 'overview' });
      head.appendChild(el('p', {}, ['給与収入の見込み ', el('strong', { text: yen(res.revenue) }),
        res.salaryIncome !== null ? '（給与所得 ' + yen(res.salaryIncome) + '）' : '（220万円以上のため、給与所得の計算は省略しています）']));
      if (res.nextWall) {
        head.appendChild(el('p', { class: 'next' }, ['いちばん近い壁: ', el('strong', { text: res.nextWall.title + ' — ' + R.formatMan(res.nextWall.wall) + '（あと ' + yen(res.nextWall.remaining) + '）' })]));
      } else {
        head.appendChild(el('p', { class: 'next', text: 'この収入では、金額で判定する壁はすべて超えているか、対象外です。' }));
      }
      body.appendChild(head);
      var grid = el('div', { class: 'rgrid' });
      res.sections.forEach(function (s) { grid.appendChild(renderSection(s, position)); });
      body.appendChild(grid);
    }
    var section = $('result');
    section.hidden = false;
    $('result-h').focus();
  }

  document.querySelectorAll('input[name="position"]').forEach(function (r) { r.addEventListener('change', syncFields); });
  $('run').addEventListener('click', run);
  $('revenue').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  syncFields();
})();
