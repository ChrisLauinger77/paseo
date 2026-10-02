import { useCallback, useState } from "react";
import { StyleSheet } from "react-native-unistyles";
import { Network } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { MultiProjectTaskSheet } from "./task-sheet";

export function MultiProjectTaskAction({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);
  const supported = useHostFeature(serverId, "workspaceMultiplicity");
  if (!supported) return null;
  return (
    <>
      <Button
        style={styles.action}
        variant="ghost"
        size="sm"
        leftIcon={Network}
        onPress={openSheet}
        testID="new-workspace-multi-project-task"
      >
        {t("multiProjectTask.title")}
      </Button>
      {open ? (
        <MultiProjectTaskSheet key={serverId} serverId={serverId} onClose={closeSheet} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({ action: { alignSelf: "flex-start" } });
