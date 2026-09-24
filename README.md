# 🎬 Lampa Desktop

## Windows x64 с Electron AC3/EAC3

Этот форк собирает Lampa 1.6.0 на **Electron 44.4.4** для Windows x64.
Используется [собранный Electron с флагами AC3/EAC3](https://github.com/ARST113/electron/releases/tag/v44.4.4-ac3-eac3).
Установщик публикуется в [релизах этого форка](https://github.com/ARST113/lampa-desktop/releases).
Автообновление также направлено на этот форк.

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
yarn build-win
node scripts/verify-electron.cjs dist/win-unpacked/Lampa.exe dist/win-unpacked/ffmpeg.dll
```

Версия и контрольные суммы Electron закреплены в `build/electron-runtime.json`.
Сборка завершается ошибкой при несовпадении архива, версии или `ffmpeg.dll`.
Исходный проект и сборки для остальных платформ: [Kolovatoff/lampa-desktop](https://github.com/Kolovatoff/lampa-desktop).

---

[![GitHub All Releases](https://img.shields.io/endpoint?url=https://lampa.kolovatoff.ru/github/downloads)](https://github.com/Kolovatoff/lampa-desktop/releases)
[![GitHub Release](https://img.shields.io/github/v/release/Kolovatoff/lampa-desktop?style=for-the-badge&logo=github)](https://github.com/Kolovatoff/lampa-desktop/releases)
[![License](https://img.shields.io/github/license/Kolovatoff/lampa-desktop?style=for-the-badge&color=blue)](LICENSE)

![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![macOS](https://img.shields.io/badge/mac%20os-000000?style=for-the-badge&logo=macos&logoColor=F0F0F0)

> **Неофициальный** десктоп-клиент для просмотра фильмов и сериалов  
> Построен на базе **Electron**, использует API сторонних сервисов.

---

## 🔧 Возможности

✅ Поддержка **Windows, Linux, macOS**  
✅ Синхронизация таймкодов с **VLC, KMPlayer, MPC(HC/BE/QT)** (кроме MacOS)  
✅ Динамическая загрузка Lampa с `lampa.mx` или кастомного URL  
✅ Экспорт/импорт конфигурации между устройствами  
✅ Встроенные настройки: смена URL, полноэкранный режим и др.  
✅ Поддержка `window.location.reload()`  
✅ Сохранение позиции окна, размера и монитора  
✅ Кнопка закрытия приложения  
✅ Автоматические обновления  
✅ Встроенная поддержка **TorrServer**  
✅ Автообнаружение плеера при запуске, также окно выбора плеера из найденных  
✅ Горячие клавиши  
✅ Управление с геймпада: Xbox, PlayStation, Switch Pro и другие контроллеры со стандартной раскладкой

## 🔧 Горячие клавиши в приложении

- F - полный экран
- S - открывает поиск
- M - открывает левое меню

---

## 📦 Установка

Скачайте последнюю версию из [релизов](https://github.com/Kolovatoff/lampa-desktop/releases):

1. Выберите подходящий установщик:
   - `.exe` — для Windows
   - `.AppImage` / `.deb` / `.rpm` — для Linux
   - `.dmg` — для macOS
2. Установите
3. [Настройте](docs/quick-start.md)
4. Приятного просмотра!

---

## 🔄 Экспорт и импорт настроек

Переносите свои настройки между устройствами или резервируйте их:

- [📖 Подробнее: Экспорт/Импорт](docs/export-import.md)

---

## 🆘 Инструкция по настройке и прочее

- [Как настроить / Частые вопросы / Проблемы](docs/quick-start.md)

---

## 🛠 Разработка

Документация по этому проекту от ИИ [![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Kolovatoff/lampa-desktop)

Исходный код самой **Lampa** доступен здесь: 👉 [yumata/lampa-source](https://github.com/yumata/lampa-source)

### ✍️ Внесение изменений

Процесс стандартный:

1. **Форкните репозиторий** — кнопка `Fork` в правом верхнем углу GitHub
2. **Клонируйте свой форк** — `git clone https://github.com/ВАШ_ЛОГИН/lampa-desktop.git`
3. **Создайте ветку** — `git checkout -b feature/название-фичи` или `fix/описание-бага`
4. **Внесите изменения и закоммитьте** — `git commit -m 'Краткое описание того, что сделано'`
5. **Отправьте ветку** — `git push origin feature/название-фичи`
6. **Откройте Pull Request** — перейдите в оригинальный репозиторий и нажмите `Compare & pull request`

---

## 📢 Обратная связь

По вопросам, багам и предложениям — пишите в Telegram:  
👉 [@lampa_desktop](http://t.me/lampa_desktop) (Группа)

---

## 📄 Лицензия

Этот проект распространяется под лицензией **GPL-2.0**.  
Подробнее см. в файле [LICENSE](LICENSE).

---

⭐ Если проект полезен — поставьте звезду

### Поддержать через Robokassa

|                                                                    100₽                                                                     |                                                                    250₽                                                                     |                                                                    500₽                                                                     |
| :-----------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------: |
| ![QR 100₽](https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://auth.robokassa.ru/merchant/Invoice/5d762NejHk-hEAtwYmMgAA) | ![QR 250₽](https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://auth.robokassa.ru/merchant/Invoice/MgIfH6xn10qeIz2spPb58A) | ![QR 500₽](https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://auth.robokassa.ru/merchant/Invoice/b4vzffdiNUyeTEy6furqpg) |
|                           [Поддержать на 100₽](https://auth.robokassa.ru/merchant/Invoice/5d762NejHk-hEAtwYmMgAA)                           |                           [Поддержать на 250₽](https://auth.robokassa.ru/merchant/Invoice/MgIfH6xn10qeIz2spPb58A)                           |                           [Поддержать на 500₽](https://auth.robokassa.ru/merchant/Invoice/b4vzffdiNUyeTEy6furqpg)                           |
