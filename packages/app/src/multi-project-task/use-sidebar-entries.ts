import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import { selectTaskSidebarEntries } from "./sidebar-model";

export function useTaskSidebarEntries(serverIds: readonly string[]) {
  // One collection subscription to shared maps; transcript updates do not scan agents.
  const agentMaps = useSessionStore(
    useShallow((state) => serverIds.map((serverId) => state.sessions[serverId]?.agents)),
  );
  return useMemo(
    () =>
      selectTaskSidebarEntries(
        serverIds.map((serverId, index) => ({
          serverId,
          agents: agentMaps[index],
        })),
      ),
    [agentMaps, serverIds],
  );
}
