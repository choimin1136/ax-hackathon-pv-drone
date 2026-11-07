# ArduPilot SITL 안내

SunPatch의 드론은 실제 기체 대신 **ArduPilot SITL**(Software In The Loop)로 비행합니다. SITL은 실제 드론 비행 제어기에 올라가는 ArduCopter 펌웨어를 서버에서 그대로 실행하는 시뮬레이터입니다. 그래서 미션 업로드, 이륙, 웨이포인트 비행, 착륙을 실제 기체와 같은 MAVLink 명령으로 다룹니다.

이 문서는 팀 서버(`/data/hackathon`)를 기준으로 설치, 실행, 웹 연동, 설정값을 정리합니다. 설정값 예시는 [sitl.env.example](sitl.env.example)에 있습니다.

## 구성

```text
브라우저 ── POST /api/sitl/start|stop|fly ──→ 웹 서버 (server/sitl-control.mjs)
                                                 │ 실행
                         ┌───────────────────────┴───────────────────────┐
                         ↓                                               ↓
              arducopter (SITL, TCP 5760)  ←── MAVLink ──  python drone/mission.py
                                                                         │
                                               drone/sample_flight/live.jsonl (비행 기록)
                                                                         │
브라우저 ←── GET /api/missions/live (1초마다) ── 웹 서버 ←──────────────────┘
```

| 구성 요소 | 파일 | 하는 일 |
|---|---|---|
| SITL | `ardupilot/build/sitl/bin/arducopter` | 쿼드콥터(`+` 프레임) 비행 시뮬레이션, TCP 5760에서 MAVLink 연결 대기 |
| 비행 프로그램 | [drone/mission.py](../drone/mission.py) | 구역 웨이포인트 업로드, 시동, 이륙, 도착 이벤트 기록, 착륙 |
| SITL 제어 | [server/sitl-control.mjs](../server/sitl-control.mjs) | SITL과 비행 프로그램 실행·종료, 준비 상태와 비행 단계 보고 |
| 화면 | [web/sitl.mjs](../web/sitl.mjs) | 드론 켜기·끄기·비행 시작, 3D 비행, 비행 계기, 드론 로그 |

## 가상 발전소와 미션

| 항목 | 값 | 위치 |
|---|---|---|
| 구역 | 4행 × 6열, `A-1`~`D-6` | `mission.py` `ROWS`, `COLS` |
| 구역 크기 | 20m | `CELL_M` |
| 비행 고도 | 30m | `ALT_M` |
| 구역 도착 후 정지 | 2초 | `HOLD_S` |
| 이륙장 | 격자 왼쪽 밖 (-30m, 30m) | `HOME_X_M`, `HOME_Y_M` |
| 비행 순서 | 지그재그: A-1→A-6, B-6→B-1, C-1→C-6, D-6→D-1 | `plant_cells()` |
| 시작 위치 | 위도 -35.363261, 경도 149.165230, 고도 584m, 방위 353° (ArduPilot 기본 시험장) | `sitl-control.mjs` `--home` |

화면과 기록에는 실제 좌표를 남기지 않고 발전소 기준 상대 좌표(x, y, m)만 남깁니다.

비행 순서는 이렇습니다.

1. GPS 위치를 확인합니다(`home ready`).
2. 구역 웨이포인트를 업로드합니다(`mission uploaded`).
3. 시동을 겁니다(`armed`).
4. 30m로 이륙합니다(`이륙 완료`).
5. AUTO 모드로 웨이포인트를 차례로 돕니다.
6. 이륙장으로 돌아와 착륙합니다(RTL).

비행 프로그램이 출력하는 이 문구를 웹 서버가 읽어 화면의 단계(위치 확인 중 → 미션 업로드 중 → 시동 준비 중 → 이륙 중)로 보여 줍니다.

## 설치 (Ubuntu, 처음 한 번)

팀 서버는 systemd가 없는 컨테이너라, 프로세스는 tmux 세션으로 띄웁니다.

**1. 빌드 도구와 소스**

```bash
sudo apt-get update && sudo apt-get install -y build-essential git python3-venv tmux
```
```bash
cd /data/hackathon && git clone --recurse-submodules https://github.com/ArduPilot/ardupilot.git
```

**2. 빌드용·비행용 Python 환경**

ArduPilot의 `install-prereqs-ubuntu.sh`는 wxPython 빌드에서 오래 멈출 수 있어 쓰지 않습니다. 필요한 패키지만 venv에 설치합니다. 빌드에는 `empy` 3.3.4가 필요합니다(4.x는 빌드 실패).

```bash
python3 -m venv /data/hackathon/drone-venv
```
```bash
/data/hackathon/drone-venv/bin/pip install empy==3.3.4 pexpect future ptyprocess lxml pymavlink
```

**3. SITL 빌드**

```bash
cd /data/hackathon/ardupilot && source /data/hackathon/drone-venv/bin/activate && ./waf configure --board sitl && ./waf copter
```

빌드가 끝나면 `build/sitl/bin/arducopter`가 생깁니다.

**4. 확인**

```bash
/data/hackathon/drone-venv/bin/python -c "import pymavlink; print('ok')"
```

## 실행

### 웹에서 (평소)

웹 서버가 SITL과 비행 프로그램을 직접 띄웁니다. 점검 현황 화면에서 이렇게 조작합니다.

1. **드론 켜기:** SITL을 실행합니다. TCP 5760이 열리면 "드론 준비됨 · 8배속"이 됩니다.
2. **비행 시작:** 전체 24구역 비행을 시작합니다. 선택 점검의 재비행은 고른 구역만 비행합니다(`--cells`).
3. **드론 끄기:** 5초 안에 두 번 눌러야 꺼집니다. 공개 주소에서는 누구나 끌 수 있습니다.

API는 로그인 없이 쓸 수 있습니다.

| 요청 | 하는 일 | 실패 응답 |
|---|---|---|
| `POST /api/sitl/start` | SITL 실행 | |
| `POST /api/sitl/stop` | 비행 프로그램과 SITL 종료 | |
| `POST /api/sitl/fly` `{"cells":"C-4,C-5"}` | 비행 시작. `cells`를 빼면 전체 | 409: 꺼짐·준비 중·이미 비행 중, 400: 잘못된 구역 |
| `GET /api/sitl/status` | `{ speedup, sitl, ready, flying, mission, stage }` | |

비행은 동시에 하나만 실행됩니다. 새 전체 비행을 시작하면 이전 `live.jsonl`은 점검 기록으로 보관된 뒤 새로 쓰입니다.

### 손으로 (점검·디버깅)

웹 서버를 거치지 않고 터미널에서 띄울 때 씁니다. 웹에서 이미 켠 SITL과 동시에 띄우면 포트 5760이 겹치니, 먼저 웹에서 끄세요.

```bash
mkdir -p /data/hackathon/sitl-run && cd /data/hackathon/sitl-run && /data/hackathon/ardupilot/build/sitl/bin/arducopter --model + --speedup 8 --defaults /data/hackathon/ardupilot/Tools/autotest/default_params/copter.parm -I0 --home -35.363261,149.165230,584,353
```

SITL은 첫 MAVLink 연결이 들어올 때까지 시뮬레이션을 시작하지 않습니다. 다른 터미널에서 연결을 확인합니다.

```bash
cd /data/hackathon/deploy && /data/hackathon/drone-venv/bin/python drone/telemetry_test.py
```
```bash
cd /data/hackathon/deploy && /data/hackathon/drone-venv/bin/python drone/mission.py --mission-id test --out-dir /tmp --cells C-4,C-5
```

| `mission.py` 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--mission-id` | `mission_01` | 기록 파일 이름(`<id>.jsonl`)과 기록의 `mission_id` |
| `--cells` | 전체 24구역 | 비행할 구역 (예: `C-4,C-5`) |
| `--connect` | `tcp:127.0.0.1:5760` | SITL MAVLink 주소 |
| `--out-dir` | `drone/sample_flight` | 기록 파일 폴더 |

SITL을 멈출 때는 `Ctrl+C`를 씁니다. `Ctrl+Z`는 프로세스를 멈춘 채 포트를 잡고 있어서, 다음 실행이 `bind failed`로 실패합니다. 이때는 `pkill -9 arducopter`로 정리합니다.

## 팀 서버 운영

| tmux 세션 | 스크립트 | 하는 일 |
|---|---|---|
| `web` | `/data/hackathon/run-web.sh` | 웹 서버 실행. 종료되면 3초 뒤 다시 시작 |
| `web-update` | `/data/hackathon/update-web.sh` | 30초마다 `main`을 확인해 바뀌었으면 배포 폴더를 갱신하고 웹 서버를 재시작 |

`main`에 merge하면 30초 안에 공개 주소에 반영됩니다. 배포 폴더(`/data/hackathon/deploy`)에서는 코드를 고치지 않습니다.

`run-web.sh` 예시입니다. 환경 변수는 반복문 밖에서 정해야 하므로, 설정을 바꾸면 tmux `web` 세션을 통째로 다시 띄웁니다.

```bash
#!/bin/bash
export PHOTO_DIR=/data/test
cd /data/hackathon/deploy
while true; do
  HOST=0.0.0.0 PORT=8501 BASE_PATH=/i/cM6-Hw0t0JXk4-bD /data/hackathon/node20/bin/node server/index.mjs
  echo "web exited, restarting in 3s"
  sleep 3
done
```
```bash
tmux kill-session -t web
```
```bash
tmux new-session -d -s web 'bash /data/hackathon/run-web.sh'
```

## 설정값

모든 값은 환경 변수로 바꿀 수 있고, 비워 두면 아래 기본값을 씁니다. 예시 파일은 [sitl.env.example](sitl.env.example)입니다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `SITL_SPEEDUP` | `8` | 비행 배속. 화면의 비행 시간은 배속을 곱해 비행 기준으로 표시 |
| `SITL_BIN` | `/data/hackathon/ardupilot/build/sitl/bin/arducopter` | SITL 실행 파일 |
| `SITL_DEFAULTS` | `.../Tools/autotest/default_params/copter.parm` | 기체 기본 파라미터 |
| `SITL_DIR` | `/data/hackathon/sitl-run` | SITL 작업 폴더(eeprom 등) |
| `PYTHON_BIN` | `/data/hackathon/drone-venv/bin/python` | 비행 프로그램용 Python |
| `MISSION_SCRIPT` | 저장소의 `drone/mission.py` | 비행 프로그램 |
| `FLIGHT_DIR` | 저장소의 `drone/sample_flight` | 비행 기록 폴더 |

웹 서버와 모델 설정(`HOST`, `PORT`, `BASE_PATH`, `HISTORY_FILE`, `PHOTO_DIR`, `MODEL_URL`, `HOTSPOT_PHOTO_PATTERN`)은 [루트 README](../README.md#설정값)를 참고하세요.

## 비행 기록 형식

비행 프로그램은 한 줄에 하나씩 JSON을 쓰는 JSONL 파일을 남깁니다. 웹 서버는 덜 쓰인 마지막 줄을 건너뛰고 읽습니다. `t`는 비행 시작 후 **현실 초**라서, 8배속이면 비행 기준 시간은 `t × 8`입니다.

| `type` | 언제 | 주요 필드 |
|---|---|---|
| `mission_start` | 시동 직후 | `cells` (비행할 구역 목록. 24곳보다 적으면 재비행 기록) |
| `position` | 0.5초마다 | `position {x_m, y_m, rel_alt_m}`, `heading`, `battery`, `roll`, `pitch` |
| `frame` | 구역 도착(MISSION_ITEM_REACHED) | `cell_id`, `waypoint`, `source_photo`, `position`, `battery`, `vehicle_id`, `captured_at` |
| `log` | 비행 단계와 비행 제어기 메시지 | `source` (`mission` 또는 `fc`), `text` |
| `mission_end` | 착륙 후 | `frames`, `planned` |

`mission_01.jsonl`의 실제 줄입니다. 이 기록은 자세 값을 남기기 전에 만들어 `roll`, `pitch`가 없습니다.

```json
{"type": "position", "mission_id": "mission_01", "t": 19.6, "position": {"x_m": -26.8, "y_m": 26.9, "rel_alt_m": 30.5}, "heading": 134.93, "battery": 73}
{"type": "frame", "mission_id": "mission_01", "t": 30.2, "vehicle_id": "sitl_01", "cell_id": "A-1", "waypoint": 1, "source_photo": "photo_001.jpg", "position": {"x_m": 0.2, "y_m": -0.1, "rel_alt_m": 30.0}, "battery": 70, "captured_at": "2026-11-07T07:59:20"}
```

`drone/sample_flight/mission_01.jsonl`은 이륙장 출발 전체 비행 기록(342.9초, 구역 24곳)이고, `retry_01.jsonl`은 C-4, C-5 재비행 기록입니다. `live.jsonl`과 `inspection-history.json`은 웹에서 비행할 때 생기며 저장소에 올리지 않습니다(`.gitignore`).

## 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| "드론 켜는 중"이 오래 이어짐 | SITL이 첫 연결을 기다리는 중이거나 실행에 실패했습니다. `SITL_BIN` 경로와 `ls /data/hackathon/sitl-run`을 확인합니다. |
| 비행 시작이 409 | 드론이 꺼져 있거나, 준비 중이거나, 다른 비행이 진행 중입니다. 상태 표시를 확인합니다. |
| `bind failed` / 5760 사용 중 | 이전 SITL이 남아 있습니다. `pkill -9 arducopter` 뒤 다시 켭니다. |
| 비행이 "위치 확인 중"에서 멈춤 | GPS 고정 전입니다. 120초가 지나면 `gps timeout`으로 실패합니다. SITL을 껐다 켭니다. |
| 비행 계기 자세가 "근사값" | 기록에 `roll`, `pitch`가 없는 예전 기록입니다. 새로 비행하면 비행 제어기 값으로 바뀝니다. |
| 배터리가 0%에 가까움 | 같은 SITL로 여러 번 비행하면 가상 배터리가 줄어듭니다. 드론을 껐다 켜면 다시 찹니다. |
| `ModuleNotFoundError: pymavlink` | `PYTHON_BIN`이 venv의 Python을 가리키는지 확인합니다. |

## 한계

- **시뮬레이션:** 실제 기체가 아닙니다. 바람, 센서 오차, 통신 끊김은 SITL 기본값 수준만 반영합니다.
- **사진:** SITL은 사진을 찍지 않습니다. 구역 도착 시점만 기록하고, 사진은 웹 서버가 `PHOTO_DIR`에서 배정합니다.
- **공개 조작:** 공개 주소에서는 누구나 드론을 켜고 끌 수 있어, 시연 중 다른 사람의 조작으로 비행이 끊길 수 있습니다.
- **실기체 전환:** 미션과 MAVLink 명령은 그대로 쓸 수 있지만, 실제 기체에서는 카메라 연동, 안전 설정, 비행 허가가 따로 필요합니다.
