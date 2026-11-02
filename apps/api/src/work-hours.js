export function calculateWorkCompensation(basePay, overtimeHours, overtimePay) {
  return {
    overtime_hours: Number(Math.max(0, overtimeHours).toFixed(2)),
    base_pay: Number(basePay).toFixed(2),
    overtime_pay: Number(overtimePay).toFixed(2),
    total_pay: (Number(basePay) + Number(overtimePay)).toFixed(2),
  };
}
