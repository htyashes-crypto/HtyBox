//! Host 身份 + 本机配置（L3）：Curve25519 密钥对 + 稳定 `serverId` + LAN 开关，
//! 持久化到 `config_dir()/HtyBox/`。公钥即配对信任锚（offer 携带）；私钥永不出本机。

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};

use htybox_link::e2e::{KeyPair, KEY_SIZE};

/// 进程内的 Host 身份（启动时 load_or_create，存入 AppState 与 ws_host 共享）。
pub struct HostIdentity {
    keypair: KeyPair,
    server_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedIdentity {
    secret_key_b64: String,
    server_id: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostConfig {
    #[serde(default)]
    lan_enabled: bool,
}

/// `config_dir()/HtyBox/`（best-effort 创建）。
fn config_dir() -> Option<PathBuf> {
    let dir = dirs::config_dir()?.join("HtyBox");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

impl HostIdentity {
    fn generate() -> Self {
        let keypair = KeyPair::generate();
        let pk = keypair.public_bytes();
        let server_id = format!("htybox-{}", URL_SAFE_NO_PAD.encode(&pk[..8]));
        Self { keypair, server_id }
    }

    /// 读已存身份；缺失/不可解析则新建并尽力持久化；无 config dir(极罕见)用内存身份。
    pub fn load_or_create() -> Self {
        let Some(dir) = config_dir() else {
            return Self::generate(); // 无 config dir：本会话内存身份(不持久化)
        };
        let path = dir.join("host-identity.json");
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<PersistedIdentity>(&text) {
                if let Ok(raw) = STANDARD.decode(p.secret_key_b64.trim()) {
                    if let Ok(sk) = <[u8; KEY_SIZE]>::try_from(raw.as_slice()) {
                        return Self { keypair: KeyPair::from_secret_bytes(sk), server_id: p.server_id };
                    }
                }
            }
        }
        let id = Self::generate();
        let persisted = PersistedIdentity {
            secret_key_b64: STANDARD.encode(id.keypair.secret_bytes()),
            server_id: id.server_id.clone(),
        };
        if let Ok(text) = serde_json::to_string_pretty(&persisted) {
            if std::fs::write(&path, text).is_ok() {
                tighten_perms(&path);
            }
        }
        id
    }

    pub fn keypair(&self) -> &KeyPair {
        &self.keypair
    }
    pub fn server_id(&self) -> &str {
        &self.server_id
    }
    pub fn public_b64(&self) -> String {
        self.keypair.public_b64()
    }
}

/// 读 LAN 开关（默认 false）。
pub fn load_lan_enabled() -> bool {
    let Some(dir) = config_dir() else { return false };
    std::fs::read_to_string(dir.join("host-config.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<HostConfig>(&t).ok())
        .map(|c| c.lan_enabled)
        .unwrap_or(false)
}

/// 写 LAN 开关。
pub fn save_lan_enabled(enabled: bool) -> Result<(), String> {
    let dir = config_dir().ok_or("no config dir")?;
    let text = serde_json::to_string_pretty(&HostConfig { lan_enabled: enabled }).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("host-config.json"), text).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn tighten_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn tighten_perms(_path: &Path) {
    // Windows：config_dir 位于用户 profile（%APPDATA%），默认仅本用户可访问；显式 ACL 留后续。
}
