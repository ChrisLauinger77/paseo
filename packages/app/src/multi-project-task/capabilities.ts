import type { PaseoToolAvailability } from "@getpaseo/protocol/messages";

const REQUIRED_TOOLS = ["list_projects", "create_workspace", "create_agent"];

export type TaskCapabilityIssue =
  | "checkingTools"
  | "unsupportedHost"
  | "toolsDisabled"
  | "unsupportedProvider"
  | "toolCheckFailed";

export function getTaskCapabilityIssue(
  availability: PaseoToolAvailability | undefined,
): TaskCapabilityIssue | null {
  // COMPAT(paseoToolAvailability): added in v0.11.0; remove absence gate after 2027-04-02 once daemon floor includes it.
  if (!availability) return "unsupportedHost";
  if (availability.status === "disabled") return "toolsDisabled";
  if (availability.status === "unsupported") return "unsupportedProvider";
  if (REQUIRED_TOOLS.some((tool) => availability.disabledTools.includes(tool))) {
    return "toolsDisabled";
  }
  return REQUIRED_TOOLS.every((tool) => availability.tools.includes(tool))
    ? null
    : "unsupportedHost";
}
