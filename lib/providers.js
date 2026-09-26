(function (root, factory) {
  'use strict';

  const core = typeof module === 'object' && module.exports
    ? require('./core.js')
    : root.DichiarerCore;
  const api = factory(core);

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DichiarerProviders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const RESULT_SCHEMA = {
    type: 'object',
    properties: {
      spiegazione: { type: 'string' },
      compilazioni: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 },
            valore: { type: 'string' }, motivo: { type: 'string' },
            fonti: { type: 'array', items: { type: 'string' }, minItems: 1 } },
          required: ['id', 'valore', 'motivo', 'fonti'],
          additionalProperties: false
        }
      },
      avvertenze: { type: 'array', items: { type: 'string' } }
    },
    required: ['spiegazione', 'compilazioni', 'avvertenze'],
    additionalProperties: false
  };

  const isRecord = (value) => Boolean(value) &&
    typeof value === 'object' && !Array.isArray(value);

  function malformed(provider) {
    const label = provider === 'openai' ? 'OpenAI' : 'Anthropic';
    return providerError(provider, 'MALFORMED_RESPONSE', `La risposta ${label} non è valida.`);
  }

  function fail(provider, code, message) {
    throw providerError(provider, code, message);
  }

  function providerError(provider, code, message, details) {
    const error = new Error(message);
    error.name = 'ProviderError'; error.provider = provider;
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function parseJsonResult(text, provider) {
    try {
      if (typeof text !== 'string') throw new TypeError('missing text');
      const result = JSON.parse(text);
      if (!hasExactKeys(result, ['spiegazione', 'compilazioni', 'avvertenze']) ||
          typeof result.spiegazione !== 'string' ||
          !Array.isArray(result.compilazioni) ||
          !Array.isArray(result.avvertenze) ||
          !result.avvertenze.every((item) => typeof item === 'string') ||
          !result.compilazioni.every((item) =>
            hasExactKeys(item, ['id', 'valore', 'motivo', 'fonti']) &&
            Number.isInteger(item.id) && item.id >= 0 &&
            typeof item.valore === 'string' &&
            typeof item.motivo === 'string' &&
            Array.isArray(item.fonti) && item.fonti.length > 0 &&
            item.fonti.every((source) => typeof source === 'string')
          )) {
        throw new TypeError('invalid result');
      }
      return result;
    } catch {
      const label = provider === 'openai' ? 'OpenAI' : 'Anthropic';
      throw providerError(provider, 'MALFORMED_RESPONSE',
        `La risposta ${label} non contiene JSON valido.`);
    }
  }

  function hasExactKeys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    const sortedExpected = expected.slice().sort();
    return keys.length === sortedExpected.length &&
      keys.every((key, index) => key === sortedExpected[index]);
  }

  function textToBase64(value) {
    const text = String(value || '');
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function openAIContent(input) {
    const content = (input.attachments || []).map((attachment) => {
      if (attachment.kind === 'text') {
        return {
          type: 'input_file',
          filename: attachment.name,
          file_data: `data:${attachment.mediaType || 'text/plain'};base64,${textToBase64(attachment.text)}`
        };
      }
      const dataUrl = `data:${attachment.mediaType};base64,${attachment.data}`;
      return attachment.kind === 'image'
        ? { type: 'input_image', image_url: dataUrl }
        : {
            type: 'input_file',
            filename: attachment.name,
            file_data: dataUrl
          };
    });
    content.push({ type: 'input_text', text: input.prompt || '' });
    return content;
  }

  function anthropicContent(input) {
    const content = (input.attachments || []).map((attachment) => {
      if (attachment.kind === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mediaType,
            data: attachment.data
          }
        };
      }
      if (attachment.kind === 'text') {
        return {
          type: 'document',
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: attachment.text || ''
          },
          title: attachment.name
        };
      }
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: attachment.mediaType || 'application/pdf',
          data: attachment.data
        },
        title: attachment.name
      };
    });
    content.push({
      type: 'text',
      text: `${input.prompt || ''}\n\nRestituisci soltanto JSON conforme a questo schema: ${JSON.stringify(RESULT_SCHEMA)}`
    });
    return content;
  }

  function buildOpenAIRequest(input) {
    return {
      model: input && input.model || 'gpt-5.6',
      instructions: input && input.systemPrompt || '',
      input: [{
        role: 'user',
        content: openAIContent(input || {})
      }],
      tools: [{
        type: 'web_search',
        filters: { allowed_domains: core.OFFICIAL_SOURCE_DOMAINS.slice() },
        search_context_size: 'low'
      }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      text: {
        format: {
          type: 'json_schema',
          name: 'compilazione_dichiarazione',
          strict: true,
          schema: JSON.parse(JSON.stringify(RESULT_SCHEMA))
        }
      }
    };
  }

  function parseOpenAIResponse(data) {
    if (!isRecord(data) || !Array.isArray(data.output) ||
        !data.output.every(isRecord)) throw malformed('openai');
    if (data.status === 'incomplete') {
      fail('openai', 'TRUNCATED', 'La risposta OpenAI è incompleta o troncata.');
    }
    if (data.status !== 'completed') {
      fail('openai', 'RESPONSE_STATE', 'La risposta OpenAI non è conclusa correttamente.');
    }
    const output = data.output;
    if (output.some((item) => item.status === 'incomplete')) {
      fail('openai', 'TRUNCATED', 'La risposta OpenAI è incompleta o troncata.');
    }
    if (output.some((item) => item.status && item.status !== 'completed')) {
      fail('openai', 'RESPONSE_STATE', 'La risposta OpenAI contiene operazioni non concluse.');
    }
    const content = output.flatMap((item) =>
      Array.isArray(item.content) ? item.content : []
    );
    if (!content.every(isRecord)) throw malformed('openai');
    if (content.some((item) => item.type === 'refusal')) {
      fail('openai', 'REFUSAL', 'OpenAI ha rifiutato la richiesta.');
    }
    const searchCalls = output.filter((item) => item.type === 'web_search_call');
    if (searchCalls.length === 0) {
      fail('openai', 'SEARCH_REQUIRED', 'OpenAI non ha eseguito la ricerca web richiesta.');
    }
    if (searchCalls.length > 3) {
      fail('openai', 'SEARCH_LIMIT', 'OpenAI ha superato il limite locale di tre ricerche web.');
    }
    const sources = uniqueOfficialSources(searchCalls.flatMap((item) =>
      Array.isArray(item.action && item.action.sources)
        ? item.action.sources
        : []
    ));
    if (sources.length === 0) {
      fail('openai', 'MISSING_SEARCH_METADATA',
        'OpenAI non ha restituito fonti ufficiali verificabili.');
    }
    const outputText = content.find((item) => item.type === 'output_text');

    return {
      result: parseJsonResult(outputText && outputText.text, 'openai'),
      sources,
      searchCount: searchCalls.length
    };
  }

  function buildAnthropicRequest(input, remainingSearches) {
    return {
      model: input && input.model || 'claude-sonnet-5',
      max_tokens: 16000,
      system: input && input.systemPrompt || '',
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        allowed_domains: core.OFFICIAL_SOURCE_DOMAINS.slice(),
        max_uses: Math.max(0, Math.min(3, Number.isFinite(remainingSearches)
          ? Math.floor(remainingSearches)
          : 3))
      }],
      messages: Array.isArray(input && input.messages)
        ? input.messages.slice()
        : [{ role: 'user', content: anthropicContent(input || {}) }]
    };
  }

  function uniqueOfficialSources(items) {
    const seen = new Set();
    return items.map(core.normalizeOfficialSource).filter(Boolean).filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });
  }

  function parseAnthropicResponse(data) {
    if (!isRecord(data) || !Array.isArray(data.content) ||
        !data.content.every(isRecord)) throw malformed('anthropic');
    const content = data.content;
    if (data && data.stop_reason === 'refusal') {
      fail('anthropic', 'REFUSAL', 'Anthropic ha rifiutato la richiesta.');
    }
    if (data && (data.stop_reason === 'max_tokens' ||
        data.stop_reason === 'model_context_window_exceeded')) {
      fail('anthropic', 'TRUNCATED', 'La risposta Anthropic è incompleta o troncata.');
    }
    const searchCount = Math.max(
      content.filter((item) =>
        item.type === 'server_tool_use' && item.name === 'web_search'
      ).length,
      Number(data && data.usage && data.usage.server_tool_use &&
        data.usage.server_tool_use.web_search_requests) || 0
    );
    if (searchCount > 3) {
      fail('anthropic', 'SEARCH_LIMIT',
        'Anthropic ha superato il limite di tre ricerche web.');
    }
    if (content.some((item) =>
      (Array.isArray(item.content) && !item.content.every(isRecord)) ||
      (Array.isArray(item.citations) && !item.citations.every(isRecord)))) {
      throw malformed('anthropic');
    }
    const sourceItems = content.flatMap((item) => {
      if (item.type === 'web_search_tool_result' && Array.isArray(item.content)) {
        return item.content.filter((entry) => entry.type === 'web_search_result');
      }
      if (item.type === 'text' && Array.isArray(item.citations)) {
        return item.citations.filter((entry) =>
          entry.type === 'web_search_result_location'
        );
      }
      return [];
    });
    const textBlock = content.find((item) => item.type === 'text');
    const pauseTurn = data.stop_reason === 'pause_turn';
    const sources = uniqueOfficialSources(sourceItems);
    if (!pauseTurn && sources.length === 0) {
      fail('anthropic', 'MISSING_SEARCH_METADATA',
        'Anthropic non ha restituito fonti ufficiali verificabili.');
    }
    return {
      result: pauseTurn ? null : parseJsonResult(textBlock && textBlock.text, 'anthropic'),
      sources,
      searchCount,
      pauseTurn,
      assistantContent: content
    };
  }

  function readHeader(headers, name) {
    if (headers && typeof headers.get === 'function') return headers.get(name);
    if (!headers || typeof headers !== 'object') return undefined;
    const key = Object.keys(headers).find((item) =>
      item.toLowerCase() === name.toLowerCase()
    );
    return key ? headers[key] : undefined;
  }

  function classifyProviderError(provider, status, body, headers) {
    const label = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
    const details = { status };
    if (status === 401 || status === 403) {
      return providerError(
        provider, 'API_KEY', `La chiave API ${label} non è valida o autorizzata.`, details
      );
    }
    if (status === 429) {
      const retryAfter = readHeader(headers, 'retry-after');
      if (retryAfter) details.retryAfter = retryAfter;
      return providerError(
        provider, 'RATE_LIMIT', `${label} ha applicato un limite di richieste.`, details
      );
    }
    const bodyText = JSON.stringify(body || {}).toLowerCase();
    if (/web.?search|search.*(?:disabled|support|available)|max_uses/.test(bodyText)) {
      return providerError(
        provider,
        'SEARCH_UNAVAILABLE',
        `La ricerca web richiesta non è disponibile per questo account o modello ${label}.`,
        details
      );
    }
    if (status === 404 || /model.*(?:not found|unsupported|unavailable)/.test(bodyText)) {
      return providerError(
        provider, 'MODEL_UNAVAILABLE', `Il modello ${label} selezionato non è disponibile.`, details
      );
    }
    return providerError(
      provider, 'API_ERROR', `${label} ha restituito un errore (HTTP ${status}).`, details
    );
  }

  function buildCapabilityProbe(provider, model) {
    const warning = 'La prova esegue una ricerca web che il provider può addebitare.';
    const probeInput = {
      model,
      systemPrompt: 'Esegui la prova richiesta usando soltanto fonti ufficiali.',
      prompt: 'Cerca il sito ufficiale dell’Agenzia delle Entrate e restituisci un risultato JSON senza compilazioni.',
      attachments: []
    };
    const image = {
      kind: 'image',
      name: 'prova.png',
      mediaType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    };
    if (provider === 'openai') {
      probeInput.attachments = [
        {
          kind: 'file',
          name: 'prova.txt',
          mediaType: 'text/plain',
          data: 'cHJvdmE='
        },
        image
      ];
      const body = buildOpenAIRequest(probeInput);
      body.max_output_tokens = 500;
      return { endpoint: '/v1/responses', body, warning };
    }
    if (provider === 'anthropic') {
      probeInput.attachments = [
        { kind: 'text', name: 'prova.txt', text: 'prova' },
        image
      ];
      const body = buildAnthropicRequest(probeInput, 1);
      body.max_tokens = 500;
      return { endpoint: '/v1/messages', body, warning };
    }
    throw providerError(
      provider, 'UNSUPPORTED_PROVIDER', 'Provider non supportato.'
    );
  }

  return {
    buildOpenAIRequest, parseOpenAIResponse,
    buildAnthropicRequest, parseAnthropicResponse,
    classifyProviderError,
    buildCapabilityProbe
  };
});
