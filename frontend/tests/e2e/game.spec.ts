import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const world = JSON.parse(readFileSync("../backend/maps/map-4.json", "utf8"));
const other = JSON.parse(readFileSync("../backend/maps/map-3.json", "utf8"));
const player = {
  id: "p1",
  name: "Гоблин",
  role: "active",
  slot: 0,
  x: 80,
  y: 54,
  w: 32,
  h: 46,
  hp: 100,
  artifacts: 0,
  collected: [],
  pvpKills: 0,
  monsterKills: 0,
  connected: true,
  alive: true,
  facing: 1,
  state: "idle",
  lastProcessedInputSeq: 0,
  queue: 0,
};
test("real backend connection and keyboard input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?debug");
  await page.screenshot({ path: "test-results/login.png", fullPage: true });
  await page
    .getByLabel("КАК ВАС ЗАПОМНЯТ ЛЕТОПИСЦЫ?")
    .fill(`Искатель${Date.now() % 10000}`);
  await page
    .getByRole("button", { name: "Отправиться за нелепостями" })
    .click();
  await expect(page.locator("#join")).toBeHidden();
  await expect(page.locator("#connection")).toContainText("В сети");
  await expect(page.locator("#players")).toContainText("вы");
  await page.waitForTimeout(3500);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyD");
  await page.keyboard.press("KeyW");
  await page.keyboard.press("Space");
  await page.screenshot({ path: "test-results/playing.png", fullPage: true });
  expect(errors).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(1);
});
test("mock lifecycle, death, results, map cleanup and viewport", async ({
  page,
}) => {
  const inputs: unknown[] = [];
  let tick = 1;
  let round = 1;
  let phase = "countdown";
  let hp = 100;
  let alive = true;
  let artifacts = 0;
  let collected: number[] = [];
  let medkitAvailable = true;
  let result: unknown = null;
  let currentMap = world;
  let send: (type: string, data: unknown) => void = () => {};
  await page.routeWebSocket("**/ws", (ws) => {
    send = (type, data) =>
      ws.send(
        JSON.stringify({
          protocolVersion: 1,
          type,
          roundID: round,
          serverTick: tick++,
          data,
        }),
      );
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "hello") {
        send("welcome", {
          playerID: "p1",
          token: "test-token",
          role: "active",
          queue: 0,
        });
        send("map", currentMap);
        snap();
      }
      if (m.type === "input") inputs.push(m);
      if (m.type === "ping") send("pong", { nonce: m.nonce });
    });
  });
  function snap() {
    send("snapshot", {
      phase,
      remaining: phase === "countdown" ? 3 : 100,
      players: [
        {
          ...player,
          hp,
          alive,
          artifacts,
          collected,
          role: alive ? "active" : "spectator",
        },
        { ...player, id: "p2", name: "Рыцарь", slot: 1, x: 2700 },
      ],
      monsters: [],
      artifacts: [],
      medkits: [
        { id: "h1", x: 200, y: 100, w: 24, h: 24, available: medkitAvailable },
      ],
      required: [0, 1, 2, 3, 4],
      result,
    });
  }
  await page.goto("/?debug");
  await page.locator("#name").fill("Гоблин");
  await page
    .getByRole("button", { name: "Отправиться за нелепостями" })
    .click();
  await expect(page.locator("#center")).toContainText("3");
  await expect(page.locator("#center h2")).toHaveText(world.name);
  await expect(page.locator(".round-objectives")).toContainText(
    "Башмак великана",
  );
  await expect(page.locator("#objectives .objective")).toHaveCount(5);
  await page.screenshot({
    path: "test-results/round-task.png",
    fullPage: true,
  });
  phase = "playing";
  snap();
  await expect.poll(() => inputs.length).toBeGreaterThan(0);
  await expect(page.locator("#debug")).toContainText("2/3 entities");
  await expect(page.locator("#count")).toContainText("2 / 4");
  collected = [0];
  artifacts = 1;
  hp = 80;
  medkitAvailable = false;
  send("medkit.collected", {
    id: 98,
    type: "medkit.collected",
    source: "p1",
    target: "h1",
    cause: "heal",
    amount: 50,
    serverTick: tick,
  });
  snap();
  await expect(page.locator("#objectives .done")).toHaveText(
    "✓ 🥾 Башмак великана",
  );
  await expect(page.locator("#feed")).toContainText("восстанавливает 50 HP");
  await expect(page.locator(".player-card.self")).toContainText("80 HP");
  hp = 0;
  alive = false;
  send("player.died", {
    id: 99,
    type: "player.died",
    source: "p2",
    target: "p1",
    cause: "melee",
    amount: 25,
    serverTick: tick,
  });
  snap();
  await expect(page.locator("#spectator")).toContainText("Вы погибли");
  const count = inputs.length;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(150);
  await page.keyboard.up("KeyD");
  expect(inputs.length).toBe(count);
  phase = "round_finished";
  result = {
    winner: "p2",
    reason: "five_artifacts",
    standings: [
      { ...player, hp, alive },
      { ...player, id: "p2", name: "Рыцарь", slot: 1, artifacts: 5 },
    ],
  };
  send("result", result);
  snap();
  await expect(page.locator("#center")).toContainText("Рыцарь — легенда!");
  result = {
    winner: "",
    reason: "timeout",
    standings: [{ ...player, hp, alive }],
  };
  send("result", result);
  snap();
  await expect(page.locator("#center")).toContainText("Раунд без победителя");
  round++;
  phase = "countdown";
  result = null;
  alive = true;
  hp = 100;
  artifacts = 0;
  collected = [];
  medkitAvailable = true;
  currentMap = other;
  send("map", currentMap);
  snap();
  await expect(page.locator("#map-name")).toHaveText(other.name);
  await expect(page.locator("#center h2")).toHaveText(other.name);
  await expect(page.locator("#center")).toContainText("РАУНД 2");
  await expect(page.locator("#objectives .done")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#center")).toContainText(
    "Вы играете в следующем раунде",
  );
});

test("reload clears identity and allows a different player", async ({
  page,
}) => {
  const handshakes: { type: string; name?: string }[] = [];
  await page.routeWebSocket("**/ws", (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (["hello", "resume"].includes(message.type)) {
        handshakes.push(message);
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            type: "welcome",
            roundID: 1,
            serverTick: 1,
            data: {
              playerID: "p1",
              token: "old-token",
              role: "active",
              queue: 0,
            },
          }),
        );
      }
    });
  });
  await page.goto("/");
  await page.locator("#name").fill("Первый");
  await page.locator("#join-form button").click();
  await expect.poll(() => handshakes.length).toBe(1);
  await page.reload();
  await expect(page.locator("#join")).toBeVisible();
  await expect(page.locator("#name")).toHaveValue("");
  await page.locator("#name").fill("Второй");
  await page.locator("#join-form button").click();
  await expect.poll(() => handshakes.length).toBe(2);
  expect(handshakes.map(({ type, name }) => ({ type, name }))).toEqual([
    { type: "hello", name: "Первый" },
    { type: "hello", name: "Второй" },
  ]);
});
