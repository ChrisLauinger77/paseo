import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import type {
  CreateAgentRequestOptions,
  CreateWorkspaceRequestOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { buildOrchestrationPrompt } from "./prompt";

export type TaskProject = Pick<
  ProjectDescriptor,
  "projectId" | "projectDisplayName" | "projectCustomName" | "projectRootPath" | "projectKind"
>;
type TaskWorkspace = Pick<
  WorkspaceDescriptor,
  "id" | "projectId" | "workspaceDirectory" | "archivingAt"
>;
export type TaskAgentConfig = Pick<
  AgentSessionConfig,
  "provider" | "model" | "modeId" | "thinkingOptionId" | "featureValues"
>;
export type TaskTargets =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: readonly TaskProject[]; workspaces: readonly TaskWorkspace[] };

type Coordinator = Pick<AgentSnapshotPayload, "id" | "workspaceId">;
export interface TaskLaunchClient {
  createAgent(input: CreateAgentRequestOptions): Promise<Coordinator>;
  createWorkspace(
    input: CreateWorkspaceRequestOptions,
  ): Promise<{ agent?: Coordinator; error?: string | null }>;
}

export interface TaskFormState {
  targets: TaskTargets;
  prompt: string;
  selectedProjectIds: string[];
  selectedProjects: TaskProject[];
  hasMissingProjects: boolean;
  isolation: "local" | "worktree";
  canUseWorktree: boolean;
  agentConfig: TaskAgentConfig | null;
  workingDir: string;
  canSubmit: boolean;
  submission: "idle" | "pending" | "succeeded";
  error: string | null;
}

export function openMultiProjectTaskForm(targets: TaskTargets) {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: TaskFormState = {
    targets,
    prompt: "",
    selectedProjectIds: [],
    selectedProjects: [],
    hasMissingProjects: false,
    isolation: "local",
    canUseWorktree: false,
    agentConfig: null,
    workingDir: "",
    canSubmit: false,
    submission: "idle",
    error: null,
  };
  // Keep the creation identity on an unchanged retry, including a lost response.
  let attempt:
    | { fingerprint: string; id: string; request: CreateAgentRequestOptions; workspaceId?: string }
    | undefined;
  function resolveSelectedProjects(): TaskProject[] {
    if (state.targets.status !== "ready") return [];
    const byId = new Map(state.targets.projects.map((project) => [project.projectId, project]));
    return state.selectedProjectIds.flatMap((id) => byId.get(id) ?? []);
  }
  function coordinatorWorkspace() {
    if (state.targets.status !== "ready") return undefined;
    const workspaces = state.targets.workspaces;
    return resolveSelectedProjects().flatMap((project) =>
      workspaces.filter(
        (workspace) =>
          workspace.projectId === project.projectId &&
          !workspace.archivingAt &&
          workspace.workspaceDirectory,
      ),
    )[0];
  }
  function publish(patch: Partial<TaskFormState>) {
    if (closed) return;
    state = { ...state, ...patch };
    const selected = resolveSelectedProjects();
    const validSelection =
      selected.length > 0 && selected.length === state.selectedProjectIds.length;
    const canUseWorktree =
      validSelection && selected.every((project) => project.projectKind === "git");
    state = {
      ...state,
      canUseWorktree,
      isolation: state.targets.status === "ready" && !canUseWorktree ? "local" : state.isolation,
      hasMissingProjects:
        state.targets.status === "ready" && selected.length !== state.selectedProjectIds.length,
      workingDir:
        coordinatorWorkspace()?.workspaceDirectory ??
        selected[0]?.projectRootPath ??
        state.workingDir,
      canSubmit:
        state.submission === "idle" &&
        validSelection &&
        Boolean(state.prompt.trim() && state.agentConfig?.provider && state.agentConfig.model),
    };
    for (const listener of listeners) listener();
  }
  publish({});
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    applyTargets(next: TaskTargets) {
      publish({ targets: next });
    },
    applyAgentConfig(agentConfig: TaskAgentConfig | null) {
      publish({ agentConfig });
    },
    setPrompt(prompt: string) {
      if (state.submission === "idle") publish({ prompt, error: null });
    },
    toggleProject(projectId: string) {
      if (
        state.submission !== "idle" ||
        state.targets.status !== "ready" ||
        (!state.selectedProjectIds.includes(projectId) &&
          !state.targets.projects.some((project) => project.projectId === projectId))
      )
        return;
      const selectedProjects = state.selectedProjectIds.includes(projectId)
        ? state.selectedProjects.filter((project) => project.projectId !== projectId)
        : [
            ...state.selectedProjects,
            ...state.targets.projects.filter((project) => project.projectId === projectId),
          ];
      publish({
        selectedProjects,
        selectedProjectIds: state.selectedProjectIds.includes(projectId)
          ? state.selectedProjectIds.filter((id) => id !== projectId)
          : [...state.selectedProjectIds, projectId],
        error: null,
      });
    },
    setIsolation(isolation: TaskFormState["isolation"]) {
      if (state.submission === "idle") publish({ isolation, error: null });
    },
    async submit(client: TaskLaunchClient, createId: () => string) {
      if (closed || !state.canSubmit || !state.agentConfig) return null;
      const projects = resolveSelectedProjects();
      const workspace = coordinatorWorkspace();
      const initialPrompt = buildOrchestrationPrompt({
        task: state.prompt,
        projects,
        isolation: state.isolation,
        agent: state.agentConfig,
      });
      const request: CreateAgentRequestOptions = {
        config: { ...state.agentConfig, cwd: state.workingDir, title: "Multi-project task" },
        initialPrompt,
      };
      const fingerprint = JSON.stringify([initialPrompt, state.agentConfig]);
      if (attempt?.fingerprint !== fingerprint)
        attempt = { fingerprint, id: createId(), request, workspaceId: workspace?.id };
      const { id: idempotencyKey, request: originalRequest, workspaceId } = attempt;
      publish({ submission: "pending", error: null });
      try {
        // Agent + workspace creation is one existing operation when no context exists.
        const agent = workspaceId
          ? await client.createAgent({ ...originalRequest, workspaceId, idempotencyKey })
          : await client
              .createWorkspace({
                source: {
                  kind: "directory",
                  path: projects[0]!.projectRootPath,
                  projectId: projects[0]!.projectId,
                },
                agent: originalRequest,
                idempotencyKey,
              })
              .then((result) => {
                if (result.error || !result.agent)
                  throw new Error(result.error ?? "Coordinator creation returned no agent");
                return result.agent;
              });
        publish({ submission: "succeeded" });
        return closed ? null : agent;
      } catch (error) {
        publish({
          submission: "idle",
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
  };
}
export type MultiProjectTaskForm = ReturnType<typeof openMultiProjectTaskForm>;
