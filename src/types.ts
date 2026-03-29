export interface InstalledApp {
  name: string;
  version: string;
  publisher: string;
  install_location: string;
  install_date: string;
  estimated_size_kb: number;
  uninstall_string: string;
  quiet_uninstall_string: string;
  registry_key: string;
  is_orphan: boolean;
  icon_path: string;
}

export type FilterStatus = "all" | "installed" | "orphan";
export type SortField = "name" | "publisher" | "size" | "status";
export type SortDirection = "asc" | "desc";

export interface DriveInfo {
  letter: string;
  label: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
}

export interface DirEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  children: DirEntry[];
  file_count: number;
  dir_count: number;
}
