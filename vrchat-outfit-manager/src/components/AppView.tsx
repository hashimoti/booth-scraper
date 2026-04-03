import * as opener from "@tauri-apps/plugin-opener";
import type { UseOutfitManagerResult } from "../hooks/useOutfitManager";

const accentColor = "#f28c6f";
const accentSoft = "#fff1eb";
const panelColor = "#fffaf7";
const panelBorder = "#f3d8cf";
const pageBackground = "linear-gradient(180deg, #fff8f3 0%, #fffdfa 45%, #fef7f2 100%)";
const cardShadow = "0 12px 28px rgba(227, 157, 129, 0.14)";

function AppView({
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
}: UseOutfitManagerResult) {
  return (
    <div
      style={{
        padding: "24px",
        maxWidth: "1200px",
        margin: "0 auto",
        fontFamily: '"Trebuchet MS", "Hiragino Kaku Gothic ProN", sans-serif',
        minHeight: "100vh",
        background: pageBackground,
        color: "#5c4b46",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDraggingPinId(null)}
      onClick={clearContextMenu}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0, color: "#7a5147", letterSpacing: "0.02em" }}>VRC Outfit Manager</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "10px 18px",
              cursor: "pointer",
              borderRadius: "999px",
              border: `1px solid ${panelBorder}`,
              background: "#fff",
              boxShadow: "0 8px 18px rgba(214, 181, 168, 0.18)",
            }}
          >
            スクリーンショット選択
          </button>
          <button
            onClick={() => void exportImage()}
            disabled={exporting || pins.length === 0}
            style={{
              padding: "10px 24px",
              background: accentColor,
              color: "#fff",
              border: "none",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: "bold",
              boxShadow: "0 12px 24px rgba(242, 140, 111, 0.28)",
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
          background: panelColor,
          padding: "18px",
          borderRadius: "24px",
          border: `1px solid ${panelBorder}`,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          boxShadow: cardShadow,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px", color: "#7a5147" }}>アイテムサイズ:</label>
          <input type="range" min="40" max="300" value={thumbSize} onChange={(event) => setThumbSize(Number(event.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{thumbSize}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px", color: "#7a5147" }}>枠の太さ:</label>
          <input type="range" min="0" max="20" value={borderWidth} onChange={(event) => setBorderWidth(Number(event.target.value))} style={{ flex: 1 }} />
          <span style={{ minWidth: "50px" }}>{borderWidth}px</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold", width: "120px", color: "#7a5147" }}>枠の色:</label>
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
            borderRadius: "28px",
            overflow: "hidden",
            height: "70vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#2f2522",
            boxShadow: "0 22px 44px rgba(73, 49, 42, 0.28)",
            border: "1px solid rgba(255,255,255,0.35)",
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
                  onContextMenu={(event) => removePin(event, pin.itemId)}
                  style={{
                    position: "absolute",
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: thumbSize,
                    height: thumbSize,
                    border: `${borderWidth}px solid ${borderColor}`,
                    borderRadius: "22px",
                    overflow: "hidden",
                    cursor: "grab",
                    zIndex: 10,
                    boxShadow: "0 10px 24px rgba(0,0,0,0.26)",
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
                bottom: "14px",
                background: "rgba(255, 248, 243, 0.92)",
                color: "#7a5147",
                border: "1px solid rgba(255,255,255,0.8)",
                boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
                padding: "8px 16px",
                borderRadius: "999px",
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
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="BoothのURLを貼り付け"
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: "999px",
            border: `1px solid ${panelBorder}`,
            background: "#fffdfb",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
          }}
          onKeyDown={(event) => event.key === "Enter" && void fetchItem()}
        />
        <button
          onClick={() => void fetchItem()}
          disabled={loading}
          style={{
            padding: "10px 22px",
            background: accentColor,
            color: "#fff",
            border: "none",
            borderRadius: "999px",
            boxShadow: "0 12px 24px rgba(242, 140, 111, 0.28)",
          }}
        >
          追加
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "20px" }}>
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
              border: `2px solid ${selectedItemId === item.id ? borderColor : panelBorder}`,
              borderRadius: "24px",
              padding: "12px",
              cursor: "pointer",
              background: "#fffdfb",
              boxShadow: selectedItemId === item.id ? "0 18px 32px rgba(242, 140, 111, 0.18)" : cardShadow,
              transition: "all 0.2s ease",
            }}
          >
            <button
              onClick={(event) => void deleteItem(event, item.id)}
              title="このアイテムを削除"
              style={{
                position: "absolute",
                top: "-10px",
                right: "-10px",
                width: "28px",
                height: "28px",
                background: "#e74c6f",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                cursor: "pointer",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 16px rgba(231, 76, 111, 0.28)",
                zIndex: 5,
              }}
            >
              ×
            </button>

            <img src={item.thumbnail_url || ""} style={{ width: "100%", height: "120px", objectFit: "cover", borderRadius: "18px" }} />
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
            background: "#fffaf7",
            border: `1px solid ${panelBorder}`,
            boxShadow: "0 16px 30px rgba(92, 75, 70, 0.18)",
            zIndex: 1000,
            borderRadius: "18px",
            padding: "6px 0",
          }}
        >
          <div
            onClick={() => {
              const item = items.find((entry) => entry.id === contextMenu.itemId);
              clearContextMenu();
              if (item) {
                void opener.openUrl(item.booth_url);
              }
            }}
            style={{ padding: "10px 16px", cursor: "pointer", fontSize: "14px", color: "#6b4f48" }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = accentSoft;
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
            background: panelColor,
            borderRadius: "24px",
            border: `2px dashed ${panelBorder}`,
            boxShadow: cardShadow,
          }}
        >
          <h2 style={{ fontSize: "15px", marginBottom: "10px", color: "#7a5147", fontWeight: "bold" }}>投稿用クレジット</h2>
          <textarea
            readOnly
            value={usedItems.map((item) => `・${item.name}\n${item.booth_url}`).join("\n\n")}
            style={{
              width: "100%",
              height: "140px",
              padding: "12px",
              borderRadius: "18px",
              border: `1px solid ${panelBorder}`,
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "1.6",
              backgroundColor: "#fffdfb",
              color: "#5c4b46",
              resize: "none",
              cursor: "pointer",
            }}
            onClick={(event) => event.currentTarget.select()}
          />
          <p style={{ fontSize: "11px", color: "#9c7b70", marginTop: "8px" }}>
            使っているアイテムだけを一覧化しています。投稿文やメモにそのまま使えます。
          </p>
        </div>
      )}
    </div>
  );
}

export default AppView;
