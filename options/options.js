// DichiarerAI — impostazioni

const $ = (sel) => document.querySelector(sel);

// Elenchi di partenza: vengono sostituiti da quelli scaricati con 🔄
const MODELLI_DEFAULT = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (consigliato)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (più veloce ed economico)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (il più economico)' }
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (consigliato)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (economico)' },
    { id: 'gpt-4.1', label: 'GPT-4.1' }
  ]
};

// Elenchi correnti per provider (default o scaricati)
const modelli = {
  anthropic: [...MODELLI_DEFAULT.anthropic],
  openai: [...MODELLI_DEFAULT.openai]
};

function providerSelezionato() {
  return document.querySelector('input[name="provider"]:checked').value;
}

function aggiornaSezioni() {
  const p = providerSelezionato();
  $('#sezione-anthropic').classList.toggle('hidden', p !== 'anthropic');
  $('#sezione-openai').classList.toggle('hidden', p !== 'openai');
}

// Ricostruisce la tendina dei modelli e seleziona `selezionato`
// (se non è in elenco, passa in modalità «Altro modello…»)
function popolaSelect(provider, selezionato) {
  const select = $(`#${provider}-model`);
  const custom = $(`#${provider}-model-custom`);

  select.innerHTML = '';
  for (const m of modelli[provider]) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    select.appendChild(opt);
  }
  const optCustom = document.createElement('option');
  optCustom.value = '__custom__';
  optCustom.textContent = 'Altro modello…';
  select.appendChild(optCustom);

  if (selezionato && modelli[provider].some((m) => m.id === selezionato)) {
    select.value = selezionato;
    custom.classList.add('hidden');
    custom.value = '';
  } else if (selezionato) {
    select.value = '__custom__';
    custom.classList.remove('hidden');
    custom.value = selezionato;
  } else {
    select.selectedIndex = 0;
    custom.classList.add('hidden');
    custom.value = '';
  }
}

function leggiModello(provider) {
  const select = $(`#${provider}-model`);
  if (select.value === '__custom__') {
    return $(`#${provider}-model-custom`).value.trim();
  }
  return select.value;
}

function mostraEsito(msg, ok) {
  const el = $('#esito');
  el.textContent = msg;
  el.className = 'esito ' + (ok ? 'ok' : 'errore');
}

async function carica() {
  const cfg = await chrome.storage.local.get({
    provider: 'anthropic',
    anthropicKey: '',
    anthropicModel: 'claude-opus-4-8',
    openaiKey: '',
    openaiModel: 'gpt-4o',
    anthropicModels: null,
    openaiModels: null
  });

  if (Array.isArray(cfg.anthropicModels) && cfg.anthropicModels.length > 0) {
    modelli.anthropic = cfg.anthropicModels;
  }
  if (Array.isArray(cfg.openaiModels) && cfg.openaiModels.length > 0) {
    modelli.openai = cfg.openaiModels;
  }

  document.querySelector(`input[name="provider"][value="${cfg.provider}"]`).checked = true;
  $('#anthropic-key').value = cfg.anthropicKey;
  $('#openai-key').value = cfg.openaiKey;
  popolaSelect('anthropic', cfg.anthropicModel);
  popolaSelect('openai', cfg.openaiModel);
  aggiornaSezioni();
}

async function salva() {
  const cfg = {
    provider: providerSelezionato(),
    anthropicKey: $('#anthropic-key').value.trim(),
    anthropicModel: leggiModello('anthropic') || 'claude-opus-4-8',
    openaiKey: $('#openai-key').value.trim(),
    openaiModel: leggiModello('openai') || 'gpt-4o'
  };
  await chrome.storage.local.set(cfg);
  mostraEsito('✅ Impostazioni salvate!', true);
  return cfg;
}

// Scarica dal provider l'elenco aggiornato dei modelli
async function aggiornaModelli(provider) {
  const apiKey = $(`#${provider}-key`).value.trim();
  if (!apiKey) {
    return mostraEsito('❌ Inserisci prima la chiave API, serve per scaricare i modelli.', false);
  }

  const btn = $(`#refresh-${provider}`);
  btn.disabled = true;
  btn.classList.add('rotante');
  mostraEsito('⏳ Scarico l\'elenco dei modelli…', true);

  try {
    const r = await chrome.runtime.sendMessage({
      action: 'listModels',
      payload: { provider, apiKey }
    });
    if (!r?.ok) throw new Error(r?.error || 'risposta non valida');
    if (!r.models || r.models.length === 0) throw new Error('nessun modello ricevuto');

    modelli[provider] = r.models;
    await chrome.storage.local.set({ [`${provider}Models`]: r.models });

    const attuale = leggiModello(provider);
    popolaSelect(provider, attuale);
    mostraEsito(`✅ Elenco aggiornato: ${r.models.length} modelli disponibili.`, true);
  } catch (e) {
    mostraEsito('❌ Impossibile aggiornare i modelli: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.classList.remove('rotante');
  }
}

async function prova() {
  const cfg = await salva();
  const provider = cfg.provider;
  const apiKey = provider === 'openai' ? cfg.openaiKey : cfg.anthropicKey;
  const model = provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;

  if (!apiKey) {
    return mostraEsito('❌ Inserisci prima la chiave API.', false);
  }

  const btn = $('#btn-test');
  btn.disabled = true;
  mostraEsito('⏳ Verifica in corso…', true);

  try {
    const r = await chrome.runtime.sendMessage({
      action: 'test',
      payload: { provider, apiKey, model }
    });
    if (r?.ok) mostraEsito(`✅ Connessione riuscita con ${model}!`, true);
    else mostraEsito('❌ Errore: ' + (r?.error || 'risposta non valida'), false);
  } catch (e) {
    mostraEsito('❌ Errore: ' + e.message, false);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  carica();

  document.querySelectorAll('input[name="provider"]').forEach((r) => {
    r.addEventListener('change', aggiornaSezioni);
  });

  for (const provider of ['anthropic', 'openai']) {
    $(`#${provider}-model`).addEventListener('change', (e) => {
      $(`#${provider}-model-custom`).classList.toggle('hidden', e.target.value !== '__custom__');
    });
    $(`#refresh-${provider}`).addEventListener('click', () => aggiornaModelli(provider));
  }

  document.querySelectorAll('.mostra').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  $('#btn-salva').addEventListener('click', salva);
  $('#btn-test').addEventListener('click', prova);
});
