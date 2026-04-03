export interface BoothItem {
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

export interface Pin {
  itemId: number;
  x: number;
  y: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  itemId: number;
}
