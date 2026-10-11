export function popupPosition(size, anchor, width, height, margin = 8) {
  const x = anchor.x + anchor.width / 2 - width / 2;
  return { x: Math.round(Math.max(margin, Math.min(size.x - width - margin, x))),
    y: Math.round(Math.max(0, Math.min(size.y - height - margin, anchor.y + anchor.height + 6))) };
}

export const popupContains = (point, position, size) => point.x >= position.x && point.y >= position.y
  && point.x < position.x + size.x && point.y < position.y + size.y;
