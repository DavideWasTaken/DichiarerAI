// DichiarerAI — service worker
// Gestisce le chiamate alle API AI (Anthropic Claude / OpenAI).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Apre il pannello laterale al clic sull'icona dell'estensione
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// Schema JSON della risposta attesa dal modello
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    spiegazione: {
      type: 'string',
      description: 'Breve spiegazione in italiano di cosa è stato compilato e come sono stati calcolati i valori'
    },
    compilazioni: {
      type: 'array',
      description: 'Elenco dei campi da compilare',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: "L'ID numerico del campo, preso dall'elenco dei campi forniti"
          },
          valore: {
            type: 'string',
            description: 'Il valore da inserire nel campo. Per checkbox: "true" o "false". Per select: il testo esatto di una delle opzioni.'
          },
          motivo: {
            type: 'string',
            description: 'Breve motivazione in italiano del valore proposto'
          }
        },
        required: ['id', 'valore', 'motivo'],
        additionalProperties: false
      }
    },
    avvertenze: {
      type: 'array',
      description: 'Avvertenze importanti per l\'utente: dati mancanti, ambiguità, controlli da fare',
      items: { type: 'string' }
    }
  },
  required: ['spiegazione', 'compilazioni', 'avvertenze'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `Sei DichiarerAI, un assistente esperto nella compilazione della dichiarazione dei redditi italiana (modello 730 e Redditi Persone Fisiche) sul sito della dichiarazione precompilata dell'Agenzia delle Entrate.

Ricevi:
1. L'elenco dei campi presenti nella sezione della dichiarazione che l'utente sta guardando. Ogni campo ha un ID numerico, un'etichetta, un contesto (rigo/sezione, es. "T11", "Sezione II") e il valore attuale.
2. Le istruzioni dell'utente.
3. Eventuali documenti allegati come file veri e propri: PDF (CU, report del broker, ricevute), immagini (foto di scontrini o documenti), CSV, testo. Leggili direttamente ed estrai tu i dati che servono.

Il tuo compito è determinare quali campi compilare e con quali valori, restituendo un JSON conforme allo schema richiesto.

REGOLE FONDAMENTALI:
- Proponi SOLO i campi realmente necessari in base alla richiesta e ai dati disponibili. Non compilare campi a caso.
- Il campo "id" deve essere esattamente uno degli ID forniti nell'elenco. Non inventare ID.
- NON inventare dati. Se mancano informazioni per completare la richiesta, spiega cosa manca in "avvertenze".
- Se i documenti allegati contengono i dati (es. report di plusvalenze di un broker), calcola tu i totali corretti (somme di corrispettivi, costi, minusvalenze, ecc.) e mostra il calcolo in "motivo".

FORMATO DEI VALORI:
- Importi in euro: la maggior parte dei campi mostra ",00" ed è arrotondata all'euro: fornisci solo la parte intera, senza separatore delle migliaia e senza decimali (es. "6996"). Arrotonda all'euro più vicino.
- Se un campo accetta chiaramente decimali, usa la virgola come separatore decimale (formato italiano, es. "1234,56").
- Checkbox: "true" per spuntare, "false" per togliere la spunta.
- Radio button: "true" sul radio corretto del gruppo.
- Menu a tendina (select): usa il testo esatto di una delle opzioni elencate per quel campo.
- Codici fiscali e partite IVA: maiuscoli, senza spazi.
- Date: nel formato richiesto dal campo (tipicamente GG/MM/AAAA).

CONOSCENZE UTILI (quadro T — plusvalenze finanziarie, anno d'imposta 2025):
- Sezione II (T11-T16): plusvalenze con imposta sostitutiva 26% (azioni, ETF non armonizzati gestiti in dichiarativo, ecc.). T11 col.1 = totale corrispettivi (vendite), col.2 = totale costi/valori di acquisto.
- Sezione V (T41-T45): plusvalenze da cripto-attività (26%), con distinzione ante 2025 / 2025.
- Le minusvalenze di anni precedenti (certificate o da precedente dichiarazione) vanno nei righi dedicati (T13/T14, T43/T44).
- Quadro W: monitoraggio investimenti esteri e IVAFE/IVIE.
Applica le regole fiscali italiane vigenti con prudenza: in caso di dubbio interpretativo, segnalalo in "avvertenze" invece di tirare a indovinare.

Rispondi sempre in italiano.`;

// ---------------------------------------------------------------------------

function buildMainText({ pageInfo, fields, userText }) {
  const parts = [];

  parts.push('## Pagina attuale');
  parts.push(`URL: ${pageInfo.url || 'n/d'}`);
  parts.push(`Sezione: ${pageInfo.title || 'n/d'}`);
  parts.push('');

  parts.push('## Campi disponibili nella pagina (JSON)');
  parts.push(JSON.stringify(fields));
  parts.push('');

  parts.push("## Richiesta dell'utente");
  parts.push(userText || '(nessuna istruzione specifica: compila ciò che è deducibile dai documenti allegati)');

  return parts.join('\n');
}

// Gli allegati vengono passati al modello così come sono (come in una chat):
// immagini e PDF in base64, file di testo come documento testuale.

function anthropicContent({ mainText, attachments }) {
  const blocks = [];
  for (const a of attachments || []) {
    if (a.kind === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mediaType, data: a.data }
      });
    } else if (a.kind === 'pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: a.data },
        title: a.name
      });
    } else {
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: a.text },
        title: a.name
      });
    }
  }
  blocks.push({ type: 'text', text: mainText });
  return blocks;
}

function openaiContent({ mainText, attachments }) {
  const parts = [];
  const testi = [];
  for (const a of attachments || []) {
    if (a.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${a.mediaType};base64,${a.data}` }
      });
    } else if (a.kind === 'pdf') {
      parts.push({
        type: 'file',
        file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` }
      });
    } else {
      testi.push(`### File allegato: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``);
    }
  }
  const testoCompleto = testi.length > 0 ? `${testi.join('\n\n')}\n\n${mainText}` : mainText;
  parts.push({ type: 'text', text: testoCompleto });
  return parts;
}

// Modelli Claude che supportano il ragionamento adattivo
function supportsAdaptiveThinking(model) {
  return /claude-(fable|opus-4-[678]|sonnet-4-6)/.test(model);
}

async function callAnthropic({ apiKey, model, systemPrompt, content }) {
  const body = {
    model,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: RESULT_SCHEMA }
    }
  };
  if (supportsAdaptiveThinking(model)) {
    body.thinking = { type: 'adaptive' };
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Errore API Anthropic (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Risposta del modello vuota o non valida.');
  return JSON.parse(textBlock.text);
}

async function callOpenAI({ apiKey, model, systemPrompt, content }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'compilazione_dichiarazione',
        strict: true,
        schema: RESULT_SCHEMA
      }
    }
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Errore API OpenAI (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const rispostaTesto = data?.choices?.[0]?.message?.content;
  if (!rispostaTesto) throw new Error('Risposta del modello vuota o non valida.');
  return JSON.parse(rispostaTesto);
}

async function getConfig() {
  const cfg = await chrome.storage.local.get({
    provider: 'anthropic',
    anthropicKey: '',
    anthropicModel: 'claude-opus-4-8',
    openaiKey: '',
    openaiModel: 'gpt-4o'
  });
  return cfg;
}

async function handleAnalizza(payload) {
  const cfg = await getConfig();
  const mainText = buildMainText(payload);
  const attachments = payload.attachments || [];

  if (cfg.provider === 'openai') {
    if (!cfg.openaiKey) {
      throw new Error('Chiave API OpenAI non configurata. Apri le impostazioni (⚙️) e inseriscila.');
    }
    return callOpenAI({
      apiKey: cfg.openaiKey,
      model: cfg.openaiModel || 'gpt-4o',
      systemPrompt: SYSTEM_PROMPT,
      content: openaiContent({ mainText, attachments })
    });
  }

  if (!cfg.anthropicKey) {
    throw new Error('Chiave API Claude non configurata. Apri le impostazioni (⚙️) e inseriscila.');
  }
  return callAnthropic({
    apiKey: cfg.anthropicKey,
    model: cfg.anthropicModel || 'claude-opus-4-8',
    systemPrompt: SYSTEM_PROMPT,
    content: anthropicContent({ mainText, attachments })
  });
}

// Verifica rapida della chiave API dalle impostazioni
async function handleTest({ provider, apiKey, model }) {
  if (provider === 'openai') {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: 16
      })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message || `HTTP ${res.status}`);
    }
    return true;
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ping' }]
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return true;
}

// Scarica l'elenco dei modelli disponibili dal provider
async function handleListModels({ provider, apiKey }) {
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    // Tiene solo i modelli chat, esclude embedding/audio/immagini ecc.
    const esclusi = /embed|tts|whisper|audio|realtime|transcribe|moderation|dall-e|image|davinci|babbage|instruct|search|computer-use|codex/;
    return (data.data || [])
      .filter((m) => /^(gpt-|o\d|chatgpt)/.test(m.id) && !esclusi.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map((m) => ({ id: m.id, label: m.id }));
  }

  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === 'analizza') {
    handleAnalizza(msg.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // risposta asincrona
  }
  if (msg?.action === 'test') {
    handleTest(msg.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.action === 'listModels') {
    handleListModels(msg.payload)
      .then((models) => sendResponse({ ok: true, models }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});
