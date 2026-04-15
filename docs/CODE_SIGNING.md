# 🔏 Code Signing — Настройка подписи Soviet

Подпись предотвращает срабатывание SmartScreen (Windows) и Gatekeeper (macOS) при установке.

---

## Windows

### Что нужно
Сертификат подписи кода (Code Signing Certificate):
- **OV (Organization Validation)** — дешевле (~$70/год), убирает «Unknown Publisher», но не убирает SmartScreen сразу (нужна репутация)
- **EV (Extended Validation)** — дороже (~$350/год), мгновенно убирает SmartScreen. **Рекомендуется.**

Где купить:
- [SSL.com](https://www.ssl.com/certificates/ev-code-signing/) — EV от $239/год
- [Certum](https://certum.eu/en/cert_offer/open-source-code-signing/) — **бесплатно для open source проектов** ✅
- [SignPath.io](https://signpath.io/products/open-source) — **бесплатно для open source** ✅

### Настройка GitHub Secrets
После получения сертификата (файл `.pfx`):

```bash
# Конвертировать PFX в base64
# Windows PowerShell:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("soviet_signing.pfx")) | clip

# Linux/macOS:
base64 -i soviet_signing.pfx | pbcopy
```

Добавь в **Settings → Secrets → Actions**:
| Secret | Значение |
|--------|---------|
| `WINDOWS_CERTIFICATE` | base64-строка PFX файла |
| `WINDOWS_CERTIFICATE_PASSWORD` | пароль от PFX |

### Локальная проверка
```powershell
# Подписать вручную (после установки сертификата):
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "Soviet_2.4.0_x64-setup.exe"

# Проверить подпись:
signtool verify /pa "Soviet_2.4.0_x64-setup.exe"
```

---

## macOS

### Что нужно
1. Apple Developer Program ([$99/год](https://developer.apple.com/programs/))
2. После регистрации — создать сертификат **Developer ID Application** в Xcode или [certificates.apple.com](https://developer.apple.com/account/resources/certificates)

### Настройка GitHub Secrets

```bash
# Экспортировать сертификат из Keychain как .p12:
# Keychain Access → Certificates → Developer ID Application → Export

# Конвертировать в base64:
base64 -i DeveloperID.p12 | pbcopy
```

Добавь в **Settings → Secrets → Actions**:
| Secret | Значение |
|--------|---------|
| `APPLE_CERTIFICATE` | base64 .p12 файла |
| `APPLE_CERTIFICATE_PASSWORD` | пароль от .p12 |
| `APPLE_KEYCHAIN_PASSWORD` | произвольный пароль для временного keychain |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Имя (TEAM_ID)` |
| `APPLE_ID` | твой Apple ID email |
| `APPLE_PASSWORD` | app-specific password ([appleid.apple.com](https://appleid.apple.com/account/manage)) |
| `APPLE_TEAM_ID` | 10-значный Team ID из [developer.apple.com](https://developer.apple.com/account) |

### Нотаризация
После добавления секретов CI автоматически:
1. Подпишет `.app` сертификатом Developer ID
2. Отправит на нотаризацию в Apple
3. Прикрепит ticket к `.dmg`

---

## Обновления (Tauri Updater)

Уже настроено. Updater подписывает `latest.json` через:
- `TAURI_SIGNING_PRIVATE_KEY` (ed25519 приватный ключ)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Сгенерировать пару ключей если нужно пересоздать:
```bash
npm run tauri signer generate -- -w soviet_updater.key
```

---

## Проверка результата

После первого успешного релиза с подписью:
- **Windows**: запусти `.exe` — не должно быть предупреждения SmartScreen (или будет только один раз пока набирается репутация)
- **macOS**: запусти `.dmg` — Gatekeeper пропустит без предупреждений
- **VirusTotal**: загрузи `.exe` — подписанный бинарь имеет значительно меньше ложных срабатываний
