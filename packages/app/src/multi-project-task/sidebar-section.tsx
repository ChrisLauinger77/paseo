import { memo, useCallback, useMemo, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import equal from "fast-deep-equal";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  useWorkspaceLayoutStore,
  collectAllTabs,
  findPaneById,
} from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import { useHosts } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useTaskSidebarEntries } from "./use-sidebar-entries";
import type { TaskSidebarEntry } from "./sidebar-model";

export function MultiProjectTaskSidebarSection() {
  const { t } = useTranslation();
  const { serverIds } = useSidebarModel();
  const entries = useTaskSidebarEntries(serverIds);
  const hosts = useHosts();
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(entries);
  const selection = useActiveWorkspaceSelection();
  const workspaceKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const selectedAgentId = useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined;
    if (!layout) return null;
    const focusedId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
    const target = collectAllTabs(layout.root).find((tab) => tab.tabId === focusedId)?.target;
    return target?.kind === "agent" ? target.agentId : null;
  });
  if (entries.length === 0) return null;
  return (
    <View style={styles.section} testID="sidebar-multi-project-tasks">
      <SidebarSectionHeader
        title={t("multiProjectTask.sidebarTitle")}
        testID="sidebar-multi-project-tasks-header"
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      {collapsed ? null : (
        <>
          {visibleItems.map((entry) => (
            <TaskRow
              key={`${entry.serverId}:${entry.agentId}`}
              entry={entry}
              hostLabel={
                serverIds.length > 1
                  ? hosts.find((host) => host.serverId === entry.serverId)?.label
                  : undefined
              }
              selected={selection?.serverId === entry.serverId && selectedAgentId === entry.agentId}
            />
          ))}
          {canToggle ? (
            <SidebarGroupToggleRow
              expanded={expanded}
              onPress={toggleExpanded}
              testID="sidebar-multi-project-tasks-show-more"
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const TaskRow = memo(function TaskRow({
  entry,
  selected,
  hostLabel,
}: {
  entry: TaskSidebarEntry;
  selected: boolean;
  hostLabel?: string;
}) {
  const { t } = useTranslation();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const open = useCallback(() => {
    navigateToAgent({
      serverId: entry.serverId,
      workspaceId: entry.workspaceId,
      agentId: entry.agentId,
    });
    showMobileAgent();
  }, [entry.agentId, entry.serverId, entry.workspaceId, showMobileAgent]);
  const title = entry.title?.trim() || t("multiProjectTask.title");
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.row,
      hovered && styles.hovered,
      selected && styles.selected,
      pressed && styles.pressed,
    ],
    [selected],
  );
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={accessibilityState}
      aria-selected={selected}
      testID={`sidebar-multi-project-task-${entry.serverId}:${entry.agentId}`}
      onPress={open}
      highlightStyle={styles.pressed}
      style={rowStyle}
    >
      <View style={styles.status}>
        <AgentStatusDot
          status={entry.status}
          requiresAttention={entry.requiresAttention}
          attentionReason={entry.attentionReason}
          pendingPermissionCount={entry.pendingPermissionCount}
          showInactive
        />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t(entry.subagentCount === 1 ? "subagents.pillLabelOne" : "subagents.pillLabelMany", {
            count: entry.subagentCount,
          })}
          {hostLabel ? ` · ${hostLabel}` : ""}
        </Text>
      </View>
    </PressHighlight>
  );
}, equal);

const styles = StyleSheet.create((theme) => ({
  section: { paddingBottom: theme.spacing[3] },
  row: {
    minHeight: 36,
    marginBottom: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  selected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  pressed: { backgroundColor: theme.colors.surface2 },
  status: { width: theme.iconSize.md, height: 20, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minWidth: 0 },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 20,
  },
  subtitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
