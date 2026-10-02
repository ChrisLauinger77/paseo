import type { Agent } from "@/stores/session-store";
import { isMultiProjectTask } from "./metadata";

export type TaskSidebarAgent = Pick<
  Agent,
  | "id"
  | "workspaceId"
  | "title"
  | "labels"
  | "parentAgentId"
  | "archivedAt"
  | "status"
  | "requiresAttention"
  | "attentionReason"
  | "pendingPermissions"
  | "createdAt"
>;

export interface TaskSidebarSession {
  serverId: string;
  agents: ReadonlyMap<string, TaskSidebarAgent> | undefined;
}

export interface TaskSidebarEntry {
  serverId: string;
  agentId: string;
  workspaceId: string | undefined;
  title: string | null;
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  attentionReason: Agent["attentionReason"];
  pendingPermissionCount: number;
  subagentCount: number;
  createdAt: Date;
}

// This is a sidebar projection of agent records, never another source of task state.
export function selectTaskSidebarEntries(
  sessions: readonly TaskSidebarSession[],
): TaskSidebarEntry[] {
  const entries: TaskSidebarEntry[] = [];
  for (const { serverId, agents } of sessions) {
    if (!agents) continue;
    const childCounts = new Map<string, number>();
    for (const agent of agents.values()) {
      if (agent.archivedAt || !agent.parentAgentId) continue;
      childCounts.set(agent.parentAgentId, (childCounts.get(agent.parentAgentId) ?? 0) + 1);
    }
    for (const agent of agents.values()) {
      if (agent.archivedAt || !isMultiProjectTask(agent)) continue;
      entries.push({
        serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        title: agent.title,
        status: agent.status,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
        pendingPermissionCount: agent.pendingPermissions.length,
        subagentCount: childCounts.get(agent.id) ?? 0,
        createdAt: agent.createdAt,
      });
    }
  }
  return entries.sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.serverId.localeCompare(b.serverId) ||
      a.agentId.localeCompare(b.agentId),
  );
}
