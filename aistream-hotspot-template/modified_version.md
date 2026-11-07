# 서빙 연결 변경 이력

## v0.1.4 — 2026-11-07 KST

- 사용자 요청: 판단 확률 응답 추가. 작업 사용자명 미확인, 구현/기록 Codex.
- src/hotspot_runtime.py: 기존 final_probability를 최상위 probability로 노출. is_hotspot, decision_threshold, calibrated를 함께 반환.
- 기존 이미지/마스크/영역/상세 결과 유지, CUDA 고정 유지. 개별 영역의 확률을 추가하지 않음.
- verify_local.py: 실제 모델 응답에서 확률 범위, 상세 결과와의 일치, 임계값 판정 및 보정 여부 일치 검증.
- 플랫폼 적용 및 추가 필드 UI 표시 미검증.

## v0.1.3 — 2026-11-07 KST

- 사용자 요청: 서빙 CPU/CUDA 선택 제거, CUDA 고정. 작업 사용자명 미확인, 구현/기록 Codex.
- main.py: --device 옵션 제거, run_serving(device='cuda')로 호출.
- src/serving_runtime.py 및 hotspot_runtime.py: 기본 device를 cuda로 변경. GPU 미지원 시 시작 실패 유지.
- verify_local.py: 내부 함수에 CPU를 명시해 기존 모델/API 검증 유지. CUDA 미지원 시 기본 실행 실패 검증 추가.
- 원본과 결과물의 deployment.yaml/Dockerfile은 동일. 원본에 GPU 프로필/리소스 선언 없음. 프로필 UI 소실 원인은 미확정이며 임의의 플랫폼 설정을 추가하지 않음.
- 실제 GPU 실행과 GPU 프로필 UI 표시 미검증.

## v0.1.2 — 2026-11-07 KST

- 작업 사용자: 미확인. 구현 및 기록: Codex.
- 추가 제공된 원본 model_inputs.py를 src/에 그대로 복사하여 실제 schemaVersion/inputs/model 계약으로 검증하도록 수정.
- 초기 연결본의 최상위 model.mountPath 가정은 잘못된 것으로 확인되어 제거.
- src/serving_runtime.py: 원본 /infer 경로와 SERVING_ROOT_PATH 설정 반영.
- src/hotspot_runtime.py: bboxes 및 JPEG data URI output 추가. 분할 영역의 픽셀 좌표 외접 사각형을 사용하며 라벨은 hotspot=1.
- 검증: 실제 모델로 /infer 합성 이미지 요청, 모델 입력 계약, 출력 마스크/시각화 크기, health 및 오류 응답 재검증.
- 입출력 UI 등록을 처리하는 플랫폼 빌드 코드는 제공되지 않아 포트 미표시 원인은 아직 미확정. template-inout.yaml은 기존 명세와 일치.

## v0.1.1 — 2026-11-07 KST

- 작업 사용자: 미확인. 구현 및 기록: Codex.
- template-inout.yaml: 모델 입력 model(MLFLOW_MODEL, /app/volume/models/model)과 서빙 출력 serving(SERVING, http)을 확인하고 usesMlflowRun: false를 명시.
- 원본 src_templete/template-inout.yaml에도 동일 설정을 적용하도록 인계.
- checkpoint 파라미터는 모델 입력 포트 내부의 상대 파일명이며 모델 연결을 대체하지 않음.
- 검증: YAML 구문, 포트 종류/이름/경로, 런타임 mountPath 키, ZIP 최상위 설정 포함 여부 점검. 플랫폼 빌드 및 UI 포트 표시 미검증.

## v0.1.0 — 2026-11-07 KST

- 작업 사용자: 미확인. 구현 및 기록: Codex.
- 원본: Downloads/src_templete와 제출 모델 패키지. 원본은 변경하지 않고 별도 작업 폴더에 작성.
- main.py: 기존 앵커 옵션을 checkpoint/device/임계값 옵션으로 변경, Click 단독 import 유지.
- src/hotspot_runtime.py: 플랫폼 모델 경로 검증, load_checkpoint 연결, 영상 전용 추론 및 PNG 마스크 인코딩.
- src/serving_runtime.py: FastAPI lifespan 로딩, health, multipart 추론, 오류 응답.
- pyproject.toml: TensorFlow/Ray 대신 PyTorch/Transformers/FastAPI/Uvicorn 의존성.
- template-inout.yaml: model 입력 및 serving 출력 선언.
- deployment.yaml/Dockerfile.txt: 제공 원본 유지. Dockerfile은 Dockerfile.txt의 동일 복사본.
- solar_hotspot/: 제출 소스 그대로 복사. 모델 파일 역시 원본과 동일.
- 영향: 기존 앵커 옵션 API 대신 hotspot 이미지 업로드 API 사용. 자동 외부 서비스 등록 없음.
- 검증: 최종 결과는 validation.json 참조. 플랫폼 실행/배포/GPU는 미검증.
