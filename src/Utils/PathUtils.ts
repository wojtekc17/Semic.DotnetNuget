import * as path from "node:path";
import * as vscode from "vscode";

export function CreateProjectId(projectPath: string): string {
  return projectPath.toLowerCase();
}

export function GetDirectoryName(projectPath: string): string {
  return path.basename(path.dirname(projectPath));
}

export function GetProjectName(projectPath: string): string {
  return path.basename(projectPath, path.extname(projectPath));
}

export function GetRelativeProjectPath(projectUri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(projectUri);

  if (!workspaceFolder) {
    return projectUri.fsPath;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, projectUri.fsPath);
  return workspaceFolder.name === path.basename(workspaceFolder.uri.fsPath)
    ? relativePath
    : path.join(workspaceFolder.name, relativePath);
}
