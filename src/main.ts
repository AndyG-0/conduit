import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function focusGrid() {
  document.querySelector<HTMLButtonElement>(".tile")?.focus();
}

window.addEventListener("DOMContentLoaded", () => {
  focusGrid();

  document.querySelectorAll<HTMLButtonElement>(".tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      void invoke("launch_app");
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.metaKey && e.key === "Enter") {
      e.preventDefault();
      void invoke("toggle_fullscreen");
      return;
    }

    // Native "Enter activates the focused button" behavior isn't reliably
    // delivered through a Tauri WebviewWindow, so trigger it explicitly.
    if (
      e.key === "Enter" &&
      document.activeElement?.classList.contains("tile")
    ) {
      e.preventDefault();
      (document.activeElement as HTMLButtonElement).click();
    }
  });

  void listen("return-to-grid", () => {
    focusGrid();
  });
});
