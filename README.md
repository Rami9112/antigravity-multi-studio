# Anti-Multi Studio (`anti-multi`)

Google Antigravity (v2.x Hub & Antigravity IDE) **다중 계정 관리 · 다중 인스턴스 동시 실행 · 기기 식별값(Device Fingerprint) 및 아웃바운드 프록시 IP 격리 플랫폼**입니다.

---

## 핵심 아키텍처 및 격리 원리

1. **다중 인스턴스 동시 실행 (`--user-data-dir` & `.gemini` 홈 분리)**
   - `Antigravity.exe` (`dist/main.js`)의 `app.requestSingleInstanceLock()`은 Electron `--user-data-dir` 단위로 동작합니다.
   - 프로필마다 독립된 `data/profiles/<profileId>/user-data`와 `data/profiles/<profileId>/home` (`USERPROFILE` / `HOME`)을 부여하여, **서로 다른 계정의 Antigravity 창을 동시에 여러 개** 띄워도 싱글 인스턴스 락이나 SQLite DB(`conversation_summaries.db`) 충돌이 발생하지 않습니다.

2. **전역 Windows 자격 증명 관리자(`gemini:antigravity`) 충돌 우회 및 파일 토큰 격리**
   - Antigravity v2.23.x의 `language_server.exe` (`codeassistclient.NewCompositeTokenStorage`)는 기본적으로 전역 OS Keyring(`CredReadW("gemini:antigravity")`)을 사용하여 다중 실행 시 계정이 서로 덮어써지는 문제가 있습니다.
   - `anti-multi`는 자식 프로세스에 `SSH_CONNECTION="127.0.0.1 0 127.0.0.1 22"` 환경 변수를 주입하여 `shouldBypassKeyring()`을 활성화하고, 각 프로필의 독립 경로인 `<profileHome>/.gemini/jetski-standalone-oauth-token` 파일과 `<userDataDir>/User/globalStorage/state.vscdb` (`antigravityUnifiedStateSync.oauthToken`)를 사용하도록 격리합니다.
   - 실행된 Antigravity 창 내부에서 새 계정으로 로그인하면 해당 토큰이 자동으로 감지되어 프로필 스토어에 동기화됩니다.

3. **프로필별 기기 식별값(Device Fingerprint) 변조**
   - 각 프로필마다 고유한 기기 식별값을 생성·보존합니다:
     - `installationId` (`<profileHome>/.gemini/antigravity/installation_id`)
     - `telemetry.machineId` (`auth0|user_<32_hex>`)
     - `telemetry.macMachineId`, `telemetry.devDeviceId`, `telemetry.sqmId`, `storage.serviceMachineId` (`storage.json` & `state.vscdb`)
     - `.updaterId` (`<userDataDir>/.updaterId`)
     - `osType` (`windows` | `darwin` | `linux`), `arch` (`arm64` | `amd64`), `hostname` (`COMPUTERNAME`)

4. **프로필별 전용 로컬 스텔스 게이트웨이 (`CLOUD_CODE_URL`) 및 프록시 IP 라우팅**
   - 각 실행 인스턴스마다 전용 로컬 게이트웨이(`127.0.0.1:<ephemeral_port>`)를 띄우고 `CLOUD_CODE_URL`로 주입합니다.
   - 아웃바운드 요청 시:
     - 해당 프로필의 `Authorization: Bearer <access_token>` 강제 주입
     - `User-Agent` (`antigravity/hub/2.23.1 (aidev_client; os_type=...; arch=...; cl=998881661)`) 및 `Client-Metadata` (`installationId=...`) 헤더 변조
     - JSON 바디 내 `metadata.installationId`, `metadata.ideVersion`, `metadata.duetProject` 자동 재작성
     - `/log`, `:recordTelemetry`, `:recordAnalytics` 텔레메트리 요청 로컬 드롭(선택 가능)
     - 프로필에 설정된 **HTTP / HTTPS / SOCKS5 프록시**를 통해 업스트림(`daily-cloudcode-pa.googleapis.com`)으로 터널링하여 계정마다 서로 다른 공인 IP로 통신합니다.

---

## 실행 방법

```bash
# 의존성 설치
pnpm install

# 웹 UI 대시보드 서버 실행 (기본 http://127.0.0.1:4300)
pnpm dev

# 프로덕션 빌드 및 실행
pnpm start

# 전체 정적 검증(lint/typecheck/build) 및 단위·통합 테스트 실행
pnpm verify
```
