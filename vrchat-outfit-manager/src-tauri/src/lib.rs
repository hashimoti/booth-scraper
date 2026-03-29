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

#[tauri::command]
async fn save_image(base64_data: String) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;
    
    let path = std::path::PathBuf::from("/mnt/c/Users/hashi/Desktop/outfit.png");
    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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