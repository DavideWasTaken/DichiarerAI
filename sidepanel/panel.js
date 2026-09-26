'use strict';

const $ = (selector) => document.querySelector(selector);
const CORE = DichiarerCore;
const BRIDGE = DichiarerPageBridge;
const state = { fields: [], attachments: [], proposal: null, pageInfo: null,
  tabId: null, tabUrl: null, readSessionId: null, requestId: null };

const EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt',
  'csv', 'tsv', 'md', 'json', 'html', 'xml', 'xls', 'xlsx']);
const MB = 1024 * 1024;

function showError(message) {
  const box = $('#errore');
  box.textContent = `❌ ${message}`;
  box.classList.remove('hidden');
}

function clearError() { $('#errore').classList.add('hidden'); }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function checkSite() {
  const tab = await activeTab();
  const valid = Boolean(tab && CORE.isTaxReturnUrl(tab.url));
  $('#banner-sito').classList.toggle('hidden', valid);
  return valid ? tab : null;
}

function updateAnalyzeButton() {
  const hasRequest = Boolean($('#istruzioni').value.trim() || state.attachments.length);
  $('#btn-analizza').disabled = !state.fields.length || !hasRequest ||
    !$('#consenso-invio').checked || Boolean(state.requestId);
}

function invalidateConsent() {
  $('#consenso-invio').checked = false;
  state.proposal = null;
  $('#sezione-risultati').classList.add('hidden');
  updateAnalyzeButton();
}

async function readPage() {
  clearError();
  const tab = await checkSite();
  if (!tab) return showError('Apri prima il sito ufficiale della dichiarazione precompilata.');
  const readSessionId = crypto.randomUUID();
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: BRIDGE.scrapePage,
      args: [readSessionId, true]
    });
  } catch (error) {
    return showError(`Impossibile leggere questa pagina: ${error.message}`);
  }
  const fields = [];
  let pageInfo = null;
  for (const injection of results || []) {
    const data = injection.result;
    if (!data || !Array.isArray(data.campi)) continue;
    pageInfo ||= { url: data.url, title: data.title };
    for (const field of data.campi) {
      fields.push({ ...field, id: fields.length, frameId: injection.frameId });
    }
  }
  if (!fields.length) return showError('Nessun campo fiscale modificabile trovato. Apri un quadro e riprova.');
  Object.assign(state, { fields, pageInfo, tabId: tab.id, tabUrl: tab.url, readSessionId });
  const list = $('#lista-campi');
  list.replaceChildren(...fields.map((field) => {
    const li = document.createElement('li');
    li.textContent = `${field.etichetta || field.contesto || `Campo ${field.id}`} (${field.tipo})`;
    return li;
  }));
  $('#esito-lettura').textContent = `✅ ${fields.length} campi rilevati.`;
  $('#esito-lettura').classList.remove('hidden');
  $('#dettaglio-campi').classList.remove('hidden');
  invalidateConsent();
}

function extension(name) { return name.toLowerCase().split('.').pop(); }
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function prepareFile(file) {
  const ext = extension(file.name);
  if (!EXTENSIONS.has(ext)) throw new Error('tipo di file non supportato');
  const kind = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'image'
    : ext === 'pdf' ? 'pdf' : ['xls', 'xlsx'].includes(ext) ? 'excel' : 'text';
  const limit = kind === 'image' ? 5 * MB : kind === 'text' ? 3 * MB : 20 * MB;
  if (file.size > limit) throw new Error(`file troppo grande (limite ${limit / MB} MB)`);
  if (kind === 'image' || kind === 'pdf') {
    return { name: file.name, kind, mediaType: file.type ||
      (kind === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`),
      data: base64(await file.arrayBuffer()), size: file.size };
  }
  if (kind === 'excel') {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false });
    const parts = workbook.SheetNames.flatMap((name) => [
      `--- Foglio: ${name} ---`, XLSX.utils.sheet_to_csv(workbook.Sheets[name])
    ]);
    const text = parts.join('\n');
    if (new TextEncoder().encode(text).length > 3 * MB) throw new Error('contenuto convertito oltre 3 MB');
    return { name: `${file.name}.csv`, kind: 'text', mediaType: 'text/csv', text, size: file.size };
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  return { name: file.name, kind: 'text', mediaType: file.type || 'text/plain', text, size: file.size };
}

function renderFiles() {
  const list = $('#lista-file');
  list.replaceChildren(...state.attachments.map((file, index) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KB)`;
    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1); renderFiles(); invalidateConsent();
    });
    li.append(name, remove);
    return li;
  }));
}

async function addFiles(fileList) {
  clearError();
  const incoming = Array.from(fileList || []);
  if (state.attachments.length + incoming.length > 10) return showError('Puoi allegare al massimo 10 file.');
  if ([...state.attachments, ...incoming].reduce((n, f) => n + f.size, 0) > 20 * MB) {
    return showError('Gli allegati superano il limite complessivo di 20 MB.');
  }
  for (const file of incoming) {
    try { state.attachments.push(await prepareFile(file)); }
    catch (error) { showError(`${file.name}: ${error.message}`); }
  }
  renderFiles(); invalidateConsent();
}

function renderResult(data) {
  const result = data.result;
  state.proposal = result;
  $('#anni-risultato').textContent = `${$('#anno-dichiarazione').value} / redditi ${$('#anno-redditi').value}`;
  $('#spiegazione').textContent = result.spiegazione;
  const warnings = $('#avvertenze');
  warnings.replaceChildren(...result.avvertenze.map((warning) => {
    const div = document.createElement('div'); div.className = 'avvertenza';
    div.textContent = `⚠️ ${warning}`; return div;
  }));
  const proposals = $('#lista-proposte');
  proposals.replaceChildren(...result.compilazioni.map((proposal) => {
    const field = state.fields.find((item) => item.id === proposal.id);
    const li = document.createElement('li');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.dataset.id = String(proposal.id); checkbox.checked = false;
    const info = document.createElement('div'); info.className = 'info';
    const title = document.createElement('div'); title.className = 'etichetta';
    title.textContent = field?.etichetta || field?.contesto || `Campo ${proposal.id}`;
    const value = document.createElement('div'); value.className = 'valore'; value.textContent = proposal.valore;
    const reason = document.createElement('div'); reason.className = 'motivo'; reason.textContent = proposal.motivo;
    const sources = document.createElement('div'); sources.className = 'fonti';
    for (const url of proposal.fonti) {
      const link = document.createElement('a'); link.href = url; link.textContent = 'Fonte ufficiale';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
    }
    info.append(title, value, reason, sources); li.append(checkbox, info); return li;
  }));
  $('#btn-applica').disabled = true;
  proposals.addEventListener('change', () => {
    $('#btn-applica').disabled = !proposals.querySelector('input:checked');
  }, { once: false });
  $('#sezione-risultati').classList.remove('hidden');
}

async function analyze() {
  clearError();
  if (!$('#consenso-invio').checked) return showError('Conferma l’invio dei dati per questa analisi.');
  const declarationYear = Number($('#anno-dichiarazione').value);
  const incomeYear = Number($('#anno-redditi').value);
  if (!declarationYear || !incomeYear) return showError('Conferma entrambi gli anni.');
  state.requestId = crypto.randomUUID();
  $('#consenso-invio').checked = false;
  $('#btn-annulla').classList.remove('hidden');
  $('#caricamento').classList.remove('hidden'); updateAnalyzeButton();
  try {
    const response = await chrome.runtime.sendMessage({ action: 'analizza', requestId: state.requestId,
      payload: { pageInfo: state.pageInfo,
        fields: CORE.serializeFields(state.fields, $('#includi-valori').checked),
        userText: $('#istruzioni').value.trim(), attachments: state.attachments,
        declarationYear, incomeYear } });
    if (!response?.ok) throw new Error(response?.error || 'Risposta non valida.');
    renderResult(response.data);
  } catch (error) { showError(error.message); }
  finally {
    state.requestId = null; $('#btn-annulla').classList.add('hidden');
    $('#caricamento').classList.add('hidden'); updateAnalyzeButton();
  }
}

async function applySelected() {
  clearError();
  const ids = Array.from($('#lista-proposte').querySelectorAll('input:checked'))
    .map((input) => Number(input.dataset.id));
  if (!ids.length) return showError('Seleziona almeno una proposta.');
  const tab = await activeTab();
  if (!tab || tab.id !== state.tabId || tab.url !== state.tabUrl) {
    return showError('La scheda o la pagina è cambiata: rileggi i campi.');
  }
  const groups = new Map();
  for (const id of ids) {
    const field = state.fields.find((item) => item.id === id);
    const proposal = state.proposal.compilazioni.find((item) => item.id === id);
    if (!field || !proposal) continue;
    if (!groups.has(field.frameId)) groups.set(field.frameId, []);
    groups.get(field.frameId).push({ ...field, proposedValue: proposal.valore,
      valoreProposto: proposal.valore, valoreDaApplicare: proposal.valore,
      valoreNuovo: proposal.valore, valore: field.valore });
  }
  const preflighted = [];
  for (const [frameId, items] of groups) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] }, func: BRIDGE.preflightFields,
      args: [items, state.readSessionId]
    });
    if (!injection?.result?.ok) return showError('La pagina è cambiata: rileggi i campi prima di applicare.');
    preflighted.push([frameId, items]);
  }
  let changed = 0;
  const failed = [];
  for (const [frameId, items] of preflighted) {
    const fillItems = items.map((item) => ({ localId: item.localId, valore: item.proposedValue }));
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] }, func: BRIDGE.fillFields,
      args: [fillItems, state.readSessionId]
    });
    changed += injection?.result?.changed?.length || 0;
    failed.push(...(injection?.result?.failed || []));
  }
  const box = $('#esito-applica'); box.classList.remove('hidden');
  box.textContent = failed.length
    ? `⚠️ ${changed} campi modificati; ${failed.length} non riusciti. Rileggi e verifica la pagina.`
    : `✅ ${changed} campi modificati. Verificali: la dichiarazione non è stata salvata né inviata.`;
}

document.addEventListener('DOMContentLoaded', () => {
  const year = new Date().getFullYear();
  $('#anno-dichiarazione').value = String(year);
  $('#anno-redditi').value = String(year - 1);
  checkSite();
  $('#btn-impostazioni').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#btn-leggi').addEventListener('click', readPage);
  $('#btn-analizza').addEventListener('click', analyze);
  $('#btn-applica').addEventListener('click', applySelected);
  $('#btn-annulla').addEventListener('click', () => {
    if (state.requestId) chrome.runtime.sendMessage({ action: 'cancel', requestId: state.requestId });
  });
  for (const selector of ['#istruzioni', '#anno-dichiarazione', '#anno-redditi',
    '#includi-valori']) $(selector).addEventListener('input', invalidateConsent);
  $('#consenso-invio').addEventListener('change', updateAnalyzeButton);
  const input = $('#input-file');
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  const drop = $('#file-drop');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault(); drop.classList.remove('drag'); addFiles(event.dataTransfer?.files);
  });
  chrome.tabs.onActivated.addListener(checkSite);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url) checkSite(); });
});
