import * as path from "node:path";
import * as vscode from "vscode";
import { type ProjectInfo, type ProjectError, type WorkspaceSettingsState } from "../Types/SharedTypes";
import { CsprojReader } from "./CsprojReader";

const ExcludeGlob = "**/{bin,obj,node_modules,.git,.vs}/**";
const ProjectBatchSize = 25;
const ConfigurationSection = "semicDotnet.workspace";

export interface ScanWorkspaceResult {
  solutionPath?: string;
  workspaceSettings: WorkspaceSettingsState;
  projects: ProjectInfo[];
  errors: ProjectError[];
}

interface WorkspaceDiscoverySettings {
  useAllProjects: boolean;
  discoveryInitialized: boolean;
}

export class WorkspaceScanner {
  private sessionSolutionPath = "";

  public constructor(private readonly csprojReader: CsprojReader) {}

  public async SelectSolutionFromWorkspace(): Promise<boolean> {
    const solutionUri = await this.PickSolutionFromWorkspace();

    if (!solutionUri) {
      return false;
    }

    await this.UpdateWorkspaceSettings({
      useAllProjects: false,
      discoveryInitialized: true
    });
    this.sessionSolutionPath = vscode.workspace.asRelativePath(solutionUri, false);

    return true;
  }

  public async SetWorkspaceSolution(solutionPath: string): Promise<void> {
    this.sessionSolutionPath = solutionPath;
    await this.UpdateWorkspaceSettings({
      useAllProjects: false,
      discoveryInitialized: true
    });
  }

  public async ListAvailableSolutionPaths(): Promise<string[]> {
    const [slnxUris, slnUris] = await Promise.all([
      vscode.workspace.findFiles("**/*.slnx", ExcludeGlob),
      vscode.workspace.findFiles("**/*.sln", ExcludeGlob)
    ]);

    return slnxUris.concat(slnUris).sort(CompareByWorkspaceDepth).map((uri) => vscode.workspace.asRelativePath(uri, false));
  }

  public async SetUseAllProjects(useAllProjects: boolean): Promise<void> {
    if (!useAllProjects && !this.sessionSolutionPath) {
      this.sessionSolutionPath = await this.GetDefaultSolutionPath();
    }

    await this.UpdateWorkspaceSettings({
      useAllProjects,
      discoveryInitialized: true
    });
  }

  public async Scan(): Promise<ScanWorkspaceResult> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return {
        projects: [],
        workspaceSettings: this.GetWorkspaceSettingsState(this.GetWorkspaceSettings()),
        errors: [{ projectPath: "", message: "Open a workspace or folder before scanning for .NET projects." }]
      };
    }

    const settings = this.GetWorkspaceSettings();

    if (settings.useAllProjects) {
      return await this.ScanAllProjects();
    }

    if (this.sessionSolutionPath) {
      const solutionUri = await this.ResolveConfiguredSolution(this.sessionSolutionPath);

      if (!solutionUri) {
        return {
          projects: [],
          workspaceSettings: this.GetWorkspaceSettingsState(settings),
          errors: [{ projectPath: this.sessionSolutionPath, message: "Configured .sln or .slnx file was not found." }]
        };
      }

      return await this.ScanSolution(solutionUri);
    }

    const solutionUri = await this.FindShallowestSolution();

    if (solutionUri) {
      this.sessionSolutionPath = vscode.workspace.asRelativePath(solutionUri, false);
      await this.UpdateWorkspaceSettings({
        useAllProjects: false,
        discoveryInitialized: true
      });
      return await this.ScanSolution(solutionUri);
    }

    await this.UpdateWorkspaceSettings({
      useAllProjects: true,
      discoveryInitialized: true
    });
    return await this.ScanAllProjects();
  }

  private async ScanSolution(solutionUri: vscode.Uri): Promise<ScanWorkspaceResult> {
    const projectUris = await this.ReadProjectsFromSolution(solutionUri);
    const result = await this.ReadProjects(projectUris);

    return {
      solutionPath: solutionUri.fsPath,
      workspaceSettings: this.GetWorkspaceSettingsState(this.GetWorkspaceSettings()),
      projects: result.projects,
      errors: result.errors
    };
  }

  private async ScanAllProjects(): Promise<ScanWorkspaceResult> {
    const projectUris = await this.FindAllProjectUris();
    const result = await this.ReadProjects(projectUris);

    return {
      workspaceSettings: this.GetWorkspaceSettingsState(this.GetWorkspaceSettings()),
      projects: result.projects,
      errors: result.errors
    };
  }

  private async ReadProjects(projectUris: vscode.Uri[]): Promise<Pick<ScanWorkspaceResult, "projects" | "errors">> {
    const projects: ProjectInfo[] = [];
    const errors: ProjectError[] = [];

    for (let index = 0; index < projectUris.length; index += ProjectBatchSize) {
      const batch = projectUris.slice(index, index + ProjectBatchSize);
      const results = await Promise.all(batch.map((projectUri) => this.csprojReader.ReadProject(projectUri)));

      results.forEach((result) => {
        if (result.project) {
          projects.push(result.project);
        }

        if (result.error) {
          errors.push(result.error);
        }
      });

      await YieldToEventLoop();
    }

    projects.sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: "base" }));

    return {
      projects,
      errors
    };
  }

  private async FindShallowestSolution(): Promise<vscode.Uri | undefined> {
    const [slnxUris, slnUris] = await Promise.all([
      vscode.workspace.findFiles("**/*.slnx", ExcludeGlob),
      vscode.workspace.findFiles("**/*.sln", ExcludeGlob)
    ]);

    return slnxUris.concat(slnUris).sort(CompareByWorkspaceDepth)[0];
  }

  private async FindAllProjectUris(): Promise<vscode.Uri[]> {
    return (await vscode.workspace.findFiles("**/*.csproj", ExcludeGlob)).sort(CompareByWorkspaceDepth);
  }

  private async GetDefaultSolutionPath(): Promise<string> {
    const solutionUri = await this.FindShallowestSolution();

    return solutionUri ? vscode.workspace.asRelativePath(solutionUri, false) : "";
  }

  private async PickSolutionFromWorkspace(): Promise<vscode.Uri | undefined> {
    const [slnxUris, slnUris] = await Promise.all([
      vscode.workspace.findFiles("**/*.slnx", ExcludeGlob),
      vscode.workspace.findFiles("**/*.sln", ExcludeGlob)
    ]);
    const solutionUris = slnxUris.concat(slnUris).sort(CompareByWorkspaceDepth);

    if (solutionUris.length === 0) {
      void vscode.window.showWarningMessage("No .sln or .slnx file was found in the current workspace.");
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      solutionUris.map((uri) => ({
        label: path.basename(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri, false),
        uri
      })),
      {
        title: "Select solution",
        placeHolder: "Select .sln or .slnx used by Semic NuGet"
      }
    );

    return selected?.uri;
  }

  private async ResolveConfiguredSolution(configuredPath: string): Promise<vscode.Uri | undefined> {
    if (!configuredPath.trim()) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const candidatePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : workspaceFolder
        ? path.resolve(workspaceFolder.uri.fsPath, configuredPath)
        : configuredPath;
    const extension = path.extname(candidatePath).toLowerCase();

    if (extension !== ".sln" && extension !== ".slnx") {
      return undefined;
    }

    const candidateUri = vscode.Uri.file(candidatePath);

    try {
      await vscode.workspace.fs.stat(candidateUri);
      return candidateUri;
    } catch {
      return undefined;
    }
  }

  private async ReadProjectsFromSolution(solutionUri: vscode.Uri): Promise<vscode.Uri[]> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(solutionUri)).toString("utf8");
    const solutionDirectory = path.dirname(solutionUri.fsPath);
    const projectPaths = new Set<string>();
    const extension = path.extname(solutionUri.fsPath).toLowerCase();

    if (extension === ".sln") {
      const matches = content.matchAll(/Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+\.csproj)"/gi);
      Array.from(matches).forEach((match) => projectPaths.add(match[1]));
      return this.ResolveProjectUris(solutionDirectory, projectPaths);
    }

    const matches = content.matchAll(/\b(?:Path|File)=["']([^"']+\.csproj)["']/gi);
    Array.from(matches).forEach((match) => projectPaths.add(match[1]));

    return this.ResolveProjectUris(solutionDirectory, projectPaths);
  }

  private ResolveProjectUris(solutionDirectory: string, projectPaths: Set<string>): vscode.Uri[] {
    return Array.from(projectPaths).map((projectPath) => {
      const normalizedPath = projectPath.replace(/\//g, path.sep);
      return vscode.Uri.file(path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(solutionDirectory, normalizedPath));
    });
  }

  private GetWorkspaceSettings(): WorkspaceDiscoverySettings {
    const config = vscode.workspace.getConfiguration(ConfigurationSection);
    const useAllProjects = config.inspect<boolean>("useAllProjects");
    const discoveryInitialized = config.inspect<boolean>("discoveryInitialized");

    return {
      useAllProjects: useAllProjects?.globalValue ?? useAllProjects?.defaultValue ?? false,
      discoveryInitialized: discoveryInitialized?.globalValue ?? discoveryInitialized?.defaultValue ?? false
    };
  }

  private async UpdateWorkspaceSettings(settings: Partial<WorkspaceDiscoverySettings>): Promise<void> {
    const config = vscode.workspace.getConfiguration(ConfigurationSection);

    await Promise.all(
      Object.entries(settings).map(([key, value]) => config.update(key, value, vscode.ConfigurationTarget.Global))
    );
  }

  private GetWorkspaceSettingsState(settings: WorkspaceDiscoverySettings): WorkspaceSettingsState {
    return {
      useAllProjects: settings.useAllProjects,
      solutionPath: this.sessionSolutionPath,
      availableSolutions: []
    };
  }
}

function CompareByWorkspaceDepth(left: vscode.Uri, right: vscode.Uri): number {
  const leftPath = vscode.workspace.asRelativePath(left, false);
  const rightPath = vscode.workspace.asRelativePath(right, false);
  const leftDepth = leftPath.split(/[\\/]+/).length;
  const rightDepth = rightPath.split(/[\\/]+/).length;

  return leftDepth - rightDepth || leftPath.localeCompare(rightPath, undefined, { sensitivity: "base" });
}

function YieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
