import { itemLabel } from "./items";
import Phaser from "phaser";
import "./style.css";
import { Store } from "./state";
import { Network } from "./network";
import { InputController } from "./input";
import { GameScene } from "./scene";
import { VIEW } from "./spatial";
import { validateName, type Player } from "./protocol";
const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `<header><a class="brand" href="/">✦ <span>БЮРО НЕЛЕПЫХ<br><b>АРТЕФАКТОВ</b></span></a><div class="room-label">ЭКСПЕДИЦИЯ / <strong>MAIN</strong></div><div id="connection" class="connection">● Не подключено</div></header>
<main><section class="title-row"><div><div class="eyebrow">МАЛЕНЬКИЕ ГЕРОИ. СОМНИТЕЛЬНЫЕ СОКРОВИЩА.</div><h1>Найти. Украсть. <em>Не умереть.</em></h1></div><div class="goal"><span>◇</span><div><b>5 предметов по списку</b><small>и слава совершенно ваша</small></div></div></section>
<div class="layout"><section class="arena"><div class="arena-bar"><span>● <b id="map-name">Неизведанная территория</b></span><span id="round">Ожидание экспедиции</span><b id="timer">—:—</b></div><div class="stage"><div id="game"></div><div id="join" class="join-overlay"><form id="join-form" class="join-card"><div class="badge">НАБОР ИСКАТЕЛЕЙ ОТКРЫТ</div><div class="relic">✧<span>🧪</span>✧</div><h2>Сокровища ждут.<br>Здравый смысл — нет.</h2><p>Соберите по одному из пяти предметов задания раньше соперников. Остерегайтесь грибов. Они сегодня не в духе.</p><label for="name">КАК ВАС ЗАПОМНЯТ ЛЕТОПИСЦЫ?</label><input id="name" name="name" autocomplete="off" placeholder="Например, Барон Понедельник" required><p id="error" class="error" role="alert"></p><button type="submit">Отправиться за нелепостями <span>↗</span></button><small>До 4 игроков · до 10 минут · одна сомнительная победа</small></form></div><div id="center" class="center-overlay" hidden></div><div id="spectator" class="spectator" hidden></div><div id="reconnect" class="reconnect" hidden>Восстанавливаем связь с экспедицией…</div><pre id="debug"></pre></div><div class="controls"><span><kbd>A</kbd><kbd>D</kbd> движение</span><span><kbd>W</kbd><kbd>↑</kbd> прыжок</span><span><kbd>SPACE</kbd> атака</span><span><kbd>TAB</kbd> участники</span><span><kbd>ESC</kbd> меню</span></div></section>
<aside><div class="section-heading"><h2>Искатели</h2><span id="count">0 / 4</span></div><div id="players"></div><div class="field-note"><span>ЗАДАНИЕ РАУНДА</span><h3>Собрать по списку.</h3><div id="objectives">Задание появится перед стартом.</div><p>По одному предмету каждого вида. Повторы не засчитываются.</p><p>✚ 4 аптечки: +50 HP, восстановление через 60 с. Артефакты появляются по одному раз в 20 с.</p></div><div class="feed-heading">ХРОНИКИ НЕЛЕПОСТИ</div><div id="feed" aria-live="polite"><p>Здесь начнётся ваша история.</p></div></aside></div><footer><span>Никаких достойных сокровищ не пострадало.</span><span>СОБИРАТЕЛИ НЕЛЕПЫХ АРТЕФАКТОВ <b> / MVP 01</b></span></footer></main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const store = new Store();
const url =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const network = new Network(store, url);
const input = new InputController(store, network);
const scene = new GameScene(store);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: "#202637",
  scene,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  audio: { noAudio: true },
});
const form = el<HTMLFormElement>("join-form");
const name = el<HTMLInputElement>("name");
// Old versions persisted identity; each page load now starts a fresh login.
sessionStorage.removeItem("artifact-name");
sessionStorage.removeItem("artifact-session");
name.value = "";
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const error = validateName(name.value);
  if (error) {
    el("error").textContent = error;
    return;
  }
  el("error").textContent = "";
  network.connect(name.value.trim());
});
const connectionLabels = {
  idle: "Не подключено",
  connecting: "Подключаемся…",
  connected: "В сети",
  unstable: "Нестабильная связь",
  reconnecting: "Переподключение…",
  lost: "Соединение потеряно",
  expired: "Сессия истекла",
};
const colors = ["#78e1bd", "#f8c76c", "#c3a4ff", "#7fceff"];
const marks = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ"];
function node(tag: string, text: string, cls = "") {
  const n = document.createElement(tag);
  n.textContent = text;
  n.className = cls;
  return n;
}
function playerCard(p: Player) {
  const card = node(
    "div",
    "",
    "player-card" + (p.id === store.id ? " self" : ""),
  );
  card.style.setProperty("--player-color", colors[p.slot]);
  const avatar = node("div", marks[p.slot], "avatar");
  const details = node("div", "", "player-details");
  const label = node("strong", p.name + (p.id === store.id ? " · вы" : ""));
  const status = node(
    "small",
    !p.connected
      ? "Нет связи"
      : !p.alive
        ? "Наблюдает"
        : "В поисках неприятностей",
  );
  const hp = node("div", "", "hp");
  const fill = node("i", "");
  fill.style.width = `${p.hp}%`;
  hp.append(fill);
  details.append(label, status, hp);
  const score = node("div", `${p.artifacts}/5`, "score");
  score.append(node("small", `${p.hp} HP`));
  card.append(avatar, details, score);
  return card;
}
let hudKey = "";
let feedKey = "";
let objectiveKey = "";
let centerKey = "";
let spectatorKey = "";
let lastRole = "";
let noticeUntil = 0;
function ui() {
  el("connection").textContent =
    `● ${connectionLabels[store.connection]}${store.connection === "connected" ? ` · ${store.latency} мс` : ""}`;
  el("connection").dataset.state = store.connection;
  const logged = !!store.id && !!store.snapshot;
  el("join").hidden = logged && !["lost", "expired"].includes(store.connection);
  if (store.error) el("error").textContent = store.error;
  el("reconnect").hidden =
    !logged ||
    !["reconnecting", "unstable", "lost", "expired"].includes(store.connection);
  el("reconnect").textContent =
    store.connection === "lost"
      ? store.error
      : "Восстанавливаем связь с экспедицией…";
  if (lastRole === "spectator" && store.role === "active")
    noticeUntil = Date.now() + 3500;
  lastRole = store.role;
  const s = store.snapshot;
  const ok = JSON.stringify([s?.required, store.self?.collected]);
  if (ok !== objectiveKey) {
    objectiveKey = ok;
    const list = el("objectives");
    list.replaceChildren();
    if (!s?.required.length)
      list.append(node("p", "Задание появится перед стартом."));
    for (const kind of s?.required ?? []) {
      const done = store.self?.collected.includes(kind);
      list.append(
        node(
          "div",
          `${done ? "✓" : "○"} ${itemLabel(kind)}`,
          done ? "objective done" : "objective",
        ),
      );
    }
  }
  const players = s?.players.filter((p) => p.slot >= 0) ?? [];
  el("count").textContent = `${players.length} / 4`;
  el("map-name").textContent = store.map?.name ?? "Неизведанная территория";
  el("round").textContent = s
    ? `Раунд ${store.roundID.toString().padStart(2, "0")}`
    : "Ожидание экспедиции";
  const remaining = Math.ceil(s?.remaining ?? 0);
  el("timer").textContent = s
    ? `${Math.floor(remaining / 60)
        .toString()
        .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`
    : "—:—";
  const pk = JSON.stringify(
    players.map((p) => [
      p.id,
      p.name,
      p.slot,
      p.hp,
      p.artifacts,
      p.alive,
      p.connected,
    ]),
  );
  if (pk !== hudKey) {
    hudKey = pk;
    el("players").replaceChildren(...players.map(playerCard));
    for (let i = players.length; i < 4; i++)
      el("players").append(
        node("div", `${marks[i]}   Место для будущей легенды`, "empty-slot"),
      );
  }
  const spec = logged && store.self?.role !== "active" && !store.result;
  const sk = JSON.stringify([
    spec,
    store.self?.alive,
    store.queue,
    store.target,
    players.filter((p) => p.alive).map((p) => p.id),
  ]);
  if (sk !== spectatorKey) {
    spectatorKey = sk;
    el("spectator").hidden = !spec;
    el("spectator").replaceChildren();
    if (spec) {
      el("spectator").append(
        node(
          "strong",
          store.self?.slot !== undefined &&
            store.self.slot >= 0 &&
            !store.self.alive
            ? "Вы погибли. Экспедиция продолжается."
            : `Вы наблюдаете${store.queue ? ` · очередь № ${store.queue}` : ""}`,
        ),
      );
      const buttons = node("div", "");
      for (const p of players.filter((p) => p.alive)) {
        const b = node(
          "button",
          p.name,
          p.id === store.target ? "selected" : "",
        );
        b.onclick = () => {
          store.target = p.id;
          network.send("spectate", { target: p.id });
        };
        buttons.append(b);
      }
      const overview = node("button", "Центр карты");
      overview.onclick = () => {
        store.target = "overview";
        network.send("spectate", { target: "" });
      };
      buttons.append(overview);
      el("spectator").append(buttons);
    }
  }
  const ck = JSON.stringify([
    s?.phase,
    store.roundID,
    store.map?.name,
    s?.required,
    remaining,
    store.result,
    input.menu,
    input.table,
    Date.now() < noticeUntil,
  ]);
  if (ck !== centerKey) {
    centerKey = ck;
    const center = el("center");
    center.replaceChildren();
    center.hidden = true;
    if (
      logged &&
      (store.result ||
        input.table ||
        input.menu ||
        s?.phase === "countdown" ||
        Date.now() < noticeUntil)
    ) {
      center.hidden = false;
      const panel = node("div", "", "panel");
      if (store.result) {
        const winner = players.find((p) => p.id === store.result?.winner);
        panel.append(
          node("div", "ЭКСПЕДИЦИЯ ЗАВЕРШЕНА", "eyebrow"),
          node(
            "h2",
            winner ? `${winner.name} — легенда!` : "Раунд без победителя",
          ),
          node(
            "p",
            (
              {
                collection_complete: "Все пять предметов задания собраны!",
                five_artifacts: "Пять находок. Ни одной полезной.",
                timeout: "Время истекло.",
                all_dead: "Все искатели погибли.",
              } as Record<string, string>
            )[store.result.reason] ?? store.result.reason,
          ),
        );
        const table = document.createElement("table");
        const head = document.createElement("tr");
        for (const title of ["Искатель", "◇", "PvP", "Монстры", "HP", "Статус"])
          head.append(node("th", title));
        table.append(head);
        for (const p of store.result.standings) {
          const tr = document.createElement("tr");
          for (const cell of [
            p.name,
            `${p.artifacts}`,
            `${p.pvpKills}`,
            `${p.monsterKills}`,
            `${p.hp}`,
            p.alive ? "Жив" : "Погиб",
          ])
            tr.append(node("td", cell));
          table.append(tr);
        }
        panel.append(table, node("p", `Следующий раунд через ${remaining} с`));
      } else if (input.menu) {
        panel.append(
          node("h2", "Привал без паузы"),
          node("p", "Мир продолжает жить. Esc — вернуться."),
        );
        const leave = node("button", "Покинуть экспедицию");
        leave.onclick = () => {
          network.stop();
          store.reset();
          store.connection = "idle";
          input.menu = false;
        };
        panel.append(leave);
      } else if (input.table) {
        panel.append(node("h2", "Участники экспедиции"));
        for (const p of players)
          panel.append(node("p", `${p.name} · ${p.artifacts}/5 · ${p.hp} HP`));
      } else if (s?.phase === "countdown") {
        panel.classList.add("countdown");
        panel.append(
          node("div", `РАУНД ${store.roundID}`, "eyebrow"),
          node("h2", store.map?.name ?? "Новая экспедиция"),
          node("p", "Соберите по одному предмету каждого вида:"),
          node(
            "div",
            (s.required ?? []).map(itemLabel).join(" · "),
            "round-objectives",
          ),
          node("div", "ЭКСПЕДИЦИЯ НАЧНЁТСЯ ЧЕРЕЗ", "eyebrow"),
          node("strong", `${remaining}`),
          node(
            "p",
            store.role === "active"
              ? "Вы играете в следующем раунде"
              : `Вы наблюдаете · очередь ${store.queue}`,
          ),
        );
      } else panel.append(node("p", "Вы играете в следующем раунде"));
      center.append(panel);
    }
  }
  const events = store.events
    .filter((e) =>
      [
        "artifact.collected",
        "medkit.collected",
        "damage",
        "player.died",
        "monster.died",
      ].includes(e.type),
    )
    .slice(-4);
  const ek = JSON.stringify(events.map((e) => e.id));
  if (ek !== feedKey) {
    feedKey = ek;
    el("feed").replaceChildren(
      ...events.reverse().map((e) => {
        const source =
          s?.players.find((p) => p.id === e.source)?.name ?? "Монстр";
        const target =
          s?.players.find((p) => p.id === e.target)?.name ?? "монстра";
        return node(
          "p",
          e.type === "artifact.collected"
            ? `◇ ${source} находит артефакт`
            : e.type === "medkit.collected"
              ? `✚ ${source} восстанавливает ${e.amount} HP`
              : e.type === "player.died"
                ? `✕ ${target} покидает бой`
                : e.type === "monster.died"
                  ? `✦ ${source} побеждает монстра`
                  : `⚔ ${source} → ${target}: ${e.amount}`,
        );
      }),
    );
  }
  el("debug").textContent = scene.debug;
}
const uiTimer = setInterval(ui, 100);
ui();
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(uiTimer);
    input.destroy();
    network.destroy();
    game.destroy(true);
  },
  { once: true },
);
