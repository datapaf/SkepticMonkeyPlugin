import * as vscode from "vscode";
import { ChatPanel } from "./chatPanel";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("skepticMonkey.openChat", () => {
      ChatPanel.createOrShow(context.extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("skepticMonkey.clearChat", () => {
      ChatPanel.clearIfOpen();
    }),
  );

  // Open chat in the editor when the activity-bar launcher item is used.
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "skepticMonkey.launcher",
      new LauncherTreeProvider(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("skepticMonkey.launcher.open", () => {
      ChatPanel.createOrShow(context.extensionUri);
    }),
  );
}

export function deactivate(): void {
  // no-op
}

class LauncherTreeProvider implements vscode.TreeDataProvider<LauncherItem> {
  getTreeItem(element: LauncherItem): vscode.TreeItem {
    return element;
  }

  getChildren(): LauncherItem[] {
    return [
      new LauncherItem(
        "Open Chat",
        "Open SkepticMonkey chat in the editor",
        "skepticMonkey.launcher.open",
      ),
    ];
  }
}

class LauncherItem extends vscode.TreeItem {
  constructor(label: string, tooltip: string, commandId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon("comment-discussion");
    this.command = {
      command: commandId,
      title: label,
    };
  }
}
