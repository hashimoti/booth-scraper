mod scraper;

use base64::{engine::general_purpose, Engine as _};
use scraper::{BoothItem, BoothScraper};
use std::fs;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn fetch_booth_item(url: String) -> Result<BoothItem, String> {
    let scraper = BoothScraper::new().map_err(|e| e.to_string())?;
    scraper.fetch(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_image(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let base64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", base64))
}

// ★修正箇所1: path 引数を追加し、固定パスを廃止
#[tauri::command]
async fn save_image(base64_data: String, path: String) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;
    
    // フロントエンドのダイアログで指定された path を使用する
    let path_buf = std::path::PathBuf::from(&path);
    fs::write(&path_buf, bytes).map_err(|e| e.to_string())?;

    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ★修正箇所2: .plugin(...) を追加して機能を有効化する
        .plugin(tauri_plugin_sql::Builder::default().build()) // SQLite用
        .plugin(tauri_plugin_dialog::init())                 // 保存ダイアログ用
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_booth_item,
            fetch_image,
            save_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}