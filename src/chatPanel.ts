import * as vscode from "vscode";
import {
  buildInputText,
  estimateLineUncertainty,
  LineEstimateResponse,
} from "./apiClient";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  lines?: LineEstimateResponse["lines"];
  meta?: {
    model_path?: string;
    estimator?: string;
  };
}

/**
 * SkepticMonkey chat as an editor-area webview tab.
 */
export class ChatPanel {
  public static readonly viewType = "skepticMonkey.chatPanel";

  private static current?: ChatPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private messages: ChatMessage[] = [];
  private busy = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel = panel;

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "ready":
            this.postState();
            break;
          case "send":
            await this.handleSend(String(message.text ?? ""));
            break;
          case "clear":
            this.clearChat();
            break;
          case "openSettings":
            await vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "skepticMonkey",
            );
            break;
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          this.postState();
        }
      },
      null,
      this.disposables,
    );
  }

  public static createOrShow(extensionUri: vscode.Uri): ChatPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(column);
      return ChatPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      "SkepticMonkey Chat",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    ChatPanel.current = new ChatPanel(panel, extensionUri);
    return ChatPanel.current;
  }

  public static clearIfOpen(): void {
    ChatPanel.current?.clearChat();
  }

  public clearChat(): void {
    this.messages = [];
    this.postState();
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("skepticMonkey");
    return {
      apiUrl: config.get<string>("apiUrl", "http://127.0.0.1:8000"),
      threshold: config.get<number>("uncertaintyThreshold", 0.5),
      timeoutMs: config.get<number>("requestTimeoutMs", 600_000),
    };
  }

  private postState(): void {
    const { apiUrl, threshold } = this.getConfig();
    void this.panel.webview.postMessage({
      type: "state",
      messages: this.messages,
      busy: this.busy,
      apiUrl,
      threshold,
    });
  }

  private async handleSend(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || this.busy) {
      return;
    }

    this.messages.push({
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    });
    this.busy = true;
    this.postState();

    const { apiUrl, timeoutMs } = this.getConfig();

    try {
      // Intentionally send only the latest user message — not full history.
      const result = await estimateLineUncertainty(
        apiUrl,
        buildInputText(text),
        timeoutMs,
      );

      this.messages.push({
        id: `a-${Date.now()}`,
        role: "assistant",
        content: result.generation_text,
        lines: result.lines,
        meta: {
          model_path: result.model_path,
          estimator: result.estimator,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.messages.push({
        id: `e-${Date.now()}`,
        role: "system",
        content: message,
      });
    } finally {
      this.busy = false;
      this.postState();
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.css"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>SkepticMonkey Chat</title>
</head>
<body>
  <header class="toolbar">
    <div class="toolbar-title">SkepticMonkey</div>
    <div class="toolbar-actions">
      <button id="settingsBtn" class="icon-btn" title="Open settings">Settings</button>
      <button id="clearBtn" class="icon-btn" title="Clear chat">Clear</button>
    </div>
  </header>
  <div id="apiHint" class="api-hint"></div>
  <main id="messages" class="messages" aria-live="polite"></main>
  <footer class="composer">
    <textarea id="input" rows="3" placeholder="Ask SkepticMonkey… (only this message is sent to the API)"></textarea>
    <button id="sendBtn" class="send-btn">Send</button>
  </footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ChatPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
