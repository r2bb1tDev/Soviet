use crate::crypto::KeyPair;
use keyring::Entry;
use serde::{Serialize, Deserialize};

const SERVICE: &str = "soviet";
const ACCOUNT: &str = "identity";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Identity {
    pub nickname: String,
    pub public_key: String, // Base58
}

/// Путь к файлу-резервной копии ключа (используется если keyring недоступен)
fn fallback_key_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = base.join("Soviet");
    std::fs::create_dir_all(&dir).ok();
    dir.join("key.dat")
}

/// Сохраняем приватный ключ — сначала keyring, при неудаче — файл
pub fn save_private_key(key_bytes: &[u8; 32]) -> anyhow::Result<()> {
    let encoded = bs58::encode(key_bytes).into_string();

    // Пробуем системное хранилище ОС
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        if entry.set_password(&encoded).is_ok() {
            // Дополнительно пишем резервный файл
            std::fs::write(fallback_key_path(), &encoded).ok();
            return Ok(());
        }
    }

    // Резервный путь — файл
    std::fs::write(fallback_key_path(), &encoded)
        .map_err(|e| anyhow::anyhow!("Cannot save key: {}", e))
}

/// Загрузить приватный ключ — сначала keyring, потом файл
pub fn load_private_key() -> anyhow::Result<Option<[u8; 32]>> {
    // Пробуем keyring
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        if let Ok(encoded) = entry.get_password() {
            if let Ok(bytes) = bs58::decode(&encoded).into_vec() {
                if let Ok(arr) = bytes.try_into() as Result<[u8; 32], _> {
                    return Ok(Some(arr));
                }
            }
        }
    }

    // Пробуем файл
    let path = fallback_key_path();
    if path.exists() {
        let encoded = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("Cannot read key file: {}", e))?;
        let encoded = encoded.trim();
        let bytes = bs58::decode(encoded)
            .into_vec()
            .map_err(|e| anyhow::anyhow!("Key decode error: {}", e))?;
        let arr: [u8; 32] = bytes.try_into()
            .map_err(|_| anyhow::anyhow!("Key length mismatch"))?;
        return Ok(Some(arr));
    }

    Ok(None)
}

/// Удалить ключ из хранилища (при сбросе)
pub fn delete_private_key() -> anyhow::Result<()> {
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        entry.delete_password().ok();
    }
    let path = fallback_key_path();
    if path.exists() {
        std::fs::remove_file(path).ok();
    }
    Ok(())
}

/// Создать новую идентичность: генерировать ключи, сохранить
pub fn create_identity(nickname: &str) -> anyhow::Result<(Identity, KeyPair)> {
    let keypair = KeyPair::generate();
    save_private_key(&keypair.private_key_bytes())?;
    let identity = Identity {
        nickname: nickname.to_string(),
        public_key: keypair.public_key_base58(),
    };
    Ok((identity, keypair))
}

/// Загрузить существующую идентичность
pub fn load_identity(nickname: &str) -> anyhow::Result<Option<(Identity, KeyPair)>> {
    match load_private_key()? {
        Some(bytes) => {
            let keypair = KeyPair::from_bytes(&bytes)?;
            let identity = Identity {
                nickname: nickname.to_string(),
                public_key: keypair.public_key_base58(),
            };
            Ok(Some((identity, keypair)))
        }
        None => Ok(None),
    }
}

/// Экспорт ключей (Base58 строка для резервной копии)
pub fn export_keys(keypair: &KeyPair) -> String {
    bs58::encode(keypair.private_key_bytes()).into_string()
}

/// Импорт ключей из Base58 строки
pub fn import_keys(encoded: &str) -> anyhow::Result<KeyPair> {
    let bytes = bs58::decode(encoded)
        .into_vec()
        .map_err(|e| anyhow::anyhow!("Import decode error: {}", e))?;
    let arr: [u8; 32] = bytes.try_into()
        .map_err(|_| anyhow::anyhow!("Key length mismatch"))?;
    let keypair = KeyPair::from_bytes(&arr)?;
    save_private_key(&arr)?;
    Ok(keypair)
}
