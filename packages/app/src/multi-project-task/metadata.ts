import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";

export const MULTI_PROJECT_TASK_LABEL = "paseo.multi-project-task";

export function isMultiProjectTask(agent: { labels: Record<string, string> }): boolean {
  return (
    agent.labels[MULTI_PROJECT_TASK_LABEL] === "true" &&
    getParentAgentIdFromLabels(agent.labels) === null
  );
}

export function deriveTaskTitle(prompt: string): string {
  // Match the daemon's provisional agent-title convention, using the user's task
  // rather than the first line of the orchestration envelope.
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim());
  return firstLine?.trim().replace(/\s+/g, " ").slice(0, 60).trim() || "Multi-project task";
}
