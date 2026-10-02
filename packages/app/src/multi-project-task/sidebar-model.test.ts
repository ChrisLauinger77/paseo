import { describe, expect, it } from "vitest";
import { selectTaskSidebarEntries, type TaskSidebarAgent } from "./sidebar-model";

function agent(id: string, overrides: Partial<TaskSidebarAgent> = {}): TaskSidebarAgent {
  return {
    id,
    workspaceId: "technical-context",
    title: "Inspect GNOME Shell extensions",
    labels: { "paseo.multi-project-task": "true" },
    parentAgentId: null,
    status: "idle",
    pendingPermissions: [],
    createdAt: new Date("2026-10-02T12:00:00Z"),
    ...overrides,
  };
}

describe("multi-project sidebar entries", () => {
  it("selects only explicitly marked root coordinators and counts their active managed children", () => {
    const agents = [
      agent("task"),
      agent("ordinary", { labels: {} }),
      agent("disabled", { labels: { "paseo.multi-project-task": "false" } }),
      agent("worker", {
        workspaceId: "other-project",
        parentAgentId: "task",
        labels: { "paseo.parent-agent-id": "task" },
      }),
      agent("marked-worker", {
        parentAgentId: "task",
        labels: { "paseo.multi-project-task": "true", "paseo.parent-agent-id": "task" },
      }),
      agent("archived-worker", { parentAgentId: "task", archivedAt: new Date() }),
      agent("archived-task", { archivedAt: new Date() }),
    ];
    const entries = selectTaskSidebarEntries([
      { serverId: "host", agents: new Map(agents.map((a) => [a.id, a])) },
    ]);
    expect(entries.map(({ agentId, subagentCount }) => ({ agentId, subagentCount }))).toEqual([
      { agentId: "task", subagentCount: 2 },
    ]);
    expect(entries[0]).toMatchObject({
      serverId: "host",
      workspaceId: "technical-context",
      title: "Inspect GNOME Shell extensions",
    });
    // Projection never moves workers or changes their parent relationship.
    expect(agents[3]).toMatchObject({ workspaceId: "other-project", parentAgentId: "task" });
  });

  it("keeps multiple tasks including closed coordinators, scoped to their own host", () => {
    const entries = selectTaskSidebarEntries([
      {
        serverId: "one",
        agents: new Map([
          ["first", agent("first", { status: "closed" })],
          ["second", agent("second", { createdAt: new Date("2026-10-02T13:00:00Z") })],
        ]),
      },
      {
        serverId: "two",
        agents: new Map([
          ["first", agent("first", { title: null })],
          ["child", agent("child", { labels: {}, parentAgentId: "first" })],
        ]),
      },
    ]);
    expect(
      entries.map(({ serverId, agentId, subagentCount, status, title }) => ({
        serverId,
        agentId,
        subagentCount,
        status,
        title,
      })),
    ).toEqual([
      {
        serverId: "one",
        agentId: "second",
        subagentCount: 0,
        status: "idle",
        title: "Inspect GNOME Shell extensions",
      },
      {
        serverId: "one",
        agentId: "first",
        subagentCount: 0,
        status: "closed",
        title: "Inspect GNOME Shell extensions",
      },
      { serverId: "two", agentId: "first", subagentCount: 1, status: "idle", title: null },
    ]);
  });
});
