fn main() {
    // In release builds, request admin elevation at startup (single UAC prompt).
    // In debug/dev builds, skip this so `cargo run` works normally.
    #[cfg(target_os = "windows")]
    {
        let mut windows = tauri_build::WindowsAttributes::new();
        if !cfg!(debug_assertions) {
            windows = windows.app_manifest(r#"
                <assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
                    <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
                        <security>
                            <requestedPrivileges>
                                <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
                            </requestedPrivileges>
                        </security>
                    </trustInfo>
                </assembly>
            "#);
        }
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run tauri-build");
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_build::build();
    }
}
