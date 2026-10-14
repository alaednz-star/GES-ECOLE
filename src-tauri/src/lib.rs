//! Gestion École -- Windows desktop shell (ADR-010).
//!
//! The app's UI is the web app's client build, served locally (so it opens without internet).
//! It talks to Supabase with the signed-in user's session; the few server operations that need
//! the secret key go to the online server. This shell adds what a desktop app must do itself:
//!
//! - the window only ever shows the app: any other address (website, mailto:, sms:, WhatsApp)
//!   opens in the system's own application;
//! - downloads (CSV, Word) are saved to the Downloads folder and shown in Explorer.

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The app's own pages: the local origin Tauri serves on Windows, and the dev server.
fn is_app_url(url: &Url) -> bool {
    matches!(url.scheme(), "blob" | "data" | "about" | "tauri")
        || matches!(url.host_str(), Some("tauri.localhost") | Some("localhost"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let open_handle = handle.clone();
            let window_handle = handle.clone();
            let download_dir = handle.path().download_dir().ok();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Gestion École")
                .inner_size(1280.0, 820.0)
                .min_inner_size(1024.0, 700.0)
                .center()
                // Any other address leaves the app window and opens in the system browser / mail
                // / SMS / WhatsApp application.
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        return true;
                    }
                    let _ = open_handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                // target="_blank" and window.open: never a second app window.
                .on_new_window(move |url, _features| {
                    let _ = window_handle.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                })
                .on_download(move |webview, event| {
                    match event {
                        DownloadEvent::Requested { destination, .. } => {
                            if let (Some(dir), Some(name)) = (download_dir.as_ref(), destination.file_name()) {
                                *destination = dir.join(name);
                            }
                            true
                        }
                        DownloadEvent::Finished { path, success, .. } => {
                            if success {
                                if let Some(path) = path {
                                    let _ = webview.app_handle().opener().reveal_item_in_dir(path);
                                }
                            }
                            true
                        }
                        _ => true,
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gestion École");
}
