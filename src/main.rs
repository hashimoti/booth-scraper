use booth_scraper::BoothScraper;
 
#[tokio::main]
async fn main() {
    // コマンドライン引数からURLを受け取る
    let url = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("使い方: booth-scraper <Booth URL>");
        eprintln!("例:     booth-scraper https://booth.pm/ja/items/1234567");
        std::process::exit(1);
    });

    println!("取得中: {url}");

    let scraper = BoothScraper::new().expect("クライアント初期化失敗");

    match scraper.fetch(&url).await {
        Ok(item) => {
            println!("\n=== 取得結果 ===");
            println!("商品名     : {}", item.name);
            println!("価格       : {}", item.price_str);
            println!("ショップ   : {}", item.shop_name);
            println!("サムネイル : {:?}", item.thumbnail_url);
            println!("画像枚数   : {}", item.image_urls.len());
            println!("タグ       : {:?}", item.tags);
            println!("説明       : {}…", &item.description.chars().take(80).collect::<String>());

            // JSON出力
            let json = serde_json::to_string_pretty(&item).unwrap();
            println!("\n=== JSON ===\n{json}");
        }
        Err(e) => {
            eprintln!("エラー: {e}");
            std::process::exit(1);
        }
    }
}
