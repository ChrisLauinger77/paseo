import type {
  CreateAgentRequestOptions,
  CreateWorkspaceRequestOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { TaskLaunchClient, TaskAgentConfig } from "./form-model";
import { buildOrchestrationPrompt } from "./prompt";

import { describe, expect, it } from "vitest";
import { openMultiProjectTaskForm, type TaskProject } from "./form-model";

const projects: TaskProject[] = [
  {
    projectId: "a",
    projectDisplayName: "Extension A",
    projectCustomName: null,
    projectRootPath: "/a",
    projectKind: "git",
  },
  {
    projectId: "b",
    projectDisplayName: "Extension B",
    projectCustomName: null,
    projectRootPath: "/b",
    projectKind: "git",
  },
  {
    projectId: "notes",
    projectDisplayName: "Notes",
    projectCustomName: null,
    projectRootPath: "/notes",
    projectKind: "non_git",
  },
];

function open() {
  return openMultiProjectTaskForm({ status: "ready", projects, workspaces: [] });
}

describe("multi-project task form", () => {
  it("requires a prompt and at least one registered project, with independent selection", () => {
    const form = open();
    expect(form.getState().canSubmit).toBe(false);
    form.setPrompt("Migrate the extensions");
    form.applyAgentConfig({ provider: "codex", model: "gpt-test" });
    expect(form.getState().canSubmit).toBe(false);
    form.toggleProject("a");
    form.toggleProject("b");
    expect(form.getState().selectedProjectIds).toEqual(["a", "b"]);
    expect(form.getState().canSubmit).toBe(true);
    form.toggleProject("a");
    expect(form.getState().selectedProjectIds).toEqual(["b"]);
    form.toggleProject("b");
    expect(form.getState().canSubmit).toBe(false);
    form.toggleProject("unknown");
    expect(form.getState().selectedProjectIds).toEqual([]);
  });
});

it("allows Worktree only for a non-empty selection of Git projects", () => {
  const form = open();
  form.setIsolation("worktree");
  expect(form.getState().isolation).toBe("local");
  form.toggleProject("a");
  form.toggleProject("b");
  form.setIsolation("worktree");
  expect(form.getState()).toMatchObject({ canUseWorktree: true, isolation: "worktree" });
  form.applyTargets({ status: "loading" });
  expect(form.getState()).toMatchObject({ canSubmit: false, isolation: "worktree" });
  form.applyTargets({ status: "ready", projects, workspaces: [] });
  form.toggleProject("notes");
  expect(form.getState()).toMatchObject({ canUseWorktree: false, isolation: "local" });
  form.setIsolation("worktree");
  expect(form.getState().isolation).toBe("local");
});

it("preserves draft input through replica updates and blocks missing targets until deselected", () => {
  const form = readyForm();
  form.applyTargets({ status: "ready", projects: projects.slice(1), workspaces: [] });
  expect(form.getState()).toMatchObject({
    prompt: task,
    selectedProjectIds: ["a", "b"],
    canSubmit: false,
    hasMissingProjects: true,
  });
  form.toggleProject("a");
  expect(form.getState()).toMatchObject({
    selectedProjectIds: ["b"],
    canSubmit: true,
    hasMissingProjects: false,
  });
  form.close();
  form.setPrompt("discarded");
  expect(form.getState().prompt).toBe(task);
  expect(open().getState().selectedProjectIds).toEqual([]);
});

const task = "  Apply the GNOME 52 migration guide.\nKeep my exact wording.\n";
const config: TaskAgentConfig = {
  provider: "codex",
  model: "gpt-test",
  modeId: "auto",
  thinkingOptionId: "high",
  featureValues: { fast_mode: true },
};
const workspace = { id: "context", projectId: "a", workspaceDirectory: "/a", archivingAt: null };
function readyForm(workspaces = [workspace]) {
  const form = openMultiProjectTaskForm({ status: "ready", projects, workspaces });
  form.setPrompt(task);
  form.toggleProject("a");
  form.toggleProject("b");
  form.applyAgentConfig(config);
  return form;
}
class LaunchClient implements TaskLaunchClient {
  agents: CreateAgentRequestOptions[] = [];
  workspaces: CreateWorkspaceRequestOptions[] = [];
  error: string | null = null;
  async createAgent(input: CreateAgentRequestOptions) {
    this.agents.push(input);
    if (this.error) throw new Error(this.error);
    return { id: "coordinator", workspaceId: "context" };
  }
  async createWorkspace(input: CreateWorkspaceRequestOptions) {
    this.workspaces.push(input);
    if (this.error) return { error: this.error };
    return { agent: { id: "coordinator", workspaceId: "new-context" } };
  }
}

it.each(["local", "worktree"] as const)(
  "launches one coordinator with %s worker instructions and the selected configuration",
  async (isolation) => {
    const form = readyForm();
    form.setIsolation(isolation);
    const client = new LaunchClient();
    expect(await form.submit(client, () => "creation-id")).toEqual({
      id: "coordinator",
      workspaceId: "context",
    });
    expect(client.workspaces).toEqual([]);
    expect(client.agents).toHaveLength(1);
    expect(client.agents[0]).toMatchObject({
      workspaceId: "context",
      idempotencyKey: "creation-id",
      config: { ...config, cwd: "/a" },
    });
    const prompt = client.agents[0]!.initialPrompt!;
    expect(prompt.endsWith(task)).toBe(true);
    expect(prompt).toContain('"projectId": "a"');
    expect(prompt).toContain('"projectId": "b"');
    expect(prompt).not.toContain('"projectId": "notes"');
    expect(prompt).toContain(`isolation: "${isolation}"`);
    expect(prompt).toContain('"provider": "codex/gpt-test"');
    expect(prompt).toContain('"features": {');
    expect(form.getState().submission).toBe("succeeded");
  },
);

it("uses ordinary local workspace creation only when selected projects have no usable coordinator context", async () => {
  const form = readyForm([]);
  form.setIsolation("worktree");
  const client = new LaunchClient();
  await form.submit(client, () => "create-context");
  expect(client.agents).toEqual([]);
  expect(client.workspaces[0]).toMatchObject({
    source: { kind: "directory", path: "/a", projectId: "a" },
    agent: { config: { ...config, cwd: "/a" } },
  });
  expect(client.workspaces[0]!.agent!.initialPrompt).toContain('isolation: "worktree"');
});

it.each([true, false])(
  "shows coordinator failure and retries the same creation identity (existing context: %s)",
  async (existing) => {
    const form = readyForm(existing ? [workspace] : []);
    const client = new LaunchClient();
    client.error = "Provider failed to start";
    expect(await form.submit(client, () => "first-id")).toBeNull();
    expect(form.getState()).toMatchObject({
      error: "Provider failed to start",
      submission: "idle",
      canSubmit: true,
      prompt: task,
    });
    // Workspace publication from a partly successful creation must not change the retry.
    form.applyTargets({ status: "ready", projects, workspaces: [workspace] });
    client.error = null;
    expect(await form.submit(client, () => "must-not-be-used")).not.toBeNull();
    const requests = existing ? client.agents : client.workspaces;
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
  },
);

it("blocks duplicate submission and freezes inputs while creating", async () => {
  const form = readyForm();
  let complete!: (value: { id: string; workspaceId: string }) => void;
  const client: TaskLaunchClient = {
    createAgent: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    createWorkspace: async () => {
      throw new Error("Unexpected workspace creation");
    },
  };
  const pending = form.submit(client, () => "once");
  expect(form.getState()).toMatchObject({ submission: "pending", canSubmit: false });
  form.setPrompt("replacement");
  form.toggleProject("b");
  expect(form.getState()).toMatchObject({ prompt: task, selectedProjectIds: ["a", "b"] });
  expect(await form.submit(client, () => "twice")).toBeNull();
  complete({ id: "coordinator", workspaceId: "context" });
  await pending;
});

it("gives fixed instructions for validation, parallel children, notifications, and partial failure", () => {
  const prompt = buildOrchestrationPrompt({
    task,
    projects: projects.slice(0, 2),
    isolation: "worktree",
    agent: config,
  });
  for (const instruction of [
    "list_projects",
    "create_workspace",
    "create_agent",
    "host only",
    "never clone",
    "without serially waiting",
    "runs in parallel",
    "completion notifications",
    "Do not poll",
    '"notifyOnFinish": true',
    "Continue when an individual",
    "partial failure",
    "every selected project",
    "do not detach",
    "never fall back to Local",
  ]) {
    expect(prompt.toLowerCase()).toContain(instruction.toLowerCase());
  }
});
