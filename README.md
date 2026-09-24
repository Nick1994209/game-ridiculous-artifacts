# Собиратели нелепых артефактов

Сетевой 2D-платформер: до четырёх игроков, пять карт, PvP, монстры,
зрители с FIFO-очередью, reconnect и непрерывные серверные раунды.
Первый живой игрок с пятью подтверждёнными артефактами побеждает.

## Быстрый запуск

```sh
# Терминал 1
cd backend
go run ./cmd/game-server

# Терминал 2
cd frontend
npm ci
npm run dev
```

Откройте http://127.0.0.1:5173. Требуются Go 1.26 и Node 22.12+ / 24.
Порт 8080 занят? Запустите backend с `ADDR=127.0.0.1:8081`, frontend с
`BACKEND_URL=http://127.0.0.1:8081`.

- [Backend: архитектура, конфигурация, JSON-протокол и тесты](backend/README.md)
- [Frontend: управление, renderer, windowing и тесты](frontend/README.md)
- [Исходные схемы пяти карт](backend/maps/DESIGN.md)

Исходные задания сохранены в `prompts/`. Данные игры в памяти, внешние сервисы не нужны.
Локальное движение authoritative без prediction; remote interpolation 120 мс.

## Docker: сервер и frontend в одном контейнере

Из корня репозитория:

```sh
docker build -t ridiculous-artifacts .
docker run --rm -p 8080:8080 ridiculous-artifacts
```

Игра: http://localhost:8080. Go-сервер раздаёт собранный frontend и принимает
WebSocket на `/ws` на том же порту; Node и отдельный веб-сервер в runtime не нужны.
Если локальный 8080 занят, используйте `-p 8082:8080` и откройте http://localhost:8082.

Изменение порта самого сервера:

```sh
docker run --rm -e PORT=9000 -p 9000:9000 ridiculous-artifacts
```

`PORT` имеет приоритет над `ADDR`; без обоих используется `8080`.
`STATIC_DIR` задаёт каталог frontend: в контейнере `/app/public`,
при запуске из `backend` по умолчанию `../frontend/dist` (сначала `npm run build`
из `frontend`). Runtime работает от непривилегированного пользователя.
