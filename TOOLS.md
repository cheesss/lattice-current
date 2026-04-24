# TOOLS.md - Lattice Local Notes

## 자주 쓰는 실행

```powershell
npm run dev
npm run intelligence:scheduler
npm run sidecar:dev
openclaw gateway run
```

## 점검

```powershell
openclaw health --json
openclaw sessions --agent lattice-ops --json
node --import tsx --test tests/openclaw-plugin-control-plane.test.mjs
```

## 프로세스 정리

불필요한 `@playwright/mcp`, 임시 `codex exec`, 종료된 OpenClaw agent child process는 정리한다. Lattice API, Vite, scheduler, sidecar, OpenClaw gateway는 현재 작업에 필요하면 유지한다.
