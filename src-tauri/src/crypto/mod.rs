use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use x25519_dalek::{StaticSecret, PublicKey as X25519PublicKey, EphemeralSecret};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce, aead::{Aead, AeadCore, KeyInit, OsRng}};
use hkdf::Hkdf;
use sha2::Sha256;
use rand::rngs::OsRng as RandOsRng;
use serde::{Serialize, Deserialize};

/// Пара ключей пользователя (Ed25519 для подписи + X25519 для шифрования)
#[derive(Clone)]
pub struct KeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub x25519_secret: StaticSecret,
}

impl KeyPair {
    /// Генерация новой пары ключей
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut RandOsRng);
        let verifying_key = signing_key.verifying_key();
        // Конвертируем Ed25519 private key bytes → X25519 secret
        let x25519_secret = StaticSecret::from(signing_key.to_bytes());
        Self { signing_key, verifying_key, x25519_secret }
    }

    /// Восстановление из байт приватного ключа
    pub fn from_bytes(bytes: &[u8; 32]) -> anyhow::Result<Self> {
        let signing_key = SigningKey::from_bytes(bytes);
        let verifying_key = signing_key.verifying_key();
        let x25519_secret = StaticSecret::from(*bytes);
        Ok(Self { signing_key, verifying_key, x25519_secret })
    }

    /// Публичный ключ в Base58 (это «номер» пользователя)
    pub fn public_key_base58(&self) -> String {
        bs58::encode(self.verifying_key.to_bytes()).into_string()
    }

    /// Приватный ключ в байтах (для хранения в системном keystore)
    pub fn private_key_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }
}

/// Зашифрованный пакет сообщения
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedMessage {
    pub version: u8,
    pub sender_pk: String,      // Base58
    pub ephemeral_pk: String,   // Base58 (X25519 ephemeral public key)
    pub nonce: String,          // Base64
    pub ciphertext: String,     // Base64
    pub signature: String,      // Base64 (Ed25519)
    pub timestamp: i64,
}

/// Шифрование сообщения для получателя
/// Схема: ECDH(X25519) → HKDF-SHA256 → ChaCha20-Poly1305 + Ed25519 подпись
pub fn encrypt_message(
    sender: &KeyPair,
    recipient_pk_base58: &str,
    plaintext: &[u8],
) -> anyhow::Result<EncryptedMessage> {
    // 1. Декодируем публичный ключ получателя
    let recipient_pk_bytes: [u8; 32] = bs58::decode(recipient_pk_base58)
        .into_vec()
        .map_err(|e| anyhow::anyhow!("Invalid recipient key: {}", e))?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Key length mismatch"))?;
    let recipient_x25519_pk = X25519PublicKey::from(recipient_pk_bytes);

    // 2. Генерируем эфемерную пару X25519
    let ephemeral_secret = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_pk = X25519PublicKey::from(&ephemeral_secret);

    // 3. ECDH: shared_secret
    let shared_secret = ephemeral_secret.diffie_hellman(&recipient_x25519_pk);

    // 4. HKDF для вывода ключа шифрования
    let sender_pk_bytes = sender.verifying_key.to_bytes();
    let salt = [sender_pk_bytes.as_slice(), recipient_pk_bytes.as_slice()].concat();
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared_secret.as_bytes());
    let mut encryption_key = [0u8; 32];
    hk.expand(b"soviet-messenger-v1", &mut encryption_key)
        .map_err(|e| anyhow::anyhow!("HKDF expand error: {:?}", e))?;

    // 5. ChaCha20-Poly1305 шифрование
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&encryption_key));
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("Encrypt error: {:?}", e))?;

    // 6. Ed25519 подпись: подписываем ephemeral_pk || nonce || ciphertext
    let mut to_sign = Vec::new();
    to_sign.extend_from_slice(ephemeral_pk.as_bytes());
    to_sign.extend_from_slice(nonce.as_slice());
    to_sign.extend_from_slice(&ciphertext);
    let signature = sender.signing_key.sign(&to_sign);

    let timestamp = chrono::Utc::now().timestamp();

    Ok(EncryptedMessage {
        version: 1,
        sender_pk: sender.public_key_base58(),
        ephemeral_pk: bs58::encode(ephemeral_pk.as_bytes()).into_string(),
        nonce: base64_encode(nonce.as_slice()),
        ciphertext: base64_encode(&ciphertext),
        signature: base64_encode(&signature.to_bytes()),
        timestamp,
    })
}

/// Расшифровка сообщения
pub fn decrypt_message(
    recipient: &KeyPair,
    msg: &EncryptedMessage,
) -> anyhow::Result<Vec<u8>> {
    // 1. Декодируем все поля
    let sender_pk_bytes: [u8; 32] = bs58::decode(&msg.sender_pk)
        .into_vec()?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Bad sender key length"))?;
    let sender_verifying_key = VerifyingKey::from_bytes(&sender_pk_bytes)
        .map_err(|e| anyhow::anyhow!("Bad sender key: {}", e))?;

    let ephemeral_pk_bytes: [u8; 32] = bs58::decode(&msg.ephemeral_pk)
        .into_vec()?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Bad ephemeral key length"))?;
    let ephemeral_pk = X25519PublicKey::from(ephemeral_pk_bytes);

    let nonce_bytes = base64_decode(&msg.nonce)?;
    let ciphertext_bytes = base64_decode(&msg.ciphertext)?;
    let sig_bytes = base64_decode(&msg.signature)?;

    // 2. Верификация подписи
    let mut to_verify = Vec::new();
    to_verify.extend_from_slice(ephemeral_pk.as_bytes());
    to_verify.extend_from_slice(&nonce_bytes);
    to_verify.extend_from_slice(&ciphertext_bytes);

    let sig_array: [u8; 64] = sig_bytes.try_into()
        .map_err(|_| anyhow::anyhow!("Bad signature length"))?;
    let signature = Signature::from_bytes(&sig_array);
    sender_verifying_key.verify(&to_verify, &signature)
        .map_err(|_| anyhow::anyhow!("Signature verification failed"))?;

    // 3. ECDH
    let shared_secret = recipient.x25519_secret.diffie_hellman(&ephemeral_pk);

    // 4. HKDF
    let recipient_pk_bytes = recipient.verifying_key.to_bytes();
    let salt = [sender_pk_bytes.as_slice(), recipient_pk_bytes.as_slice()].concat();
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared_secret.as_bytes());
    let mut encryption_key = [0u8; 32];
    hk.expand(b"soviet-messenger-v1", &mut encryption_key)
        .map_err(|e| anyhow::anyhow!("HKDF error: {:?}", e))?;

    // 5. Расшифровка
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&encryption_key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext_bytes.as_slice())
        .map_err(|_| anyhow::anyhow!("Decryption failed — wrong key or tampered message"))?;

    Ok(plaintext)
}

/// Safety Number для верификации контакта (12 групп по 5 цифр)
pub fn safety_number(pk_a: &str, pk_b: &str) -> String {
    use sha2::Digest;
    let mut keys = vec![pk_a, pk_b];
    keys.sort();
    let combined = keys.join("");
    let hash = sha2::Sha256::digest(combined.as_bytes());
    // Берём первые 30 байт → 12 групп по 5 цифр
    let digits: String = hash.iter()
        .take(30)
        .map(|b| format!("{:03}", b % 100))
        .collect::<Vec<_>>()
        .chunks(3)
        .map(|c| c.join(""))
        .collect::<Vec<_>>()
        .chunks(5)
        .map(|c| c.join(" "))
        .collect::<Vec<_>>()
        .join("  ");
    digits
}

fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    // Простая base64 без внешних зависимостей
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        let _ = write!(result, "{}", CHARS[(b0 >> 2)] as char);
        let _ = write!(result, "{}", CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            let _ = write!(result, "{}", CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
        } else { result.push('='); }
        if chunk.len() > 2 {
            let _ = write!(result, "{}", CHARS[b2 & 0x3f] as char);
        } else { result.push('='); }
    }
    result
}

fn base64_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    const VALS: [i8; 128] = {
        let mut v = [-1i8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0usize;
        while i < chars.len() { v[chars[i] as usize] = i as i8; i += 1; }
        v
    };
    let s = s.trim_end_matches('=');
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    for chunk in bytes.chunks(4) {
        let get = |i: usize| -> anyhow::Result<u8> {
            if i >= chunk.len() { return Ok(0); }
            let c = chunk[i];
            if c >= 128 { return Err(anyhow::anyhow!("Invalid base64 char")); }
            let v = VALS[c as usize];
            if v < 0 { return Err(anyhow::anyhow!("Invalid base64 char")); }
            Ok(v as u8)
        };
        let b0 = get(0)?; let b1 = get(1)?; let b2 = get(2)?; let b3 = get(3)?;
        result.push((b0 << 2) | (b1 >> 4));
        if chunk.len() > 2 { result.push((b1 << 4) | (b2 >> 2)); }
        if chunk.len() > 3 { result.push((b2 << 6) | b3); }
    }
    Ok(result)
}
