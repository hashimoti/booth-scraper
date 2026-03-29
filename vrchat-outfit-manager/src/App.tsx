import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
  x: number; // スクショ上の位置（割合 0~1）
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLDivElement>(null);

  async function fetchItem() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const item = await invoke<BoothItem>("fetch_booth_item", { url });
      if (item.thumbnail_url) {
        const localUrl = await invoke<string>("fetch_image", {
          url: item.thumbnail_url,
        });
        item.thumbnail_url = localUrl;
      }
      setItems((prev) => {
        if (prev.find((i) => i.id === item.id)) return prev;
        return [...prev, item];
      });
      setUrl("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function onScreenshotSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScreenshot(ev.target?.result as string);
      setPins([]);
    };
    reader.readAsDataURL(file);
  }

  function onScreenshotClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selectedItemId === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPins((prev) => {
      const filtered = prev.filter((p) => p.itemId !== selectedItemId);
      return [...filtered, { itemId: selectedItemId, x, y }];
    });
    setSelectedItemId(null);
  }

  function getColor(itemId: number) {
    const idx = items.findIndex((i) => i.id === itemId);
    return COLORS[idx % COLORS.length];
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
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

  async function exportImage() {
    if (!screenshot || items.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const bg = await loadImage(screenshot);
      canvas.width = bg.width;
      canvas.height = bg.height;
      ctx.drawImage(bg, 0, 0);

      const itemSize = 90;
      const itemGap = 10;
      const panelPadding = 14;
      const labelHeight = 32;
      const cols = Math.min(items.length, 4);
      const panelW = cols * (itemSize + itemGap) - itemGap + panelPadding * 2;
      const panelH = itemSize + labelHeight + panelPadding * 2;
      const panelX = canvas.width - panelW - 24;
      const panelY = canvas.height - panelH - 24;

      // パネル背景
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      roundRect(ctx, panelX, panelY, panelW, panelH, 14);
      ctx.fill();

      for (let i = 0; i < Math.min(items.length, 4); i++) {
        const item = items[i];
        const color = COLORS[i % COLORS.length];
        const ix = panelX + panelPadding + i * (itemSize + itemGap);
        const iy = panelY + panelPadding;

        // アイテム画像
        if (item.thumbnail_url) {
          const img = await loadImage(item.thumbnail_url);
          ctx.save();
          roundRect(ctx, ix, iy, itemSize, itemSize, 8);
          ctx.clip();
          ctx.drawImage(img, ix, iy, itemSize, itemSize);
          ctx.restore();
        }

        // カラーボーダー
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        roundRect(ctx, ix, iy, itemSize, itemSize, 8);
        ctx.stroke();

        // アイテム名
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        const name = item.name.length > 10 ? item.name.slice(0, 10) + "…" : item.name;
        ctx.fillText(name, ix + itemSize / 2, iy + itemSize + 14);

        // 価格
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "10px sans-serif";
        ctx.fillText(item.price_str, ix + itemSize / 2, iy + itemSize + 28);

        // ピンがある場合は引き出し線を描画
        const pin = pins.find((p) => p.itemId === item.id);
        if (pin) {
          const pinX = pin.x * canvas.width;
          const pinY = pin.y * canvas.height;
          const targetX = ix + itemSize / 2;
          const targetY = iy;

          // 引き出し線
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(pinX, pinY);
          ctx.lineTo(targetX, targetY);
          ctx.stroke();
          ctx.setLineDash([]);

          // ピン丸
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pinX, pinY, 8, 0, Math.PI * 2);
          ctx.fill();

          // ピン中央に番号
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(String(i + 1), pinX, pinY + 4);
        }
      }

      const base64 = canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
      await invoke("save_image", { base64Data: base64 });
      alert("画像を保存しました！");
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ padding: "24px", fontFamily: "sans-serif", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>コーデまとめ</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => fileInputRef.current?.click()}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer" }}>
            スクショを選択
          </button>
          <button onClick={exportImage} disabled={exporting || items.length === 0 || !screenshot}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer", background: (items.length > 0 && screenshot) ? "#4a6cf7" : "#eee", color: (items.length > 0 && screenshot) ? "#fff" : "#aaa" }}>
            {exporting ? "書き出し中..." : "画像として保存"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onScreenshotSelect} />
      </div>

      {error && <div style={{ color: "red", marginBottom: "16px", fontSize: "14px" }}>{error}</div>}

      {selectedItemId !== null && (
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "8px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#856404" }}>
          スクショ上の該当部位をクリックしてください
        </div>
      )}

      {screenshot && (
        <div ref={screenshotRef} onClick={onScreenshotClick}
          style={{ position: "relative", marginBottom: "20px", borderRadius: "12px", overflow: "hidden", cursor: selectedItemId !== null ? "crosshair" : "default" }}>
          <img src={screenshot} alt="スクショ" style={{ width: "100%", display: "block" }} />
          {pins.map((pin) => (
            <div key={pin.itemId} style={{
              position: "absolute",
              left: `calc(${pin.x * 100}% - 10px)`,
              top: `calc(${pin.y * 100}% - 10px)`,
              width: "20px", height: "20px",
              background: getColor(pin.itemId),
              borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", fontWeight: "bold", color: "#fff",
              pointerEvents: "none",
            }}>
              {items.findIndex((i) => i.id === pin.itemId) + 1}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://booth.pm/ja/items/..."
          style={{ flex: 1, padding: "8px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid #ccc" }}
          onKeyDown={(e) => e.key === "Enter" && fetchItem()} />
        <button onClick={fetchItem} disabled={loading}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer" }}>
          {loading ? "取得中..." : "取得"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
        {items.map((item, idx) => {
          const color = COLORS[idx % COLORS.length];
          const isSelected = selectedItemId === item.id;
          const hasPin = pins.some((p) => p.itemId === item.id);
          return (
            <div key={item.id} onClick={() => setSelectedItemId(isSelected ? null : item.id)}
              style={{ border: `2px solid ${isSelected ? color : hasPin ? color : "#eee"}`, borderRadius: "12px", overflow: "hidden", cursor: "pointer", opacity: isSelected ? 1 : 0.9, background: isSelected ? "#f0f4ff" : "#fff" }}>
              {item.thumbnail_url && (
                <img src={item.thumbnail_url} alt={item.name} style={{ width: "100%", height: "130px", objectFit: "cover" }} />
              )}
              <div style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <div style={{ width: "16px", height: "16px", background: color, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#fff", fontWeight: "bold", flexShrink: 0 }}>
                    {idx + 1}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 500 }}>{item.name}</div>
                </div>
                <div style={{ fontSize: "12px", color: "#888" }}>{item.price_str}</div>
                {hasPin && <div style={{ fontSize: "11px", color: color, marginTop: "4px" }}>ピン設定済み</div>}
                {isSelected && <div style={{ fontSize: "11px", color: "#856404", marginTop: "4px" }}>スクショをクリック</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;