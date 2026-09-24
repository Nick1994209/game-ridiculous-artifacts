# Backend — Собиратели нелепых артефактов

Go 1.26, net/http, coder/websocket. Все данные в памяти, одна комната `main`.

```sh
cd backend
go run ./cmd/game-server
# Проверки
gofmt -w .
go vet ./...
go test ./...
go test -race ./...
go build ./...
```

Сервер: http://localhost:8080; `/healthz`, `/readyz`, WebSocket `/ws`.
При SIGINT/SIGTERM завершаются HTTP, соединения и единственный room loop.

## Настройки

`PORT=8080` (по умолчанию), `ADDR` — альтернативный полный адрес при отсутствии `PORT`.
`PORT` имеет приоритет и должен быть в диапазоне 1–65535.
`STATIC_DIR=../frontend/dist` — каталог собранного frontend (в общем Docker-образе `/app/public`).
`ALLOWED_ORIGINS=localhost:5173,127.0.0.1:5173` (список host:port).
Числовые env: `TICK_RATE=30`, `SNAPSHOT_RATE=15`, `MAX_CONNECTIONS=128`, `INPUT_RATE=60`,
`ROUND_SECONDS=180`, `INTERMISSION_SECONDS=8`, `COUNTDOWN_SECONDS=3`,
`RECONNECT_GRACE_SECONDS=10`, `ARTIFACT_RESPAWN_SECONDS=3`,
`MOVE_SPEED=340`, `GRAVITY=1600`, `JUMP_SPEED=820`.
Остальные параметры боя и типов монстров централизованы в `internal/platform/config.go`.
Персонаж 32×46, монстр 38×40, предмет 24×24. Высота прыжка около 210 единиц.

## Протокол v1

Каждый клиентский JSON содержит `protocolVersion:1`, `type` и для input `roundID`.
Первое сообщение за 5 секунд: `{"protocolVersion":1,"type":"hello","name":"Ведьма"}`
либо `{"protocolVersion":1,"type":"resume","token":"…"}`.
Команды: `input` с полем `input:{seq,left,right,jump,attack}`, `spectate` с `target`,
`ping` с числовым `nonce`. Положение, здоровье и счёт от клиента не принимаются.

Все ответы: `{protocolVersion:1,type,roundID,serverTick,data}`.
- `welcome`: `{playerID,token,role,queue}`. Token — секрет текущей сессии.
- `role`: надёжное уведомление `{role,queue}`; те же данные доступны в snapshot.
- `map`: полная карта из встроенных JSON, только при подключении/смене раунда.
- `snapshot`: `{phase,remaining,players,monsters,artifacts,result}`.
  Игрок включает `lastProcessedInputSeq`, роль, очередь, слот, HP, alive, connected, счёт.
- `round.countdown`, `round.started`, `round.finished`, `attack`, `hit`, `damage`,
  `player.died`, `player.killed`, `monster.died`, `monster.spawned`,
  `artifact.collected`, `artifact.spawned`: доменные события с `id,source,target,cause,serverTick,amount`.
- `result`: `{winner,reason,standings}`; пустой winner означает отсутствие победителя.
- `pong`: `{nonce}`; `spectate`: `{target}`.
- `error`: `{code}` — `invalid_name`, `name_taken`, `session_expired`, `room_full`,
  `protocol_mismatch`, `unknown_message`.

Структуры DTO описаны в domain/types.go и inbound/server.go; token не входит в snapshots.
Reliable очередь ограничена 128 сообщениями: медленное соединение закрывается, затем
клиент восстанавливается из полного состояния. Snapshot хранится отдельно (последний).
Максимальный входящий JSON 2048 байт, лимит сообщений INPUT_RATE+10 в секунду.
Transport ping каждые 15 секунд, timeout 5 секунд; write timeout 3 секунды.

## Правила и архитектура

`waiting → countdown → playing → round_finished → intermission`.
Первый подключившийся запускает countdown. Состав фиксируется сразу; последующие подключения
ждут следующий раунд. До четырёх подключённых прежних участников сохраняют места,
свободные заполняются FIFO. Погибшие возвращаются в следующем раунде. Отключённый
участник остаётся в мире на grace period, затем погибает; замена только между раундами.
Имена резервируются на grace period. Resume одновременно подключённой сессии отклоняется.

`domain` не зависит от transport; `game` содержит детерминированные шаги симуляции,
state machine и in-memory repository; `inbound` синхронизирует команды и loop одним mutex,
кодирует DTO и обслуживает неблокирующие очереди. Время симуляции задаётся шагами `Step`,
random — интерфейс Intn, тесты не ждут реальные игровые секунды.

Карты embedded из `maps/*.json`; оригинальные схемы — `maps/DESIGN.md`.
Добавлены промежуточные ступени к исходным маршрутам. Startup-валидация проверяет
геометрию, опоры артефактов и связность платформ в пределах стандартного прыжка.
Графовая проверка не заменяет физический playtest всех траекторий. Артефакты появляются только в свободных
точках (до 10). Монстры не прыгают и преследуют лишь в своей платформенной секции.
Все параметры и геометрия передаются клиенту через карту/состояние, клиент не хранит копию карт.

MVP: нет БД, авторизации, рейтинга, чата, глобального pathfinding и lag compensation.
Перезапуск сервера теряет сессии и текущий раунд. Клиентам нужен TLS reverse proxy для production.

Общий Dockerfile в корне собирает server + frontend: `docker build -t ridiculous-artifacts .`
из корня проекта. Подробности запуска — в корневом README. `backend/Dockerfile` остаётся
вариантом для сборки только backend с build context `backend`.
