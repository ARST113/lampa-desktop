# Lampa Desktop

Неофициальный настольный клиент Lampa на Electron с поддержкой AC3/EAC3, переключения аудиодорожек и встроенных текстовых субтитров MKV.

## Скачать Lampa Desktop

**[Единый стабильный релиз — скачать для Windows, Linux и macOS](https://github.com/ARST113/lampa-desktop/releases/tag/v1.6.0-ac3.23).** Windows — текущая версия **1.6.0-ac3.23**. Сборки Linux и macOS имеют версию **1.6.0-ac3.7** и включены в тот же релиз для удобной загрузки. Все кнопки ведут на файлы единого релиза; номера версий в названиях сохранены.

**Ручная проверка Windows ac3.23:** пользователь проверил воспроизведение пяти видеофайлов, аварийных завершений приложения не наблюдалось.

### Windows x64 — 1.6.0-ac3.23

[![Windows — установщик EXE](.github/badges/windows-installer.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-x64-1.6.0-ac3.23.exe)
[![Windows — Portable EXE](.github/badges/windows-portable-exe.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-portable-x64-1.6.0-ac3.23.exe)
[![Windows — Portable ZIP](.github/badges/windows-portable-zip.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-portable-zip-x64-1.6.0-ac3.23.zip)

- **Установщик EXE:** стандартная установка в Windows с поддержкой автообновления.
- **Portable EXE:** один файл, запуск без установки.
- **Portable ZIP:** распакуйте архив и запустите Lampa.exe; нет дополнительной NSIS-распаковки при каждом запуске.

Обе Portable-версии используют папку **LampaData** рядом с программой. Сохраняйте её при обновлении.

### Linux — 1.6.0-ac3.7

[![Linux x86_64](.github/badges/linux-x64.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-x86_64-1.6.0-ac3.7-linux-ac3.rpm)
[![Linux ARM64](.github/badges/linux-arm64.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-aarch64-1.6.0-ac3.7-linux-ac3.rpm)

- **x86_64 / AMD64:** RPM для 64-битных процессоров Intel и AMD.
- **ARM64 / aarch64:** RPM для 64-битных ARM.

**32-битной Linux-сборки x86/i386 нет.** Linux x86_64 — тоже 64-битная версия. Оба пакета собраны из версии ac3.7 и размещены также в едином релизе ac3.23 для удобства. Linux с исходным кодом версии ac3.23 пока не собирался.

### macOS — 1.6.0-ac3.7

[![macOS Universal](.github/badges/macos-universal.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-universal-1.6.0-ac3.7-macos-ac3.dmg) · [ZIP для Universal](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-universal-1.6.0-ac3.7-macos-ac3.zip)

[![macOS Intel](.github/badges/macos-intel.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-x64-1.6.0-ac3.7-macos-ac3.dmg) · [ZIP для Intel](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-x64-1.6.0-ac3.7-macos-ac3.zip)

[![macOS Apple Silicon](.github/badges/macos-arm64.svg)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-arm64-1.6.0-ac3.7-macos-ac3.dmg) · [ZIP для Apple Silicon](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/lampa-arm64-1.6.0-ac3.7-macos-ac3.zip)

Каждая кнопка скачивает **DMG**. Для установки откройте DMG и перетащите **Lampa.app** в папку «Программы» (Applications). Архивы ZIP для всех трёх архитектур также находятся в [едином релизе ac3.23](https://github.com/ARST113/lampa-desktop/releases/tag/v1.6.0-ac3.23), но для обычной установки достаточно DMG.

- **Universal:** Intel x64 и Apple Silicon ARM64 в одном приложении.
- **Intel x64:** Mac с процессорами Intel.
- **Apple Silicon ARM64:** Mac на процессорах серии M (M1 и новее).

Требуется **macOS 13 Ventura или новее**. Это сборки исходного кода версии ac3.7, доступные непосредственно в едином релизе ac3.23; macOS с исходным кодом версии ac3.23 пока не собирался. Из-за отсутствия нотарификации Apple для первого запуска может потребоваться команда **Открыть** в контекстном меню Finder.

**[Последний объединённый релиз](https://github.com/ARST113/lampa-desktop/releases/latest)** · **[Все релизы](https://github.com/ARST113/lampa-desktop/releases)** · **[SHA-256 Windows ac3.23](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.23/SHASUMS256.txt)**

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

Сборки macOS и Linux ac3.7 продублированы в объединённый релиз ac3.23 без пересборки; исходная ветка macOS — macos/ac3-eac3. Современные Windows-исправления ac3.23 не входят в старые сборки для других платформ.

## Авторство и лицензия

Исходная основа проекта — [Kolovatoff/lampa-desktop](https://github.com/Kolovatoff/lampa-desktop). Условия распространения сохранены в [LICENSE](LICENSE). Клиент неофициальный и использует API сторонних сервисов.
