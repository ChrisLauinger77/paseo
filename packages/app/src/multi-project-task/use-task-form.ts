import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type MaterializedAgentProfile,
} from "@/agent-profiles";
import { useAgentFormState } from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import { getHostRuntimeStore, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { resolveEffectiveModel } from "@/provider-selection/resolve-agent-form";
import { openMultiProjectTaskForm, type TaskTargets } from "./form-model";
import { getTaskCapabilityIssue, type TaskCapabilityIssue } from "./capabilities";

export function useTaskForm(serverId: string) {
  const runtime = useHostRuntimeSnapshot(serverId);
  const projects = useSessionStore((store) => store.sessions[serverId]?.projects);
  const workspaces = useSessionStore((store) => store.sessions[serverId]?.workspaces);
  const targets = useMemo<TaskTargets>(() => {
    if (runtime?.connectionStatus !== "online") return { status: "loading" };
    if (runtime.agentDirectoryError)
      return { status: "error", message: runtime.agentDirectoryError };
    if (!runtime.hasEverLoadedAgentDirectory) return { status: "loading" };
    return {
      status: "ready",
      projects: Array.from(projects?.values() ?? []),
      workspaces: Array.from(workspaces?.values() ?? []),
    };
  }, [
    projects,
    workspaces,
    runtime?.connectionStatus,
    runtime?.agentDirectoryError,
    runtime?.hasEverLoadedAgentDirectory,
  ]);
  const [model] = useState(() => openMultiProjectTaskForm(targets));
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const selection = useAgentFormState({ serverId, workingDir: state.workingDir });
  const effectiveModel = resolveEffectiveModel(selection.availableModels, selection.selectedModel);
  const modelId = effectiveModel?.id ?? selection.selectedModel;
  const modeId =
    selection.modeOptions.find((mode) => mode.id === selection.selectedMode)?.id ??
    selection.modeOptions[0]?.id;
  const thinkingOptionId = effectiveModel?.thinkingOptions?.find(
    (option) => option.id === selection.selectedThinkingOptionId,
  )?.id;
  const features = useDraftAgentFeatures({
    refreshOnMount: true,
    serverId,
    provider: selection.selectedProvider,
    cwd: state.workingDir,
    modelId,
    modeId,
    thinkingOptionId,
  });
  const { applyProfileFromUser } = selection;
  const { applyProfileFeatureValues } = features;
  const applyProfile = useCallback(
    (profile: MaterializedAgentProfile) => {
      applyProfileFromUser(profile);
      applyProfileFeatureValues(profile.featureValues);
    },
    [applyProfileFromUser, applyProfileFeatureValues],
  );
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({ kind: "draft", controls: { applyProfile } }),
    [applyProfile],
  );
  const availableProviders = useMemo(
    () => selection.modelSelectorProviders.map((provider) => provider.id),
    [selection.modelSelectorProviders],
  );
  const profiles = useAgentProfilePicker({ serverId, availableProviders, target: profileTarget });
  const selectedEntry = selection.allProviderEntries?.find(
    (entry) => entry.provider === selection.selectedProvider,
  );
  const config = useMemo(
    () =>
      selectedEntry?.status === "ready" &&
      selection.selectedProvider &&
      modelId &&
      !features.isLoading
        ? {
            provider: selection.selectedProvider,
            model: modelId,
            modeId,
            thinkingOptionId,
            featureValues: features.featureValues,
          }
        : null,
    [
      selectedEntry?.status,
      selection.selectedProvider,
      modelId,
      modeId,
      thinkingOptionId,
      features.featureValues,
      features.isLoading,
    ],
  );

  let capabilityIssue: TaskCapabilityIssue | null = "checkingTools";
  if (features.error) capabilityIssue = "toolCheckFailed";
  else if (config) capabilityIssue = getTaskCapabilityIssue(features.paseoTools);

  useEffect(() => getHostRuntimeStore().acquireDirectoryDemand(serverId), [serverId]);
  useEffect(() => () => model.close(), [model]);
  useEffect(() => model.applyTargets(targets), [model, targets]);
  useEffect(
    () => model.applyAgentConfig(config, capabilityIssue),
    [model, config, capabilityIssue],
  );
  return { model, state, selection, profiles };
}
