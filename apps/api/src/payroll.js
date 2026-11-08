const parseDate = (value) => new Date(`${value}T00:00:00Z`);
const formatDate = (date) => date.toISOString().slice(0, 10);

export function mondayOf(date) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return formatDate(value);
}

export function nextDate(date) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + 1);
  return formatDate(value);
}

export function previousDate(date) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() - 1);
  return formatDate(value);
}

export const PAYROLL_TIME = '03:45';

// Letzter Tag, den der Gehaltslauf abrechnet: ab 03:45 Uhr der Vortag. Der Lauf prüft stündlich.
// Ist noch eine Schicht offen (laufender Timer), wartet ihr Starttag, bis ausgestempelt ist; sonst fehlten ihre Stunden,
// und bei einer Nacht von Sonntag auf Montag wäre die Woche schon abgeschlossen.
export function payrollCutoff({ date, time, openShiftDate = null }) {
  const yesterday = previousDate(date);
  let last = time >= PAYROLL_TIME ? yesterday : previousDate(yesterday);
  if (openShiftDate && openShiftDate <= last) last = previousDate(openShiftDate);
  return last;
}

// Festgehalt für den Tag, dazu je Bonusstunde ein Prozentsatz des Festgehalts
export function calculateDailyPayroll({ dailySalary, bonusPercent, bonusHours }) {
  const baseCents = Math.round(dailySalary * 100);
  const bonusCents = Math.round(bonusHours * baseCents * bonusPercent / 100);
  return {
    base_amount: (baseCents / 100).toFixed(2),
    overtime_hours: bonusHours,
    overtime_pay: (bonusCents / 100).toFixed(2),
    total_amount: ((baseCents + bonusCents) / 100).toFixed(2),
  };
}

// Stunden über dem Wochen-Soll, die noch nicht vergütet sind. Nachgetragene Stunden derselben Woche holt das ein.
export function bonusHoursDue({ weeklyTarget, weekHours, settledHours }) {
  return Number(Math.max(0, Math.max(0, weekHours - weeklyTarget) - settledHours).toFixed(2));
}

// Zahlungen für alle noch offenen Tage. Jede Woche (Montag bis Sonntag) zählt die Stunden neu.
// Abgeschlossene Wochen bleiben abgeschlossen: Sonst würde ein geändertes Wochen-Soll alte Wochen neu berechnen.
export function planPayroll({ firstDate, lastDate, weeklyTarget, dailySalary, bonusPercent, hoursByDate, paidBonusHours }) {
  const payments = [];
  let currentWeek = null;
  let weekHours = 0;
  let settledHours = 0;
  for (let date = mondayOf(firstDate); date <= lastDate; date = nextDate(date)) {
    const week = mondayOf(date);
    if (week !== currentWeek) {
      currentWeek = week;
      weekHours = 0;
      settledHours = 0;
    }
    weekHours += hoursByDate.get(date) || 0;
    if (date < firstDate) {
      // Vor dem Start zählen die Stunden zum Soll, werden aber nicht vergütet
      settledHours = Math.max(0, weekHours - weeklyTarget);
    } else if (paidBonusHours.has(date)) {
      settledHours += paidBonusHours.get(date);
    } else {
      const bonusHours = bonusHoursDue({ weeklyTarget, weekHours, settledHours });
      payments.push({ date, ...calculateDailyPayroll({ dailySalary, bonusPercent, bonusHours }) });
      settledHours += bonusHours;
    }
  }
  return payments;
}
