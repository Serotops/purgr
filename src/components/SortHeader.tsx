import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { SortField, SortDirection } from "@/types";

interface SortHeaderProps {
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
}

export function SortHeader({ sortField, sortDirection, onSort }: SortHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-5 py-1.5 text-[11px] text-muted-foreground/60 border-b bg-muted/20">
      <div className="w-9" />
      <SortButton field="name" current={sortField} direction={sortDirection} onClick={onSort} className="flex-1">
        {t("sort.name")}
      </SortButton>
      <SortButton field="publisher" current={sortField} direction={sortDirection} onClick={onSort} className="hidden sm:flex w-24 justify-end">
        {t("sort.version")}
      </SortButton>
      <SortButton field="size" current={sortField} direction={sortDirection} onClick={onSort} className="hidden md:flex w-20 justify-end">
        {t("sort.size")}
      </SortButton>
      <div className="w-7" />
      <div className="w-4" />
    </div>
  );
}

function SortButton({
  field, current, direction, onClick, children, className = "",
}: {
  field: SortField; current: SortField; direction: SortDirection;
  onClick: (field: SortField) => void; children: React.ReactNode; className?: string;
}) {
  const isActive = current === field;
  return (
    <button
      onClick={() => onClick(field)}
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors duration-200 ${
        isActive ? "text-foreground/80 font-medium" : ""
      } ${className}`}
    >
      {children}
      {isActive ? (
        direction === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-30" />
      )}
    </button>
  );
}
