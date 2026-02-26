# Calendar Bridge — UI/UX Improvements (Settings & Sync)

Ниже список изменений по настройкам источника календаря и общей конфигурации синка. Формат: **что сделать → детали реализации → критерии готовности**.

---

## 1) OAuth авторизация по кнопке (внешний браузер + выбор аккаунта)

### Что сделать
- Кнопка **Authorize** должна запускать **OAuth flow в системном браузере** (default browser).
- Пользователь должен увидеть стандартную страницу Google с **выбором аккаунта**.
- После успешной авторизации плагин получает code/token и показывает статус **Authorized**.

### Детали реализации (Obsidian / Electron)
- Открывать URL авторизации через:
  - `open(url)` из `obsidian` (или `window.open` с `"_blank"`), либо
  - `require("electron").shell.openExternal(url)` (если доступно в окружении).
- Для выбора аккаунта в Google OAuth URL добавить параметры:
  - `prompt=select_account` (или `prompt=consent select_account` при необходимости)
  - при наличии проблемы с silent login — всегда форсировать prompt.
- Callback:
  - Вариант A (рекомендованный): локальный loopback redirect (`http://127.0.0.1:<port>/callback`) и временный локальный сервер в плагине.
  - Вариант B: custom URL scheme (обычно сложнее для community plugin).
- Обработать состояния:
  - not authorized / authorizing / authorized / error
  - кнопка **Revoke** должна чистить токены и локальный state.

### Критерии готовности
- Нажатие **Authorize** открывает браузер и даёт выбрать Google account.
- После успешного входа в UI отображается `Authorized` + время последней авторизации.
- При ошибке пользователь видит читабельное сообщение (invalid client, redirect mismatch, blocked by policy).

---

## 2) Fetch links: добавить поддержку Microsoft Teams meeting links

### Что сделать
- Сейчас “Include conference data” вытаскивает Google Meet / Zoom ссылки (conferenceData).
- Нужно дополнительно вытаскивать **Microsoft Teams** join link.

### Детали реализации
Teams ссылки могут быть:
1) В `location` / `description` (часто так и есть)
2) В provider-specific fields (в Google Calendar API обычно Teams не лежит в conferenceData)

Добавить парсинг ссылок из текста `description` + `location`:
- Найти URL по regex и выбрать самый вероятный join link.
- Поддержать типичные домены/паттерны Teams:
  - `https://teams.microsoft.com/l/meetup-join/...`
  - `https://teams.live.com/meet/...` (реже)
  - `https://gov.teams.microsoft.us/...` (если встречается)
- Нормализация:
  - сохранить `teams_url` (если найдено)
  - дополнительно сохранить `meeting_url` (унифицированное поле “лучший join link” по приоритету)

Приоритет выбора `meeting_url` (пример):
1) Google Meet (conferenceData)
2) Zoom (conferenceData или description)
3) Teams (description/location)
4) Любая другая ссылка “join” (fallback)

### Критерии готовности
- Если в описании/локации есть Teams link — он попадает в заметку.
- В UI/логах видно, что обнаружено: Meet/Zoom/Teams.
- Никаких false positives на обычные ссылки.

---

## 3) Sync horizon: ручной ввод + кнопка Default (значение 5)

### Что сделать
- Поле **Sync horizon (days)** должно быть **numeric input**, а не slider.
- Рядом кнопка **Default**, которая ставит значение **5**.

### Детали реализации
- Input: integer, min=1, max (например) 60.
- При потере фокуса — валидация и автокоррекция (clamp).
- Default button:
  - ставит `5`
  - сразу сохраняет настройки
  - опционально показывает toast “Set to default: 5 days”.

### Критерии готовности
- Можно ввести `5` руками.
- Кнопка Default выставляет `5`.
- Нельзя ввести нечисловое/отрицательное.

---

## 4) Auto-sync interval: ручной ввод вместо ползунка

### Что сделать
- Поле **Auto-sync interval (minutes)** — numeric input.
- Разрешить:
  - `0` = выключено
  - `>=1` — интервал в минутах

### Детали реализации
- Input: integer, min=0, max (например) 1440.
- Подсказка рядом:
  - `0 disables auto-sync`
- Если включён auto-sync:
  - пересоздавать таймер при изменении значения
  - debounce, чтобы не запускать sync слишком часто.

### Критерии готовности
- Можно ввести значение (например 60).
- При `0` таймер отключается.
- Настройки сохраняются без лагов.

---

## 5) Paths: выбирать папку/файл через picker, а не вводить руками

### Что сделать
В секции **Paths**:
- `Meetings root folder` — **выбор папки** (folder picker)
- `Series pages folder` — **выбор папки**
- `Template file` — **выбор файла** (file picker)
- Пользователь не должен вручную печатать пути (или это должно быть вторично/advanced).

### Детали реализации (Obsidian API)
Использовать стандартные UI элементы Obsidian:
- Folder picker:
  - `new FolderSuggest(app, inputEl)` / `FolderSuggest` (если используется internal suggest)
  - или модалка, которая показывает дерево vault и позволяет выбрать папку
- File picker:
  - `new FileSuggest(app, inputEl)` / `FileSuggest`
  - фильтровать по расширению `.md` для шаблонов

UX вариант:
- рядом с readonly input кнопка **Browse…**
- клик открывает modal
- после выбора:
  - путь сохраняется
  - можно показать preview “Resolved path: …”

### Критерии готовности
- Папку можно выбрать кликом, без ручного ввода.
- Для шаблона можно выбрать конкретный `.md` файл.
- Валидация: если папка/файл удалены — в UI warning + кнопка “reselect”.

---

## 6) Обновление UI: мелкие улучшения по статусам

### Что сделать
- В блоке Authorization:
  - отображать текущий статус (`Not authorized / Authorized / Error`)
  - при Authorized — показывать account email (если можно получить) и last sync
- Добавить кнопки:
  - `Test connection`
  - `Preview upcoming events` (показывает 10 ближайших)

### Критерии готовности
- Пользователь понимает, что всё работает, без догадок.
- Ошибки человеко-понятные.

---

## Acceptance Checklist (быстрая проверка)

- [ ] Authorize открывает системный браузер + выбор аккаунта (`prompt=select_account`)
- [ ] Teams link парсится из description/location и попадает в заметку
- [ ] Sync horizon — numeric input + Default=5
- [ ] Auto-sync interval — numeric input (0=off)
- [ ] Все Paths выбираются через folder/file picker
- [ ] UI показывает понятные статусы и умеет “Test connection”
