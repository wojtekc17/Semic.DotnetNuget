import * as vscode from "vscode";
import { NugetPanel } from "./Panels/NugetPanel";

export function activate(context: vscode.ExtensionContext): void {
  const nugetPanel = new NugetPanel(context);

  context.subscriptions.push(
    nugetPanel,
    vscode.window.registerWebviewViewProvider(NugetPanel.ViewId, nugetPanel, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand("semic-dotnet-nuget.open", async () => {
      await nugetPanel.Show();
    }),
    vscode.commands.registerCommand("semic-dotnet-nuget.refresh", async () => {
      await nugetPanel.Show();
      await nugetPanel.Refresh();
    })
  );
}

export function deactivate(): void {
  return;
}
