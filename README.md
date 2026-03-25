# booth-scraper

VRChat改変アイテム管理アプリ用のBoothスクレイパー（Phase 1）。

## 機能

- Booth URLから商品名・価格・ショップ名・画像URLを取得
- `https://booth.pm/ja/items/XXXXX` と `https://ショップ名.booth.pm/items/XXXXX` の両形式に対応
- 取得結果をJSON形式で出力（Phase 2でTauri連携する際にそのまま使用）

## 前提条件

```
rustup（Rust 1.75以降）
```

## ビルド・実行

```bash
# ビルド
cargo build --release

# 実行（URLを指定）
cargo run -- https://booth.pm/ja/items/1234567

# テスト実行
cargo test
```

## 取得できるデータ

```json
{
  "id": 1234567,
  "name": "商品名",
  "price": 2200,
  "price_str": "¥2,200",
  "shop_name": "ショップ名",
  "shop_url": "https://myshop.booth.pm",
  "thumbnail_url": "https://booth.pximg.net/...",
  "image_urls": ["https://booth.pximg.net/..."],
  "description": "商品説明文（先頭200文字）",
  "booth_url": "https://booth.pm/ja/items/1234567",
  "tags": ["VRChat", "衣装"]
}
```

## Tauriへの組み込み方（Phase 2）

このクレートをTauriプロジェクトの `src-tauri/` 配下に配置し、
`Cargo.toml` のworkspaceメンバーとして追加してください。

Tauriコマンドとして公開する例：

```rust
// src-tauri/src/main.rs
use booth_scraper::{BoothScraper, BoothItem, ScraperError};

#[tauri::command]
async fn fetch_booth_item(url: String) -> Result<BoothItem, String> {
    let scraper = BoothScraper::new().map_err(|e| e.to_string())?;
    scraper.fetch(&url).await.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_booth_item])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

React側からの呼び出し例：

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { BoothItem } from "./types";

const item = await invoke<BoothItem>("fetch_booth_item", {
  url: "https://booth.pm/ja/items/1234567",
});
```

## 注意事項

- Boothの利用規約の範囲内で使用してください
- 大量リクエストはサーバー負荷になるため、取得結果はSQLiteにキャッシュする（Phase 2で実装）
- BoothのHTML構造が変更された場合はセレクタの更新が必要になる場合があります
