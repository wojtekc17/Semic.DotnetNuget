import * as path from "node:path";
import { access } from "node:fs/promises";
import * as vscode from "vscode";
import { type PackageReferenceInfo, type ProjectInfo } from "../Types/SharedTypes";
import { CreateProjectId, GetRelativeProjectPath } from "../Utils/PathUtils";

export interface ReadProjectResult {
  project?: ProjectInfo;
  error?: {
    projectPath: string;
    message: string;
  };
}

export class CsprojReader {
  public async ReadProject(projectUri: vscode.Uri): Promise<ReadProjectResult> {
    try {
      const content = this.DecodeXmlFile(await vscode.workspace.fs.readFile(projectUri));
      const projectId = CreateProjectId(projectUri.fsPath);
      const projectName = GetProjectDisplayName(content, path.basename(projectUri.fsPath, ".csproj"));
      const relativeProjectPath = GetRelativeProjectPath(projectUri);
      const centralVersions = await this.ReadCentralPackageVersions(projectUri.fsPath);
      const packages = ExtractPackageReferences(content, centralVersions).map((packageReference) => ({
        ...packageReference,
        projectId,
        projectName,
        projectPath: projectUri.fsPath,
        relativeProjectPath
      }));

      return {
        project: {
          id: projectId,
          name: projectName,
          path: projectUri.fsPath,
          relativePath: relativeProjectPath,
          packages
        }
      };
    } catch (error) {
      return {
        error: {
          projectPath: projectUri.fsPath,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      };
    }
  }

  private DecodeXmlFile(fileBytes: Uint8Array): string {
    const buffer = Buffer.from(fileBytes);
    const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    const hasUtf16LeBom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
    const hasUtf16BeBom = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
    const xmlHeaderProbe = buffer.toString("latin1", 0, Math.min(buffer.length, 256));
    const xmlEncoding = xmlHeaderProbe.match(/encoding=["']([^"']+)["']/i)?.[1];
    const detectedEncoding =
      (hasUtf8Bom && "utf8") ||
      (hasUtf16LeBom && "utf16-le") ||
      (hasUtf16BeBom && "utf16-be") ||
      (xmlEncoding ? xmlEncoding.toLowerCase() : undefined) ||
      "utf8";

    if (detectedEncoding === "utf16-le" || detectedEncoding === "utf-16" || detectedEncoding === "utf-16le") {
      return new TextDecoder("utf-16le").decode(buffer);
    }

    if (detectedEncoding === "utf16-be" || detectedEncoding === "utf-16be") {
      return DecodeUtf16Be(buffer);
    }

    return new TextDecoder("utf-8").decode(buffer);
  }

  private async ReadCentralPackageVersions(projectPath: string): Promise<Map<string, string>> {
    const versions = new Map<string, string>();
    let currentDirectory = path.dirname(projectPath);

    while (true) {
      const propsPath = path.join(currentDirectory, "Directory.Packages.props");

      try {
        await access(propsPath);
        const content = this.DecodeXmlFile(await vscode.workspace.fs.readFile(vscode.Uri.file(propsPath)));

        ExtractXmlElements(content, "PackageVersion").forEach((element) => {
          const id = element.attributes.Include || element.attributes.Update || "";
          const version = element.attributes.Version || GetChildText(element.body, "Version") || "";

          if (id.trim().length > 0 && version.trim().length > 0) {
            versions.set(id.trim(), version.trim());
          }
        });

        return versions;
      } catch {
        const parentDirectory = path.dirname(currentDirectory);

        if (parentDirectory === currentDirectory) {
          return versions;
        }

        currentDirectory = parentDirectory;
      }
    }
  }
}

function GetProjectDisplayName(xmlText: string, fallbackName: string): string {
  return (
    GetChildText(xmlText, "AssemblyName") ||
    GetChildText(xmlText, "RootNamespace") ||
    GetChildText(xmlText, "PackageId") ||
    fallbackName
  );
}

function ExtractPackageReferences(
  xmlText: string,
  centralVersions: ReadonlyMap<string, string>
): Array<Omit<PackageReferenceInfo, "projectId" | "projectName" | "projectPath" | "relativeProjectPath">> {
  return ExtractXmlElements(xmlText, "PackageReference")
    .map((element) => {
      const id = element.attributes.Include || element.attributes.Update || element.attributes.Remove || "";
      const version = element.attributes.Version || GetChildText(element.body, "Version") || centralVersions.get(id.trim()) || "";

      return {
        id: id.trim(),
        version: version.trim()
      };
    })
    .filter((packageReference) => packageReference.id.length > 0 && packageReference.version.length > 0);
}

function ExtractXmlElements(xmlText: string, tagName: string): Array<{ attributes: Record<string, string>; body: string }> {
  const elements: Array<{ attributes: Record<string, string>; body: string }> = [];
  const escapedTagName = EscapeRegExp(tagName);
  const elementPattern = new RegExp(
    `<${escapedTagName}\\b([^>]*)>([\\s\\S]*?)<\\/${escapedTagName}>|<${escapedTagName}\\b([^>]*)\\/?>`,
    "gi"
  );
  let match: RegExpExecArray | null;

  while ((match = elementPattern.exec(xmlText)) !== null) {
    elements.push({
      attributes: ParseAttributes(match[1] || match[3] || ""),
      body: match[2] || ""
    });
  }

  return elements;
}

function ParseAttributes(attributeText: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([\w:.-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(attributeText)) !== null) {
    attributes[match[1]] = DecodeXmlEntities(match[2]);
  }

  return attributes;
}

function GetChildText(xmlText: string, tagName: string): string {
  const match = new RegExp(`<${EscapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${EscapeRegExp(tagName)}>`, "i").exec(xmlText);
  return match ? DecodeXmlEntities(match[1].replace(/<[^>]+>/g, "")).trim() : "";
}

function DecodeXmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function DecodeUtf16Be(buffer: Buffer): string {
  const swapped = Buffer.from(buffer);

  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const byte = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = byte;
  }

  return new TextDecoder("utf-16le").decode(swapped);
}

function EscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
