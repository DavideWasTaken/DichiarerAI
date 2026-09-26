// DichiarerAI service worker: credentials and provider traffic stay here.
importScripts('lib/core.js', 'lib/providers.js');

const CORE = DichiarerCore;
const PROVIDERS = DichiarerProviders;
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const activeRequests = new Map();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function getConfig() {
  return chrome.storage.local.get({ provider: 'openai', openaiKey: '',
    openaiModel: 'gpt-5.6', anthropicKey: '', anthropicModel: 'claude-sonnet-5' });
}

function auth(provider, key) {
  return provider === 'openai'
    ? { 'content-type': 'application/json', authorization: `Bearer ${key}` }
    : { 'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' };
}

async function post(provider, key, body, signal) {
  const response = await fetch(provider === 'openai' ? OPENAI_URL : ANTHROPIC_URL, {
    method: 'POST', headers: auth(provider, key), body: JSON.stringify(body), signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw PROVIDERS.classifyProviderError(
    provider, response.status, data, response.headers);
  return data;
}

function analysisInput(payload, model, messages) {
  const years = { declarationYear: Number(payload.declarationYear),
    incomeYear: Number(payload.incomeYear) };
  const page = payload.pageInfo || {};
  return { model, systemPrompt: CORE.buildSystemPrompt(years),
    prompt: [`Pagina: ${page.title || 'n/d'} (${page.url || 'n/d'})`,
      `Campi disponibili: ${JSON.stringify(payload.fields || [])}`,
      `Richiesta: ${payload.userText || 'Analizza i documenti allegati.'}`].join('\n\n'),
    attachments: payload.attachments || [], ...(messages ? { messages } : {}) };
}

async function analyze(payload, requestId) {
  const cfg = await getConfig();
  const provider = cfg.provider === 'anthropic' ? 'anthropic' : 'openai';
  const key = provider === 'openai' ? cfg.openaiKey : cfg.anthropicKey;
  const model = provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;
  if (!key) throw new Error(`Configura prima la chiave API ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), 120000);
  activeRequests.set(requestId, controller);
  try {
    let parsed;
    if (provider === 'openai') {
      const data = await post(provider, key,
        PROVIDERS.buildOpenAIRequest(analysisInput(payload, model)), controller.signal);
      parsed = PROVIDERS.parseOpenAIResponse(data);
    } else {
      let messages;
      let remaining = 3;
      for (let continuation = 0; continuation <= 2; continuation++) {
        const input = analysisInput(payload, model, messages);
        const body = PROVIDERS.buildAnthropicRequest(input, remaining);
        const data = await post(provider, key, body, controller.signal);
        parsed = PROVIDERS.parseAnthropicResponse(data);
        remaining = Math.max(0, remaining - parsed.searchCount);
        if (!parsed.pauseTurn) break;
        if (continuation === 2) throw new Error('Anthropic non ha completato la risposta dopo due continuazioni.');
        messages = [...body.messages, { role: 'assistant', content: parsed.assistantContent }];
      }
    }
    const years = { declarationYear: Number(payload.declarationYear),
      incomeYear: Number(payload.incomeYear) };
    return { result: CORE.validateResult(parsed.result, payload.fields || [], parsed.sources, years),
      sources: CORE.filterOfficialSources(parsed.sources, years), provider, model };
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(requestId);
  }
}

async function capabilityProbe({ provider, apiKey, model }) {
  if (!apiKey) throw new Error('Inserisci una chiave API.');
  const probe = PROVIDERS.buildCapabilityProbe(provider, model);
  const data = await post(provider, apiKey, probe.body, AbortSignal.timeout(120000));
  const parsed = provider === 'openai'
    ? PROVIDERS.parseOpenAIResponse(data) : PROVIDERS.parseAnthropicResponse(data);
  if (parsed.pauseTurn) throw new Error('La prova non è stata completata dal provider.');
  return { warning: probe.warning, sources: parsed.sources };
}

async function listModels({ provider, apiKey }) {
  if (!apiKey) throw new Error('Inserisci una chiave API.');
  const url = provider === 'openai' ? 'https://api.openai.com/v1/models'
    : 'https://api.anthropic.com/v1/models?limit=100';
  const response = await fetch(url, { headers: auth(provider, apiKey) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw PROVIDERS.classifyProviderError(
    provider, response.status, data, response.headers);
  return (data.data || []).map((item) => ({ id: item.id, label: item.display_name || item.id }))
    .filter((item) => provider === 'anthropic' ? /^claude-/.test(item.id) : /^gpt-/.test(item.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = message && message.action;
  if (action === 'cancel') {
    activeRequests.get(message.requestId)?.abort('cancelled');
    sendResponse({ ok: true });
    return false;
  }
  const work = action === 'analizza' ? analyze(message.payload || {}, message.requestId)
    : action === 'test' || action === 'testCapability' ? capabilityProbe(message.payload || {})
      : action === 'listModels' ? listModels(message.payload || {})
        : Promise.reject(new Error('Azione non supportata.'));
  work.then((data) => sendResponse(action === 'listModels'
    ? { ok: true, models: data } : { ok: true, data }))
    .catch((error) => sendResponse({ ok: false,
      error: error && error.name === 'AbortError'
        ? 'Richiesta annullata o scaduta.' : error.message || 'Errore imprevisto.' }));
  return true;
});
