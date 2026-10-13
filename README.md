# Lampa Desktop

Неофициальный настольный клиент Lampa на Electron с поддержкой AC3/EAC3, переключения аудиодорожек и встроенных текстовых субтитров MKV.

## Скачать Lampa Desktop

**[Единый стабильный релиз — скачать для Windows, Linux и macOS](https://github.com/ARST113/lampa-desktop/releases/tag/v1.6.0-ac3.24).** Windows — **1.6.0-ac3.24**, Linux и macOS — **1.6.0-ac3.8**. Все исправленные приложения доступны на одной странице релиза. Сетевое исправление, связанное с отменой HTTP-запросов и освобождением соединений, перенесено на Linux и macOS; проверки выполнены в GitHub Actions.

### Windows x64 — 1.6.0-ac3.24

[![Windows — установщик EXE](.github/badges/windows-installer-ac3.24.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-x64-1.6.0-ac3.24.exe)
[![Windows — Portable EXE](.github/badges/windows-portable-exe-ac3.24.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-portable-x64-1.6.0-ac3.24.exe)
[![Windows — Portable ZIP](.github/badges/windows-portable-zip-ac3.24.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-portable-zip-x64-1.6.0-ac3.24.zip)

- **Установщик EXE:** стандартная установка в Windows с поддержкой автообновления.
- **Portable EXE:** один файл, запуск без установки.
- **Portable ZIP:** распакуйте архив и запустите Lampa.exe; нет дополнительной NSIS-распаковки при каждом запуске.

Обе Portable-версии используют папку **LampaData** рядом с программой. Сохраняйте её при обновлении.

### Linux — 1.6.0-ac3.8

[![Linux x86_64](.github/badges/linux-x64-ac3.8.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-x86_64-1.6.0-ac3.8-linux-ac3.rpm)

[![Linux ARM64](.github/badges/linux-arm64-ac3.8.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-aarch64-1.6.0-ac3.8-linux-ac3.rpm)

- **RPM:** для совместимых дистрибутивов с пакетным менеджером RPM.
- **Архитектуры:** x86_64 (Intel/AMD) и aarch64 (ARM64).

Отдельных DEB и 32-битных сборок нет. Версия ac3.8 прошла проверки сетевого обработчика и упакованного Electron на обеих архитектурах.

### macOS — 1.6.0-ac3.8

[![macOS Universal](.github/badges/macos-universal-ac3.8.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-universal-1.6.0-ac3.8-macos-ac3.dmg)

[![macOS Intel](.github/badges/macos-intel-ac3.8.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-x64-1.6.0-ac3.8-macos-ac3.dmg)

[![macOS Apple Silicon](.github/badges/macos-arm64-ac3.8.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/lampa-arm64-1.6.0-ac3.8-macos-ac3.dmg)

Кнопки загружают **DMG**. Откройте образ и перенесите **Lampa.app** в «Программы» (Applications).

- **Universal:** Intel x64 и Apple Silicon ARM64 в одном приложении.
- **Intel x64:** для Mac на процессорах Intel.
- **Apple Silicon ARM64:** для Mac на процессорах серии M (M1 и новее).

Требуется **macOS 13 Ventura или новее**. Сборки ac3.8 прошли проверки сетевых запросов в Electron, упаковки и контрольных сумм. Приложения не нотарифицированы Apple; при первом запуске может потребоваться команда **Открыть** в контекстном меню Finder.

**[Последний объединённый релиз](https://github.com/ARST113/lampa-desktop/releases/latest)** · **[Все релизы](https://github.com/ARST113/lampa-desktop/releases)** · **[SHA-256 — все платформы](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.24/SHASUMS256.txt)**

---

## Возможности

- **Надёжность:** устранена причина аварийного исключения Node.js Undici `Parser.finish` при HTTP-запросах основного процесса. Проверки TorrServer, облачный экспорт и чтение субтитров используют сетевой стек Electron (Chromium).

- **Звук:** поддержка AC3/EAC3 во внутреннем плеере. Для Windows используется [специальная сборка Electron](https://github.com/ARST113/electron/releases/tag/v44.4.4-ac3-eac3); на macOS применяется CoreAudio.
- **Субтитры MKV:** SRT/SubRip, ASS/SSA и WebVTT. Дорожки переключаются в обычном меню плеера, видео и звук не перекодируются. Графические PGS/VobSub этим обработчиком не поддерживаются.
- **TorrServer:** переключение аудио- и текстовых дорожек, работа с перемоткой и индексами MKV. При переходе к ещё не загруженному фрагменту субтитрам нужно дождаться поступления данных.
- **Подключение к Lampa:** ввод и исправление URL без перезапуска, отдельный экран загрузки и проверка настоящего интерфейса Lampa вместо принятия любого HTML-документа за рабочий сайт.
- **Обновления Windows:** Настройки → Приложение → Проверить обновления. Доступна автоматическая проверка и отложенная установка.

Средства FFmpeg/ffprobe и необходимые лицензии входят в соответствующие пакеты. Версия и контрольные суммы ресурсов закреплены в [build/subtitle-tools.json](build/subtitle-tools.json).

### Диагностика

Консоль разработчика: **F12**, **Ctrl+Shift+I** или Настройки → Приложение → Открыть консоль.

Журнал раннего запуска Windows: %LOCALAPPDATA%/Lampa-NextGen/diagnostics/startup.log.

## Сборка из исходников

Для сборки Windows требуются Windows x64, Node.js 24 и Yarn 4.9.4. Запустите yarn install --immutable, затем scripts/prepare-electron.ps1 и scripts/prepare-subtitle-tools.ps1, после чего yarn build-win. Для проверки готового файла используйте scripts/verify-electron.cjs.

Linux и macOS ac3.8 собираются в отдельных платформенных ветках с перенесённым исправлением сетевого транспорта; исходная ветка macOS — macos/ac3-eac3. Windows ac3.24, Linux ac3.8 и macOS ac3.8 опубликованы в одном стабильном релизе.

## Авторство и лицензия

Исходная основа проекта — [Kolovatoff/lampa-desktop](https://github.com/Kolovatoff/lampa-desktop). Условия распространения сохранены в [LICENSE](LICENSE). Клиент неофициальный и использует API сторонних сервисов.
