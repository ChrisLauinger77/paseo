import { mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { seedAgentProfiles, seedModelProvider } from "../support/helpers/agent-profiles";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoWorkspace } from "../support/helpers/launcher";
import { openGlobalNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";

const providerId = "multi-project-diagnostic";
const modelId = "pi-profile-model";

for (const compact of [false, true]) {
  test(`selects projects and gates Worktree in the ${compact ? "compact" : "desktop"} form`, async ({
    page,
  }, testInfo) => {
    const git = await seedWorkspace({ repoPrefix: "multi-task-git-" });
    const notes = await seedWorkspace({ repoPrefix: "multi-task-notes-", git: false });
    try {
      await gotoWorkspace(page, git.workspaceId);
      await openGlobalNewWorkspaceComposer(page);
      if (compact) await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("new-workspace-multi-project-task").click();
      const sheet = page.getByTestId("multi-project-task-sheet");
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId("multi-project-task-start")).toBeDisabled();
      await page.getByTestId("multi-project-task-prompt").fill("Migrate these repositories");
      await page.getByTestId(`multi-project-task-project-${git.projectId}`).click();
      await page.getByTestId("multi-project-task-worktree").click();
      await expect(page.getByTestId("multi-project-task-worktree")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.getByTestId(`multi-project-task-project-${notes.projectId}`).click();
      await expect(page.getByTestId("multi-project-task-worktree")).toHaveCount(0);
      await page.getByTestId(`multi-project-task-project-${notes.projectId}`).click();
      await expect(page.getByTestId("multi-project-task-local")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.screenshot({ path: testInfo.outputPath("multi-project-task.png") });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await page.getByTestId("new-workspace-multi-project-task").click();
      await expect(page.getByTestId("multi-project-task-prompt")).toHaveValue("");
      await expect(page.getByTestId(`multi-project-task-project-${git.projectId}`)).toHaveAttribute(
        "aria-checked",
        "false",
      );
    } finally {
      await notes.cleanup();
      await git.cleanup();
    }
  });
}

test("launches a coordinator with a profile and recovers visibly from provider startup failure", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const first = await seedWorkspace({ repoPrefix: "multi-task-first-" });
  const second = await seedWorkspace({ repoPrefix: "multi-task-second-" });
  const binDir = await mkdtemp(path.join(tmpdir(), "multi-task-provider-"));
  const executable = path.join(binDir, "provider-node");
  await symlink(process.execPath, executable);
  const provider = await seedModelProvider({
    id: providerId,
    label: "Multi-project diagnostic",
    extends: "pi",
    command: [executable, path.resolve("e2e/fixtures/fake-pi-rpc.mjs")],
    models: [{ id: modelId, label: "Pi profile model", description: "Deterministic coordinator" }],
  });
  const profiles = await seedAgentProfiles([
    {
      id: "multi-task-profile",
      name: "Migration workers",
      provider: providerId,
      model: modelId,
      thinkingOptionId: "high",
    },
  ]);
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "multi-task" });
  const requests: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const message = frame.payload.toString();
      if (message.includes('"type":"agent.create.request"')) requests.push(message);
    }),
  );
  try {
    await gotoWorkspace(page, first.workspaceId);
    await openGlobalNewWorkspaceComposer(page);
    await page.getByTestId("new-workspace-multi-project-task").click();
    const sheet = page.getByTestId("multi-project-task-sheet");
    await sheet
      .getByTestId("multi-project-task-prompt")
      .fill("Apply the GNOME 52 migration guide.\nKeep this task verbatim.");
    await page.getByTestId(`multi-project-task-project-${first.projectId}`).click();
    await page.getByTestId(`multi-project-task-project-${second.projectId}`).click();
    await sheet.getByTestId("combined-model-selector").click();
    await page.getByTestId("model-profile-row-multi-task-profile").click();
    await expect(page.getByTestId("multi-project-task-start")).toBeEnabled();
    await rename(executable, `${executable}.parked`);
    await page.getByTestId("multi-project-task-start").click();
    await expect(page.getByTestId("multi-project-task-error")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("multi-project-task-prompt")).toHaveValue(
      "Apply the GNOME 52 migration guide.\nKeep this task verbatim.",
    );
    await page.screenshot({ path: testInfo.outputPath("coordinator-failure.png") });
    await rename(`${executable}.parked`, executable);
    await expect(page.getByTestId("multi-project-task-start")).toBeEnabled();
    await page.getByTestId("multi-project-task-start").click();
    await expect(sheet).toHaveCount(0, { timeout: 60_000 });
    await expect(page).toHaveURL(/\/workspace\//);
    const agents = (await client.fetchAgents({ scope: "active" })).entries.filter(
      ({ agent }) => agent.provider === providerId,
    );
    expect(agents).toHaveLength(1);
    const coordinator = agents[0]!.agent;
    expect(coordinator.workspaceId).toBe(first.workspaceId);
    expect(coordinator.model).toBe(modelId);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toContain(first.projectId);
      expect(request).toContain(second.projectId);
      expect(request).toContain("completion notifications");
    }
    await page.screenshot({ path: testInfo.outputPath("coordinator-launched.png") });
  } finally {
    await client.close();
    await profiles.restore();
    await provider.restore();
    await second.cleanup();
    await first.cleanup();
    await rm(binDir, { recursive: true, force: true });
  }
});
