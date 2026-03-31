mod scraper;

use base64::{engine::general_purpose, Engine as _};
use scraper::{BoothItem, BoothScraper};

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
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or("image/png"))
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let base64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, base64))
}

#[tauri::command]
async fn save_image(base64_data: String, path: String) -> Result<String, String> {
    let clean_base64 = if let Some(index) = base64_data.find(',') {
        &base64_data[index + 1..]
    } else {
        &base64_data
    };

    let bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| e.to_string())?;

    let path_buf = std::path::PathBuf::from(&path);
    std::fs::write(&path_buf, bytes).map_err(|e| e.to_string())?;

    Ok(path)
}

#[tauri::command]
async fn save_image_bytes(bytes: Vec<u8>, path: String) -> Result<String, String> {
    let path_buf = std::path::PathBuf::from(&path);
    std::fs::write(&path_buf, bytes).map_err(|e| e.to_string())?;

    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_booth_item,
            fetch_image,
            save_image,
            save_image_bytes,
            save_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn save_text(content: String, path: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}
