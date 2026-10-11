# Lampa Desktop

Неофициальный настольный клиент Lampa на Electron с поддержкой AC3/EAC3 и встроенных текстовых субтитров MKV.

## Скачать последнюю стабильную версию для Windows

[![Windows — установщик](https://img.shields.io/badge/Windows-Установщик%20EXE-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.21/lampa-x64-1.6.0-ac3.21.exe)
[![Windows — Portable EXE](https://img.shields.io/badge/Windows-Portable%20EXE-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.21/lampa-portable-x64-1.6.0-ac3.21.exe)
[![Windows — Portable ZIP](https://img.shields.io/badge/Windows-Portable%20ZIP-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.21/lampa-portable-zip-x64-1.6.0-ac3.21.zip)

**Версия 1.6.0-ac3.21 — Windows x64.** Обычный установщик поддерживает автообновление. Portable EXE и Portable ZIP не требуют установки и создают профиль `LampaData` рядом с программой. Сохраняйте эту папку при обновлении.

В этой версии обновлена проверка доступности адресов Lampa: одна попытка подключения, понятное сообщение об ошибке, ручное исправление URL и проверка настоящего интерфейса вместо принятия произвольной HTML-страницы за рабочий сайт.

[Все выпуски и контрольные суммы](https://github.com/ARST113/lampa-desktop/releases/latest)

### Ранее опубликованные Linux и macOS сборки

Ранее опубликованные пакеты остаются доступны в [архиве релизов](https://github.com/ARST113/lampa-desktop/releases/tag/v1.6.0-ac3.7). Они относятся к предыдущему выпуску, а не к текущей Windows-версии. В этом выпуске новые сборки Linux и macOS не создавались.

[![GitHub All Releases](https://img.shields.io/github/downloads/ARST113/lampa-desktop/total)](https://github.com/ARST113/lampa-desktop/releases)
[![GitHub Release](https://img.shields.io/github/v/release/ARST113/lampa-desktop?include_prereleases&style=for-the-badge&logo=github)](https://github.com/ARST113/lampa-desktop/releases)
[![License](https://img.shields.io/github/license/ARST113/lampa-desktop?style=for-the-badge&color=blue)](LICENSE)

> **Неофициальный** десктоп-клиент для просмотра фильмов и сериалов  
> Построен на базе **Electron**, использует API сторонних сервисов.

---

## Windows x64, Linux и macOS с Electron AC3/EAC3

Этот форк собирает Lampa 1.6.0 на **Electron 44.4.4** для Windows x64, Linux x86_64/ARM64 и macOS —
универсальный файл для Intel и Apple Silicon, плюс отдельные сборки под каждый процессор.
Используется [собранный Electron с флагами AC3/EAC3](https://github.com/ARST113/electron/releases/tag/v44.4.4-ac3-eac3).
Установщики публикуются в [релизах этого форка](https://github.com/ARST113/lampa-desktop/releases).
Автообновление также направлено на этот форк.

### macOS Universal — Intel и Apple Silicon в одном DMG

[Скачать DMG](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-universal-1.6.0-ac3.7-macos-ac3.dmg) · [Скачать ZIP](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-universal-1.6.0-ac3.7-macos-ac3.zip) · требуется **macOS 13 Ventura или новее**.

Один файл для любого Mac: внутри и `x86_64`, и `arm64` (проверено `lipo`), Rosetta не нужна.
Размер больше остальных — 374 МБ, потому что в нём лежат оба рантайма.
Эту сборку стоит брать, если не хочется думать о процессоре.

### macOS arm64 (Apple Silicon)

[Скачать DMG](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-arm64-1.6.0-ac3.7-macos-ac3.dmg) · [Скачать ZIP](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-arm64-1.6.0-ac3.7-macos-ac3.zip) · 194 МБ, только для Mac на M1/M2/M3/M4.

Проверено запуском на настоящем Apple Silicon (Apple M1, macOS 15) в CI: воспроизведение
**AC3 5.1 (RMS 0.041)** и **EAC3 7.1 (RMS 0.039)** — звук записан в WAV, а также извлечение
субтитров встроенным ffmpeg. Рантайм в этой сборке — нативные `arm64`-слайсы Electron 44.4.4
(Chromium 152.0.7977.130).

### macOS x64 (Intel)

[Скачать DMG](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-x64-1.6.0-ac3.7-macos-ac3.dmg) · [Скачать ZIP](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-x64-1.6.0-ac3.7-macos-ac3.zip) · требуется **macOS 13 Ventura или новее**.

Сборка подписана ad-hoc и не нотаризована, поэтому при первом запуске macOS скажет,
что разработчик не проверен. Лечится один раз:

```bash
xattr -dr com.apple.quarantine /Applications/Lampa.app
```

либо правой кнопкой по приложению → **Открыть**.

FFmpeg/ffprobe для субтитров уже лежат внутри бандла
(`Lampa.app/Contents/Resources/subtitle-tools`), отдельно устанавливать ничего не нужно.

Что проверено в CI на этой сборке: декодирование **AC3 5.1 и EAC3 7.1** (звук записан в WAV),
воспроизведение торрента через TorrServer — 30 секунд звука, извлечение субтитров из живого
потока встроенным ffmpeg (19 дорожек, реальные реплики), запуск приложения и отрисовка окна.
AC3/EAC3 здесь декодирует системный CoreAudio, поэтому встроенные декодеры FFmpeg для звука
на macOS не нужны.

На Mac с Apple Silicon эта сборка работает через **Rosetta 2** (macOS предложит установить её
при первом запуске) — но проще взять универсальный DMG или arm64-сборку выше, они нативные.

Версия `1.6.0-ac3.7` исправляет потерю субтитров при изменении адреса внутри Lampa:
переходы history/hash больше не отключают получение текста у работающего плеера.

Версия `1.6.0-ac3.6` читает текстовые субтитры непосредственно из потока MKV,
который уже получает видео. Дорожки обрабатываются вместе; смена языка не запускает
отдельную загрузку или FFmpeg. Консоль разработчика открывается через **F12**, **Ctrl+Shift+I** или
**Настройки → Приложение → Открыть консоль**.

Поддерживаются встроенные **текстовые субтитры MKV** во внутреннем
плеере при воспроизведении через TorrServer: SRT/SubRip, ASS/SSA и WebVTT. Выберите
дорожку в обычном меню «Субтитры». Уже полученные строки переключаются сразу.
Видео и звук не перекодируются. При перемотке в ещё не загруженную часть нужно
дождаться данных сервера, как и для видео. Для реплики, начавшейся до точки
перемотки, обработчик использует индекс субтитров MKV и небольшие Range-запросы;
если в файле такого индекса нет, текст появится со следующего полученного блока.
Интернет-поток должен быть доступен по HTTP(S). Дорожки определяются из заголовка
MKV независимо от метаданных TorrServer. Учтено обновление меню плагином Tracks на Lampac.
Графические PGS/VobSub этим обработчиком не поддерживаются; для них нужен внешний
плеер. Сложное оформление ASS преобразуется в текст WebVTT.

Обработчик FFmpeg включён в установщик, отдельно устанавливать его не нужно.
Версия и SHA-256 закреплены в `build/subtitle-tools.json`; исходные лицензионные
уведомления и ссылка на исходный код поставляются рядом с ним в `resources/subtitle-tools`.

Версия `1.6.0-ac3.2` включает переключение встроенных аудиодорожек во внутреннем плеере
(в том числе при воспроизведении через TorrServer).
В **Настройки → Приложение → Проверить обновления** можно немедленно проверить новую
версию или посмотреть ход загрузки. Если автообновление включено, проверка выполняется
через 5 секунд после запуска и затем каждые 30 минут. После загрузки приложение
предлагает установку и перезапуск; кнопка «Позже» откладывает установку.

Для сборки нужны Windows x64, Node.js 24 и Yarn 4.9.4:

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
yarn install --immutable
./scripts/prepare-electron.ps1
./scripts/prepare-subtitle-tools.ps1
yarn build-win
node scripts/verify-electron.cjs dist/win-unpacked/Lampa.exe dist/win-unpacked/ffmpeg.dll
```

### Сборка под macOS

Используется ветка `macos/ac3-eac3`: приложение берёт ffmpeg/ffprobe из бандла, поэтому
статические сборки обеих архитектур упаковываются в `.app` вместе с приложением.
Готовые сборки переносятся в релизы этого репозитория workflow
`Publish application builds from the Electron fork`.

Исходная основа проекта — [Kolovatoff/lampa-desktop](https://github.com/Kolovatoff/lampa-desktop).
Сведения об авторстве и условия распространения исходного кода сохранены в [LICENSE](LICENSE).
