import { useTranslation } from "react-i18next";
import { SidebarSectionHeader } from "./sidebar-section-header";

export function PinnedSectionHeader(props: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <SidebarSectionHeader
      {...props}
      title={t("sidebar.pinned.title")}
      testID="sidebar-pinned-section-header"
    />
  );
}
