import { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

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

function App() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<BoothItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  
  // ドラッグ管理用
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLDivElement>(null);

  // --- アイテム操作 ---
  async function fetchItem() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const item = await invoke<BoothItem>("fetch_booth_item", { url });
      if (item.thumbnail_url) {
        const localUrl = await invoke<string>("fetch_image", { url: item.thumbnail_url });
        item.thumbnail_url = localUrl;
      }
      setItems((prev) => prev.find((i) => i.id === item.id) ? prev : [...prev, item]);
      setUrl("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function removeItem(itemId: number) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setPins((prev) => prev.filter((p) => p.itemId !== itemId));
    if (selectedItemId === itemId) setSelectedItemId(null);
  }

  // --- ドラッグ&ドロップ ロジック ---
  const handlePinMouseDown = (e: React.MouseEvent, itemId: number) => {
    e.stopPropagation();
    setDraggingPinId(itemId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingPinId === null || !screenshotRef.current) return;

    const rect = screenshotRef.current.getBoundingClientRect();
    // 0~1の範囲にクランプ（制限）
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setPins((prev) =>
      prev.map((p) => (p.itemId === draggingPinId ? { ...p, x, y } : p))
    );
  };

  const handleMouseUp = () => {
    setDraggingPinId(null);
  };

  // スクショをクリックして新規配置
  function onScreenshotClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selectedItemId === null || draggingPinId !== null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    setPins((prev) => {
      const filtered = prev.filter((p) => p.itemId !== selectedItemId);
      return [...filtered, { itemId: selectedItemId, x, y }];
    });
    setSelectedItemId(null);
  }

  // --- ヘルパー ---
  function getColor(itemId: number) {
    const idx = items.findIndex((i) => i.id === itemId);
    return COLORS[idx % COLORS.length] || COLORS[0];
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // --- 画像書き出し (Canvas) ---
  async function exportImage() {
    if (!screenshot || items.length === 0) return;
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const bg = await loadImage(screenshot);
      canvas.width = bg.width;
      canvas.height = bg.height;
      ctx.drawImage(bg, 0, 0);

      const scale = bg.width / 1920;
      const thumbSize = 400 * scale; 
      const borderWidth = 10 * scale;

      for (const pin of pins) {
        const item = items.find((i) => i.id === pin.itemId);
        if (!item || !item.thumbnail_url) continue;

        const color = getColor(item.id);
        const pinX = pin.x * canvas.width;
        const pinY = pin.y * canvas.height;
        const ix = pinX - thumbSize / 2;
        const iy = pinY - thumbSize / 2;

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 20 * scale;
        
        // 枠
        ctx.fillStyle = color;
        roundRect(ctx, ix - borderWidth, iy - borderWidth, thumbSize + borderWidth * 2, thumbSize + borderWidth * 2, 24 * scale);
        ctx.fill();

        // 画像
        ctx.shadowBlur = 0;
        const img = await loadImage(item.thumbnail_url);
        ctx.save();
        roundRect(ctx, ix, iy, thumbSize, thumbSize, 18 * scale);
        ctx.clip();
        ctx.drawImage(img, ix, iy, thumbSize, thumbSize);
        ctx.restore();
        ctx.restore();
      }

      const base64 = canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
      await invoke("save_image", { base64Data: base64 });
      alert("画像を保存しました！");
    } catch (e) {
      setError("エクスポート失敗: " + String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div 
      style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto", userSelect: draggingPinId !== null ? "none" : "auto" }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ヘッダー */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
        <h2>VRCコーデまとめ作成</h2>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => fileInputRef.current?.click()}>スクショ選択</button>
          <button 
            onClick={exportImage} 
            disabled={exporting || pins.length === 0}
            style={{ background: pins.length > 0 ? "#4a6cf7" : "#ccc", color: "#fff" }}
          >
            {exporting ? "保存中..." : "画像として保存"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const r = new FileReader();
            r.onload = (ev) => { setScreenshot(ev.target?.result as string); setPins([]); };
            r.readAsDataURL(file);
          }
        }} />
      </div>

      {/* メイン：スクショ表示エリア */}
      {screenshot && (
        <div 
          ref={screenshotRef}
          onClick={onScreenshotClick}
          style={{ position: "relative", marginBottom: "24px", borderRadius: "8px", overflow: "hidden", cursor: selectedItemId ? "crosshair" : "default" }}
        >
          <img src={screenshot} style={{ width: "100%", display: "block" }} draggable={false} />
          
          {pins.map((pin) => {
            const item = items.find(i => i.id === pin.itemId);
            return (
              <div
                key={pin.itemId}
                onMouseDown={(e) => handlePinMouseDown(e, pin.itemId)}
                style={{
                  position: "absolute",
                  left: `${pin.x * 100}%`,
                  top: `${pin.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: "120px", height: "120px", // プレビュー用の小さめサイズ
                  border: `3px solid ${getColor(pin.itemId)}`,
                  borderRadius: "8px",
                  overflow: "hidden",
                  cursor: "grab",
                  zIndex: draggingPinId === pin.itemId ? 100 : 10,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
                }}
              >
                <img src={item?.thumbnail_url || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
              </div>
            );
          })}
        </div>
      )}

      {/* アイテム追加フォーム */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <input 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          placeholder="BoothのURLを貼り付け" 
          style={{ flex: 1, padding: "8px" }}
        />
        <button onClick={fetchItem} disabled={loading}>{loading ? "取得中..." : "追加"}</button>
      </div>

      {/* アイテムリスト */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "15px" }}>
        {items.map((item, idx) => (
          <div 
            key={item.id}
            onClick={() => setSelectedItemId(item.id)}
            style={{ 
              border: `2px solid ${selectedItemId === item.id ? getColor(item.id) : "#eee"}`,
              borderRadius: "8px", padding: "8px", position: "relative", cursor: "pointer"
            }}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
              style={{ position: "absolute", top: -5, right: -5, borderRadius: "50%", border: "none", background: "red", color: "#fff", cursor: "pointer" }}
            >
              ×
            </button>
            <img src={item.thumbnail_url || ""} style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "4px" }} />
            <div style={{ fontSize: "12px", marginTop: "4px", fontWeight: "bold", overflow: "hidden", whiteSpace: "nowrap" }}>{item.name}</div>
            <div style={{ fontSize: "11px", color: "#666" }}>{idx + 1}: クリックして配置</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;