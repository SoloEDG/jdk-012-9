export function downloadRecap(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "余境-个人参观回顾.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
