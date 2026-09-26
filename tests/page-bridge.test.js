'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const bridge = require('../lib/page-bridge.js');
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'tax-form.html'),
  'utf8'
);

function makeDom(html = fixture) {
  return new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dichiarazioneprecompilata.agenziaentrate.gov.it/730'
  });
}

function run(dom, fn, ...args) {
  return dom.window.eval(`(${fn.toString()}).apply(null, ${JSON.stringify(args)})`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function propose(field, proposedValue = field.valore) {
  return { ...field, proposedValue };
}

function wrapOptionInGroup(dom, disabled) {
  const document = dom.window.document;
  const option = document.querySelector('#regime option[value="semplificato"]');
  const group = document.createElement('optgroup');
  group.label = 'Regimi';
  group.disabled = disabled;
  option.replaceWith(group);
  group.append(option);
  return group;
}

test('scrapes only visible, enabled, allowlisted controls', () => {
  const dom = makeDom();
  const result = plain(run(dom, bridge.scrapePage, 'session-a'));

  assert.deepEqual(result.campi.map((field) => field.tipo), [
    'text', 'number', 'date', 'month', 'email', 'tel',
    'select', 'textarea', 'checkbox', 'radio', 'radio'
  ]);
});

test('uses effective disabledness inherited from a fieldset throughout the flow', () => {
  const html = `
    <h1>Quadro T</h1>
    <fieldset id="group" disabled>
      <legend>Quadro T</legend>
      <label for="amount">Importo</label>
      <input id="amount" type="text" value="10">
    </fieldset>
  `;
  const preflightDom = makeDom(html);
  const preflightDocument = preflightDom.window.document;

  const disabledRead = plain(run(
    preflightDom, bridge.scrapePage, 'session-fieldset-disabled'
  ));
  preflightDocument.querySelector('#group').disabled = false;
  const field = plain(run(
    preflightDom, bridge.scrapePage, 'session-fieldset-enabled'
  )).campi[0];
  preflightDocument.querySelector('#group').disabled = true;
  const preflight = plain(run(preflightDom, bridge.preflightFields, [
    propose(field, '20')
  ], 'session-fieldset-enabled'));

  const fillDom = makeDom(html);
  const fillDocument = fillDom.window.document;
  fillDocument.querySelector('#group').disabled = false;
  const fillField = plain(run(
    fillDom, bridge.scrapePage, 'session-fieldset-fill'
  )).campi[0];
  const beforeFill = plain(run(fillDom, bridge.preflightFields, [
    propose(fillField, '20')
  ], 'session-fieldset-fill'));
  fillDocument.querySelector('#group').disabled = true;
  const fill = plain(run(fillDom, bridge.fillFields, [{
    localId: fillField.localId, valore: '20'
  }], 'session-fieldset-fill'));

  assert.deepEqual({
    scrapedWhileDisabled: disabledRead.campi.length,
    preflight: [preflight.ok, preflight.results[0].code],
    beforeFill: beforeFill.ok,
    fill: [fill.ok, fill.results[0].code],
    value: fillDocument.querySelector('#amount').value
  }, {
    scrapedWhileDisabled: 0,
    preflight: [false, 'FIELD_INELIGIBLE'],
    beforeFill: true,
    fill: [false, 'FIELD_INELIGIBLE'],
    value: '10'
  });
});

test('rejects a page without a visible tax-form marker', () => {
  const dom = makeDom(`
    <h1>Profilo utente</h1>
    <div class="row"><label>Nome <input type="text"></label></div>
  `);

  assert.throws(
    () => run(dom, bridge.scrapePage, 'session-a'),
    (error) => error.code === 'NOT_TAX_FORM'
  );
});

test('normalizes field labels, section context, row context and select options', () => {
  const dom = makeDom();
  const result = plain(run(dom, bridge.scrapePage, 'session-a'));
  const text = result.campi.find((field) => field.tipo === 'text');
  const select = result.campi.find((field) => field.tipo === 'select');

  assert.deepEqual({
    url: result.url,
    title: result.title,
    text: {
      etichetta: text.etichetta,
      sezione: text.sezione,
      contesto: text.contesto
    },
    select: {
      etichetta: select.etichetta,
      opzioni: select.opzioni.slice(0, 3)
    }
  }, {
    url: 'https://dichiarazioneprecompilata.agenziaentrate.gov.it/730',
    title: 'Dichiarazione precompilata 730',
    text: {
      etichetta: 'Spese sanitarie',
      sezione: 'Quadro E',
      contesto: 'E1 Spese sanitarie'
    },
    select: {
      etichetta: 'Regime',
      opzioni: ['-- Scegli --', 'Ordinario', 'Regime semplificato']
    }
  });
});

test('assigns local IDs and the read session to every scraped element', () => {
  const dom = makeDom();
  const result = plain(run(dom, bridge.scrapePage, 'session-42'));
  const first = dom.window.document.querySelector('#testo');

  assert.deepEqual(
    result.campi.map((field) => [field.localId, field.readSessionId]),
    result.campi.map((field, index) => [index, 'session-42'])
  );
  assert.deepEqual(
    [first.dataset.dichiareraiId, first.dataset.dichiareraiSession],
    ['0', 'session-42']
  );
});

test('a new scrape clears stale tags before reassigning the eligible union', () => {
  const dom = makeDom(`
    <h1>Quadro T</h1>
    <label for="first">Primo</label><input id="first" type="text" value="1">
    <label for="second">Secondo</label><input id="second" type="text" value="2" style="display:none">
    <label><input id="peer" type="radio" name="peer-group" disabled>Peer</label>
  `);
  const firstRead = plain(run(dom, bridge.scrapePage, 'session-one'));
  const first = dom.window.document.querySelector('#first');
  const second = dom.window.document.querySelector('#second');
  const peer = dom.window.document.querySelector('#peer');
  assert.deepEqual([
    first.dataset.dichiareraiId,
    first.dataset.dichiareraiSession,
    peer.dataset.dichiareraiId,
    peer.dataset.dichiareraiSession
  ], ['0', 'session-one', '1', 'session-one']);

  first.style.display = 'none';
  second.style.display = 'block';
  peer.style.display = 'none';
  const secondRead = plain(run(dom, bridge.scrapePage, 'session-two'));
  const stale = plain(run(dom, bridge.preflightFields, [
    propose(firstRead.campi[0], '3')
  ], 'session-one'));

  assert.deepEqual({
    firstTags: [first.dataset.dichiareraiId, first.dataset.dichiareraiSession],
    secondTags: [second.dataset.dichiareraiId, second.dataset.dichiareraiSession],
    peerTags: [peer.dataset.dichiareraiId, peer.dataset.dichiareraiSession],
    secondIds: secondRead.campi.map((field) => field.localId),
    taggedZero: dom.window.document.querySelectorAll(
      '[data-dichiarerai-id="0"]'
    ).length,
    staleCode: stale.results[0].code
  }, {
    firstTags: [undefined, undefined],
    secondTags: ['0', 'session-two'],
    peerTags: [undefined, undefined],
    secondIds: [0],
    taggedZero: 1,
    staleCode: 'SESSION_MISMATCH'
  });
});

test('captures values, checked state and validation constraints', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-a')).campi;
  const text = fields.find((field) => field.tipo === 'text');
  const select = fields.find((field) => field.tipo === 'select');
  const checkbox = fields.find((field) => field.tipo === 'checkbox');

  assert.deepEqual({
    tag: text.tag,
    name: text.name,
    valore: text.valore,
    checked: text.checked,
    disabled: text.disabled,
    readOnly: text.readOnly,
    required: text.required,
    min: text.min,
    max: text.max,
    step: text.step,
    pattern: text.pattern,
    maxLength: text.maxLength,
    selectValue: select.valore,
    checkboxValue: checkbox.valore,
    checkboxChecked: checkbox.checked
  }, {
    tag: 'input',
    name: 'spese',
    valore: '1000',
    checked: false,
    disabled: false,
    readOnly: false,
    required: true,
    min: '',
    max: '',
    step: '',
    pattern: '[0-9]+',
    maxLength: 12,
    selectValue: 'Ordinario',
    checkboxValue: 'true',
    checkboxChecked: true
  });
});

test('captures every visible same-name radio peer in each radio snapshot', () => {
  const dom = makeDom();
  const radios = plain(run(dom, bridge.scrapePage, 'session-radio')).campi
    .filter((field) => field.tipo === 'radio');

  assert.deepEqual(radios.map((radio) => radio.radioPeers.map((peer) => ({
    localId: peer.localId,
    readSessionId: peer.readSessionId,
    optionValue: peer.optionValue,
    valore: peer.valore,
    checked: peer.checked,
    etichetta: peer.etichetta
  }))), [
    [
      {
        localId: 9, readSessionId: 'session-radio', optionValue: 'si',
        valore: 'true', checked: true, etichetta: 'Tipo dichiarazione Sì'
      },
      {
        localId: 10, readSessionId: 'session-radio', optionValue: 'no',
        valore: 'false', checked: false, etichetta: 'No'
      },
      {
        localId: 11, readSessionId: 'session-radio', optionValue: 'bloccato',
        valore: 'false', checked: false, etichetta: 'Bloccato'
      }
    ],
    [
      {
        localId: 9, readSessionId: 'session-radio', optionValue: 'si',
        valore: 'true', checked: true, etichetta: 'Tipo dichiarazione Sì'
      },
      {
        localId: 10, readSessionId: 'session-radio', optionValue: 'no',
        valore: 'false', checked: false, etichetta: 'No'
      },
      {
        localId: 11, readSessionId: 'session-radio', optionValue: 'bloccato',
        valore: 'false', checked: false, etichetta: 'Bloccato'
      }
    ]
  ]);
});

test('preflights complete snapshots without mutating or notifying controls', () => {
  const dom = makeDom();
  const snapshots = plain(run(dom, bridge.scrapePage, 'session-preflight')).campi;
  const items = snapshots
    .filter((field) => field.tipo !== 'radio' || field.checked)
    .map((field) => propose(field));
  let events = 0;
  for (const element of dom.window.document.querySelectorAll('input,select,textarea')) {
    element.addEventListener('input', () => { events += 1; });
    element.addEventListener('change', () => { events += 1; });
  }
  const before = snapshots.map((field) => [field.valore, field.checked]);

  const result = plain(run(
    dom, bridge.preflightFields, items, 'session-preflight'
  ));
  const after = plain(run(dom, bridge.scrapePage, 'session-preflight')).campi
    .map((field) => [field.valore, field.checked]);

  assert.deepEqual(result, {
    ok: true,
    results: items.map((field) => ({ localId: field.localId, ok: true }))
  });
  assert.deepEqual(after, before);
  assert.equal(events, 0);
});

test('preflight rejects invalid proposed values for every guarded control rule', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-proposals')).campi;
  const byType = new Map(fields.map((field) => [field.tipo, field]));
  const invalid = [
    [byType.get('text'), ''],
    [byType.get('text'), 'abc'],
    [byType.get('number'), '-1'],
    [byType.get('number'), '20.005'],
    [byType.get('date'), 'not-a-date'],
    [byType.get('month'), '2025-13'],
    [byType.get('email'), 'not-an-email'],
    [byType.get('select'), 'semplificato'],
    [byType.get('textarea'), 'x'.repeat(81)],
    [byType.get('checkbox'), 'TRUE'],
    [fields.find((field) => field.tipo === 'radio' && field.checked), 'false']
  ];

  for (const [field, proposedValue] of invalid) {
    const result = plain(run(dom, bridge.preflightFields, [
      propose(field, proposedValue)
    ], 'session-proposals'));
    assert.equal(result.ok, false, `${field.tipo}: ${proposedValue}`);
    assert.equal(result.results[0].code, 'INVALID_PROPOSED_VALUE');
  }
});

test('preflight rejects the batch before any earlier field is mutated', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-batch')).campi;
  const text = fields.find((field) => field.tipo === 'text');
  const number = fields.find((field) => field.tipo === 'number');
  let events = 0;
  dom.window.document.querySelector('#tax-form').addEventListener('input', () => {
    events += 1;
  });

  const result = plain(run(dom, bridge.preflightFields, [
    propose(text, '1500'),
    propose(number, '-1')
  ], 'session-batch'));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results.map((entry) => entry.ok), [true, false]);
  assert.deepEqual([
    dom.window.document.querySelector('#testo').value,
    dom.window.document.querySelector('#numero').value,
    events
  ], ['1000', '20', 0]);
});

test('preflight rejects two true proposals for the same radio group', () => {
  const dom = makeDom();
  const radios = plain(run(dom, bridge.scrapePage, 'session-radio-conflict')).campi
    .filter((field) => field.tipo === 'radio');
  const before = radios.map((field) => field.checked);
  let clicks = 0;
  dom.window.document.querySelector('#tax-form').addEventListener('click', () => {
    clicks += 1;
  });

  const result = plain(run(dom, bridge.preflightFields,
    radios.map((field) => propose(field, 'true')),
    'session-radio-conflict'
  ));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results.map((entry) => entry.code), [
    'RADIO_GROUP_CONFLICT', 'RADIO_GROUP_CONFLICT'
  ]);
  assert.deepEqual(
    radios.map((field) => dom.window.document.querySelector(
      `[data-dichiarerai-id="${field.localId}"]`
    ).checked),
    before
  );
  assert.equal(clicks, 0);
});

test('preflight and fill recheck visible, enabled and editable eligibility', () => {
  const hiddenDom = makeDom();
  const hiddenField = plain(run(
    hiddenDom, bridge.scrapePage, 'session-hidden'
  )).campi.find((field) => field.tipo === 'text');
  hiddenDom.window.document.querySelector('#testo').style.display = 'none';
  const hiddenResult = plain(run(hiddenDom, bridge.preflightFields, [
    propose(hiddenField, '1500')
  ], 'session-hidden'));

  const selectDom = makeDom();
  const selectField = plain(run(
    selectDom, bridge.scrapePage, 'session-disabled-option'
  )).campi.find((field) => field.tipo === 'select');
  selectDom.window.document.querySelector(
    '#regime option[value="semplificato"]'
  ).disabled = true;
  const disabledOption = plain(run(selectDom, bridge.preflightFields, [
    propose(selectField, 'Regime semplificato')
  ], 'session-disabled-option'));

  const selectFillDom = makeDom();
  const selectFillField = plain(run(
    selectFillDom, bridge.scrapePage, 'session-fill-option'
  )).campi.find((field) => field.tipo === 'select');
  const beforeSelectFill = plain(run(selectFillDom, bridge.preflightFields, [
    propose(selectFillField, 'Regime semplificato')
  ], 'session-fill-option'));
  selectFillDom.window.document.querySelector(
    '#regime option[value="semplificato"]'
  ).disabled = true;
  const selectFill = plain(run(selectFillDom, bridge.fillFields, [{
    localId: selectFillField.localId, valore: 'Regime semplificato'
  }], 'session-fill-option'));

  const changedDom = makeDom();
  const changedField = plain(run(
    changedDom, bridge.scrapePage, 'session-fill-eligibility'
  )).campi.find((field) => field.tipo === 'text');
  const beforeFill = plain(run(changedDom, bridge.preflightFields, [
    propose(changedField, '1500')
  ], 'session-fill-eligibility'));
  changedDom.window.document.querySelector('#testo').readOnly = true;
  const fillResult = plain(run(changedDom, bridge.fillFields, [{
    localId: changedField.localId, valore: '1500'
  }], 'session-fill-eligibility'));

  assert.deepEqual({
    hidden: [hiddenResult.ok, hiddenResult.results[0].code],
    disabledOption: [disabledOption.ok, disabledOption.results[0].code],
    selectFill: [beforeSelectFill.ok, selectFill.ok,
      selectFill.results[0].code,
      selectFillDom.window.document.querySelector('#regime').value],
    beforeFill: beforeFill.ok,
    fill: [fillResult.ok, fillResult.results[0].code],
    unchanged: changedDom.window.document.querySelector('#testo').value
  }, {
    hidden: [false, 'FIELD_INELIGIBLE'],
    disabledOption: [false, 'FIELD_INELIGIBLE'],
    selectFill: [true, false, 'FIELD_INELIGIBLE', 'ordinario'],
    beforeFill: true,
    fill: [false, 'FIELD_INELIGIBLE'],
    unchanged: '1000'
  });
});

test('uses effective disabledness inherited from an optgroup', () => {
  const preflightDom = makeDom();
  wrapOptionInGroup(preflightDom, true);
  const preflightField = plain(run(
    preflightDom, bridge.scrapePage, 'session-optgroup-preflight'
  )).campi.find((field) => field.tipo === 'select');
  const preflight = plain(run(preflightDom, bridge.preflightFields, [
    propose(preflightField, 'Regime semplificato')
  ], 'session-optgroup-preflight'));

  const fillDom = makeDom();
  const group = wrapOptionInGroup(fillDom, false);
  const fillField = plain(run(
    fillDom, bridge.scrapePage, 'session-optgroup-fill'
  )).campi.find((field) => field.tipo === 'select');
  const beforeFill = plain(run(fillDom, bridge.preflightFields, [
    propose(fillField, 'Regime semplificato')
  ], 'session-optgroup-fill'));
  group.disabled = true;
  const fill = plain(run(fillDom, bridge.fillFields, [{
    localId: fillField.localId, valore: 'Regime semplificato'
  }], 'session-optgroup-fill'));

  assert.deepEqual({
    preflight: [preflight.ok, preflight.results[0].code],
    beforeFill: beforeFill.ok,
    fill: [fill.ok, fill.results[0].code],
    value: fillDom.window.document.querySelector('#regime').value
  }, {
    preflight: [false, 'FIELD_INELIGIBLE'],
    beforeFill: true,
    fill: [false, 'FIELD_INELIGIBLE'],
    value: 'ordinario'
  });
});

test('preflight rejects a stale read session', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'old-session')).campi[0];

  const result = plain(run(dom, bridge.preflightFields, [propose(item)], 'new-session'));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results.map(({ localId, ok, code }) => ({
    localId, ok, code
  })), [{ localId: 0, ok: false, code: 'SESSION_MISMATCH' }]);
});

test('preflight rejects a stale current value', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-value')).campi[0];
  dom.window.document.querySelector('#testo').value = '2000';

  const result = plain(run(
    dom, bridge.preflightFields, [propose(item)], 'session-value'
  ));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results[0].changed, ['valore']);
});

test('preflight rejects a stale normalized label', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-label')).campi[0];
  dom.window.document.querySelector('label[for="testo"]').textContent =
    'Altre spese';

  const result = plain(run(
    dom, bridge.preflightFields, [propose(item)], 'session-label'
  ));

  assert.equal(result.ok, false);
  assert.ok(result.results[0].changed.includes('etichetta'));
});

test('preflight rejects stale select options', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-options')).campi
    .find((field) => field.tipo === 'select');
  dom.window.document.querySelector('#regime option[value="semplificato"]')
    .textContent = 'Regime speciale';

  const result = plain(run(
    dom, bridge.preflightFields, [propose(item)], 'session-options'
  ));

  assert.equal(result.ok, false);
  assert.ok(result.results[0].changed.includes('opzioni'));
});

test('retains and preflights select options beyond the provider cap', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-long-select')).campi
    .find((field) => field.tipo === 'select');
  dom.window.document.querySelector('#regime option:last-child').textContent =
    'Opzione finale modificata';

  const result = plain(run(dom, bridge.preflightFields, [{
    ...propose(item)
  }], 'session-long-select'));

  assert.deepEqual({
    optionCount: item.opzioni.length,
    finalOption: item.opzioni.at(-1),
    ok: result.ok,
    optionsChanged: Boolean(result.results[0].changed?.includes('opzioni'))
  }, {
    optionCount: 38,
    finalOption: 'Opzione 34',
    ok: false,
    optionsChanged: true
  });
});

test('preflight rejects stale validation constraints', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-constraints')).campi
    .find((field) => field.tipo === 'number');
  dom.window.document.querySelector('#numero').min = '10';

  const result = plain(run(
    dom, bridge.preflightFields, [propose(item)], 'session-constraints'
  ));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results[0].changed, ['min']);
});

test('preflight rejects a changed same-name radio peer', () => {
  const dom = makeDom();
  const item = plain(run(dom, bridge.scrapePage, 'session-radio-change')).campi
    .find((field) => field.tipo === 'radio');
  dom.window.document.querySelector('#radio-no').value = 'altro';

  const result = plain(run(
    dom, bridge.preflightFields, [propose(item)], 'session-radio-change'
  ));

  assert.equal(result.ok, false);
  assert.deepEqual(result.results[0].changed, ['radioPeers']);
});

test('preflight requires the complete field identity snapshot', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-identity')).campi;
  const text = fields.find((field) => field.tipo === 'text');
  const radio = fields.find((field) => field.tipo === 'radio');
  const cases = [
    [text, 'tag', 'textarea'],
    [text, 'tipo', 'email'],
    [radio, 'name', 'different-group'],
    [radio, 'optionValue', 'different-option'],
    [radio, 'checked', false],
    [text, 'sezione', 'Quadro diverso'],
    [text, 'contesto', 'Rigo diverso']
  ];

  for (const [source, property, staleValue] of cases) {
    const item = structuredClone(source);
    item[property] = staleValue;
    const result = plain(run(
      dom, bridge.preflightFields, [propose(item)], 'session-identity'
    ));
    assert.equal(result.ok, false, property);
    assert.ok(result.results[0].changed.includes(property), property);
  }
});

test('fills every supported control with native setters and field events', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-fill')).campi;
  const byType = new Map(fields.map((field) => [field.tipo, field]));
  const text = dom.window.document.querySelector('#testo');
  Object.defineProperty(text, 'value', {
    configurable: true,
    set() { throw new Error('own setter must not run'); }
  });
  const events = [];
  const clicks = [];
  for (const element of dom.window.document.querySelectorAll('input,select,textarea,button')) {
    element.addEventListener('input', () => events.push(`input:${element.id}`));
    element.addEventListener('change', () => events.push(`change:${element.id}`));
    element.addEventListener('click', () => clicks.push(element.id));
  }
  const items = [
    [byType.get('text'), '1500'],
    [byType.get('number'), '30'],
    [byType.get('date'), '2025-06-03'],
    [byType.get('month'), '2025-06'],
    [byType.get('email'), 'luigi@example.test'],
    [byType.get('tel'), '06999999'],
    [byType.get('select'), 'Regime semplificato'],
    [byType.get('textarea'), 'Nuove note'],
    [byType.get('checkbox'), 'false'],
    [fields.find((field) => field.localId === 10), 'true']
  ].map(([field, valore]) => ({ localId: field.localId, valore }));

  const result = plain(run(dom, bridge.fillFields, items, 'session-fill'));
  const nativeTextValue = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype, 'value'
  ).get.call(text);

  assert.equal(result.ok, true);
  assert.equal(result.partial, false);
  assert.equal(result.results.every((entry) => entry.ok), true);
  assert.deepEqual([
    nativeTextValue,
    dom.window.document.querySelector('#numero').value,
    dom.window.document.querySelector('#data').value,
    dom.window.document.querySelector('#mese').value,
    dom.window.document.querySelector('#email').value,
    dom.window.document.querySelector('#telefono').value,
    dom.window.document.querySelector('#regime').value,
    dom.window.document.querySelector('#note').value,
    dom.window.document.querySelector('#conferma').checked,
    dom.window.document.querySelector('#radio-no').checked
  ], [
    '1500', '30', '2025-06-03', '2025-06', 'luigi@example.test',
    '06999999', 'semplificato', 'Nuove note', false, true
  ]);
  assert.deepEqual(clicks, ['conferma', 'radio-no']);
  assert.equal(events.length, 20);
});

test('reports runtime failures when synchronous handlers revert filled values', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-revert')).campi;
  const text = fields.find((field) => field.tipo === 'text');
  const select = fields.find((field) => field.tipo === 'select');
  const textElement = dom.window.document.querySelector('#testo');
  const selectElement = dom.window.document.querySelector('#regime');
  const inputValue = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype, 'value'
  );
  const selectValue = Object.getOwnPropertyDescriptor(
    dom.window.HTMLSelectElement.prototype, 'value'
  );
  textElement.addEventListener('input', () => {
    inputValue.set.call(textElement, '1000');
  });
  selectElement.addEventListener('change', () => {
    selectValue.set.call(selectElement, 'ordinario');
  });

  const result = plain(run(dom, bridge.fillFields, [
    { localId: text.localId, valore: '1500' },
    { localId: select.localId, valore: 'Regime semplificato' }
  ], 'session-revert'));

  assert.deepEqual({
    ok: result.ok,
    partial: result.partial,
    codes: result.results.map((entry) => entry.code),
    values: [textElement.value, selectElement.value]
  }, {
    ok: false,
    partial: false,
    codes: ['RUNTIME_FAILURE', 'RUNTIME_FAILURE'],
    values: ['1000', 'ordinario']
  });
});

test('requires exact select labels and only allows selecting a radio as true', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-exact')).campi;
  const select = fields.find((field) => field.tipo === 'select');
  const radioNo = fields.find((field) => field.localId === 10);

  const result = plain(run(dom, bridge.fillFields, [
    { localId: select.localId, valore: 'semplificato' },
    { localId: radioNo.localId, valore: 'false' }
  ], 'session-exact'));

  assert.equal(result.ok, false);
  assert.equal(result.partial, false);
  assert.equal(result.results.every((entry) => !entry.ok), true);
  assert.equal(dom.window.document.querySelector('#regime').value, 'ordinario');
  assert.equal(dom.window.document.querySelector('#radio-no').checked, false);
});

test('uses full identical select-label normalization and rejects ambiguity', () => {
  const longDom = makeDom();
  const longField = plain(run(
    longDom, bridge.scrapePage, 'session-long-label'
  )).campi.find((field) => field.tipo === 'select');
  const longOptions = Array.from(longDom.window.document.querySelectorAll(
    '#regime option[value^="long-"]'
  ));
  const labels = longOptions.map((option) =>
    option.textContent.replace(/\s+/g, ' ').trim()
  );
  const longPreflight = plain(run(longDom, bridge.preflightFields, [
    propose(longField, labels[1])
  ], 'session-long-label'));
  const longFill = plain(run(longDom, bridge.fillFields, [{
    localId: longField.localId, valore: labels[1]
  }], 'session-long-label'));

  const ambiguousDom = makeDom();
  const ambiguousField = plain(run(
    ambiguousDom, bridge.scrapePage, 'session-ambiguous'
  )).campi.find((field) => field.tipo === 'select');
  const ambiguousPreflight = plain(run(
    ambiguousDom, bridge.preflightFields,
    [propose(ambiguousField, 'Scelta ambigua')], 'session-ambiguous'
  ));
  const ambiguousFill = plain(run(ambiguousDom, bridge.fillFields, [{
    localId: ambiguousField.localId, valore: 'Scelta ambigua'
  }], 'session-ambiguous'));

  assert.deepEqual({
    fullLabels: longField.opzioni.filter((label) => label.startsWith('Etichetta')),
    distinctAfter80: labels[0].slice(0, 80) === labels[1].slice(0, 80) &&
      labels[0] !== labels[1],
    long: [longPreflight.ok, longFill.ok,
      longDom.window.document.querySelector('#regime').value],
    ambiguous: [ambiguousPreflight.ok, ambiguousFill.ok,
      ambiguousDom.window.document.querySelector('#regime').value]
  }, {
    fullLabels: labels,
    distinctAfter80: true,
    long: [true, true, 'long-b'],
    ambiguous: [false, false, 'ordinario']
  });
});

test('reports a partial runtime failure without saving or submitting', () => {
  const dom = makeDom();
  const fields = plain(run(dom, bridge.scrapePage, 'session-partial')).campi;
  const text = fields.find((field) => field.tipo === 'text');
  const number = fields.find((field) => field.tipo === 'number');
  const prototype = dom.window.HTMLInputElement.prototype;
  const nativeValue = Object.getOwnPropertyDescriptor(prototype, 'value');
  Object.defineProperty(prototype, 'value', {
    configurable: true,
    get: nativeValue.get,
    set(value) {
      if (this.id === 'numero') throw new Error('runtime fixture failure');
      nativeValue.set.call(this, value);
    }
  });
  let submits = 0;
  let saveClicks = 0;
  dom.window.document.querySelector('#tax-form')
    .addEventListener('submit', (event) => { submits += 1; event.preventDefault(); });
  dom.window.document.querySelector('#fake-save')
    .addEventListener('click', () => { saveClicks += 1; });

  const result = plain(run(dom, bridge.fillFields, [
    { localId: text.localId, valore: '1500' },
    { localId: number.localId, valore: '30' }
  ], 'session-partial'));

  assert.deepEqual({
    ok: result.ok,
    partial: result.partial,
    changed: result.changed,
    failed: result.failed,
    statuses: result.results.map((entry) => entry.ok)
  }, {
    ok: false,
    partial: true,
    changed: [text.localId],
    failed: [number.localId],
    statuses: [true, false]
  });
  assert.deepEqual([submits, saveClicks], [0, 0]);
});

test('exports three autonomous CommonJS and browser functions', () => {
  const expected = ['fillFields', 'preflightFields', 'scrapePage'];
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'page-bridge.js'),
    'utf8'
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);

  assert.deepEqual(Object.keys(bridge).sort(), expected);
  assert.deepEqual(Object.keys(context.DichiarerPageBridge).sort(), expected);
  for (const name of expected) {
    assert.equal(typeof context.DichiarerPageBridge[name], 'function');
  }
});
