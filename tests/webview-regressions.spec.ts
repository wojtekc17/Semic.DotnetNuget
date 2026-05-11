import { expect, type Page, test } from "@playwright/test";

type WebviewMessage = {
    type: string;
    payload?: unknown;
};

async function dispatchWebviewMessage(page: Page, message: WebviewMessage) {
    await page.evaluate((nextMessage) => {
        window.dispatchEvent(new MessageEvent("message", { data: nextMessage }));
    }, message);
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const stateStore = { value: undefined as unknown };

        Object.defineProperty(window, "acquireVsCodeApi", {
            value: () => ({
                getState: () => stateStore.value,
                setState: (nextState: unknown) => {
                    stateStore.value = nextState;
                },
                postMessage: (message: { type: string }) => {
                    if (message.type !== "ready") {
                        return;
                    }

                    window.dispatchEvent(
                        new MessageEvent("message", {
                            data: {
                                type: "workspaceLoaded",
                                payload: {
                                    solutionPath: "Test.sln",
                                    workspaceSettings: {
                                        useAllProjects: false,
                                        solutionPath: "Test.sln",
                                        availableSolutions: ["Test.sln"]
                                    },
                                    projects: [
                                        {
                                            id: "api",
                                            name: "ApiService",
                                            path: "c:/repo/src/ApiService/ApiService.csproj",
                                            relativePath: "src/ApiService/ApiService.csproj",
                                            packages: [
                                                {
                                                    id: "Critical.Package",
                                                    version: "1.0.0",
                                                    projectId: "api",
                                                    projectName: "ApiService",
                                                    projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                                                    relativeProjectPath: "src/ApiService/ApiService.csproj"
                                                }
                                            ]
                                        }
                                    ],
                                    installedPackages: [
                                        {
                                            id: "Critical.Package",
                                            versions: ["1.0.0"],
                                            projects: [
                                                {
                                                    id: "Critical.Package",
                                                    version: "1.0.0",
                                                    projectId: "api",
                                                    projectName: "ApiService",
                                                    projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                                                    relativeProjectPath: "src/ApiService/ApiService.csproj"
                                                }
                                            ],
                                            availableInSelectedSource: false,
                                            availableSourceNames: [],
                                            hasUpdate: false,
                                            isConsolidated: true,
                                            vulnerabilities: [
                                                {
                                                    projectId: "api",
                                                    projectName: "ApiService",
                                                    version: "1.0.0",
                                                    severity: "High",
                                                    advisoryUrl: "https://example.test/advisory"
                                                }
                                            ]
                                        }
                                    ],
                                    sources: [
                                        {
                                            name: "broken",
                                            url: "https://broken-source.example/v3/index.json",
                                            enabled: true,
                                            healthStatus: "error",
                                            healthMessage: "Source health check failed"
                                        },
                                        {
                                            name: "nuget.org",
                                            url: "https://api.nuget.org/v3/index.json",
                                            enabled: true,
                                            healthStatus: "ok",
                                            healthMessage: "Source is available"
                                        }
                                    ],
                                    errors: [],
                                    options: {
                                        selectedSourceName: "broken",
                                        includePrerelease: false
                                    },
                                    status: "success",
                                    message: "Workspace loaded."
                                }
                            }
                        })
                    );
                }
            })
        });
    });

    await page.goto("/");
});

test("operation log opens only on Logs click", async ({ page }) => {
    await dispatchWebviewMessage(page, {
        type: "error",
        payload: {
            message: "Bulk package update failed.",
            details: "Operation log\nFailed to update package in project."
        }
    });

    await expect(page.locator(".operationErrorPanel")).toHaveCount(0);

    const logsButton = page.getByRole("button", { name: "Logs" });
    await expect(logsButton).toBeVisible();

    await logsButton.click();
    await expect(page.locator(".operationErrorPanel")).toBeVisible();
    await expect(page.locator(".operationErrorPanel pre")).toContainText("Failed to update package in project.");

    await page.getByRole("button", { name: "Hide logs" }).click();
    await expect(page.locator(".operationErrorPanel")).toHaveCount(0);
});

test("vulnerabilities remain visible even when selected source is broken", async ({ page }) => {
    await page.getByRole("button", { name: "VULNERABILITIES" }).click();

    await expect(page.getByText("Critical.Package")).toBeVisible();
    await expect(page.getByText("No vulnerabilities found.")).toHaveCount(0);
});
