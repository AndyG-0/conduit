import { renderGrid, focusGrid, hideTileBanner } from "./main";

const grid = document.querySelector<HTMLElement>("#grid")!;
const panel = document.querySelector<HTMLElement>("#help")!;

const SHORTCUTS: [string, string][] = [
  ["Arrow keys", "Move focus around the grid"],
  ["Enter", "Launch the focused tile"],
  ["E", "Enter edit mode on the focused tile (reorder or delete tiles)"],
  ["Arrow keys (editing)", "Move the grabbed tile"],
  ["Enter (editing)", "Grab or release the focused tile"],
  ["Delete / Backspace (editing)", "Remove the focused tile"],
  ["Escape (editing)", "Exit edit mode"],
  ["Cmd/Ctrl+Enter", "Toggle full screen"],
  ["Browser Back", "Return to the grid from a tile"],
  ["?", "Open this help panel"],
  ["Escape", "Close a panel (Settings or Help)"],
];

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
        <p>Launching a tile navigates this tab directly to the service's own
        site — there's no isolated session per tile, so signing in on one
        service uses the same browser cookies and storage as any other site
        you visit here. Add a custom service from Settings with just a name
        and base URL.</p>
        <p>To get back to Conduit, use your browser's Back button. Some
        sites push several pages of their own history before you reach
        anything — you may need to press Back more than once to land back on
        the grid.</p>
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
