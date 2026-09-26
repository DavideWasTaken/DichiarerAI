# Privacy

DichiarerAI has no project-operated backend and does not collect analytics.

API keys and settings are stored in `chrome.storage.local` in the local Chrome profile. This storage is not an encrypted secret vault. When the user starts an analysis and grants fresh consent, the extension sends the selected field descriptions, optional current field values, instructions, and attachments directly to the configured provider (OpenAI or Anthropic). The provider may retain or process that data under its own terms and account settings.

Current field values are excluded by default. The extension only runs on the official pre-filled return host and does not save or submit a return.

Removing the extension deletes its local extension storage through Chrome. Users can also clear the saved keys from the extension settings before removal.
