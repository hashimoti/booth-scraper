import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import Database from "@tauri-apps/plugin-sql";
import { check } from "@tauri-apps/plugin-updater";
import type { BoothItem, ContextMenuState, Pin } from "../types";

const DB_PATH = "sqlite:outfit_manager.db";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function getExportSafeImageSrc(src: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(src);
  if (cached) {
    return cached;
  }

  const safeSrc = await invoke<string>("fetch_image", { url: src });
  cache.set(src, safeSrc);
  return safeSrc;
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

export interface UseOutfitManagerResult {
  url: string;
  items: BoothItem[];
  loading: boolean;
  exporting: boolean;
  screenshot: string | null;
  selectedItemId: number | null;
  pins: Pin[];
  thumbSize: number;
  borderWidth: number;
  borderColor: string;
  draggingPinId: number | null;
  contextMenu: ContextMenuState | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  usedItems: BoothItem[];
  setUrl: (value: string) => void;
  setThumbSize: (value: number) => void;
  setBorderWidth: (value: number) => void;
  setBorderColor: (value: string) => void;
  setSelectedItemId: (value: number | null) => void;
  setContextMenu: (value: ContextMenuState | null) => void;
  setDraggingPinId: (value: number | null) => void;
  fetchItem: () => Promise<void>;
  deleteItem: (event: MouseEvent, id: number) => Promise<void>;
  removePin: (event: MouseEvent, itemId: number) => void;
  exportImage: () => Promise<void>;
  handleMouseMove: (event: MouseEvent) => void;
  onScreenshotClick: (event: MouseEvent) => void;
  handleScreenshotFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  clearContextMenu: () => void;
}

export function useOutfitManager(): UseOutfitManagerResult {
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const dbRef = useRef<Database | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let disposed = false;

    async function checkForUpdates() {
      try {
        const update = await check();
        if (!update) {
          return;
        }

        const yes = await ask(`新Ver (${update.version}) があります。更新しますか？`, {
          title: "アップデート確認",
          kind: "info",
        });

        if (yes) {
          alert("ダウンロードを開始します...");
          await update.downloadAndInstall();
          alert("インストール完了！再起動します。");
          await relaunch();
        }
      } catch (error) {
        await ask(`エラーが発生しました: ${String(error)}`, { title: "デバッグ情報", kind: "error" });
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

  async function deleteItem(event: MouseEvent, id: number) {
    event.stopPropagation();

    const yes = await ask("このアイテムを削除しますか？", {
      title: "削除確認",
      kind: "warning",
    });
    if (!yes) return;

    try {
      const db = dbRef.current;
      if (!db) throw new Error("Database is not ready");

      await db.execute("DELETE FROM items WHERE id = $1", [id]);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setPins((prev) => prev.filter((pin) => pin.itemId !== id));
      if (selectedItemId === id) {
        setSelectedItemId(null);
      }
    } catch (error) {
      console.error("削除エラー:", error);
      setError("削除エラー: " + String(error));
    }
  }

  function removePin(event: MouseEvent, itemId: number) {
    event.preventDefault();
    event.stopPropagation();
    setPins((prev) => prev.filter((pin) => pin.itemId !== itemId));
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
      const exportImageCache = new Map<string, string>();

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

        const safeThumbnailSrc = await getExportSafeImageSrc(item.thumbnail_url, exportImageCache);
        const thumbnail = await loadImage(safeThumbnailSrc);
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

  function handleMouseMove(event: MouseEvent) {
    if (draggingPinId === null || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setPins((prev) => prev.map((pin) => (pin.itemId === draggingPinId ? { ...pin, x, y } : pin)));
  }

  function onScreenshotClick(event: MouseEvent) {
    if (selectedItemId === null || draggingPinId !== null || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    setPins((prev) => [...prev.filter((pin) => pin.itemId !== selectedItemId), { itemId: selectedItemId, x, y }]);
    setSelectedItemId(null);
  }

  function handleScreenshotFileChange(event: ChangeEvent<HTMLInputElement>) {
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

  function clearContextMenu() {
    setContextMenu(null);
  }

  const usedItems = items.filter((item) => pins.some((pin) => pin.itemId === item.id));

  return {
    url,
    items,
    loading,
    exporting,
    screenshot,
    selectedItemId,
    pins,
    thumbSize,
    borderWidth,
    borderColor,
    draggingPinId,
    contextMenu,
    fileInputRef,
    imgRef,
    usedItems,
    setUrl,
    setThumbSize,
    setBorderWidth,
    setBorderColor,
    setSelectedItemId,
    setContextMenu,
    setDraggingPinId,
    fetchItem,
    deleteItem,
    removePin,
    exportImage,
    handleMouseMove,
    onScreenshotClick,
    handleScreenshotFileChange,
    clearContextMenu,
  };
}
