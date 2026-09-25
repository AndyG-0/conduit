// Minimal GTK3 + WebKit2GTK-4.1 test harness for the Pi DRM spike.
//
// Loads a URL fullscreen with encrypted-media explicitly enabled via
// webkit_settings_set_enable_encrypted_media(), which is OFF by default
// in WebKitGTK and not turned on by Epiphany. This is what a Tauri app
// would need to do on Linux too (Tauri doesn't expose this WebKitSettings
// flag directly as of writing, so a real Tauri build would need the same
// raw webkit2gtk call via its window-creation hook). Build:
//
//   gcc $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1) eme-harness.c -o eme-harness
//
// Usage: ./eme-harness <url>

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

static void on_destroy(GtkWidget *widget, gpointer data) {
  gtk_main_quit();
}

int main(int argc, char *argv[]) {
  gtk_init(&argc, &argv);

  const char *url = argc > 1 ? argv[1] : "http://127.0.0.1:8899/probe.html";

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_fullscreen(GTK_WINDOW(window));
  g_signal_connect(window, "destroy", G_CALLBACK(on_destroy), NULL);

  WebKitWebView *webview = WEBKIT_WEB_VIEW(webkit_web_view_new());
  WebKitSettings *settings = webkit_web_view_get_settings(webview);

  webkit_settings_set_enable_encrypted_media(settings, TRUE);
  webkit_settings_set_enable_mediasource(settings, TRUE);
  webkit_settings_set_enable_webgl(settings, TRUE);
  webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
  webkit_settings_set_media_playback_requires_user_gesture(settings, FALSE);
  webkit_settings_set_enable_write_console_messages_to_stdout(settings, TRUE);

  g_print("enable-encrypted-media = %d\n", webkit_settings_get_enable_encrypted_media(settings));

  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(webview));
  webkit_web_view_load_uri(webview, url);

  gtk_widget_show_all(window);
  gtk_main();
  return 0;
}
