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
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyJ");
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
          role: alive ? "active" : "spectator",
        },
        { ...player, id: "p2", name: "Рыцарь", slot: 1, x: 2700 },
      ],
      monsters: [],
      artifacts: [],
      result,
    });
  }
  await page.goto("/?debug");
  await page.locator("#name").fill("Гоблин");
  await page
    .getByRole("button", { name: "Отправиться за нелепостями" })
    .click();
  await expect(page.locator("#center")).toContainText("3");
  phase = "playing";
  snap();
  await expect.poll(() => inputs.length).toBeGreaterThan(0);
  await expect(page.locator("#debug")).toContainText("1/2 entities");
  await expect(page.locator("#count")).toContainText("2 / 4");
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
  currentMap = other;
  send("map", currentMap);
  snap();
  await expect(page.locator("#map-name")).toHaveText(other.name);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#center")).toContainText(
    "Вы играете в следующем раунде",
  );
});
