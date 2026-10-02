import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import type {
  CreateAgentRequestOptions,
  CreateWorkspaceRequestOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import type {
  AgentSnapshotPayload,
  ListProviderFeaturesResponseMessage,
} from "@getpaseo/protocol/messages";
import { buildOrchestrationPrompt } from "./prompt";
import { deriveTaskTitle, MULTI_PROJECT_TASK_LABEL } from "./metadata";
import { getTaskCapabilityIssue, type TaskCapabilityIssue } from "./capabilities";

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
  listProviderFeatures(
    config: AgentSessionConfig,
  ): Promise<
    Pick<ListProviderFeaturesResponseMessage["payload"], "provider" | "paseoTools" | "error">
  >;
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
  capabilityIssue: TaskCapabilityIssue | null;
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
    capabilityIssue: "checkingTools",
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
        state.capabilityIssue === null &&
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
    applyAgentConfig(
      agentConfig: TaskAgentConfig | null,
      capabilityIssue: TaskCapabilityIssue | null,
    ) {
      publish({ agentConfig, capabilityIssue });
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
      const agentConfig = state.agentConfig;
      const launchTargets = state.targets;
      const workingDir = state.workingDir;
      publish({ submission: "pending", error: null });
      try {
        // Cached form data can outlive a policy change or a daemon reconnect.
        // Resolve against this provider again before either creation RPC.
        const features = await client.listProviderFeatures({ ...agentConfig, cwd: workingDir });
        if (features.error) throw new Error(features.error);
        if (closed) return null;
        const inputsChanged = state.agentConfig !== agentConfig || state.targets !== launchTargets;
        if (inputsChanged || state.capabilityIssue !== null) {
          publish({ submission: "idle" });
          return null;
        }
        const capabilityIssue = getTaskCapabilityIssue(features.paseoTools);
        if (capabilityIssue) {
          publish({ capabilityIssue, submission: "idle" });
          return null;
        }
        const projects = resolveSelectedProjects();
        const workspace = coordinatorWorkspace();
        const initialPrompt = buildOrchestrationPrompt({
          task: state.prompt,
          projects,
          isolation: state.isolation,
          agent: state.agentConfig,
        });
        const request: CreateAgentRequestOptions = {
          config: {
            ...state.agentConfig,
            cwd: state.workingDir,
            title: deriveTaskTitle(state.prompt),
          },
          labels: { [MULTI_PROJECT_TASK_LABEL]: "true" },
          initialPrompt,
        };
        const fingerprint = JSON.stringify([initialPrompt, state.agentConfig]);
        if (attempt?.fingerprint !== fingerprint)
          attempt = { fingerprint, id: createId(), request, workspaceId: workspace?.id };
        const { id: idempotencyKey, request: originalRequest, workspaceId } = attempt;
        // Agent + workspace creation is one existing operation when no context exists.
        const agent = workspaceId
          ? await client.createAgent({ ...originalRequest, workspaceId, idempotencyKey })
          : await client
              .createWorkspace({
                // This is a technical context, so keep the task's name on its agent.
                title: projects[0]!.projectCustomName || projects[0]!.projectDisplayName,
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
