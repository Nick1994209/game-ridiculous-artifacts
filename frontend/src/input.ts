import type { Buttons } from "./protocol";
import type { Store } from "./state";
import type { Network } from "./network";
export class InputController {
  keys = new Set<string>();
  timer: ReturnType<typeof setInterval>;
  menu = false;
  table = false;
  constructor(
    public store: Store,
    public network: Network,
  ) {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
    this.timer = setInterval(() => {
      if (store.canInput) {
        network.send("input", { input: store.input.push(this.buttons) });
      } else this.keys.clear();
    }, 1000 / 30);
  }
  get buttons(): Buttons {
    return {
      left: this.keys.has("KeyA") || this.keys.has("ArrowLeft"),
      right: this.keys.has("KeyD") || this.keys.has("ArrowRight"),
      jump:
        this.keys.has("KeyW") ||
        this.keys.has("ArrowUp") ||
        this.keys.has("Space"),
      attack: this.keys.has("KeyJ") || this.keys.has("KeyX"),
    };
  }
  down = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "Tab"].includes(e.code))
      e.preventDefault();
    if (e.repeat) return;
    if (e.code === "Escape") {
      this.menu = !this.menu;
      this.keys.clear();
      return;
    }
    if (e.code === "Tab") this.table = true;
    if (!this.menu) this.keys.add(e.code);
  };
  up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "Tab") this.table = false;
  };
  blur = () => {
    this.keys.clear();
    this.table = false;
  };
  destroy() {
    clearInterval(this.timer);
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
  }
}
