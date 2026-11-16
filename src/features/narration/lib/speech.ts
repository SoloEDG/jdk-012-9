export function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
export function speak(text: string, rate: number) {
  stopSpeech();
  if (!("speechSynthesis" in window)) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = rate;
  window.speechSynthesis.speak(u);
  return true;
}
