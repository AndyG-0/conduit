import { renderGrid, focusGrid, hideTileBanner } from "./main";
import { keyboardShortcuts } from "./platform";

const grid = document.querySelector<HTMLElement>("#grid")!;
const panel = document.querySelector<HTMLElement>("#help")!;

const SHORTCUTS = keyboardShortcuts();

function renderHelp(): void {
  panel.innerHTML = `
    <div class="help-content">
      <div class="help-header">
        <h1>Help</h1>
        <button type="button" id="help-close">Back</button>
      </div>
      <section class="help-section">
        <h2>Keyboard shortcuts</h2>
        <table class="help-shortcuts">
          <tbody>
            ${SHORTCUTS.map(
              ([keys, desc]) => `
              <tr>
                <td><kbd>${keys}</kbd></td>
                <td>${desc}</td>
              </tr>
            `,
            ).join("")}
          </tbody>
        </table>
      </section>
      <section class="help-section">
        <h2>How tiles work</h2>
        <p>Each tile is its own isolated browser session — signing in on one
        service never shares cookies or storage with another. Add a custom
        service from Settings with just a name and base URL; a tile can always
        navigate within its own site. The "Additional allowed domains" field is
        only needed if a service's login or playback redirects to a different
        domain that breaks without it.</p>
        <p>By default a tile's icon is pulled from the site's own favicon.
        Use the "Icon override" field in Settings to pin a specific vendored
        icon instead.</p>
      </section>
    </div>
  `;

  panel
    .querySelector<HTMLButtonElement>("#help-close")!
    .addEventListener("click", () => {
      closeHelp();
    });
}

export function openHelp(): void {
  grid.hidden = true;
  panel.hidden = false;
  hideTileBanner();
  renderHelp();
}

export function closeHelp(): void {
  panel.hidden = true;
  grid.hidden = false;
  void renderGrid().then(focusGrid);
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden) {
    e.preventDefault();
    closeHelp();
  }
});
