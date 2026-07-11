// DichiarerAI — pannello laterale
// Legge i campi della pagina, raccoglie gli allegati (passati all'AI così come
// sono, come in una chat) e applica i valori proposti dal modello.

const HOST_DICHIARAZIONE = 'dichiarazioneprecompilata.agenziaentrate.gov.it';

const stato = {
  pageInfo: {},
  campi: [], // [{gid, frameId, localId, etichetta, contesto, tipo, valore, opzioni}]
  allegati: [], // [{name, kind: 'image'|'pdf'|'text', mediaType, data?, text?, size}]
  proposte: [] // ultima risposta dell'AI
};

// ---------------------------------------------------------------------------
// Funzioni INIETTATE nella pagina (devono essere autonome, niente closure)
// ---------------------------------------------------------------------------

function scrapePage() {
  const testoPulito = (t) => (t || '').replace(/\s+/g, ' ').trim();

  const isVisibile = (el) => {
    if (el.type === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };

  const etichettaDi = (el) => {
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return testoPulito(l.textContent);
      } catch (e) { /* id non valido come selettore */ }
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return testoPulito(aria);
    const lblIds = el.getAttribute('aria-labelledby');
    if (lblIds) {
      const t = lblIds.split(/\s+/)
        .map((id) => (document.getElementById(id) || {}).textContent || '')
        .join(' ');
      if (testoPulito(t)) return testoPulito(t);
    }
    const wrap = el.closest('label');
    if (wrap) return testoPulito(wrap.textContent).slice(0, 160);
    let n = el.previousElementSibling;
    for (let i = 0; i < 2 && n; i++, n = n.previousElementSibling) {
      const t = testoPulito(n.textContent);
      if (t) return t.slice(0, 160);
    }
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
      const s = p.previousElementSibling;
      if (s) {
        const t = testoPulito(s.textContent);
        if (t) return t.slice(0, 160);
      }
    }
    return el.getAttribute('placeholder') || el.name || el.id || '';
  };

  // contesto: intestazione più vicina che precede il campo + testo del "rigo"
  const intestazioni = [];
  document
    .querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')
    .forEach((h) => intestazioni.push(h));
  const intestazionePer = (el) => {
    let ultima = '';
    for (const h of intestazioni) {
      const pos = h.compareDocumentPosition(el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        const t = testoPulito(h.textContent);
        if (t) ultima = t.slice(0, 120);
      } else {
        break;
      }
    }
    return ultima;
  };

  const contestoRigo = (el) => {
    const rigo = el.closest('tr, li, fieldset, [class*="rigo"], [class*="row"], [class*="Row"]');
    if (!rigo) return '';
    return testoPulito(rigo.innerText || '').slice(0, 240);
  };

  const campi = [];
  let localId = 0;
  const elementi = document.querySelectorAll('input, select, textarea');
  for (const el of elementi) {
    if (!isVisibile(el)) continue;
    if (['button', 'submit', 'reset', 'image', 'file'].includes(el.type)) continue;
    if (el.readOnly || el.disabled) continue;
    if (campi.length >= 400) break;

    el.dataset.dichiareraiId = String(localId);

    const tag = el.tagName.toLowerCase();
    const campo = {
      localId,
      tipo: tag === 'select' ? 'select' : el.type || tag,
      etichetta: etichettaDi(el),
      sezione: intestazionePer(el),
      contesto: contestoRigo(el)
    };

    if (el.type === 'checkbox' || el.type === 'radio') {
      campo.valore = el.checked ? 'true' : 'false';
      if (el.type === 'radio') campo.gruppo = el.name || '';
    } else if (tag === 'select') {
      campo.valore = el.selectedOptions[0] ? testoPulito(el.selectedOptions[0].textContent) : '';
      campo.opzioni = Array.from(el.options)
        .map((o) => testoPulito(o.textContent))
        .filter(Boolean)
        .slice(0, 30);
    } else {
      campo.valore = el.value || '';
    }

    campi.push(campo);
    localId++;
  }

  const titolo =
    (document.querySelector('h1') || {}).textContent ||
    (document.querySelector('h2') || {}).textContent ||
    document.title;

  return {
    url: location.href,
    title: (titolo || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    campi
  };
}

function fillFields(items) {
  const risultati = [];

  const setNativo = (el, v) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
  };

  const notifica = (el) => {
    for (const t of ['input', 'change']) {
      el.dispatchEvent(new Event(t, { bubbles: true }));
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const evidenzia = (el) => {
    const prima = el.style.outline;
    el.style.outline = '3px solid #0e9f6e';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prima;
      el.style.outlineOffset = '';
    }, 3000);
  };

  for (const it of items) {
    const el = document.querySelector(`[data-dichiarerai-id="${it.localId}"]`);
    if (!el) {
      risultati.push({ localId: it.localId, ok: false, msg: 'campo non trovato (la pagina è cambiata? rileggi la pagina)' });
      continue;
    }
    try {
      const valore = String(it.valore);
      if (el.type === 'checkbox' || el.type === 'radio') {
        const desiderato = ['true', '1', 'si', 'sì', 'x', 'on'].includes(valore.toLowerCase());
        if (el.checked !== desiderato) {
          el.click();
          if (el.checked !== desiderato) {
            el.checked = desiderato;
            notifica(el);
          }
        }
      } else if (el.tagName === 'SELECT') {
        let opzione = Array.from(el.options).find((o) => o.value === valore);
        if (!opzione) {
          const vNorm = valore.trim().toLowerCase();
          opzione =
            Array.from(el.options).find((o) => o.textContent.trim().toLowerCase() === vNorm) ||
            Array.from(el.options).find((o) => o.textContent.trim().toLowerCase().includes(vNorm));
        }
        if (!opzione) {
          risultati.push({ localId: it.localId, ok: false, msg: `opzione «${valore}» non trovata nel menu` });
          continue;
        }
        setNativo(el, opzione.value);
        notifica(el);
      } else {
        el.focus();
        setNativo(el, valore);
        notifica(el);
      }
      evidenzia(el);
      risultati.push({ localId: it.localId, ok: true });
    } catch (e) {
      risultati.push({ localId: it.localId, ok: false, msg: e.message });
    }
  }
  return risultati;
}

// ---------------------------------------------------------------------------
// Utilità pannello
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function mostraErrore(msg) {
  const el = $('#errore');
  el.textContent = '❌ ' + msg;
  el.classList.remove('hidden');
}

function nascondiErrore() {
  $('#errore').classList.add('hidden');
}

function formattaPeso(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function tabAttiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function controllaSito() {
  try {
    const tab = await tabAttiva();
    const ok = tab?.url && new URL(tab.url).hostname === HOST_DICHIARAZIONE;
    $('#banner-sito').classList.toggle('hidden', !!ok);
    return !!ok;
  } catch (e) {
    $('#banner-sito').classList.remove('hidden');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Passo 1 — lettura pagina
// ---------------------------------------------------------------------------

async function leggiPagina() {
  nascondiErrore();
  const tab = await tabAttiva();
  if (!tab) return mostraErrore('Nessuna scheda attiva trovata.');

  let risultati;
  try {
    risultati = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: scrapePage
    });
  } catch (e) {
    return mostraErrore(
      'Impossibile leggere la pagina: ' + e.message + '. Assicurati di essere sulla dichiarazione precompilata.'
    );
  }

  stato.campi = [];
  stato.pageInfo = {};
  let gid = 0;

  for (const r of risultati || []) {
    if (!r?.result?.campi?.length) continue;
    if (!stato.pageInfo.url) {
      stato.pageInfo = { url: r.result.url, title: r.result.title };
    }
    for (const c of r.result.campi) {
      stato.campi.push({ gid: gid++, frameId: r.frameId, ...c });
    }
  }

  const esito = $('#esito-lettura');
  esito.classList.remove('hidden');

  if (stato.campi.length === 0) {
    esito.textContent = '🤔 Nessun campo compilabile trovato in questa pagina. Apri il quadro da compilare e riprova.';
    $('#dettaglio-campi').classList.add('hidden');
    $('#btn-analizza').disabled = true;
    return;
  }

  esito.innerHTML = `✅ Trovati <b>${stato.campi.length}</b> campi in «${stato.pageInfo.title || 'pagina corrente'}»`;

  const lista = $('#lista-campi');
  lista.innerHTML = '';
  for (const c of stato.campi) {
    const li = document.createElement('li');
    const eti = c.etichetta || c.contesto || '(senza etichetta)';
    li.innerHTML = `<b>#${c.gid}</b> ${escapeHtml(eti.slice(0, 90))}${c.valore ? ` — <i>${escapeHtml(String(c.valore).slice(0, 30))}</i>` : ''}`;
    lista.appendChild(li);
  }
  $('#dettaglio-campi').classList.remove('hidden');
  $('#btn-analizza').disabled = false;
}

function escapeHtml(s) {
  const d = document.createElement('span');
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Passo 2 — allegati (passati all'AI così come sono)
// ---------------------------------------------------------------------------

const LIMITI = {
  image: 5 * 1024 * 1024, // limite immagini API
  pdf: 25 * 1024 * 1024,
  text: 3 * 1024 * 1024
};

const TIPI_IMMAGINE = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

function leggiComeBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]); // rimuove il prefisso data:
    r.onerror = () => reject(new Error('lettura file fallita'));
    r.readAsDataURL(file);
  });
}

function leggiComeTesto(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('lettura file fallita'));
    r.readAsText(file);
  });
}

function leggiComeArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('lettura file fallita'));
    r.readAsArrayBuffer(file);
  });
}

async function aggiungiFile(fileList) {
  nascondiErrore();
  for (const file of fileList) {
    const est = (file.name.split('.').pop() || '').toLowerCase();
    try {
      let allegato;

      if (TIPI_IMMAGINE[est] || file.type.startsWith('image/')) {
        if (file.size > LIMITI.image) throw new Error('immagine troppo grande (max 5 MB)');
        allegato = {
          name: file.name,
          kind: 'image',
          mediaType: TIPI_IMMAGINE[est] || file.type,
          data: await leggiComeBase64(file),
          size: file.size
        };
      } else if (est === 'pdf' || file.type === 'application/pdf') {
        if (file.size > LIMITI.pdf) throw new Error('PDF troppo grande (max 25 MB)');
        allegato = {
          name: file.name,
          kind: 'pdf',
          mediaType: 'application/pdf',
          data: await leggiComeBase64(file),
          size: file.size
        };
      } else if (est === 'xlsx' || est === 'xls') {
        // Le API non accettano Excel come allegato: conversione 1:1 in CSV,
        // nessun dato viene interpretato o modificato.
        if (typeof XLSX === 'undefined') {
          throw new Error('libreria Excel non disponibile: esporta il file in CSV e riprova');
        }
        const buf = await leggiComeArrayBuffer(file);
        const wb = XLSX.read(buf, { type: 'array' });
        const pezzi = [];
        for (const nome of wb.SheetNames) {
          pezzi.push(`--- Foglio: ${nome} ---`);
          pezzi.push(XLSX.utils.sheet_to_csv(wb.Sheets[nome]));
        }
        allegato = {
          name: file.name + ' (convertito in CSV)',
          kind: 'text',
          text: pezzi.join('\n'),
          size: file.size
        };
      } else {
        if (file.size > LIMITI.text) throw new Error('file di testo troppo grande (max 3 MB)');
        allegato = {
          name: file.name,
          kind: 'text',
          text: await leggiComeTesto(file),
          size: file.size
        };
      }

      stato.allegati.push(allegato);
    } catch (e) {
      mostraErrore(`«${file.name}»: ${e.message}`);
    }
  }
  disegnaListaFile();
}

function disegnaListaFile() {
  const ul = $('#lista-file');
  ul.innerHTML = '';
  stato.allegati.forEach((a, i) => {
    const icona = a.kind === 'image' ? '🖼️' : a.kind === 'pdf' ? '📄' : '🗒️';
    const li = document.createElement('li');
    li.innerHTML = `<span class="nome">${icona} ${escapeHtml(a.name)}</span>
      <span class="peso">${formattaPeso(a.size)}</span>`;
    const btn = document.createElement('button');
    btn.title = 'Rimuovi';
    btn.textContent = '✕';
    btn.addEventListener('click', () => {
      stato.allegati.splice(i, 1);
      disegnaListaFile();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Passo 3 — chiamata AI
// ---------------------------------------------------------------------------

async function analizza() {
  nascondiErrore();
  $('#sezione-risultati').classList.add('hidden');

  if (stato.campi.length === 0) {
    return mostraErrore('Prima leggi la pagina (passo 1).');
  }
  const testo = $('#istruzioni').value.trim();
  if (!testo && stato.allegati.length === 0) {
    return mostraErrore('Scrivi cosa vuoi compilare oppure allega un documento.');
  }

  // Campi nel formato compatto per il modello
  const fieldsPerModello = stato.campi.map((c) => {
    const f = {
      id: c.gid,
      tipo: c.tipo,
      etichetta: c.etichetta,
      sezione: c.sezione,
      contesto: c.contesto,
      valore: c.valore
    };
    if (c.opzioni) f.opzioni = c.opzioni;
    if (c.gruppo) f.gruppo = c.gruppo;
    return f;
  });

  $('#btn-analizza').disabled = true;
  $('#caricamento').classList.remove('hidden');

  try {
    const risposta = await chrome.runtime.sendMessage({
      action: 'analizza',
      payload: {
        pageInfo: stato.pageInfo,
        fields: fieldsPerModello,
        userText: testo,
        attachments: stato.allegati
      }
    });

    if (!risposta) throw new Error('Nessuna risposta dal servizio. Riprova.');
    if (!risposta.ok) throw new Error(risposta.error);

    stato.proposte = risposta.data;
    disegnaRisultati(risposta.data);
  } catch (e) {
    mostraErrore(e.message);
  } finally {
    $('#btn-analizza').disabled = false;
    $('#caricamento').classList.add('hidden');
  }
}

function disegnaRisultati(dati) {
  $('#spiegazione').textContent = dati.spiegazione || '';

  const avv = $('#avvertenze');
  avv.innerHTML = '';
  for (const a of dati.avvertenze || []) {
    const div = document.createElement('div');
    div.className = 'avvertenza';
    div.textContent = '⚠️ ' + a;
    avv.appendChild(div);
  }

  const ul = $('#lista-proposte');
  ul.innerHTML = '';
  const valide = (dati.compilazioni || []).filter((p) =>
    stato.campi.some((c) => c.gid === p.id)
  );

  if (valide.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'L\'AI non ha proposto compilazioni per questa pagina.';
    ul.appendChild(li);
    $('#btn-applica').disabled = true;
  } else {
    $('#btn-applica').disabled = false;
    for (const p of valide) {
      const campo = stato.campi.find((c) => c.gid === p.id);
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.gid = String(p.id);
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `
        <div class="etichetta">${escapeHtml(campo.etichetta || campo.contesto || `Campo #${p.id}`)}</div>
        <div class="valore">${escapeHtml(p.valore)}</div>
        <div class="motivo">${escapeHtml(p.motivo || '')}</div>`;
      li.appendChild(cb);
      li.appendChild(info);
      ul.appendChild(li);
    }
  }

  $('#esito-applica').classList.add('hidden');
  $('#sezione-risultati').classList.remove('hidden');
  $('#sezione-risultati').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Applica i valori nella pagina
// ---------------------------------------------------------------------------

async function applica() {
  nascondiErrore();
  const selezionati = Array.from(
    document.querySelectorAll('#lista-proposte input[type="checkbox"]:checked')
  ).map((cb) => Number(cb.dataset.gid));

  if (selezionati.length === 0) {
    return mostraErrore('Seleziona almeno un campo da compilare.');
  }

  const tab = await tabAttiva();
  if (!tab) return mostraErrore('Nessuna scheda attiva trovata.');

  // Raggruppa per frame
  const perFrame = new Map();
  for (const gid of selezionati) {
    const campo = stato.campi.find((c) => c.gid === gid);
    const proposta = stato.proposte.compilazioni.find((p) => p.id === gid);
    if (!campo || !proposta) continue;
    if (!perFrame.has(campo.frameId)) perFrame.set(campo.frameId, []);
    perFrame.get(campo.frameId).push({ localId: campo.localId, valore: proposta.valore });
  }

  let okTot = 0;
  const problemi = [];

  for (const [frameId, items] of perFrame) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: fillFields,
        args: [items]
      });
      for (const esito of r?.result || []) {
        if (esito.ok) okTot++;
        else problemi.push(esito.msg);
      }
    } catch (e) {
      problemi.push(e.message);
    }
  }

  const box = $('#esito-applica');
  box.classList.remove('hidden');
  box.innerHTML = `✅ <b>${okTot}</b> campi compilati nella pagina. Controllali e salva la sezione sul sito.`;
  if (problemi.length > 0) {
    mostraErrore('Alcuni campi non sono stati compilati: ' + problemi.join(' · '));
  }
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  controllaSito();

  $('#btn-impostazioni').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#btn-leggi').addEventListener('click', leggiPagina);
  $('#btn-analizza').addEventListener('click', analizza);
  $('#btn-applica').addEventListener('click', applica);

  const drop = $('#file-drop');
  const input = $('#input-file');
  input.addEventListener('change', () => {
    aggiungiFile(input.files);
    input.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    if (e.dataTransfer?.files?.length) aggiungiFile(e.dataTransfer.files);
  });

  // Aggiorna il banner quando l'utente cambia scheda
  chrome.tabs.onActivated.addListener(controllaSito);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url) controllaSito();
  });
});
