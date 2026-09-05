import * as THREE from 'three';

/** a bilingual name plate drawn to a canvas: Hebrew on top, English below */
export function labelTexture(he, en, { w = 512, h = 160, big = false, plate = 'rgba(17, 45, 96, 0.92)', border = '#d0342c', sub = '#dbe7ff' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const r = 26;
  g.fillStyle = plate;
  g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, r); g.fill();
  g.strokeStyle = border; g.lineWidth = 8;
  g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, r); g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.direction = 'rtl';
  g.font = `bold ${big ? 58 : 54}px "Segoe UI", Arial, "Noto Sans Hebrew", "DejaVu Sans", sans-serif`;
  g.fillText(he, w / 2, h * 0.36);
  g.direction = 'ltr';
  g.font = `${big ? 34 : 30}px "Segoe UI", Arial, "DejaVu Sans", sans-serif`;
  g.fillStyle = sub;
  g.fillText(en, w / 2, h * 0.74);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
