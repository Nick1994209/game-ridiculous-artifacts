# Frontend — Бюро нелепых артефактов

Новый проект: TypeScript, Vite, Phaser **3.90**, Zod; DOM UI без дополнительного framework.
Phaser выбран согласно промпту: один scene/camera layer, один canvas и игровой loop,
без клиентского physics engine. Графика — локальные примитивы и системные emoji.

## Запуск

```sh
# Терминал 1, из корня репозитория
cd backend
go run ./cmd/game-server

# Терминал 2, из корня репозитория
cd frontend
npm ci
npm run dev
```

Открыть http://127.0.0.1:5173. Vite проксирует `/ws` на http://127.0.0.1:8080.
Если порт занят: backend `ADDR=127.0.0.1:8081 go run ./cmd/game-server`, frontend
`BACKEND_URL=http://127.0.0.1:8081 npm run dev`.

`VITE_WS_URL` задаёт прямой ws/wss endpoint (при сборке), иначе используется текущий host
и `/ws`. Для production нужны HTTPS и reverse proxy `/ws` к Go. Если frontend и backend
на разных origin, настройте `ALLOWED_ORIGINS` на backend. Production host не зашит.

## Управление

A/D или стрелки — движение, W/↑/Space — одинарный прыжок, J/X — атака.
Tab — временная таблица, Esc — меню без остановки игры. Потеря фокуса сбрасывает кнопки.
Зритель выбирает живого игрока или фиксированную камеру в центре карты.

## Архитектура и синхронизация

- `src/protocol.ts`: Zod-схемы DTO и проверка версии/имени.
- `src/network.ts`: hello/resume, heartbeat, latency, ограниченный reconnect/backoff.
- `src/state.ts`: normalised store, роли, bounded history, event dedup, seq/ack buffer.
- `src/input.ts`: состояние клавиш и отправка intentions 30 раз/сек.
- `src/spatial.ts`: camera bounds, overscan, spatial chunks и interpolation.
- `src/scene.ts`: Phaser renderer, entity views, эффекты, управление камерой и cleanup.
- `src/main.ts`: UI входа, HUD, spectator mode, таблица и результаты; обновление 10 Гц.

Полный сетевой контракт — `../backend/README.md`. Имена всегда проходят textContent /
Phaser Text, не вставляются в HTML. Token только в sessionStorage, не в логах или URL.
Контролы блокируются по серверной роли/смерти и во время reconnect/countdown.
События дедуплицируются, старые roundID/ticks отбрасываются. Контрольные ошибки обрабатываются
даже если сервер перезапустился с меньшим roundID. При отказе первичного resume выполняется
hello; при истечении восстановительной сессии показывается вход и причина.

Движение локального персонажа в этом MVP **authoritative, без prediction** (допустимый
вариант из промпта). Seq/ack buffer изолирован для последующего prediction; неподтверждённые
inputs никогда не меняют HP, положение в сетевом state, сбор или победителя.
Другие игроки и монстры интерполируются между snapshots с задержкой 120 мс, без долгой
экстраполяции. При потере связи применяется последнее подтверждённое состояние.

## Viewport windowing

Геометрия пяти карт поступает только от сервера. Исходные ASCII-дизайны:
`../backend/maps/DESIGN.md`. Клиент не содержит копию координат.

Логическое окно 1100×650, chunks 512×512, overscan 150; настройки в `VIEW` (`spatial.ts`).
Камера ограничена размерами карты. Статическая геометрия индексируется один раз на карту;
каждый кадр Graphics получает только результаты запроса пересекающихся chunks.
Dynamic entities/подписи/эффекты вне render window не рисуются и не анимируются.
Невидимые Phaser Text уничтожаются, network state сохраняется целиком.
HUD находится в DOM, координаты не вызывают DOM-перерисовку; карточки изменяются только
при изменении HUD-полей. Смена карты очищает index, labels, effects и event dedup.
Уход со страницы очищает input listeners, timers, socket и Phaser game.

`npm run dev`, URL `/?debug`: FPS, visible/total entities, active chunks, snapshot rate,
контуры viewport/overscan. Production сборка не включает debug overlay.
При проверке в Chrome типичная сцена показывала 60 FPS, 6/17 видимых сущностей,
6 чанков и 15 snapshots/с; это smoke-замер, не гарантия для любого устройства.

## Проверки

```sh
npm run lint
npm test
npm run build
# Требуются запущенные backend/frontend и установленный Google Chrome:
npm run test:e2e
# Если frontend на другом порту:
TEST_BASE_URL=http://127.0.0.1:5174 npm run test:e2e
```

Unit: имена, parser/version, смерть/роль, seq/ack, старые snapshots/rounds,
reconnect, результаты, camera bounds всех пяти карт, chunk/culling и offscreen state.
Playwright: реальный backend + keyboard; mock WebSocket lifecycle, смерть, результаты,
смена карты и единственный canvas. Скриншоты — `test-results/` (не в репозитории).

Сборка выдаёт предупреждение о размере vendor chunk Phaser (~330 KB gzip).
Это отдельный кэшируемый chunk. 2D-примитивы — временные игровые ассеты;
нет мобильных touch-controls, звука, клиентского prediction или permanent account.

## Общий Docker-образ

Корневой `Dockerfile` собирает frontend и копирует `dist` в образ Go-сервера.
Сервер сам раздаёт статику и `/ws` на порту `PORT` (по умолчанию 8080).
Vite dev server и `VITE_WS_URL` для такого запуска не нужны; клиент использует
текущий origin. Команды сборки и запуска — в корневом README.
