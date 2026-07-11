<div align="center">

<img src="icons/icon128.png" alt="Logo DichiarerAI" width="96" />

# DichiarerAI

**La dichiarazione dei redditi si compila (quasi) da sola ✨**

Estensione Chrome che compila la [dichiarazione precompilata dell'Agenzia delle Entrate](https://dichiarazioneprecompilata.agenziaentrate.gov.it)
con l'aiuto dell'intelligenza artificiale — Claude (Anthropic) oppure OpenAI, con la **tua** chiave API.

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Claude](https://img.shields.io/badge/AI-Claude%20%7C%20OpenAI-8A2BE2)
![Lingua](https://img.shields.io/badge/lingua-italiano-009246)

</div>

---

## 🧾 Cosa fa

Apri un quadro della dichiarazione (es. *Quadro T — Plusvalenze*), allega i tuoi documenti
(report del broker, CU, ricevute, foto di scontrini…) e scrivi cosa ti serve in linguaggio
naturale. L'AI analizza campi e documenti e **propone i valori solo per i campi necessari**,
con una motivazione per ognuno. Tu rivedi, deselezioni ciò che non vuoi e applichi:
i campi vengono compilati direttamente nella pagina ed evidenziati in verde.

> 💬 *«Ho venduto azioni per 6.996 € comprate a 6.117 €, compila il rigo giusto»* → l'AI
> individua il rigo T11 della Sezione II e propone corrispettivi e costi già calcolati.

## ⚙️ Come funziona

| Passo | Cosa succede |
|---|---|
| **1 · 📖 Leggi la pagina** | L'estensione rileva tutti i campi del quadro aperto (etichetta, rigo, sezione, valore attuale), anche dentro gli iframe |
| **2 · 📎 Allega documenti** *(opzionale)* | PDF, immagini, CSV, Excel, TXT: vengono inviati all'AI **come allegati nativi**, come in una chat — nessuna elaborazione locale¹ |
| **3 · ✨ Compila con l'AI** | Il modello riceve campi + istruzioni + allegati e risponde in JSON strutturato: valore, motivazione e avvertenze per ogni campo |
| **4 · ✔️ Applica** | Rivedi la proposta con le checkbox e applica: i valori vengono inseriti con eventi nativi (compatibili con Angular/React) ed evidenziati |

¹ *Unica eccezione: i file Excel vengono convertiti 1:1 in CSV prima dell'invio, perché le API di Anthropic e OpenAI non accettano `.xlsx` come allegato. Il contenuto non viene interpretato né modificato.*

## 📦 Installazione

1. Scarica o clona questo repository
   ```bash
   git clone https://github.com/<tuo-utente>/DichiarerAI.git
   ```
2. Apri Chrome e vai su `chrome://extensions`
3. Attiva la **Modalità sviluppatore** (interruttore in alto a destra)
4. Clicca **Carica estensione non pacchettizzata** e seleziona la cartella del progetto
5. Clicca sull'icona di DichiarerAI nella barra: si apre il pannello laterale

## 🔑 Configurazione

Apri le impostazioni (⚙️ nel pannello) e scegli il provider:

| Provider | Dove ottenere la chiave | Modelli |
|---|---|---|
| **Claude (Anthropic)** — consigliato | [platform.claude.com](https://platform.claude.com) | Opus 4.8, Sonnet 4.6, Haiku 4.5… |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4o, GPT-4o mini, GPT-4.1… |

- 🔄 Il pulsante accanto alla tendina **scarica l'elenco aggiornato dei modelli** direttamente
  dal provider: quando escono modelli nuovi li puoi usare subito, senza aggiornare l'estensione.
- 🔌 **«Prova la connessione»** verifica al volo che la chiave funzioni.
- ✏️ Con **«Altro modello…»** puoi inserire qualsiasi ID modello a mano.

## 🔒 Privacy e sicurezza

- Le chiavi API sono salvate **solo sul tuo computer** (`chrome.storage.local`), mai sincronizzate né inviate altrove.
- I dati della pagina e i file allegati vengono inviati **esclusivamente** al provider AI che hai
  configurato, e **solo** quando premi «Compila con l'AI».
- Nessun server intermedio: le chiamate vanno dirette da Chrome ad Anthropic/OpenAI.
- Si tratta di **dati fiscali personali**: usa un account di cui ti fidi e leggi le condizioni
  d'uso del provider prima di caricare documenti.

## ⚠️ Avvertenze

> **DichiarerAI è un assistente, non un commercialista.**
> I valori proposti dall'AI possono contenere errori: **verifica sempre ogni campo** prima di
> salvare e inviare la dichiarazione. L'uso dell'estensione è sotto la tua esclusiva responsabilità.

## 🗂️ Struttura del progetto

```
DichiarerAI/
├── manifest.json          # Manifest V3
├── background.js          # Service worker: chiamate API (Claude / OpenAI), elenco modelli
├── sidepanel/             # Pannello laterale (interfaccia principale)
│   ├── panel.html
│   ├── panel.css
│   └── panel.js           # Lettura campi, gestione allegati, applicazione valori
├── options/               # Pagina impostazioni (provider, chiavi, modelli)
│   ├── options.html
│   ├── options.css
│   └── options.js
├── lib/
│   └── xlsx.full.min.js   # SheetJS: conversione Excel → CSV
└── icons/                 # Icone dell'estensione
```

## 🤝 Contribuire

Segnalazioni e pull request sono benvenute! Alcune idee:

- [ ] Supporto ad altri quadri con conoscenze fiscali dedicate (E — Oneri, W — Estero…)
- [ ] Cronologia delle compilazioni effettuate
- [ ] Supporto ad altri provider AI (Gemini, modelli locali via Ollama…)
