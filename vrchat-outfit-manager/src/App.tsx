import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import * as opener from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import Database from "@tauri-apps/plugin-sql";
import { check } from "@tauri-apps/plugin-updater";

// --- データ型定義 ---
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
  const [borderWidth, setBorderWidth] = useState(6);
  const [borderColor, setBorderColor] = useState("#4a6cf7");
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: number } | null>(null);

  const dbRef = useRef<Database | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let disposed = false;

    async function checkForUpdates() {
      try {
        const update = await check();
        if (!update) return;

        const yes = await ask(`新しいバージョン (${update.version}) があります。今すぐ更新しますか？`, {
          title: "アップデート確認",
          kind: "info",
        });

        if (yes) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } catch (error) {
        console.error("アップデート確認エラー:", error);
      }
    }

    async function init() {
      try {
        const db = await Database.load(DB_PATH);
        if (disposed) {
          return;
        }

        dbRef.current = db;
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
        if (!disposed && savedItems.length > 0) {
          setItems(savedItems);
        }
      } catch (error) {
        console.error("データベース初期化エラー:", error);
        if (!disposed) {
          setError("データベース初期化エラー");
        }
      }
    }

    void checkForUpdates();
    void init();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedItemId(null);
        setContextMenu(null);
        setDraggingPinId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (screenshot) {
        URL.revokeObjectURL(screenshot);
      }
    };
  }, [screenshot]);

  async function fetchItem() {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const db = dbRef.current;
      if (!db) throw new Error("Database is not ready");

      const boothUrl = url.trim();
      const cached = await db.select<BoothItem[]>("SELECT * FROM items WHERE booth_url = $1", [boothUrl]);
      if (cached.length > 0) {
        const item = cached[0];
        setItems((prev) => (prev.find((entry) => entry.id === item.id) ? prev : [...prev, item]));
      } else {
        const item = await invoke<BoothItem>("fetch_booth_item", { url: boothUrl });
        await db.execute(
          `INSERT INTO items (id, name, price, price_str, shop_name, shop_url, thumbnail_url, booth_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.id, item.name, item.price, item.price_str, item.shop_name, item.shop_url, item.thumbnail_url, item.booth_url],
        );
        setItems((prev) => [...prev, item]);
      }

      setUrl("");
    } catch (error) {
      console.error("アイテム取得エラー:", error);
      setError("アイテム取得エラー: " + String(error));
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(event: React.MouseEvent, id: number) {
    event.stopPropagation();

    const yes = await ask("このアイテムを削除しますか？", {
      title: "削除確認",
      kind: "warning",
    });
    if (!yes) return;

    try {
      const db = dbRef.current;
      if (!db) throw new Error("Database is not ready");

      // 1. データベースから削除
      await db.execute("DELETE FROM items WHERE id = $1", [id]);
      // 2. 画面上の一覧から削除
      setItems((prev) => prev.filter((item) => item.id !== id));
      // 3. 配置済みピンも一緒に削除
      setPins((prev) => prev.filter((pin) => pin.itemId !== id));
      // 4. 選択中なら選択状態も解除
      if (selectedItemId === id) {
        setSelectedItemId(null);
      }
    } catch (error) {
      console.error("削除エラー:", error);
      setError("削除エラー: " + String(error));
    }
  }

  function removePin(event: React.MouseEvent, itemId: number) {
    // 右クリックメニューの既定動作を止めて、対象ピンだけ外す
    event.preventDefault();
    event.stopPropagation();
    setPins((prev) => prev.filter((pin) => pin.itemId !== itemId));
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      image.src = src;
    });
  }

  function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to export canvas"));
        }
      }, type);
    });
  }

  async function exportImage() {
    if (!screenshot || pins.length === 0 || !imgRef.current) return;

    const filePath = await save({
      filters: [{ name: "Image", extensions: ["png"] }],
      defaultPath: `VRC_Outfit_${Date.now()}.png`,
    });
    if (!filePath) return;

    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context is unavailable");

      const background = await loadImage(screenshot);
      canvas.width = background.width;
      canvas.height = background.height;
      ctx.drawImage(background, 0, 0);

      const scale = background.width / imgRef.current.clientWidth;
      const exportThumbSize = thumbSize * scale;
      const exportBorderWidth = borderWidth * scale;
      const borderRadius = exportThumbSize * 0.15;

      for (const pin of pins) {
        const item = items.find((entry) => entry.id === pin.itemId);
        if (!item?.thumbnail_url) continue;

        const pinX = pin.x * canvas.width;
        const pinY = pin.y * canvas.height;
        const imageX = pinX - exportThumbSize / 2;
        const imageY = pinY - exportThumbSize / 2;

        ctx.save();
        if (exportBorderWidth > 0) {
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = exportBorderWidth * 2;
          ctx.fillStyle = borderColor;
          ctx.beginPath();
          // @ts-ignore roundRect is available in modern webviews.
          ctx.roundRect(
            imageX - exportBorderWidth,
            imageY - exportBorderWidth,
            exportThumbSize + exportBorderWidth * 2,
            exportThumbSize + exportBorderWidth * 2,
            borderRadius + exportBorderWidth,
          );
          ctx.fill();
        }

        const thumbnail = await loadImage(item.thumbnail_url);
        ctx.save();
        ctx.beginPath();
        // @ts-ignore roundRect is available in modern webviews.
        ctx.roundRect(imageX, imageY, exportThumbSize, exportThumbSize, borderRadius);
        ctx.clip();
        ctx.drawImage(thumbnail, imageX, imageY, exportThumbSize, exportThumbSize);
        ctx.restore();
        ctx.restore();
      }

      const blob = await canvasToBlob(canvas, "image/png");
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await invoke("save_image_bytes", { bytes, path: filePath });
      alert("画像を保存しました");
    } catch (error) {
      console.error("画像保存エラー:", error);
      setError("画像保存エラー: " + String(error));
    } finally {
      setExporting(false);
    }
  }

  function handleMouseMove(event: React.MouseEvent) {
    if (draggingPinId === null || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setPins((prev) => prev.map((pin) => (pin.itemId === draggingPinId ? { ...pin, x, y } : pin)));
  }

  function onScreenshotClick(event: React.MouseEvent) {
    if (selectedItemId === null || draggingPinId !== null || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    setPins((prev) => [...prev.filter((pin) => pin.itemId !== selectedItemId), { itemId: selectedItemId, x, y }]);
    setSelectedItemId(null);
  }

  function handleScreenshotFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setScreenshot((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
    setPins([]);
    event.target.value = "";
  }

  const usedItems = items.filter((item) => pins.some((pin) => pin.itemId === item.id));

  return (
    <div
      style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", fontFamily: "sans-serif" }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDraggingPinId(null)}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>VRC Outfit Manager</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => fileInputRef.current?.click()} style={{ padding: "8px 16px", cursor: "pointer" }}>
            スクリーンショット選択
          </button>
          <button
            onClick={exportImage}
            disabled={exporting || pins.length === 0}
            style={{
              padding: "8px 24px",
              background: "#4a6cf7",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {exporting ? "書き出し中..." : "画像として保存"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" hidden accept="image/*" onChange={handleScreenshotFileChange} />
      </div>

      <div
        style={{
          marginBottom: "20px",
          background: "#f8f9fa",
          padding: "15px",
          borderRadius: "8px",
          border: "1px solid #eee",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {/* プレビュー表示 */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>アイテムサイズ:</label>
          <input type="range" min="40" max="300" value={thumbSize} onChange={(event) => setThumbSize(Number(event.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{thumbSize}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>枠の太さ:</label>
          <input type="range" min="0" max="20" value={borderWidth} onChange={(event) => setBorderWidth(Number(event.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{borderWidth}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px" }}>枠の色:</label>
          <input
            type="color"
            value={borderColor}
            onChange={(event) => setBorderColor(event.target.value)}
            style={{ width: "50px", height: "30px", border: "none", cursor: "pointer" }}
          />
          <span>{borderColor}</span>
        </div>
      </div>

      {screenshot && (
        <div
          onClick={onScreenshotClick}
          onContextMenu={(event) => {
            if (selectedItemId !== null) {
              event.preventDefault();
              setSelectedItemId(null);
            }
          }}
          style={{
            position: "relative",
            marginBottom: "30px",
            borderRadius: "12px",
            overflow: "hidden",
            height: "70vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ position: "relative", display: "inline-block" }}>
            <img ref={imgRef} src={screenshot} style={{ maxWidth: "100%", maxHeight: "70vh" }} draggable={false} />
            {pins.map((pin) => {
              const item = items.find((entry) => entry.id === pin.itemId);
              return (
                <div
                  key={pin.itemId}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setDraggingPinId(pin.itemId);
                  }}
                  // 右クリックで配置済みピンを削除
                  onContextMenu={(event) => removePin(event, pin.itemId)}
                  style={{
                    position: "absolute",
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: thumbSize,
                    height: thumbSize,
                    border: `${borderWidth}px solid ${borderColor}`,
                    borderRadius: "12px",
                    overflow: "hidden",
                    cursor: "grab",
                    zIndex: 10,
                    boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
                  }}
                >
                  <img src={item?.thumbnail_url || ""} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                </div>
              );
            })}
          </div>
          {selectedItemId && (
            <div
              style={{
                position: "absolute",
                bottom: "10px",
                background: "rgba(0,0,0,0.7)",
                color: "white",
                padding: "5px 15px",
                borderRadius: "20px",
                fontSize: "12px",
                pointerEvents: "none",
              }}
            >
              配置したい場所をクリックしてください。Escでキャンセルできます。
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", marginBottom: "30px" }}>
        {/* URL入力 */}
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="BoothのURLを貼り付け"
          style={{ flex: 1, padding: "10px", borderRadius: "4px", border: "1px solid #ddd" }}
          onKeyDown={(event) => event.key === "Enter" && void fetchItem()}
        />
        <button
          onClick={() => void fetchItem()}
          disabled={loading}
          style={{ padding: "10px 20px", background: "#4a6cf7", color: "#fff", border: "none", borderRadius: "4px" }}
        >
          追加
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "20px" }}>
        {/* アイテム一覧 */}
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => setSelectedItemId(item.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY, itemId: item.id });
            }}
            style={{
              position: "relative",
              border: `3px solid ${selectedItemId === item.id ? borderColor : "#eee"}`,
              borderRadius: "10px",
              padding: "10px",
              cursor: "pointer",
              background: "#fff",
            }}
          >
            <button
              onClick={(event) => void deleteItem(event, item.id)}
              title="このアイテムを削除"
              style={{
                position: "absolute",
                top: "-10px",
                right: "-10px",
                width: "24px",
                height: "24px",
                background: "#e74c6f",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                cursor: "pointer",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
                zIndex: 5,
              }}
            >
              ×
            </button>

            <img src={item.thumbnail_url || ""} style={{ width: "100%", height: "120px", objectFit: "cover", borderRadius: "6px" }} />
            <div
              style={{
                fontSize: "13px",
                marginTop: "8px",
                fontWeight: "bold",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.name}
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "white",
            border: "1px solid #ccc",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            zIndex: 1000,
            borderRadius: "4px",
            padding: "4px 0",
          }}
        >
          {/* コンテキストメニュー本体 */}
          <div
            onClick={() => {
              const item = items.find((entry) => entry.id === contextMenu.itemId);
              setContextMenu(null);
              if (item) {
                void opener.openUrl(item.booth_url);
              }
            }}
            style={{ padding: "8px 16px", cursor: "pointer", fontSize: "14px" }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "#f0f0f0";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
          >
            BOOTHでページを開く
          </div>
        </div>
      )}

      {pins.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            padding: "20px",
            background: "#f8f9fa",
            borderRadius: "12px",
            border: "2px dashed #dee2e6",
          }}
        >
          {/* 投稿用URLリスト */}
          <h2 style={{ fontSize: "15px", marginBottom: "10px", color: "#495057", fontWeight: "bold" }}>
            投稿用クレジット
          </h2>
          <textarea
            readOnly
            value={usedItems.map((item) => `・${item.name}\n${item.booth_url}`).join("\n\n")}
            style={{
              width: "100%",
              height: "140px",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ced4da",
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "1.6",
              backgroundColor: "#fff",
              color: "#333",
              resize: "none",
              cursor: "pointer",
            }}
            onClick={(event) => event.currentTarget.select()}
          />
          <p style={{ fontSize: "11px", color: "#868e96", marginTop: "8px" }}>
            使っているアイテムだけを一覧化しています。投稿文やメモにそのまま使えます。
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
