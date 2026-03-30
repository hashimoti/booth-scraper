import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { save } from "@tauri-apps/plugin-dialog";

// --- 型定義 ---
interface BoothItem {
  id: number;
  name: string;
  price: number;
  price_str: string;
  shop_name: string;
  shop_url: string;
  thumbnail_url: string | null;
  image_urls: string[];
  description: string;
  booth_url: string;
  tags: string[];
}

interface Pin {
  itemId: number;
  x: number;
  y: number;
}

//const COLORS = ["#4a6cf7", "#e74c6f", "#1d9e75", "#f39c12", "#9b59b6", "#e67e22"];
const DB_PATH = "sqlite:outfit_manager.db";

function App() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<BoothItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [thumbSize, setThumbSize] = useState(120);
  
  // ★ 枠線の設定用ステート
  const [borderWidth, setBorderWidth] = useState(6);
  const [borderColor, setBorderColor] = useState("#4a6cf7");

  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check(); // GitHubを見に行って最新版があるか確認
        if (update) {
          // アップデートが見つかったらダイアログを出す
          const yes = await ask(
            `新しいバージョン (${update.version}) があります！\n今すぐダウンロードして再起動しますか？`, 
            { title: "アップデートのお知らせ", kind: "info" }
          );
          
          if (yes) {
            await update.downloadAndInstall(); // ダウンロード＆上書きインストール
            await relaunch(); // アプリを自動再起動
          }
        }
      } catch (error) {
        console.error("アップデート確認エラー:", error);
      }
    }

    checkForUpdates();
    async function init() {
      try {
        const db = await Database.load(DB_PATH);
        await db.execute(`
          CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY,
            name TEXT,
            price INTEGER,
            price_str TEXT,
            shop_name TEXT,
            shop_url TEXT,
            thumbnail_url TEXT,
            booth_url TEXT UNIQUE
          )
        `);
        const savedItems = await db.select<BoothItem[]>("SELECT * FROM items");
        if (savedItems.length > 0) setItems(savedItems);
      } catch (e) {
        setError("データベース初期化エラー");
      }
    }
    init();
  }, []);

  async function fetchItem() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const db = await Database.load(DB_PATH);
      const cached = await db.select<BoothItem[]>("SELECT * FROM items WHERE booth_url = $1", [url.trim()]);
      if (cached.length > 0) {
        const item = cached[0];
        setItems((prev) => prev.find((i) => i.id === item.id) ? prev : [...prev, item]);
      } else {
        const item = await invoke<BoothItem>("fetch_booth_item", { url: url.trim() });
        if (item.thumbnail_url) {
          item.thumbnail_url = await invoke<string>("fetch_image", { url: item.thumbnail_url });
        }
        await db.execute(
          `INSERT INTO items (id, name, price, price_str, shop_name, shop_url, thumbnail_url, booth_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.id, item.name, item.price, item.price_str, item.shop_name, item.shop_url, item.thumbnail_url, item.booth_url]
        );
        setItems((prev) => [...prev, item]);
      }
      setUrl("");
    } catch (e) {
      setError("取得エラー: " + String(e));
    } finally {
      setLoading(false);
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingPinId === null || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setPins((prev) => prev.map((p) => (p.itemId === draggingPinId ? { ...p, x, y } : p)));
  };

  const onScreenshotClick = (e: React.MouseEvent) => {
    if (selectedItemId === null || draggingPinId !== null || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPins((prev) => [...prev.filter((p) => p.itemId !== selectedItemId), { itemId: selectedItemId, x, y }]);
    setSelectedItemId(null);
  };

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function exportImage() {
    console.log("保存処理開始...");
    if (!screenshot || pins.length === 0 || !imgRef.current) return;
    const filePath = await save({ filters: [{ name: 'Image', extensions: ['png'] }], defaultPath: `VRC_Outfit_${Date.now()}.png` });
    if (!filePath) {
      console.log("キャンセルされました");
      return;
    }
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const bg = await loadImage(screenshot);
      canvas.width = bg.width;
      canvas.height = bg.height;
      ctx.drawImage(bg, 0, 0);

      const scale = bg.width / imgRef.current.clientWidth;
      const exportThumbSize = thumbSize * scale;
      const finalBorderWidth = borderWidth * scale;
      const borderRadius = exportThumbSize * 0.15;

      for (const pin of pins) {
        const item = items.find((i) => i.id === pin.itemId);
        if (!item || !item.thumbnail_url) continue;

        const pinX = pin.x * canvas.width;
        const pinY = pin.y * canvas.height;
        const ix = pinX - exportThumbSize / 2;
        const iy = pinY - exportThumbSize / 2;

        ctx.save();
        if (finalBorderWidth > 0) {
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = finalBorderWidth * 2;
          ctx.fillStyle = borderColor;
          ctx.beginPath();
          // @ts-ignore
          ctx.roundRect(ix - finalBorderWidth, iy - finalBorderWidth, exportThumbSize + finalBorderWidth * 2, exportThumbSize + finalBorderWidth * 2, borderRadius + finalBorderWidth);
          ctx.fill();
        }

        const img = await loadImage(item.thumbnail_url);
        ctx.save();
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(ix, iy, exportThumbSize, exportThumbSize, borderRadius);
        ctx.clip();
        ctx.drawImage(img, ix, iy, exportThumbSize, exportThumbSize);
        ctx.restore();
        ctx.restore();
      }
      const base64Full = canvas.toDataURL("image/png");
      // カンマの位置を探して、それ以降だけを切り出す（JS側でも掃除する）
      const base64Clean = base64Full.split(',')[1]; 
      await invoke("save_image", { base64Data: base64Clean, path: filePath });
      alert("保存しました！");
    } catch (e) {
      console.error("Rust通信エラー:", e);
      setError("書き出し失敗: " + String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", fontFamily: "sans-serif" }} onMouseMove={handleMouseMove} onMouseUp={() => setDraggingPinId(null)}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>VRC Outfit Manager</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => fileInputRef.current?.click()} style={{ padding: "8px 16px", cursor: "pointer" }}>スクショ選択</button>
          <button onClick={exportImage} disabled={exporting || pins.length === 0} style={{ padding: "8px 24px", background: "#4a6cf7", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
            {exporting ? "書き出し中..." : "画像として保存"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" hidden accept="image/*" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const r = new FileReader();
            r.onload = (ev) => { setScreenshot(ev.target?.result as string); setPins([]); };
            r.readAsDataURL(file);
          }
        }} />
      </div>

      <div style={{ marginBottom: "20px", background: "#f8f9fa", padding: "15px", borderRadius: "8px", border: "1px solid #eee", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>アイテムサイズ:</label>
          <input type="range" min="40" max="300" value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{thumbSize}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>枠線の太さ:</label>
          <input type="range" min="0" max="20" value={borderWidth} onChange={(e) => setBorderWidth(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{borderWidth}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>枠線の色:</label>
          <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} style={{ width: "50px", height: "30px", border: "none", cursor: "pointer" }} />
          <span>{borderColor}</span>
        </div>
      </div>

      {screenshot && (
        <div onClick={onScreenshotClick} style={{ position: "relative", marginBottom: "30px", borderRadius: "12px", overflow: "hidden", height: "70vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <img ref={imgRef} src={screenshot} style={{ maxWidth: "100%", maxHeight: "70vh" }} draggable={false} />
            {pins.map((pin) => {
              const item = items.find(i => i.id === pin.itemId);
              return (
                <div key={pin.itemId} onMouseDown={(e) => { e.stopPropagation(); setDraggingPinId(pin.itemId); }}
                  style={{
                    position: "absolute", left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, transform: "translate(-50%, -50%)",
                    width: thumbSize, height: thumbSize, border: `${borderWidth}px solid ${borderColor}`,
                    borderRadius: "12px", overflow: "hidden", cursor: "grab", zIndex: 10, boxShadow: "0 4px 15px rgba(0,0,0,0.3)"
                  }}>
                  <img src={item?.thumbnail_url || ""} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", marginBottom: "30px" }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="BoothのURLを貼り付け" style={{ flex: 1, padding: "10px", borderRadius: "4px", border: "1px solid #ddd" }} onKeyDown={(e) => e.key === "Enter" && fetchItem()} />
        <button onClick={fetchItem} disabled={loading} style={{ padding: "10px 20px", background: "#4a6cf7", color: "#fff", border: "none", borderRadius: "4px" }}>追加</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "20px" }}>
        {items.map((item) => (
          <div key={item.id} onClick={() => setSelectedItemId(item.id)} style={{ border: `3px solid ${selectedItemId === item.id ? borderColor : "#eee"}`, borderRadius: "10px", padding: "10px", cursor: "pointer", background: "#fff" }}>
            <img src={item.thumbnail_url || ""} style={{ width: "100%", height: "120px", objectFit: "cover", borderRadius: "6px" }} />
            <div style={{ fontSize: "13px", marginTop: "8px", fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;