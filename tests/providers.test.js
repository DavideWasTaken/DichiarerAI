'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const core = require('../lib/core.js');
const providers = require('../lib/providers.js');
const anthropicSuccess = require('./fixtures/anthropic-success.json');
const openAISuccess = require('./fixtures/openai-success.json');

const input = {
  systemPrompt: 'Usa soltanto fonti ufficiali.',
  prompt: 'Analizza i campi disponibili.',
  attachments: []
};

test('builds an OpenAI Responses request with grounded web search', () => {
  const request = providers.buildOpenAIRequest(input);

  assert.equal(request.tools[0].type, 'web_search');
  assert.deepEqual(
    request.tools[0].filters.allowed_domains,
    core.OFFICIAL_SOURCE_DOMAINS
  );
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.tools[0].search_context_size, 'low');
  assert.deepEqual(request.include, ['web_search_call.action.sources']);
  assert.equal(request.text.format.type, 'json_schema');
  assert.deepEqual(
    request.text.format.schema.properties.compilazioni.items.required,
    ['id', 'valore', 'motivo', 'fonti']
  );
  assert.equal(request.text.format.strict, true);
  assert.equal(request.model, 'gpt-5.6');
  assert.equal(request.instructions, input.systemPrompt);
  assert.deepEqual(request.input[0].content, [
    { type: 'input_text', text: input.prompt }
  ]);
});

test('maps a PDF attachment to an OpenAI input_file block', () => {
  const request = providers.buildOpenAIRequest({
    ...input,
    attachments: [{
      kind: 'pdf',
      name: 'documento.pdf',
      mediaType: 'application/pdf',
      data: 'JVBERi0x'
    }]
  });

  assert.deepEqual(request.input[0].content[0], {
    type: 'input_file',
    filename: 'documento.pdf',
    file_data: 'data:application/pdf;base64,JVBERi0x'
  });
});

test('maps an image attachment to an OpenAI input_image block', () => {
  const request = providers.buildOpenAIRequest({
    ...input,
    attachments: [{
      kind: 'image',
      name: 'ricevuta.png',
      mediaType: 'image/png',
      data: 'iVBORw0KGgo='
    }]
  });

  assert.deepEqual(request.input[0].content[0], {
    type: 'input_image',
    image_url: 'data:image/png;base64,iVBORw0KGgo='
  });
});

test('maps text and converted-workbook attachments to OpenAI input_file blocks', () => {
  const request = providers.buildOpenAIRequest({
    ...input,
    attachments: [
      {
        kind: 'text',
        name: 'dati.csv',
        mediaType: 'text/csv',
        text: 'anno,valore\n2024,10'
      },
      {
        kind: 'text',
        name: 'report.xlsx.csv',
        mediaType: 'text/csv',
        text: '--- Foglio: Dati ---\nA,B'
      }
    ]
  });

  assert.deepEqual(request.input[0].content, [
    {
      type: 'input_file',
      filename: 'dati.csv',
      file_data: 'data:text/csv;base64,YW5ubyx2YWxvcmUKMjAyNCwxMA=='
    },
    {
      type: 'input_file',
      filename: 'report.xlsx.csv',
      file_data: 'data:text/csv;base64,LS0tIEZvZ2xpbzogRGF0aSAtLS0KQSxC'
    },
    { type: 'input_text', text: input.prompt }
  ]);
});

test('parses OpenAI output text and normalizes search metadata', () => {
  const parsed = providers.parseOpenAIResponse(openAISuccess);

  assert.deepEqual(parsed, {
    result: {
      spiegazione: 'Proposta verificata.',
      compilazioni: [{
        id: 10,
        valore: '6996',
        motivo: 'Importo documentato.',
        fonti: ['https://www.agenziaentrate.gov.it/portale/istruzioni-2025']
      }],
      avvertenze: []
    },
    sources: [
      {
        title: 'Istruzioni dichiarazione 2025',
        url: 'https://www.agenziaentrate.gov.it/portale/istruzioni-2025'
      },
      {
        title: 'infoprecompilata.agenziaentrate.gov.it/portale/guida-generale',
        url: 'https://infoprecompilata.agenziaentrate.gov.it/portale/guida-generale'
      }
    ],
    searchCount: 1
  });
});

test('rejects an OpenAI refusal with a typed safe error', () => {
  const refusal = {
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'refusal', refusal: 'raw unsafe provider detail' }]
    }]
  };

  assert.throws(
    () => providers.parseOpenAIResponse(refusal),
    (error) => error.name === 'ProviderError' &&
      error.code === 'REFUSAL' &&
      !error.message.includes('raw unsafe provider detail')
  );
});

test('rejects an incomplete OpenAI response', () => {
  const incomplete = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: []
  };

  assert.throws(
    () => providers.parseOpenAIResponse(incomplete),
    (error) => error.code === 'TRUNCATED'
  );
});

test('rejects a truncated OpenAI output message', () => {
  const truncated = {
    status: 'completed',
    output: [{ type: 'message', status: 'incomplete', content: [] }]
  };

  assert.throws(
    () => providers.parseOpenAIResponse(truncated),
    (error) => error.code === 'TRUNCATED'
  );
});

test('rejects malformed OpenAI JSON with a typed error', () => {
  const malformed = structuredClone(openAISuccess);
  malformed.output[1].content[0].text = '{not json';

  assert.throws(
    () => providers.parseOpenAIResponse(malformed),
    (error) => error.code === 'MALFORMED_RESPONSE'
  );
});

test('rejects more than three OpenAI web-search calls', () => {
  const excessive = structuredClone(openAISuccess);
  const searchCall = excessive.output[0];
  excessive.output.unshift(
    structuredClone(searchCall),
    structuredClone(searchCall),
    structuredClone(searchCall)
  );

  assert.throws(
    () => providers.parseOpenAIResponse(excessive),
    (error) => error.code === 'SEARCH_LIMIT'
  );
});

test('rejects an OpenAI response without web-search metadata', () => {
  const missingSearch = structuredClone(openAISuccess);
  missingSearch.output.shift();

  assert.throws(
    () => providers.parseOpenAIResponse(missingSearch),
    (error) => error.code === 'SEARCH_REQUIRED'
  );
});

test('rejects an OpenAI search call without accepted sources', () => {
  const missingSources = structuredClone(openAISuccess);
  missingSources.output[0].action.sources = [];

  assert.throws(
    () => providers.parseOpenAIResponse(missingSources),
    (error) => error.code === 'MISSING_SEARCH_METADATA'
  );
});

test('rejects failed or nonterminal OpenAI response items', () => {
  const cases = [];
  for (const status of ['failed', 'cancelled', 'queued', 'in_progress']) {
    const response = structuredClone(openAISuccess);
    response.status = status;
    cases.push(response);
  }
  const failedSearch = structuredClone(openAISuccess);
  failedSearch.output[0].status = 'failed';
  cases.push(failedSearch);

  for (const response of cases) {
    assert.throws(
      () => providers.parseOpenAIResponse(response),
      (error) => error.name === 'ProviderError' &&
        error.provider === 'openai' &&
        error.code === 'RESPONSE_STATE'
    );
  }
});

test('builds an Anthropic request with hosted web search', () => {
  const request = providers.buildAnthropicRequest(input, 3);

  assert.equal(request.tools[0].type, 'web_search_20250305');
  assert.deepEqual(request.tools[0].allowed_domains, core.OFFICIAL_SOURCE_DOMAINS);
  assert.equal(providers.buildAnthropicRequest(input, 7).tools[0].max_uses, 3);
});

test('builds Anthropic document, image, text and JSON prompt blocks', () => {
  const request = providers.buildAnthropicRequest({
    ...input,
    attachments: [
      {
        kind: 'pdf', name: 'documento.pdf',
        mediaType: 'application/pdf', data: 'JVBERg=='
      },
      {
        kind: 'image', name: 'ricevuta.png',
        mediaType: 'image/png', data: 'iVBORw=='
      },
      { kind: 'text', name: 'dati.csv', text: 'anno,valore' }
    ]
  }, 2);

  assert.deepEqual([
    request.model,
    request.max_tokens,
    request.system,
    request.messages[0].content[0],
    request.messages[0].content[1],
    request.messages[0].content[2],
    request.messages[0].content[3].type,
    request.messages[0].content[3].text.includes(input.prompt),
    request.messages[0].content[3].text.includes('"fonti"')
  ], [
    'claude-sonnet-5',
    16000,
    input.systemPrompt,
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' },
      title: 'documento.pdf'
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' }
    },
    {
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: 'anno,valore' },
      title: 'dati.csv'
    },
    'text',
    true,
    true
  ]);
});

test('parses Anthropic JSON and normalizes search sources', () => {
  const parsed = providers.parseAnthropicResponse(anthropicSuccess);

  assert.deepEqual(parsed, {
    result: {
      spiegazione: 'Proposta verificata.',
      compilazioni: [{
        id: 10,
        valore: '6996',
        motivo: 'Importo documentato.',
        fonti: ['https://www.agenziaentrate.gov.it/portale/istruzioni-2025']
      }],
      avvertenze: []
    },
    sources: [
      {
        title: 'Istruzioni dichiarazione 2025',
        url: 'https://www.agenziaentrate.gov.it/portale/istruzioni-2025'
      },
      {
        title: 'infoprecompilata.agenziaentrate.gov.it/portale/guida-generale',
        url: 'https://infoprecompilata.agenziaentrate.gov.it/portale/guida-generale'
      }
    ],
    searchCount: 1,
    pauseTurn: false,
    assistantContent: anthropicSuccess.content
  });
});

test('rejects more than three Anthropic web searches', () => {
  const excessive = structuredClone(anthropicSuccess);
  excessive.usage.server_tool_use.web_search_requests = 4;

  assert.throws(
    () => providers.parseAnthropicResponse(excessive),
    (error) => error.code === 'SEARCH_LIMIT'
  );
});

test('surfaces Anthropic pause_turn content without deciding continuation', () => {
  const paused = structuredClone(anthropicSuccess);
  paused.stop_reason = 'pause_turn';
  paused.content = paused.content.filter((block) => block.type !== 'text');

  const parsed = providers.parseAnthropicResponse(paused);
  assert.deepEqual(
    [parsed.pauseTurn, parsed.result, parsed.assistantContent],
    [true, null, paused.content]
  );
});

test('rejects an Anthropic refusal with a typed safe error', () => {
  const refusal = structuredClone(anthropicSuccess);
  refusal.stop_reason = 'refusal';
  refusal.content[2].text = 'raw unsafe refusal detail';

  assert.throws(
    () => providers.parseAnthropicResponse(refusal),
    (error) => error.name === 'ProviderError' &&
      error.provider === 'anthropic' &&
      error.code === 'REFUSAL' &&
      !error.message.includes('raw unsafe refusal detail')
  );
});

test('rejects a truncated Anthropic response with a distinct typed error', () => {
  for (const stopReason of ['max_tokens', 'model_context_window_exceeded']) {
    const truncated = structuredClone(anthropicSuccess);
    truncated.stop_reason = stopReason;
    truncated.content[2].text = 'partial raw provider output';

    assert.throws(
      () => providers.parseAnthropicResponse(truncated),
      (error) => error.name === 'ProviderError' &&
        error.provider === 'anthropic' &&
        error.code === 'TRUNCATED' &&
        !error.message.includes('partial raw provider output')
    );
  }
});

test('requires official Anthropic search metadata on terminal responses', () => {
  const noSources = structuredClone(anthropicSuccess);
  noSources.content = noSources.content.filter((block) =>
    block.type !== 'web_search_tool_result'
  );
  noSources.content.find((block) => block.type === 'text').citations = [];

  const failedSearch = structuredClone(anthropicSuccess);
  failedSearch.content[1] = {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_fixture',
    content: [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
  };
  failedSearch.content.find((block) => block.type === 'text').citations = [];

  for (const response of [noSources, failedSearch]) {
    assert.throws(
      () => providers.parseAnthropicResponse(response),
      (error) => error.name === 'ProviderError' &&
        error.code === 'MISSING_SEARCH_METADATA'
    );
  }
});

test('maps malformed provider structures to safe typed errors', () => {
  const nestedSearch = structuredClone(anthropicSuccess);
  nestedSearch.content[1].content = [null];
  const nestedCitation = structuredClone(anthropicSuccess);
  nestedCitation.content[2].citations = [null];
  const malformed = [
    () => providers.parseOpenAIResponse(null),
    () => providers.parseOpenAIResponse({ status: 'completed', output: [null] }),
    () => providers.parseAnthropicResponse(null),
    () => providers.parseAnthropicResponse({ stop_reason: 'end_turn', content: [null] }),
    () => providers.parseAnthropicResponse(nestedSearch),
    () => providers.parseAnthropicResponse(nestedCitation)
  ];

  for (const parse of malformed) {
    assert.throws(
      parse,
      (error) => error.name === 'ProviderError' &&
        error.code === 'MALFORMED_RESPONSE'
    );
  }
});

test('does not expose mutable shared result schemas', () => {
  const first = providers.buildOpenAIRequest(input);
  first.text.format.schema.properties.compilazioni.items.required.length = 0;
  first.text.format.schema.properties.spiegazione.type = 'number';

  const second = providers.buildOpenAIRequest(input);
  const anthropic = providers.buildAnthropicRequest(input, 1);
  const prompt = anthropic.messages[0].content.at(-1).text;

  assert.deepEqual(
    second.text.format.schema.properties.compilazioni.items.required,
    ['id', 'valore', 'motivo', 'fonti']
  );
  assert.equal(second.text.format.schema.properties.spiegazione.type, 'string');
  assert.match(prompt, /"required":\["id","valore","motivo","fonti"\]/);
});

test('classifies provider HTTP failures as typed safe errors', () => {
  const cases = [
    providers.classifyProviderError('openai', 401, {
      error: { message: 'secret raw body' }
    }, {}),
    providers.classifyProviderError('anthropic', 429, {}, {
      'retry-after': '12'
    }),
    providers.classifyProviderError('openai', 400, {
      error: { message: 'web_search is not supported' }
    }, {}),
    providers.classifyProviderError('anthropic', 404, {}, {}),
    providers.classifyProviderError('openai', 500, {}, {})
  ];

  assert.deepEqual(cases.map((error) => ({
    name: error.name,
    provider: error.provider,
    status: error.status,
    code: error.code,
    retryAfter: error.retryAfter,
    safe: !error.message.includes('secret raw body')
  })), [
    {
      name: 'ProviderError', provider: 'openai', status: 401,
      code: 'API_KEY', retryAfter: undefined, safe: true
    },
    {
      name: 'ProviderError', provider: 'anthropic', status: 429,
      code: 'RATE_LIMIT', retryAfter: '12', safe: true
    },
    {
      name: 'ProviderError', provider: 'openai', status: 400,
      code: 'SEARCH_UNAVAILABLE', retryAfter: undefined, safe: true
    },
    {
      name: 'ProviderError', provider: 'anthropic', status: 404,
      code: 'MODEL_UNAVAILABLE', retryAfter: undefined, safe: true
    },
    {
      name: 'ProviderError', provider: 'openai', status: 500,
      code: 'API_ERROR', retryAfter: undefined, safe: true
    }
  ]);
});

test('builds billable capability probes with each grounded search tool', () => {
  const openai = providers.buildCapabilityProbe('openai', 'gpt-probe');
  const anthropic = providers.buildCapabilityProbe('anthropic', 'claude-probe');

  assert.deepEqual({
    openAIEndpoint: openai.endpoint,
    openAIModel: openai.body.model,
    openAITool: openai.body.tools[0],
    openAIInputs: openai.body.input[0].content.map((block) => block.type),
    anthropicEndpoint: anthropic.endpoint,
    anthropicModel: anthropic.body.model,
    anthropicTool: anthropic.body.tools[0],
    anthropicInputs: anthropic.body.messages[0].content.map((block) => block.type),
    warning: /addeb|costo|pagamento/i.test(openai.warning) &&
      openai.warning === anthropic.warning
  }, {
    openAIEndpoint: '/v1/responses',
    openAIModel: 'gpt-probe',
    openAITool: {
      type: 'web_search',
      filters: { allowed_domains: core.OFFICIAL_SOURCE_DOMAINS },
      search_context_size: 'low'
    },
    openAIInputs: ['input_file', 'input_image', 'input_text'],
    anthropicEndpoint: '/v1/messages',
    anthropicModel: 'claude-probe',
    anthropicTool: {
      type: 'web_search_20250305',
      name: 'web_search',
      allowed_domains: core.OFFICIAL_SOURCE_DOMAINS,
      max_uses: 1
    },
    anthropicInputs: ['document', 'image', 'text'],
    warning: true
  });
});

test('preserves caller-owned Anthropic continuation history', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'originale' }] },
    { role: 'assistant', content: anthropicSuccess.content }
  ];
  const request = providers.buildAnthropicRequest({ ...input, messages }, 2);

  assert.deepEqual(request.messages, messages);
});

test('strictly rejects an invalid Anthropic result contract', () => {
  const invalid = structuredClone(anthropicSuccess);
  invalid.content[2].text = JSON.stringify({
    spiegazione: 'x', compilazioni: [], avvertenze: [], extra: true
  });

  assert.throws(
    () => providers.parseAnthropicResponse(invalid),
    (error) => error.code === 'MALFORMED_RESPONSE'
  );
});

test('rejects malformed Anthropic JSON with a typed error', () => {
  const malformed = structuredClone(anthropicSuccess);
  malformed.content[2].text = '{not json';

  assert.throws(
    () => providers.parseAnthropicResponse(malformed),
    (error) => error.code === 'MALFORMED_RESPONSE'
  );
});

test('exports the pure CommonJS and browser UMD adapter surface', () => {
  const expected = [
    'buildAnthropicRequest',
    'buildCapabilityProbe',
    'buildOpenAIRequest',
    'classifyProviderError',
    'parseAnthropicResponse',
    'parseOpenAIResponse'
  ];
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'providers.js'),
    'utf8'
  );
  const context = vm.createContext({
    DichiarerCore: core,
    URL
  });
  vm.runInContext(source, context);

  assert.deepEqual({
    commonJS: Object.keys(providers).sort(),
    browser: Object.keys(context.DichiarerProviders).sort(),
    hasFetch: /\bfetch\s*\(/.test(source),
    hasKeyInput: /apiKey|x-api-key|authorization/i.test(source)
  }, {
    commonJS: expected,
    browser: expected,
    hasFetch: false,
    hasKeyInput: false
  });
});
