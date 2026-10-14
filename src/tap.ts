// Whether a gesture that traveled `totalDistance` from its starting point should still count as a
// tap rather than the start of a drag/swipe. Pass a tapMaxDistance kept below whatever
// minSwipeDistance you feed resolveSwipeDirection, and below by a real margin, not just numerically -
// so the two never overlap: a touch that drifts past tapMaxDistance is unambiguously either still
// within tap tolerance or already a recognized swipe, never both and never neither. A touch that
// drifted past tapMaxDistance but never reached minSwipeDistance either (a real, if slightly wobbly,
// tap) still correctly reads as a tap by this check alone - don't infer "was this a tap" from
// "resolveSwipeDirection never fired," which misses that in-between case.
export function isTap(totalDistance: number, tapMaxDistance: number): boolean {
  return totalDistance <= tapMaxDistance
}
