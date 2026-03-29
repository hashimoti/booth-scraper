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

const COLORS = ["#4a6cf7", "#e74c6f", "#1d9e75", "#f39c12", "#9b59b6", "#e67e22"];
const DB_PATH = "sqlite:outfit_manager.db";

function App() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<BoothItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [thumbSize, setThumbSize] = useState(120);
  
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
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
        if (savedItems.length > 0) {
          setItems(savedItems);
        }
      } catch (e) {
        console.error("Database init error:", e);
        setError("データベースの初期化に失敗しました。");
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
      const cached = await db.select<BoothItem[]>(
        "SELECT * FROM items WHERE booth_url = $1", 
        [url.trim()]
      );

      if (cached.length > 0) {
        const item = cached[0];
        setItems((prev) => prev.find((i) => i.id === item.id) ? prev : [...prev, item]);
      } else {
        const item = await invoke<BoothItem>("fetch_booth_item", { url: url.trim() });
        if (item.thumbnail_url) {
          const localUrl = await invoke<string>("fetch_image", { url: item.thumbnail_url });
          item.thumbnail_url = localUrl;
        }
        await db.execute(
          `INSERT INTO items (id, name, price, price_str, shop_name, shop_url, thumbnail_url, booth_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.id, item.name, item.price, item.price_str, item.shop_name, item.shop_url, item.thumbnail_url, item.booth_url]
        );
        setItems((prev) => [...prev, item]);
      }
      setUrl("");
    } catch (e) {
      setError("アイテム取得エラー: " + String(e));
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(itemId: number) {
    try {
      const db = await Database.load(DB_PATH);
      await db.execute("DELETE FROM items WHERE id = $1", [itemId]);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setPins((prev) => prev.filter((p) => p.itemId !== itemId));
      if (selectedItemId === itemId) setSelectedItemId(null);
    } catch (e) {
      setError("削除に失敗しました。");
    }
  }

  // --- ドラッグ操作の修正 ---
  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingPinId === null || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setPins((prev) =>
      prev.map((p) => (p.itemId === draggingPinId ? { ...p, x, y } : p))
    );
  };

  const handleMouseUp = () => {
    setDraggingPinId(null);
  };

  const handlePinMouseDown = (e: React.MouseEvent, itemId: number) => {
    e.stopPropagation(); // 親のクリックイベントを発火させない
    setDraggingPinId(itemId);
  };

  function onScreenshotClick(e: React.MouseEvent) {
    if (selectedItemId === null || draggingPinId !== null || !imgRef.current) return;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    setPins((prev) => {
      const filtered = prev.filter((p) => p.itemId !== selectedItemId);
      return [...filtered, { itemId: selectedItemId, x, y }];
    });
    setSelectedItemId(null);
  }

  // --- 画像書き出し ---
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
    if (!screenshot || pins.length === 0 || !imgRef.current) return;
    
    const filePath = await save({
      filters: [{ name: 'Image', extensions: ['png'] }],
      defaultPath: `VRC_Outfit_${Date.now()}.png`
    });
    if (!filePath) return;

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
      const borderWidth = 8 * scale;

      for (const pin of pins) {
        const item = items.find((i) => i.id === pin.itemId);
        if (!item || !item.thumbnail_url) continue;

        const color = COLORS[items.findIndex(i => i.id === item.id) % COLORS.length];
        const pinX = pin.x * canvas.width;
        const pinY = pin.y * canvas.height;
        const ix = pinX - exportThumbSize / 2;
        const iy = pinY - exportThumbSize / 2;

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 20 * scale;
        ctx.fillStyle = color;
        const r = 24 * scale;
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(ix - borderWidth, iy - borderWidth, exportThumbSize + borderWidth * 2, exportThumbSize + borderWidth * 2, r);
        ctx.fill();

        ctx.shadowBlur = 0;
        const img = await loadImage(item.thumbnail_url);
        ctx.save();
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(ix, iy, exportThumbSize, exportThumbSize, r - borderWidth);
        ctx.clip();
        ctx.drawImage(img, ix, iy, exportThumbSize, exportThumbSize);
        ctx.restore();
        ctx.restore();
      }

      const base64 = canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
      await invoke("save_image", { base64Data: base64, path: filePath });
      alert("画像を保存しました！");
    } catch (e) {
      setError("書き出し失敗: " + String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div 
      style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", fontFamily: "sans-serif", boxSizing: "border-box" }}
      onMouseMove={handleMouseMove} // ここでマウス移動を監視
      onMouseUp={handleMouseUp}     // ここでドラッグ終了
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>VRC Outfit Manager</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => fileInputRef.current?.click()} style={{ padding: "8px 16px", cursor: "pointer" }}>スクショ選択</button>
          <button 
            onClick={exportImage} 
            disabled={exporting || pins.length === 0}
            style={{ padding: "8px 24px", background: pins.length > 0 ? "#4a6cf7" : "#ccc", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
          >
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

      {error && <div style={{ color: "red", padding: "10px", background: "#fff0f0", marginBottom: "10px", borderRadius: "4px" }}>{error}</div>}

      <div style={{ marginBottom: "20px", background: "#f8f9fa", padding: "12px 20px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "20px", border: "1px solid #eee" }}>
        <label style={{ fontSize: "14px", fontWeight: "bold", color: "#555" }}>サムネイルサイズ:</label>
        <input 
          type="range" min="40" max="300" value={thumbSize} 
          onChange={(e) => setThumbSize(Number(e.target.value))} 
          style={{ flex: 1, cursor: "pointer" }}
        />
        <span style={{ fontSize: "14px", fontWeight: "bold", color: "#4a6cf7", minWidth: "50px" }}>{thumbSize}px</span>
      </div>

      {screenshot && (
        <div 
          ref={screenshotRef}
          onClick={onScreenshotClick}
          style={{ 
            position: "relative", 
            marginBottom: "30px", 
            borderRadius: "12px", 
            overflow: "hidden", 
            width: "100%",
            height: "70vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            background: "#000",
            margin: "0 auto 30px auto",
            userSelect: "none" // ドラッグ中にテキスト選択されないように
          }}
        >
          {/* 画像と同じサイズになるコンテナ */}
          <div style={{ position: "relative", display: "inline-block" }}>
            <img 
              ref={imgRef}
              src={screenshot} 
              style={{ maxWidth: "100%", maxHeight: "70vh", width: "auto", height: "auto", objectFit: "contain", display: "block" }} 
              draggable={false} 
            />
            
            {pins.map((pin) => {
              const item = items.find(i => i.id === pin.itemId);
              const color = COLORS[items.findIndex(i => i.id === pin.itemId) % COLORS.length];
              return (
                <div
                  key={pin.itemId}
                  onMouseDown={(e) => handlePinMouseDown(e, pin.itemId)}
                  style={{
                    position: "absolute",
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: `${thumbSize}px`,
                    height: `${thumbSize}px`, 
                    border: `4px solid ${color}`,
                    borderRadius: "12px",
                    overflow: "hidden",
                    cursor: draggingPinId === pin.itemId ? "grabbing" : "grab",
                    zIndex: draggingPinId === pin.itemId ? 100 : 10,
                    boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
                    background: "#333",
                    touchAction: "none" // ブラウザのデフォルト挙動を防止
                  }}
                >
                  {item?.thumbnail_url ? (
                    <img src={item.thumbnail_url} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} draggable={false} />
                  ) : (
                    <div style={{ color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "10px" }}>...</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", marginBottom: "30px", background: "#f5f5f5", padding: "15px", borderRadius: "8px" }}>
        <input 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          placeholder="BoothのURLを貼り付けてアイテムを追加" 
          style={{ flex: 1, padding: "10px", borderRadius: "4px", border: "1px solid #ddd" }}
          onKeyDown={(e) => e.key === "Enter" && fetchItem()}
        />
        <button onClick={fetchItem} disabled={loading} style={{ padding: "10px 20px", cursor: "pointer", background: "#4a6cf7", color: "#fff", border: "none", borderRadius: "4px" }}>
          {loading ? "取得中..." : "アイテム追加"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "20px" }}>
        {items.map((item) => (
          <div 
            key={item.id}
            onClick={() => setSelectedItemId(item.id)}
            style={{ 
              border: `3px solid ${selectedItemId === item.id ? COLORS[items.indexOf(item) % COLORS.length] : "#eee"}`,
              borderRadius: "10px", padding: "10px", position: "relative", cursor: "pointer", background: "#fff", transition: "transform 0.1s"
            }}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
              style={{ position: "absolute", top: -8, right: -8, width: "24px", height: "24px", borderRadius: "50%", border: "none", background: "#ff4d4f", color: "#fff", cursor: "pointer", fontWeight: "bold" }}
            >
              ×
            </button>
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} style={{ width: "100%", height: "120px", objectFit: "cover", borderRadius: "6px" }} />
            ) : (
              <div style={{ width: "100%", height: "120px", background: "#eee", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>No Image</div>
            )}
            <div style={{ fontSize: "13px", marginTop: "8px", fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
            <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>クリックして配置</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;