function roundCents(value) {
  return Math.round((value + Number.EPSILON) * 100);
}

export function calculateDailyPayroll({ date, weeklyTarget, hourlyRate, surchargePercent, previousWeekHours, todayHours }) {
  const weeklyBaseCents = roundCents(weeklyTarget * hourlyRate);
  const baseCentsPerDay = Math.floor(weeklyBaseCents / 7);
  const baseRemainderCents = weeklyBaseCents % 7;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const mondayIndex = (day + 6) % 7;
  const baseCents = baseCentsPerDay + (mondayIndex < baseRemainderCents ? 1 : 0);
  const overtimeHours = Number((
    Math.max(0, previousWeekHours + todayHours - weeklyTarget)
    - Math.max(0, previousWeekHours - weeklyTarget)
  ).toFixed(2));
  const overtimePayCents = roundCents(overtimeHours * hourlyRate * (1 + surchargePercent / 100));

  return {
    base_amount: (baseCents / 100).toFixed(2),
    overtime_hours: overtimeHours,
    overtime_pay: (overtimePayCents / 100).toFixed(2),
    total_amount: ((baseCents + overtimePayCents) / 100).toFixed(2),
  };
}
