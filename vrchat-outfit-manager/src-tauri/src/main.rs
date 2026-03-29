#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//use tauri::Manager;
use serde::{Serialize, Deserialize};
use std::fs;
//use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose};
use scraper::{Html, Selector}; // 追加
use reqwest; // 追加

// --- データ構造定義 ---
#[derive(Serialize, Deserialize, Debug, Clone)]
struct BoothItem {
    id: i64,
    name: String,
    price: i32,
    price_str: String,
    shop_name: String,
    shop_url: String,
    thumbnail_url: Option<String>,
    image_urls: Vec<String>,
    description: String,
    booth_url: String,
    tags: Vec<String>,
}

// --- コマンド実装 ---

#[tauri::command]
async fn fetch_booth_item(url: String) -> Result<BoothItem, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let html = client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;

    let doc = Html::parse_document(&html);

    // --- メタタグから確実に抜く関数 ---
    let get_meta = |property: &str| {
        let sel = Selector::parse(&format!("meta[property='{}'], meta[name='{}']", property, property)).unwrap();
        doc.select(&sel).next().and_then(|e| e.value().attr("content")).map(|s| s.to_string())
    };

    let name = get_meta("og:title").unwrap_or_else(|| "商品名取得失敗".to_string());
    let thumbnail_url = get_meta("og:image");
    
    // 価格はメタタグにないので、クラス名から取得
    let price_sel = Selector::parse(".price-format, .item-price, [itemprop='price']").unwrap();
    let price_str = doc.select(&price_sel).next()
        .map(|e| e.text().collect::<String>().trim().to_string())
        .unwrap_or_else(|| "¥0".to_string());

    let price = price_str.replace(|c: char| !c.is_numeric(), "").parse::<i32>().unwrap_or(0);

    let id = url.split('/').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);

    Ok(BoothItem {
        id,
        name,
        price,
        price_str,
        shop_name: "Shop".to_string(), // 必要なら get_meta("og:site_name") 等
        shop_url: "".to_string(),
        thumbnail_url,
        image_urls: vec![],
        description: "".to_string(),
        booth_url: url,
        tags: vec![],
    })
}


#[tauri::command]
async fn fetch_image(url: String) -> Result<String, String> {
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_booth_item,
            save_image,
            fetch_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn save_image(base64_data: String, path: String) -> Result<String, String> { // ★path引数を追加
    let data = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;

    // 指定されたパスに直接書き込む
    fs::write(&path, data).map_err(|e| e.to_string())?;
    
    Ok(path)
}