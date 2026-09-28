# 🎬 Lampa Desktop

### 📥 Скачать последнюю версию (с поддержкой AC3/EAC3):
[![Скачать для Windows](https://img.shields.io/badge/Скачать-Windows_x64-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/ARST113/lampa-desktop/releases)
[![Скачать для Linux](https://img.shields.io/badge/Скачать-Linux_x86__64-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/ARST113/lampa-desktop/releases)

[![Скачать для Linux ARM64](https://img.shields.io/badge/Скачать-Linux_ARM64-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/ARST113/lampa-desktop/releases/download/v1.6.0-ac3.7/lampa-aarch64-1.6.0-ac3.7-linux-ac3.rpm)

[![GitHub All Releases](https://img.shields.io/github/downloads/ARST113/lampa-desktop/total)](https://github.com/ARST113/lampa-desktop/releases)
[![GitHub Release](https://img.shields.io/github/v/release/ARST113/lampa-desktop?include_prereleases&style=for-the-badge&logo=github)](https://github.com/ARST113/lampa-desktop/releases)
[![License](https://img.shields.io/github/license/ARST113/lampa-desktop?style=for-the-badge&color=blue)](LICENSE)

> **Неофициальный** десктоп-клиент для просмотра фильмов и сериалов  
> Построен на базе **Electron**, использует API сторонних сервисов.

---

## Windows x64 и Linux с Electron AC3/EAC3

Этот форк собирает Lampa 1.6.0 на **Electron 44.4.4** для Windows x64 и Linux x86_64.
Используется [собранный Electron с флагами AC3/EAC3](https://github.com/ARST113/electron/releases/tag/v44.4.4-ac3-eac3).
Установщики публикуются в [релизах этого форка](https://github.com/ARST113/lampa-desktop/releases).
Автообновление также направлено на этот форк.

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
