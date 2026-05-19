use std::path::PathBuf;

pub const ASSETS_DIR_NAME: &str = "assets";
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const RUNTIME_FILE_NAME: &str = "runtime.json";

pub struct PetPaths {
    pub home: PathBuf,
}

impl PetPaths {
    pub fn current_user() -> Self {
        Self {
            home: pet_home_dir(),
        }
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.home.join(ASSETS_DIR_NAME)
    }

    pub fn config_file(&self) -> PathBuf {
        self.home.join(CONFIG_FILE_NAME)
    }

    pub fn runtime_file(&self) -> PathBuf {
        self.home.join(RUNTIME_FILE_NAME)
    }
}

fn pet_home_dir() -> PathBuf {
    // Linux 用 $HOME，与 Windows 端用 %USERPROFILE% 对应。
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".sema")
        .join("pet")
}
