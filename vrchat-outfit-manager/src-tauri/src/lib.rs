//lib.rs
mod scraper;

use base64::{engine::general_purpose, Engine as _};
use scraper::{BoothItem, BoothScraper};
//use std::fs;

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

// 引数名を JS 側の invoke に合わせて base64Data に変更
#[tauri::command]
#[allow(non_snake_case)]
async fn save_image(base64Data: String, path: String) -> Result<String, String> {
    // ★ ここが超重要！「base64Data」ではなく「clean_base64」を decode に渡していますか？
    let clean_base64 = if let Some(index) = base64Data.find(',') {
        &base64Data[index + 1..]
    } else {
        &base64Data
    };

    // ❌ decode(&base64Data) だとエラーになります
    // ✅ decode(clean_base64) になっている必要があります
    let bytes = general_purpose::STANDARD
        .decode(clean_base64) // ここを確認！
        .map_err(|e| e.to_string())?;
    
    let path_buf = std::path::PathBuf::from(&path);
    std::fs::write(&path_buf, bytes).map_err(|e| e.to_string())?;

    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build()) // ★追加
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
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