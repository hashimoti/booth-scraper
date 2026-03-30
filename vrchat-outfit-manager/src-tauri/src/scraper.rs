use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ----------------------------------------------------------------
// エラー型
// ----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ScraperError {
    #[error("HTTPリクエスト失敗: {0}")]
    Http(#[from] reqwest::Error),

    #[error("無効なBooth URL: {0}")]
    InvalidUrl(String),

    #[error("ページのパースに失敗: {0}")]
    ParseError(String),
}

// ----------------------------------------------------------------
// データ型
// ----------------------------------------------------------------

/// Boothから取得したアイテム情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothItem {
    /// Booth商品ID
    pub id: u64,
    /// 商品名
    pub name: String,
    /// 価格（円）。無料の場合は0
    pub price: u64,
    /// 通貨表示文字列 例: "¥2,200"
    pub price_str: String,
    /// ショップ名
    pub shop_name: String,
    /// ショップURL
    pub shop_url: String,
    /// サムネイル画像URL（最初の1枚）
    pub thumbnail_url: Option<String>,
    /// 全画像URLリスト
    pub image_urls: Vec<String>,
    /// 商品説明（先頭200文字）
    pub description: String,
    /// 元のBooth URL
    pub booth_url: String,
    /// カテゴリタグ
    pub tags: Vec<String>,
}

// ----------------------------------------------------------------
// URLバリデーション
// ----------------------------------------------------------------

/// Booth URLから商品IDを抽出する
///
/// 対応フォーマット:
///   https://booth.pm/ja/items/1234567
///   https://username.booth.pm/items/1234567
pub fn extract_item_id(url: &str) -> Result<u64, ScraperError> {
    let url = url.trim();

    // /items/NNNN のパターンを探す
    let marker = "/items/";
    let pos = url
        .find(marker)
        .ok_or_else(|| ScraperError::InvalidUrl(format!("'/items/' が見つかりません: {url}")))?;

    let after = &url[pos + marker.len()..];
    // クエリパラメータやスラッシュの前まで
    let id_str = after
        .split(|c| c == '?' || c == '#' || c == '/')
        .next()
        .unwrap_or("");

    id_str
        .parse::<u64>()
        .map_err(|_| ScraperError::InvalidUrl(format!("商品IDが数値ではありません: '{id_str}'")))
}

/// 商品IDをBooth公式URLに正規化する
pub fn normalize_url(url: &str) -> Result<String, ScraperError> {
    let id = extract_item_id(url)?;
    Ok(format!("https://booth.pm/ja/items/{id}"))
}

// ----------------------------------------------------------------
// スクレイパー本体
// ----------------------------------------------------------------

pub struct BoothScraper {
    client: reqwest::Client,
}

impl BoothScraper {
    pub fn new() -> Result<Self, ScraperError> {
        let client = reqwest::Client::builder()
            // Boothが返す日本語ページを取得するためのヘッダ
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                         AppleWebKit/537.36 (KHTML, like Gecko) \
                         Chrome/124.0.0.0 Safari/537.36",
            )
            .default_headers({
                let mut h = reqwest::header::HeaderMap::new();
                h.insert(
                    reqwest::header::ACCEPT_LANGUAGE,
                    "ja,en-US;q=0.9,en;q=0.8".parse().unwrap(),
                );
                h
            })
            .build()?;

        Ok(Self { client })
    }

    /// Booth URLからアイテム情報を取得する（非同期版）
    pub async fn fetch(&self, url: &str) -> Result<BoothItem, ScraperError> {
        let canonical = normalize_url(url)?;
        let id = extract_item_id(url)?;

        let html = self
            .client
            .get(&canonical)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        parse_item_page(&html, id, &canonical)
    }
}

// ----------------------------------------------------------------
// HTMLパーサー
// ----------------------------------------------------------------

fn parse_item_page(html: &str, id: u64, booth_url: &str) -> Result<BoothItem, ScraperError> {
    let doc = Html::parse_document(html);

    // ---------- 商品名 ----------
    let name = first_text(
        &doc,
        // og:title メタタグを優先
        &["meta[property='og:title']", "h2.u-tpg-title1"],
        true,
    )
    .ok_or_else(|| ScraperError::ParseError("商品名が見つかりません".into()))?;

    // ---------- 価格 ----------
    // Boothの価格要素: <span class="price"> ¥2,200 </span>
    // 無料配布の場合 "無料" と表示されることもある
    let price_str = first_text(&doc, &["span.price", "[class*='price']"], false)
        .unwrap_or_else(|| "¥0".to_string());
    let price = parse_price(&price_str);

    // ---------- ショップ情報 ----------
    let shop_name = first_text(
        &doc,
        &[
            "a.u-tpg-title2[href*='booth.pm']",
            ".shop-name",
            "a[class*='shop']",
        ],
        false,
    )
    .unwrap_or_else(|| "不明なショップ".to_string());

    let shop_url = attr_val(
        &doc,
        "a.u-tpg-title2[href*='booth.pm'], a[class*='shop'][href*='booth.pm']",
        "href",
    )
    .unwrap_or_default();

    // ---------- 画像 ----------
    // og:image を最初の1枚として取得し、その後 img[data-src] や img[src] で残りを取る
    let og_image = attr_val(&doc, "meta[property='og:image']", "content");

    let mut image_urls: Vec<String> = Vec::new();

    // ギャラリー画像（data-original or src）
    let img_sel = Selector::parse(
        "li.item-thumb img[data-original], \
         .item-slideshow img[data-original], \
         .item-image img",
    )
    .unwrap();
    for el in doc.select(&img_sel) {
        let src = el
            .value()
            .attr("data-original")
            .or_else(|| el.value().attr("src"))
            .unwrap_or_default();
        let src = strip_query(src);
        if !src.is_empty() && !image_urls.contains(&src) {
            image_urls.push(src);
        }
    }

    // og:image がリストになければ先頭に追加
    if let Some(og) = og_image {
        let og = strip_query(&og);
        if !image_urls.contains(&og) {
            image_urls.insert(0, og);
        }
    }

    let thumbnail_url = image_urls.first().cloned();

    // ---------- 説明文 ----------
    let description = first_text(
        &doc,
        &[
            "meta[name='description']",
            "meta[property='og:description']",
            ".description",
        ],
        true,
    )
    .unwrap_or_default()
    .chars()
    .take(200)
    .collect::<String>();

    // ---------- タグ ----------
    let tag_sel = Selector::parse("a[href*='/tags/'], .tag").unwrap();
    let tags: Vec<String> = doc
        .select(&tag_sel)
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    Ok(BoothItem {
        id,
        name,
        price,
        price_str,
        shop_name,
        shop_url,
        thumbnail_url,
        image_urls,
        description,
        booth_url: booth_url.to_string(),
        tags,
    })
}

// ----------------------------------------------------------------
// ユーティリティ
// ----------------------------------------------------------------

/// セレクタリストを順番に試し、最初にヒットした要素のテキストを返す
fn first_text(doc: &Html, selectors: &[&str], is_meta: bool) -> Option<String> {
    for sel_str in selectors {
        let Ok(sel) = Selector::parse(sel_str) else {
            continue;
        };
        if let Some(el) = doc.select(&sel).next() {
            let text = if is_meta && el.value().name() == "meta" {
                el.value().attr("content").unwrap_or("").to_string()
            } else {
                el.text().collect::<String>()
            };
            let text = text.trim().to_string();
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

/// 属性値を取得する
fn attr_val(doc: &Html, selector: &str, attr: &str) -> Option<String> {
    let sel = Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .and_then(|el| el.value().attr(attr))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// "¥2,200" や "2200" などから数値を取り出す
fn parse_price(s: &str) -> u64 {
    s.chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

/// 画像URLからクエリパラメータを除去してキャッシュキーを安定させる
fn strip_query(url: &str) -> String {
    url.split('?').next().unwrap_or(url).to_string()
}

// ----------------------------------------------------------------
// テスト
// ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_id_official() {
        assert_eq!(
            extract_item_id("https://booth.pm/ja/items/1234567").unwrap(),
            1234567
        );
    }

    #[test]
    fn test_extract_id_shop_subdomain() {
        assert_eq!(
            extract_item_id("https://myshop.booth.pm/items/9876543").unwrap(),
            9876543
        );
    }

    #[test]
    fn test_extract_id_with_query() {
        assert_eq!(
            extract_item_id("https://booth.pm/ja/items/111?ref=top").unwrap(),
            111
        );
    }

    #[test]
    fn test_extract_id_invalid() {
        assert!(extract_item_id("https://example.com/not-booth").is_err());
    }

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            normalize_url("https://myshop.booth.pm/items/42").unwrap(),
            "https://booth.pm/ja/items/42"
        );
    }

    #[test]
    fn test_parse_price() {
        assert_eq!(parse_price("¥2,200"), 2200);
        assert_eq!(parse_price("無料"), 0);
        assert_eq!(parse_price("500"), 500);
    }
}
