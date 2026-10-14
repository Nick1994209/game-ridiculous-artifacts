export const itemIcons = ["🥾", "🦷", "🧪", "🗺", "🔘", "🪨", "🥄", "☁"];
export const itemNames = [
  "Башмак великана",
  "Зуб с пломбой",
  "Сомнительное зелье",
  "Карта никуда",
  "Та самая кнопка",
  "Обычный камень",
  "Кривая ложка",
  "Сертификат на облако",
];
export function itemLabel(kind: number) {
  return `${itemIcons[kind]} ${itemNames[kind]}`;
}
