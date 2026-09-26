<div align="center">
  <img src="icons/icon128.png" alt="DichiarerAI icon" width="96">

# DichiarerAI

**An experimental, source-grounded review assistant for Italy's pre-filled tax return.**

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![Tests](https://github.com/DavideWasTaken/DichiarerAI/actions/workflows/verify.yml/badge.svg)](https://github.com/DavideWasTaken/DichiarerAI/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
</div>

DichiarerAI reads the editable fields in the section currently open on the official Italian Revenue Agency pre-filled return website. It sends only the approved field description, your instructions, and any selected attachments directly to OpenAI or Anthropic. The model must search current official Revenue Agency sources and cite a source for every proposed field value.

The extension never submits or saves a return. Every proposal starts unselected, and you decide which values to copy into the page.

## What changed in 1.1.0

- OpenAI uses the Responses API with required web search.
- Anthropic uses hosted web search with a three-search budget.
- Searches are restricted to official `agenziaentrate.gov.it` domains.
- Each proposed value needs an official source returned by the provider.
- Declaration and income years are explicit and used to filter sources.
- Current page values are excluded unless you opt in.
- Sending tax data requires fresh consent for every analysis.
- The page is checked again before fields are changed.

## Install from source

1. Download the release ZIP and extract it, or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder.
5. Open the extension settings, choose OpenAI or Anthropic, enter your API key, and run the model/search test before saving.

## Use

1. Open a section of the [official pre-filled return website](https://dichiarazioneprecompilata.agenziaentrate.gov.it/).
2. Click **Read page**.
3. Confirm the declaration year and income year.
4. Optionally attach supporting documents and describe what you want checked.
5. Review the data disclosure and grant consent for that analysis.
6. Inspect every proposed value, reason, and official source.
7. Select only the proposals you want and click **Apply**.
8. Verify the page yourself before saving or submitting it on the Revenue Agency website.

## Supported attachments

| Type | Handling |
|---|---|
| PDF | Sent as a provider file input |
| PNG, JPEG, WebP, GIF | Sent as an image input |
| TXT, CSV, TSV, Markdown, JSON, HTML, XML | UTF-8 text sent as a file input |
| XLS, XLSX | Converted locally to ordered CSV sections with the bundled SheetJS build |

Limits are 10 files, 20 MB total, 5 MB per image, 20 MB per PDF, and 3 MB per text or converted workbook.

## Privacy and security

API keys are stored in `chrome.storage.local`. This storage is local to the browser profile, but it is not an encrypted secret vault. Page data and attachments go directly from the extension to the selected provider; there is no DichiarerAI server.

Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) before using real tax documents.

## Development

Requirements: Node.js `^22.12.0` or `>=24` and Chrome.

```bash
npm ci
npm test
npm run verify
npm run package
```

The production extension is plain Manifest V3 JavaScript. Node and jsdom are used only for tests and packaging checks.

## Project layout

```text
background.js          provider calls, cancellation, source validation
lib/core.js            official-domain, year, privacy, and result policy
lib/providers.js       OpenAI and Anthropic request/response adapters
lib/page-bridge.js     guarded page read, preflight, and field updates
sidepanel/             review and consent interface
options/               provider, key, and model settings
tests/                 Node/jsdom regression tests
```

## Important limitation

DichiarerAI is an experimental prototype, not tax or legal advice. AI output and online sources can be incomplete or wrong. You remain responsible for checking every value and for the final return.

Original project code is available under the [MIT License](LICENSE). The bundled SheetJS file keeps its Apache-2.0 license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
