import * as path from "node:path";
import * as vscode from "vscode";
import {
  DefaultOptionsState,
  type ExtensionToWebviewMessage,
  type PanelClientState,
  type WebviewToExtensionMessage
} from "../Types/SharedTypes";
import { CsprojReader } from "../Services/CsprojReader";
import { NugetService } from "../Services/NugetService";
import { WorkspaceScanner } from "../Services/WorkspaceScanner";

export class NugetPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly ViewId = "semicDotnetNugetView";

  private readonly nugetService: NugetService;
  private readonly disposables: vscode.Disposable[] = [];
  private webviewView: vscode.WebviewView | undefined;
  private clientState: PanelClientState = {
    activeTab: "browse",
    searchTerm: "",
    options: { ...DefaultOptionsState }
  };
  private projects: Awaited<ReturnType<NugetService["LoadWorkspace"]>>["projects"] = [];

  public constructor(private readonly context: vscode.ExtensionContext) {
    const reader = new CsprojReader();
    const scanner = new WorkspaceScanner(reader);
    this.nugetService = new NugetService(scanner, context.globalStorageUri.fsPath);
  }

  public async Show(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.semicDotnetNugetPanelContainer");
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview"))]
    };
    webviewView.webview.html = this.GetHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        void this.HandleMessage(message);
      },
      undefined,
      this.disposables
    );

    webviewView.onDidDispose(
      () => {
        this.webviewView = undefined;
      },
      undefined,
      this.disposables
    );
  }

  public async Refresh(): Promise<void> {
    if (!this.webviewView) {
      return;
    }

    await this.PostMessage({
      type: "busyState",
      payload: {
        status: "loading",
        message: "Loading .slnx projects and NuGet sources..."
      }
    });

    try {
      const payload = await this.nugetService.LoadWorkspace(this.clientState.options);
      this.clientState.options = payload.options;
      this.projects = payload.projects;
      await this.PostMessage({ type: "workspaceLoaded", payload });
    } catch (error) {
      await this.PostMessage({
        type: "error",
        payload: {
          message: error instanceof Error ? error.message : "Workspace refresh failed."
        }
      });
    }
  }

  public dispose(): void {
    this.webviewView = undefined;

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async HandleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.PostMessage({ type: "stateChanged", payload: this.clientState });
        await this.Refresh();
        break;
      case "refresh":
        await this.Refresh();
        break;
      case "syncState":
        this.clientState = message.payload;
        break;
      case "selectSource":
        this.clientState.options.selectedSourceName = message.payload.sourceName;
        await this.nugetService.SetConfiguredSource(message.payload.sourceName);
        await this.Refresh();
        break;
      case "setWorkspaceSolution":
        await this.nugetService.SetWorkspaceSolution(message.payload.solutionPath);
        await this.Refresh();
        break;
      case "setUseAllProjects":
        await this.nugetService.SetUseAllProjects(message.payload.useAllProjects);
        await this.Refresh();
        break;
      case "addSource":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: "Adding NuGet source..." } });
          await this.nugetService.AddSource(message.payload);
          this.clientState.options.selectedSourceName = message.payload.name;
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Could not add NuGet source." } });
        }
        break;
      case "updateSource":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: "Updating NuGet source..." } });
          await this.nugetService.UpdateSource(message.payload);
          this.clientState.options.selectedSourceName = message.payload.name;
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Could not update NuGet source." } });
        }
        break;
      case "removeSource":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: "Removing NuGet source..." } });
          await this.nugetService.RemoveSource(message.payload);
          if (this.clientState.options.selectedSourceName === message.payload.name) {
            this.clientState.options.selectedSourceName = "__all__";
          }
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Could not remove NuGet source." } });
        }
        break;
      case "installPackage":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: `Installing ${message.payload.packageId}...` } });
          const installMessage = await this.nugetService.InstallPackage(message.payload, this.projects);
          await this.PostMessage({ type: "busyState", payload: { status: "success", message: installMessage } });
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Package install failed." } });
        }
        break;
      case "bulkInstallPackages":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: "Updating selected package references..." } });
          const bulkMessage = await this.nugetService.BulkInstallPackages(message.payload, this.projects);
          await this.PostMessage({ type: "busyState", payload: { status: "success", message: bulkMessage } });
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Bulk package update failed." } });
        }
        break;
      case "uninstallPackage":
        try {
          await this.PostMessage({ type: "busyState", payload: { status: "loading", message: `Uninstalling ${message.payload.packageId}...` } });
          const uninstallMessage = await this.nugetService.UninstallPackage(message.payload, this.projects);
          await this.PostMessage({ type: "busyState", payload: { status: "success", message: uninstallMessage } });
          await this.Refresh();
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Package uninstall failed." } });
        }
        break;
      case "browsePackages": {
        try {
          const result = await this.nugetService.BrowsePackages(
            message.payload.query,
            message.payload.sourceName,
            message.payload.includePrerelease,
            message.payload.skip,
            message.payload.take,
            message.payload.append
          );
          await this.PostMessage({ type: "browsePackagesLoaded", payload: result });
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "NuGet search failed." } });
        }
        break;
      }
      case "loadPackageDetails": {
        try {
          const result = await this.nugetService.LoadPackageDetails(
            message.payload.packageId,
            message.payload.version,
            message.payload.sourceName
          );
          await this.PostMessage({ type: "packageDetailsLoaded", payload: result });
        } catch (error) {
          await this.PostMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Package details could not be loaded." } });
        }
        break;
      }
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "semicDotnetNuget.source");
        break;
    }
  }

  private GetHtmlForWebview(webview: vscode.Webview): string {
    const nonce = CreateNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview", "assets", "App.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview", "assets", "App.css")));

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Semic NuGet (.NET)</title>
    <link href="${styleUri}" rel="stylesheet" />
    <style nonce="${nonce}">
      .webviewFallback {
        box-sizing: border-box;
        min-height: 100vh;
        padding: 24px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
      }

      .webviewFallback h2 {
        margin: 0 0 8px;
        font-size: 14px;
        font-weight: 600;
      }

      .webviewFallback p {
        margin: 0;
        color: var(--vscode-descriptionForeground);
      }
    </style>
  </head>
  <body>
    <div id="root">
      <main class="webviewFallback">
        <h2>Loading Semic NuGet...</h2>
        <p>If this message stays visible, rebuild the extension webview assets and reload the Extension Development Host.</p>
      </main>
    </div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private async PostMessage(message: ExtensionToWebviewMessage): Promise<void> {
    await this.webviewView?.webview.postMessage(message);
  }
}

function CreateNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";

  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}
