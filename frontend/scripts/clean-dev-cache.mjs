// 개발 서버를 켜기 전에 실행된다.
//
// 1) 이미 개발 서버가 떠 있으면 여기서 멈춘다.
//    두 번째 서버는 포트 3001로 밀려나면서도 .next를 함께 비워버리기 때문에,
//    멀쩡히 돌던 첫 번째 서버가 자기 청크 파일을 잃고 404를 뱉으며 죽는다.
// 2) 그렇지 않으면 .next(개발 캐시)를 비우고 시작한다.
//    next build는 distDir을 따로 지정해도 .next 안의 파일을 함께 건드린다(실측:
//    개발 서버를 끈 상태에서 빌드했더니 .next의 파일 92개가 수정됐다). 그렇게 섞인
//    캐시로 뜨면 페이지는 200인데 CSS/JS만 404가 나는 "글자만 보이는" 화면이 된다.
import { rm } from "node:fs/promises";
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
      "  [중단] 개발 서버가 이미 실행 중입니다 (http://localhost:" + PORT + ")",
      "",
      "  하나 더 띄우면 두 서버가 같은 캐시를 건드려 화면이 깨집니다.",
      "  기존 프론트엔드 창을 그대로 쓰시거나, 먼저 닫고 다시 실행해주세요.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

await rm(new URL("../.next", import.meta.url), { recursive: true, force: true });
console.log("[dev] .next 개발 캐시를 비우고 시작합니다.");
