// 개발 서버가 켜져 있는 동안에는 빌드를 시작하지 못하게 막는다.
//
// next build는 .next(개발 캐시)를 함께 건드리기 때문에, 켜져 있는 개발 서버가
// 자기 청크 파일을 잃고 그 자리에서 죽는다(페이지 200 / CSS·JS 404).
// 빌드 전에 개발 서버를 내리게 안내하는 편이, 화면이 깨진 뒤 원인을 찾는 것보다 낫다.
import { createConnection } from "node:net";

const PORT = 3000;

const inUse = await new Promise((resolve) => {
  const socket = createConnection({ port: PORT, host: "127.0.0.1" });
  socket.setTimeout(1500);
  socket.on("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.on("timeout", () => {
    socket.destroy();
    resolve(false);
  });
  socket.on("error", () => resolve(false));
});

if (inUse) {
  console.error(
    [
      "",
      "  [중단] 개발 서버가 실행 중입니다 (http://localhost:" + PORT + ")",
      "",
      "  지금 빌드하면 개발 서버 화면이 깨집니다(글자만 보이는 화면).",
      "  프론트엔드 창을 먼저 닫은 뒤 다시 빌드해주세요.",
      "",
    ].join("\n")
  );
  process.exit(1);
}
