import { Listing } from "./types.js";

// Районы по приоритету (твои предпочтения): максимум 20 баллов
const DISTRICT_SCORE: Record<string, number> = {
  "Бостандыкский": 20,
  "Алмалинский":   16,
  "Ауэзовский":    12,
  "Жетысуский":     8,
  "Наурызбайский":  4,
};

const BUDGET = 35_000_000;

export function scoreListing(l: Listing): number {
  let score = 0;

  // Цена (30 баллов): чем дешевле, тем выше балл
  if (l.price > 0) {
    score += Math.max(0, Math.round((1 - l.price / BUDGET) * 30));
  } else {
    score += 15; // цена не указана — нейтральный балл
  }

  // Площадь (20 баллов): 35 м² = 0 баллов, 80 м²+ = 20 баллов
  if (l.areaM2 !== null) {
    score += Math.round(Math.min((l.areaM2 - 35) / 45, 1) * 20);
  } else {
    score += 10;
  }

  // Этаж (20 баллов): средние этажи лучше первого и последнего
  if (l.floor) {
    const [cur, total] = l.floor.split("/").map(Number);
    if (!isNaN(cur) && !isNaN(total)) {
      if (cur === 1)           score += 5;  // первый — шум, сырость
      else if (cur === total)  score += 12; // последний — крыша, лифт
      else                     score += 20; // средний — отлично
    }
  } else {
    score += 10; // этаж неизвестен — нейтральный балл
  }

  // Комнаты (10 баллов): 2 комнаты предпочтительнее
  if (l.rooms === 2)      score += 10;
  else if (l.rooms === 1) score += 5;
  else                    score += 5;

  // Район (20 баллов): ищем название района в адресе или заголовке
  const text = `${l.address || ""} ${l.title || ""}`.toLowerCase();
  let districtFound = false;
  for (const [district, pts] of Object.entries(DISTRICT_SCORE)) {
    if (text.includes(district.toLowerCase())) {
      score += pts;
      districtFound = true;
      break;
    }
  }
  if (!districtFound) score += 10; // район неизвестен — нейтральный балл

  return Math.min(Math.max(score, 0), 100);
}

export function scoreLabel(score: number): string {
  let stars: string;
  if (score >= 80)      stars = "⭐⭐⭐⭐⭐";
  else if (score >= 65) stars = "⭐⭐⭐⭐";
  else if (score >= 50) stars = "⭐⭐⭐";
  else if (score >= 35) stars = "⭐⭐";
  else                  stars = "⭐";
  return `${stars} ${score}/100`;
}
