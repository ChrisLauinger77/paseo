import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Check, Square } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { randomUUID } from "expo-crypto";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField, SelectFieldTrigger } from "@/components/ui/select-field";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useTaskForm } from "./use-task-form";
import type { MultiProjectTaskForm, TaskFormState, TaskProject } from "./form-model";

const SNAP_POINTS = ["85%", "94%"];

export function MultiProjectTaskSheet({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [visible, setVisible] = useState(true);
  const { model, state, selection, profiles } = useTaskForm(serverId);
  const pending = state.submission === "pending";
  const close = useCallback(() => {
    if (!pending) setVisible(false);
  }, [pending]);
  const submit = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    const agent = await model.submit(client, randomUUID);
    if (agent) {
      onClose();
      navigateToAgent({ serverId, workspaceId: agent.workspaceId, agentId: agent.id });
    }
  }, [model, onClose, serverId]);
  const submitPress = useCallback(() => {
    void submit();
  }, [submit]);
  const header = useMemo(() => ({ title: t("multiProjectTask.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {state.error ? (
          <Text style={styles.error} accessibilityRole="alert" testID="multi-project-task-error">
            {state.error}
          </Text>
        ) : null}
        <View style={styles.footerActions}>
          <Button size={size} onPress={close} disabled={pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            size={size}
            variant="default"
            onPress={submitPress}
            disabled={!state.canSubmit}
            loading={pending}
            testID="multi-project-task-start"
          >
            {t("multiProjectTask.start")}
          </Button>
        </View>
      </View>
    ),
    [close, pending, size, state.canSubmit, state.error, submitPress, t],
  );
  const isolationOptions = useMemo(
    () => [
      {
        value: "local" as const,
        label: t("multiProjectTask.local"),
        disabled: pending,
        testID: "multi-project-task-local",
      },
      {
        value: "worktree" as const,
        label: t("multiProjectTask.worktree"),
        disabled: pending,
        testID: "multi-project-task-worktree",
      },
    ],
    [pending, t],
  );

  return (
    <AdaptiveModalSheet
      snapPoints={SNAP_POINTS}
      visible={visible}
      onClose={close}
      onDismiss={onClose}
      header={header}
      footer={footer}
      testID="multi-project-task-sheet"
    >
      <Field label={t("multiProjectTask.prompt")}>
        <FormTextInput
          size={size}
          initialValue={state.prompt}
          onChangeText={model.setPrompt}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!pending}
          style={styles.prompt}
          accessibilityLabel={t("multiProjectTask.prompt")}
          testID="multi-project-task-prompt"
        />
      </Field>
      <Field
        label={t("multiProjectTask.projects")}
        error={
          state.targets.status === "ready" && state.selectedProjectIds.length === 0
            ? t("multiProjectTask.selectProject")
            : undefined
        }
      >
        <ProjectChoices model={model} state={state} size={size} />
      </Field>
      {state.canUseWorktree ? (
        <Field label={t("multiProjectTask.isolation")}>
          <SegmentedControl
            size={size}
            value={state.isolation}
            onValueChange={model.setIsolation}
            options={isolationOptions}
          />
        </Field>
      ) : null}
      {state.workingDir ? (
        <AgentFields
          serverId={serverId}
          selection={selection}
          profiles={profiles}
          size={size}
          disabled={pending}
        />
      ) : null}
      {state.hasMissingProjects ? (
        <Text style={styles.error}>{t("multiProjectTask.missingProjects")}</Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function ProjectChoices({
  model,
  state,
  size,
}: {
  model: MultiProjectTaskForm;
  state: TaskFormState;
  size: FieldControlSize;
}) {
  const { t } = useTranslation();
  if (state.targets.status === "loading")
    return <Text style={styles.muted}>{t("multiProjectTask.loading")}</Text>;
  if (state.targets.status === "error")
    return <Text style={styles.error}>{state.targets.message}</Text>;
  if (!state.targets.projects.length && !state.selectedProjects.length)
    return <Text style={styles.muted}>{t("multiProjectTask.empty")}</Text>;
  const projects = state.targets.projects;
  return (
    <>
      {[
        ...projects,
        ...state.selectedProjects.filter(
          (selected) => !projects.some((project) => project.projectId === selected.projectId),
        ),
      ].map((project) => (
        <ProjectChoice
          key={project.projectId}
          project={project}
          selected={state.selectedProjectIds.includes(project.projectId)}
          toggle={model.toggleProject}
          disabled={state.submission === "pending"}
          size={size}
        />
      ))}
    </>
  );
}

function ProjectChoice({
  project,
  selected,
  toggle,
  disabled,
  size,
}: {
  project: TaskProject;
  selected: boolean;
  toggle: (id: string) => void;
  disabled: boolean;
  size: FieldControlSize;
}) {
  const onPress = useCallback(() => toggle(project.projectId), [toggle, project.projectId]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Button
      size={size}
      variant="ghost"
      leftIcon={selected ? Check : Square}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      aria-checked={selected}
      accessibilityLabel={`${project.projectCustomName || project.projectDisplayName} (${project.projectRootPath})`}
      testID={`multi-project-task-project-${project.projectId}`}
      style={styles.project}
    >
      {project.projectCustomName || project.projectDisplayName}
    </Button>
  );
}

function AgentFields({
  serverId,
  selection,
  profiles,
  size,
  disabled,
}: Pick<ReturnType<typeof useTaskForm>, "selection" | "profiles"> & {
  serverId: string;
  size: FieldControlSize;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const selectedMode =
    selection.modeOptions.find((option) => option.id === selection.selectedMode) ??
    selection.modeOptions[0];
  const selectedThinking = selection.availableThinkingOptions.find(
    (option) => option.id === selection.selectedThinkingOptionId,
  );
  const modeDisplay = useMemo(
    () => (selectedMode ? { label: selectedMode.label } : null),
    [selectedMode],
  );
  const thinkingDisplay = useMemo(
    () => (selectedThinking ? { label: formatThinkingOptionLabel(selectedThinking) } : null),
    [selectedThinking],
  );
  const modeOptions = useMemo(
    () =>
      selection.modeOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
      })),
    [selection.modeOptions],
  );
  const thinkingOptions = useMemo(
    () =>
      selection.availableThinkingOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: formatThinkingOptionLabel(option),
      })),
    [selection.availableThinkingOptions],
  );
  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
      disabled: triggerDisabled,
      hovered,
      pressed,
      isOpen,
    }: {
      selectedModelLabel: string;
      disabled: boolean;
      hovered: boolean;
      pressed: boolean;
      isOpen: boolean;
    }) => (
      <SelectFieldTrigger
        label={selectedModelLabel}
        isPlaceholder={!selection.selectedModel}
        placeholder={t("multiProjectTask.model")}
        size={size}
        disabled={triggerDisabled}
        active={hovered || pressed || isOpen}
      />
    ),
    [selection.selectedModel, size, t],
  );
  return (
    <>
      <Field label={t("multiProjectTask.model")} error={selection.modelError}>
        <CombinedModelSelector
          serverId={serverId}
          providers={selection.modelSelectorProviders}
          selectedProvider={selection.selectedProvider ?? ""}
          selectedModel={selection.selectedModel}
          onSelect={selection.setProviderAndModelFromUser}
          isLoading={selection.isAllModelsLoading}
          disabled={disabled}
          profiles={profiles}
          onApplyProfile={profiles?.applyProfile}
          onOpen={selection.refetchProviderModelsIfStale}
          onRetryProvider={selection.refreshProviderModels}
          isRetryingProvider={selection.isProviderModelsRefreshing}
          triggerFill
          renderTrigger={renderModelTrigger}
        />
      </Field>
      {modeOptions.length > 1 ? (
        <SelectField
          label={t("multiProjectTask.mode")}
          placeholder={t("multiProjectTask.mode")}
          emptyText=""
          size={size}
          value={selectedMode?.id ?? null}
          selectedDisplay={modeDisplay}
          options={modeOptions}
          onChange={selection.setModeFromUser}
          disabled={disabled}
          searchable={false}
        />
      ) : null}
      {thinkingOptions.length > 1 ? (
        <SelectField
          label={t("multiProjectTask.thinking")}
          placeholder={t("multiProjectTask.thinking")}
          emptyText=""
          size={size}
          value={selectedThinking?.id ?? null}
          selectedDisplay={thinkingDisplay}
          options={thinkingOptions}
          onChange={selection.setThinkingOptionFromUser}
          disabled={disabled}
          searchable={false}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: { flex: 1, gap: theme.spacing[2] },
  footerActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  prompt: { minHeight: 100 },
  project: { justifyContent: "flex-start" },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
}));
