# SkepticMonkey VS Code Extension

Chat with [SkepticMonkey](https://github.com/datapaf/SkepticMonkey) from VS Code and inspect **line-level uncertainty** on generated code, using the same red/green highlighting as [HallucinationDetectionViewer](https://github.com/datapaf/HallucinationDetectionViewer).

## Features

- **Chat tab in the editor area** (full-width webview panel)
- Activity-bar shortcut: SkepticMonkey icon → **Open Chat**
- Sends **only the latest user message** to the API (conversation history is local UI only)
- Shows the full generation with uncertainty scores on **code lines inside markdown fences**
  - uncertainty **> threshold** → red
  - otherwise → green
- Configurable API URL and uncertainty threshold

## Prerequisites

1. Run the SkepticMonkey API locally (see that repo’s README):

```bash
uvicorn skeptic_monkey.api:app --host 127.0.0.1 --port 8000
```

2. Node.js 18+ for building this extension.

## Install / develop

```bash
npm install
npm run compile
```

Then press **F5** in VS Code (“Run Extension”) to open an Extension Development Host, or package:

```bash
npm run package
```

and install the generated `.vsix`.

## Usage

1. Run **SkepticMonkey: Open Chat** from the Command Palette, or click the SkepticMonkey activity-bar icon → **Open Chat**.
2. The chat opens as an **editor tab**. Type a prompt and press **Send** (Enter). Shift+Enter inserts a new line.
3. Wait for generation; code inside \`\`\` fences is highlighted with uncertainty scores.
4. Adjust settings under **Settings → SkepticMonkey**:
   - `skepticMonkey.apiUrl` (default `http://127.0.0.1:8000`)
   - `skepticMonkey.uncertaintyThreshold` (default `0.5`)
   - `skepticMonkey.requestTimeoutMs` (default `600000`)

## API contract

`POST {apiUrl}/estimate/line`

```json
{ "input_text": "<DeepSeek-Coder chat template>", "no-template": true }
```

The extension wraps the user's message in the same DeepSeek-Coder instruct template used by HallucinationDetectionViewer (`templated_question`) and sets `no-template` so the API does not wrap or retokenize it a second time.

Response `lines` are rendered like the Streamlit viewer: prose stays uncolored; only lines inside code fences get red/green borders and numeric scores.

## License

MIT
