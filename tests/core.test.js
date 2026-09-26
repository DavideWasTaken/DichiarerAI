'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const core = require('../lib/core.js');

const years = { declarationYear: 2025, incomeYear: 2024 };
const official2025 = 'https://www.agenziaentrate.gov.it/portale/guida-2025';
const official2024 = 'https://infoprecompilata.agenziaentrate.gov.it/portale/redditi-2024';
const officialGeneral = 'https://www.agenziaentrate.gov.it/portale/guida-generale';
const providerSources = [
  { title: 'Istruzioni 2025', url: official2025 },
  { title: 'Guida redditi 2024', url: official2024 },
  { title: 'Guida generale', url: officialGeneral }
];
const fields = [
  { id: 7, tipo: 'checkbox', opzioni: [] },
  { id: 8, tipo: 'radio', opzioni: [] },
  { id: 9, tipo: 'select', opzioni: ['Ordinario', 'Regime semplificato'] },
  { id: 10, tipo: 'text', opzioni: [] }
];

test('accepts an official Revenue Agency URL', () => {
  assert.deepEqual(core.OFFICIAL_SOURCE_DOMAINS, [
    'agenziaentrate.gov.it',
    'infoprecompilata.agenziaentrate.gov.it'
  ]);
  assert.equal(
    core.isOfficialSource('https://www.agenziaentrate.gov.it/portale/'),
    true
  );
  assert.equal(core.isOfficialSource('https://agenziaentrate.gov.it/'), true);
  assert.equal(
    core.isOfficialSource('https://infoprecompilata.agenziaentrate.gov.it/portale/guida'),
    true
  );
  assert.equal(core.isOfficialSource('http://agenziaentrate.gov.it/'), false);
  assert.equal(
    core.isOfficialSource('https://agenziaentrate.gov.it.evil.example/'),
    false
  );
  assert.equal(core.isOfficialSource('not a URL'), false);
});

test('exported domain mutations cannot weaken source validation', () => {
  const originalDomains = core.OFFICIAL_SOURCE_DOMAINS.slice();
  const maliciousUrl = 'https://evil.example/guida-2025';
  const result = {
    spiegazione: 'Proposta.',
    compilazioni: [{
      id: 10,
      valore: '6996',
      motivo: 'Importo documentato.',
      fonti: [maliciousUrl]
    }],
    avvertenze: []
  };

  try {
    try {
      core.OFFICIAL_SOURCE_DOMAINS.push('evil.example');
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }

    assert.deepEqual(core.OFFICIAL_SOURCE_DOMAINS, originalDomains);
    assert.equal(core.isOfficialSource(maliciousUrl), false);
    assert.throws(() => core.validateResult(
      result,
      fields,
      [{ title: 'Fonte malevola 2025', url: maliciousUrl }],
      years
    ));
  } finally {
    if (!Object.isFrozen(core.OFFICIAL_SOURCE_DOMAINS)) {
      core.OFFICIAL_SOURCE_DOMAINS.splice(
        0,
        core.OFFICIAL_SOURCE_DOMAINS.length,
        ...originalDomains
      );
    }
  }
});

test('exports the stable CommonJS and browser UMD surface', () => {
  const expected = [
    'OFFICIAL_SOURCE_DOMAINS',
    'buildSystemPrompt',
    'filterOfficialSources',
    'isOfficialSource',
    'isTaxFormMarker',
    'isTaxReturnUrl',
    'normalizeOfficialSource',
    'serializeFields',
    'validateResult'
  ];
  assert.deepEqual(Object.keys(core).sort(), expected);

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'core.js'),
    'utf8'
  );
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);
  assert.deepEqual(
    Object.keys(context.DichiarerCore).sort(),
    expected
  );
});

test('rejects source URLs with credentials or nonstandard ports', () => {
  assert.equal(
    core.isOfficialSource('https://user@agenziaentrate.gov.it/portale/'),
    false
  );
  assert.equal(
    core.isOfficialSource('https://agenziaentrate.gov.it:8443/portale/'),
    false
  );
});

test('normalizes an official source and removes its fragment', () => {
  assert.deepEqual(
    core.normalizeOfficialSource({
      title: '  ',
      url: 'https://www.agenziaentrate.gov.it/portale/guida?anno=2025#capitolo'
    }),
    {
      title: 'www.agenziaentrate.gov.it/portale/guida',
      url: 'https://www.agenziaentrate.gov.it/portale/guida?anno=2025'
    }
  );
  assert.equal(
    core.normalizeOfficialSource({ url: 'https://example.com/guida' }),
    null
  );
});

test('filters official sources by the two confirmed years', () => {
  const sources = [
    {
      title: 'Istruzioni dichiarazione 2025',
      url: 'https://www.agenziaentrate.gov.it/portale/modelli'
    },
    {
      title: 'Guida per i redditi 2024',
      url: 'https://infoprecompilata.agenziaentrate.gov.it/portale/guida'
    },
    {
      title: 'Istruzioni 2023',
      url: 'https://www.agenziaentrate.gov.it/portale/archivio-2023'
    },
    {
      title: 'Guida generale',
      url: 'https://www.agenziaentrate.gov.it/portale/guida-generale'
    },
    {
      title: 'Sito non ufficiale 2025',
      url: 'https://example.com/2025'
    }
  ];

  assert.deepEqual(
    core.filterOfficialSources(sources, {
      declarationYear: 2025,
      incomeYear: 2024
    }),
    [
      {
        title: 'Istruzioni dichiarazione 2025',
        url: 'https://www.agenziaentrate.gov.it/portale/modelli'
      },
      {
        title: 'Guida per i redditi 2024',
        url: 'https://infoprecompilata.agenziaentrate.gov.it/portale/guida'
      },
      {
        title: 'Guida generale',
        url: 'https://www.agenziaentrate.gov.it/portale/guida-generale'
      }
    ]
  );
});

test('deduplicates official sources after URL normalization', () => {
  const sources = [
    {
      title: 'Prima voce',
      url: 'https://www.agenziaentrate.gov.it/portale/guida#uno'
    },
    {
      title: 'Seconda voce',
      url: 'https://www.agenziaentrate.gov.it/portale/guida#due'
    }
  ];

  assert.deepEqual(core.filterOfficialSources(sources, {}), [
    {
      title: 'Prima voce',
      url: 'https://www.agenziaentrate.gov.it/portale/guida'
    }
  ]);
});

test('accepts only the exact HTTPS tax-return application host', () => {
  const host = 'dichiarazioneprecompilata.agenziaentrate.gov.it';

  assert.equal(core.isTaxReturnUrl(`https://${host}/section/730`), true);
  assert.equal(core.isTaxReturnUrl(`https://${host}:443/section/730`), true);
  assert.equal(core.isTaxReturnUrl(`http://${host}/section/730`), false);
  assert.equal(core.isTaxReturnUrl(`https://www.${host}/section/730`), false);
  assert.equal(core.isTaxReturnUrl(`https://${host}.evil.example/`), false);
  assert.equal(core.isTaxReturnUrl(`https://user@${host}/`), false);
  assert.equal(core.isTaxReturnUrl(`https://${host}:8443/`), false);
});

test('recognizes tax-form headings and row markers', () => {
  for (const marker of [
    'Dichiarazione precompilata',
    'Modello 730',
    'Redditi persone fisiche',
    'Quadro T',
    'Rigo T11',
    'T11'
  ]) {
    assert.equal(core.isTaxFormMarker(marker), true, marker);
  }

  assert.equal(core.isTaxFormMarker('Pagina informativa generica'), false);
  assert.equal(core.isTaxFormMarker(null), false);
});

test('serializes only compact privacy-safe field metadata by default', () => {
  const fields = [{
    id: 0,
    localId: 'private-dom-id',
    name: 'private-field-name',
    tipo: 'text',
    etichetta: '  Corrispettivi  ',
    sezione: '  Quadro T ',
    contesto: '  Rigo   T11 ',
    opzioni: [],
    valore: '6996',
    required: true,
    readSessionId: 'secret-session'
  }];

  assert.deepEqual(core.serializeFields(fields, false)[0], {
    id: 0,
    tipo: 'text',
    etichetta: 'Corrispettivi',
    sezione: 'Quadro T',
    contesto: 'Rigo T11',
    opzioni: []
  });
});

test('includes current values only when explicitly requested', () => {
  const fields = [{
    id: 7,
    tipo: 'checkbox',
    etichetta: 'Conferma',
    sezione: '',
    contesto: 'Rigo E7',
    opzioni: [],
    valore: true
  }];
  const before = structuredClone(fields);

  assert.deepEqual(core.serializeFields(fields, true)[0], {
    id: 7,
    tipo: 'checkbox',
    etichetta: 'Conferma',
    sezione: '',
    contesto: 'Rigo E7',
    opzioni: [],
    valore: 'true'
  });
  assert.deepEqual(fields, before);
});

test('builds a year-confirmed prompt with the source and trust policy', () => {
  const prompt = core.buildSystemPrompt({
    declarationYear: 2025,
    incomeYear: 2024
  });

  assert.match(prompt, /Anno della dichiarazione: 2025/);
  assert.match(prompt, /Anno dei redditi: 2024/);
  assert.match(prompt, /contenuto non attendibile/i);
  assert.match(prompt, /fonti ufficiali correnti/i);
  assert.match(prompt, /compilazioni.*vuoto/i);
  assert.match(prompt, /italiano/i);
});

test('requires the exact top-level result contract', () => {
  const valid = {
    spiegazione: 'Nessuna modifica.',
    compilazioni: [],
    avvertenze: ['Verificare i dati.']
  };

  assert.deepEqual(core.validateResult(valid, [], [], years), valid);
  assert.notEqual(core.validateResult(valid, [], [], years), valid);

  for (const malformed of [
    null,
    [],
    { spiegazione: 'x', compilazioni: [] },
    { spiegazione: 'x', compilazioni: {}, avvertenze: [] },
    { spiegazione: 'x', compilazioni: [], avvertenze: [], fonti: [] }
  ]) {
    assert.throws(() => core.validateResult(malformed, [], [], years));
  }
});

test('requires the exact shape and primitive types for each proposal', () => {
  const proposal = {
    id: 10,
    valore: '6996',
    motivo: 'Importo documentato.',
    fonti: []
  };
  const wrap = (item) => ({
    spiegazione: 'Proposta.',
    compilazioni: [item],
    avvertenze: []
  });

  for (const malformed of [
    { id: 10, valore: '6996', motivo: 'x' },
    { ...proposal, extra: true },
    { ...proposal, id: '10' },
    { ...proposal, valore: 6996 },
    { ...proposal, motivo: null },
    { ...proposal, fonti: [42] }
  ]) {
    assert.throws(() => core.validateResult(wrap(malformed), fields, [], years));
  }
});

test('rejects unknown and duplicate proposal IDs', () => {
  const proposal = (id) => ({
    id,
    valore: '1',
    motivo: 'Motivo.',
    fonti: [officialGeneral]
  });
  const wrap = (compilazioni) => ({
    spiegazione: 'Proposte.',
    compilazioni,
    avvertenze: []
  });

  assert.throws(() => core.validateResult(
    wrap([proposal(99)]),
    fields,
    providerSources,
    years
  ));
  assert.throws(() => core.validateResult(
    wrap([proposal(10), proposal(10)]),
    fields,
    providerSources,
    years
  ));
});

test('rejects every proposal without an individual source', () => {
  const resultWithoutSources = {
    spiegazione: 'Proposta.',
    compilazioni: [{
      id: 10,
      valore: '6996',
      motivo: 'Importo documentato.',
      fonti: []
    }],
    avvertenze: []
  };

  assert.throws(() => core.validateResult(
    resultWithoutSources,
    fields,
    providerSources,
    years
  ));
});

test('accepts only official sources reported by the provider', () => {
  const wrap = (source) => ({
    spiegazione: 'Proposta.',
    compilazioni: [{
      id: 10,
      valore: '6996',
      motivo: 'Importo documentato.',
      fonti: [source]
    }],
    avvertenze: []
  });

  assert.doesNotThrow(() => core.validateResult(
    wrap(officialGeneral),
    fields,
    providerSources,
    years
  ));
  assert.throws(() => core.validateResult(
    wrap('https://www.agenziaentrate.gov.it/portale/non-riportata'),
    fields,
    providerSources,
    years
  ));
  assert.throws(() => core.validateResult(
    wrap('https://example.com/guida-2025'),
    fields,
    providerSources,
    years
  ));
});

test('rejects a reported source that names only an unconfirmed year', () => {
  const wrongYearUrl = 'https://www.agenziaentrate.gov.it/portale/guida-2023';
  const result = {
    spiegazione: 'Proposta.',
    compilazioni: [{
      id: 10,
      valore: '6996',
      motivo: 'Importo documentato.',
      fonti: [wrongYearUrl]
    }],
    avvertenze: []
  };

  assert.throws(() => core.validateResult(
    result,
    fields,
    [{ title: 'Istruzioni 2023', url: wrongYearUrl }],
    years
  ));
});

test('requires exact boolean strings for checkbox and radio values', () => {
  const wrap = (id, valore) => ({
    spiegazione: 'Proposta.',
    compilazioni: [{
      id,
      valore,
      motivo: 'Scelta documentata.',
      fonti: [officialGeneral]
    }],
    avvertenze: []
  });

  assert.doesNotThrow(() => core.validateResult(
    wrap(7, 'true'), fields, providerSources, years
  ));
  assert.doesNotThrow(() => core.validateResult(
    wrap(8, 'false'), fields, providerSources, years
  ));
  for (const invalid of ['TRUE', 'yes', ' true ']) {
    assert.throws(() => core.validateResult(
      wrap(7, invalid), fields, providerSources, years
    ));
  }
});

test('matches select values exactly after whitespace normalization', () => {
  const wrap = (valore) => ({
    spiegazione: 'Proposta.',
    compilazioni: [{
      id: 9,
      valore,
      motivo: 'Regime documentato.',
      fonti: [officialGeneral]
    }],
    avvertenze: []
  });

  const validated = core.validateResult(
    wrap('  Regime   semplificato  '),
    fields,
    providerSources,
    years
  );
  assert.equal(validated.compilazioni[0].valore, 'Regime semplificato');
  assert.throws(() => core.validateResult(
    wrap('regime semplificato'),
    fields,
    providerSources,
    years
  ));
});

test('returns a normalized copy without mutating provider input', () => {
  const input = {
    spiegazione: '  Spiegazione   estesa. ',
    compilazioni: [{
      id: 10,
      valore: '  6996  ',
      motivo: '  Importo   documentato. ',
      fonti: [`${officialGeneral}#capitolo`]
    }],
    avvertenze: ['  Controllare   il dato. ']
  };
  const before = structuredClone(input);

  const validated = core.validateResult(
    input,
    fields,
    providerSources,
    years
  );

  assert.deepEqual(input, before);
  assert.deepEqual(validated, {
    spiegazione: 'Spiegazione estesa.',
    compilazioni: [{
      id: 10,
      valore: '6996',
      motivo: 'Importo documentato.',
      fonti: [officialGeneral]
    }],
    avvertenze: ['Controllare il dato.']
  });
  assert.notEqual(validated.compilazioni[0], input.compilazioni[0]);
  assert.notEqual(validated.compilazioni[0].fonti, input.compilazioni[0].fonti);
});
