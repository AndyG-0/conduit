import { ApiError, authApi } from "./api-client";

/**
 * Full-screen passphrase gate shown before the grid can render. `needsSetup`
 * (from `GET /api/auth/status`) decides whether this is a first-run "set a
 * passphrase" form or a returning "enter the passphrase" login form — same
 * markup, different copy and endpoint.
 */
export function renderAuthView(
  root: HTMLElement,
  needsSetup: boolean,
  onAuthenticated: () => void,
): void {
  root.innerHTML = `
    <div class="auth-view">
      <form class="auth-form">
        <h1>Conduit</h1>
        <p class="auth-copy">${
          needsSetup
            ? "Set a passphrase to protect this Conduit server."
            : "Enter the passphrase to continue."
        }</p>
        <input
          type="password"
          name="passphrase"
          class="auth-input"
          placeholder="Passphrase"
          autocomplete="${needsSetup ? "new-password" : "current-password"}"
          minlength="8"
          required
          autofocus
        />
        <p class="auth-error" hidden></p>
        <button type="submit" class="auth-submit">
          ${needsSetup ? "Set passphrase" : "Log in"}
        </button>
      </form>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>(".auth-form")!;
  const input = root.querySelector<HTMLInputElement>(".auth-input")!;
  const errorEl = root.querySelector<HTMLParagraphElement>(".auth-error")!;
  const submitBtn = root.querySelector<HTMLButtonElement>(".auth-submit")!;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      const passphrase = input.value;
      if (needsSetup) {
        await authApi.setup(passphrase);
      } else {
        await authApi.login(passphrase);
      }
      onAuthenticated();
    } catch (err) {
      errorEl.textContent =
        err instanceof ApiError ? err.message : "Something went wrong.";
      errorEl.hidden = false;
      input.value = "";
      input.focus();
    } finally {
      submitBtn.disabled = false;
    }
  });
}
